import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, getContract } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { env, loadAbi, loadDeployment } from "./config.js";

export const minechain = defineChain({
  id: env.chainId,
  name: "MineChain",
  nativeCurrency: { name: "ORE", symbol: "ORE", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
  blockExplorers: env.explorerUrl ? { default: { name: "Explorer", url: env.explorerUrl } } : undefined,
});

export const publicClient = createPublicClient({ chain: minechain, transport: http(env.rpcUrl) });

// Wallet derivation. All wallets are custodial and held by the server operator (disclosed in the README):
//   account 0 / index 0 -> game master (oracle + verifier)
//   account 1 / index h(name) -> player wallet
//   account 2 / index i -> AI agent wallet
export const gameMasterAccount = () => mnemonicToAccount(env.mnemonic, { accountIndex: 0, addressIndex: 0 });

export function playerIndex(name) {
  return Number(BigInt(keccak256(toHex(name.toLowerCase()))) & 0x7fffffffn);
}
export const playerAccount = (name) => mnemonicToAccount(env.mnemonic, { accountIndex: 1, addressIndex: playerIndex(name) });
export const agentAccount = (i) => mnemonicToAccount(env.mnemonic, { accountIndex: 2, addressIndex: i });

export const walletFor = (account) => createWalletClient({ account, chain: minechain, transport: http(env.rpcUrl) });

export function contracts(walletClient) {
  const d = loadDeployment();
  const client = walletClient ? { public: publicClient, wallet: walletClient } : { public: publicClient };
  return {
    deployment: d,
    rewards: getContract({ address: d.contracts.MiningRewards, abi: loadAbi("MiningRewards"), client }),
    registry: getContract({ address: d.contracts.AgentRegistry, abi: loadAbi("AgentRegistry"), client }),
    escrow: getContract({ address: d.contracts.JobEscrow, abi: loadAbi("JobEscrow"), client }),
  };
}

export async function confirm(hash) {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return r;
}

export const txLink = (hash) => (env.explorerUrl ? `${env.explorerUrl.replace(/\/$/, "")}/tx/${hash}` : hash);
export const blockTypeId = (blockId) => keccak256(toHex(blockId));
