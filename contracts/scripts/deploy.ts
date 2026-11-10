import hre from "hardhat";
import { keccak256, parseEther, toHex, getAddress, defineChain, type Address } from "viem";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NATIVE_MINTER = "0x0200000000000000000000000000000000000001" as const;
const ALLOW_LIST_ABI = [
  { type: "function", name: "setEnabled", stateMutability: "nonpayable", inputs: [{ name: "addr", type: "address" }], outputs: [] },
  { type: "function", name: "readAllowList", stateMutability: "view", inputs: [{ name: "addr", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const net = hre.network.name;
  // hardhat-viem only knows chains bundled with viem; describe MineChain explicitly.
  const isMineChain = net.startsWith("minechain");
  const chain =
    isMineChain
      ? defineChain({
          id: Number(process.env.MINECHAIN_CHAIN_ID ?? 777333),
          name: "MineChain",
          nativeCurrency: { name: "ORE", symbol: "ORE", decimals: 18 },
          rpcUrls: { default: { http: [(hre.network.config as { url: string }).url] } },
        })
      : undefined;
  const publicClient = await hre.viem.getPublicClient(chain ? { chain } : undefined);
  const [deployer] = await hre.viem.getWalletClients(chain ? { chain } : undefined);
  const client = { public: publicClient, wallet: deployer };
  const chainId = await publicClient.getChainId();
  const fromBlock = Number(await publicClient.getBlockNumber());
  const gameMaster = getAddress((process.env.GAME_MASTER_ADDRESS ?? deployer.account.address) as Address);

  const cfg = JSON.parse(readFileSync(join(__dirname, "../../config/rates.json"), "utf8"));
  const blockIds = Object.keys(cfg.rates);
  const types = blockIds.map((id) => keccak256(toHex(id)));
  const amounts = blockIds.map((id) => parseEther(cfg.rates[id]));

  console.log(`network=${net} chainId=${chainId} deployer=${deployer.account.address} gameMaster=${gameMaster}`);

  const rewards = await hre.viem.deployContract("MiningRewards", [parseEther(cfg.dailyCapOre)], { client });
  console.log("MiningRewards", rewards.address);
  await wait(publicClient, await rewards.write.setGameMaster([gameMaster, true]));
  await wait(publicClient, await rewards.write.setRates([types, amounts]));

  const registry = await hre.viem.deployContract("AgentRegistry", [], { client });
  console.log("AgentRegistry", registry.address);
  const escrow = await hre.viem.deployContract("JobEscrow", [registry.address], { client });
  console.log("JobEscrow", escrow.address);
  await wait(publicClient, await registry.write.setEscrow([escrow.address]));
  await wait(publicClient, await escrow.write.setVerifier([gameMaster, true]));

  // On MineChain the NativeMinter precompile exists; grant mint rights to MiningRewards only.
  let minterEnabled = false;
  const precompileCode = await publicClient.getCode({ address: NATIVE_MINTER });
  if (isMineChain) {
    const hash = await deployer.writeContract({
      address: NATIVE_MINTER,
      abi: ALLOW_LIST_ABI,
      functionName: "setEnabled",
      args: [rewards.address],
    });
    await wait(publicClient, hash);
    const role = await publicClient.readContract({
      address: NATIVE_MINTER,
      abi: ALLOW_LIST_ABI,
      functionName: "readAllowList",
      args: [rewards.address],
    });
    minterEnabled = role >= 1n;
    console.log(`NativeMinter role for MiningRewards = ${role}`);
  } else {
    console.log(`Not MineChain (precompile code: ${precompileCode ?? "none"}); mint calls will revert here.`);
  }

  const out = {
    network: net,
    chainId,
    fromBlock,
    deployedAt: new Date().toISOString(),
    deployer: deployer.account.address,
    gameMaster,
    nativeMinterEnabled: minterEnabled,
    contracts: { MiningRewards: rewards.address, AgentRegistry: registry.address, JobEscrow: escrow.address },
  };
  const dir = join(__dirname, "../../deployments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${net}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote deployments/${net}.json`);
}

async function wait(client: Awaited<ReturnType<typeof hre.viem.getPublicClient>>, hash: `0x${string}`) {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx ${hash} reverted`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
