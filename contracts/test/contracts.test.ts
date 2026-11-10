import hre from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { keccak256, parseEther, toHex, getAddress, zeroHash } from "viem";

const NATIVE_MINTER = "0x0200000000000000000000000000000000000001";
const DIAMOND = keccak256(toHex("diamond_ore"));
const STONE = keccak256(toHex("stone"));

async function deploy() {
  const [owner, gm, player, agentWallet, outsider] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  // Install the mock precompile at the real NativeMinter address.
  const mock = await hre.viem.deployContract("MockNativeMinter");
  const code = await publicClient.getCode({ address: mock.address });
  await hre.network.provider.request({ method: "hardhat_setCode", params: [NATIVE_MINTER, code] });
  const minter = await hre.viem.getContractAt("MockNativeMinter", NATIVE_MINTER);

  const rewards = await hre.viem.deployContract("MiningRewards", [parseEther("100")]);
  await rewards.write.setGameMaster([gm.account.address, true]);
  await rewards.write.setRates([[DIAMOND, STONE], [parseEther("10"), parseEther("0.01")]]);

  const registry = await hre.viem.deployContract("AgentRegistry");
  const escrow = await hre.viem.deployContract("JobEscrow", [registry.address]);
  await registry.write.setEscrow([escrow.address]);
  await escrow.write.setVerifier([gm.account.address, true]);

  return { owner, gm, player, agentWallet, outsider, publicClient, minter, rewards, registry, escrow };
}

describe("MiningRewards", () => {
  it("mints native coin for priced blocks through the precompile", async () => {
    const { gm, player, minter, rewards } = await loadFixture(deploy);
    const r = await hre.viem.getContractAt("MiningRewards", rewards.address, { client: { wallet: gm } });
    await r.write.report([keccak256(toHex("r1")), player.account.address, DIAMOND, 3n]);
    expect(await minter.read.minted([player.account.address])).to.equal(parseEther("30"));
    expect(await rewards.read.totalMinted()).to.equal(parseEther("30"));
  });

  it("is idempotent per report id", async () => {
    const { gm, player, minter, rewards } = await loadFixture(deploy);
    const r = await hre.viem.getContractAt("MiningRewards", rewards.address, { client: { wallet: gm } });
    const id = keccak256(toHex("same"));
    await r.write.report([id, player.account.address, DIAMOND, 1n]);
    await r.write.report([id, player.account.address, DIAMOND, 1n]);
    expect(await minter.read.minted([player.account.address])).to.equal(parseEther("10"));
  });

  it("enforces the daily cap and resets next day", async () => {
    const { gm, player, minter, rewards } = await loadFixture(deploy);
    const r = await hre.viem.getContractAt("MiningRewards", rewards.address, { client: { wallet: gm } });
    await r.write.report([keccak256(toHex("a")), player.account.address, DIAMOND, 15n]); // 150 > cap 100
    expect(await minter.read.minted([player.account.address])).to.equal(parseEther("100"));
    await r.write.report([keccak256(toHex("b")), player.account.address, DIAMOND, 1n]);
    expect(await minter.read.minted([player.account.address])).to.equal(parseEther("100"));
    await time.increase(86_400);
    await r.write.report([keccak256(toHex("c")), player.account.address, DIAMOND, 1n]);
    expect(await minter.read.minted([player.account.address])).to.equal(parseEther("110"));
  });

  it("ignores unpriced blocks and rejects non game masters", async () => {
    const { gm, player, outsider, minter, rewards } = await loadFixture(deploy);
    const r = await hre.viem.getContractAt("MiningRewards", rewards.address, { client: { wallet: gm } });
    await r.write.report([keccak256(toHex("dirt")), player.account.address, keccak256(toHex("dirt")), 64n]);
    expect(await minter.read.minted([player.account.address])).to.equal(0n);

    const o = await hre.viem.getContractAt("MiningRewards", rewards.address, { client: { wallet: outsider } });
    await expect(o.write.report([keccak256(toHex("x")), outsider.account.address, DIAMOND, 1n])).to.be.rejectedWith(
      "NotGameMaster",
    );
  });

  it("applies batches", async () => {
    const { gm, player, outsider, minter, rewards } = await loadFixture(deploy);
    const r = await hre.viem.getContractAt("MiningRewards", rewards.address, { client: { wallet: gm } });
    await r.write.reportBatch([
      [keccak256(toHex("1")), keccak256(toHex("2"))],
      [player.account.address, outsider.account.address],
      [STONE, DIAMOND],
      [100n, 2n],
    ]);
    expect(await minter.read.minted([player.account.address])).to.equal(parseEther("1"));
    expect(await minter.read.minted([outsider.account.address])).to.equal(parseEther("20"));
  });
});

describe("JobEscrow", () => {
  async function withJob() {
    const f = await deploy();
    const asPlayer = await hre.viem.getContractAt("JobEscrow", f.escrow.address, { client: { wallet: f.player } });
    await asPlayer.write.post(["oak_log", 32, 10, 64, -5, 3600n], { value: parseEther("5") });
    const asAgent = await hre.viem.getContractAt("JobEscrow", f.escrow.address, { client: { wallet: f.agentWallet } });
    const agentReg = await hre.viem.getContractAt("AgentRegistry", f.registry.address, {
      client: { wallet: f.agentWallet },
    });
    const asGm = await hre.viem.getContractAt("JobEscrow", f.escrow.address, { client: { wallet: f.gm } });
    return { ...f, asPlayer, asAgent, agentReg, asGm };
  }

  it("pays the agent on verified delivery and records reputation", async () => {
    const { asAgent, agentReg, asGm, agentWallet, publicClient, registry } = await loadFixture(withJob);
    await agentReg.write.register(["Digger", agentWallet.account.address]);
    await asAgent.write.accept([0n]);
    const before = await publicClient.getBalance({ address: agentWallet.account.address });
    await asGm.write.settle([0n, true, zeroHash]);
    const after = await publicClient.getBalance({ address: agentWallet.account.address });
    expect(after - before).to.equal(parseEther("5"));
    const a = await registry.read.getAgent([agentWallet.account.address]);
    expect(a.completed).to.equal(1);
    expect(a.earned).to.equal(parseEther("5"));
  });

  it("refunds the poster when delivery fails", async () => {
    const { asAgent, agentReg, asGm, agentWallet, player, publicClient, registry } = await loadFixture(withJob);
    await agentReg.write.register(["Digger", agentWallet.account.address]);
    await asAgent.write.accept([0n]);
    const before = await publicClient.getBalance({ address: player.account.address });
    await asGm.write.settle([0n, false, zeroHash]);
    const after = await publicClient.getBalance({ address: player.account.address });
    expect(after - before).to.equal(parseEther("5"));
    expect((await registry.read.getAgent([agentWallet.account.address])).failed).to.equal(1);
  });

  it("only registered agents can accept, only verifiers can settle", async () => {
    const { asAgent, asPlayer, agentReg, agentWallet } = await loadFixture(withJob);
    await expect(asAgent.write.accept([0n])).to.be.rejectedWith("NotAgent");
    await agentReg.write.register(["Digger", agentWallet.account.address]);
    await asAgent.write.accept([0n]);
    await expect(asPlayer.write.settle([0n, true, zeroHash])).to.be.rejectedWith("NotVerifier");
  });

  it("anyone can expire an overdue job back to the poster", async () => {
    const { asAgent, agentReg, agentWallet, escrow, outsider } = await loadFixture(withJob);
    await agentReg.write.register(["Digger", agentWallet.account.address]);
    await asAgent.write.accept([0n]);
    const asOutsider = await hre.viem.getContractAt("JobEscrow", escrow.address, { client: { wallet: outsider } });
    await expect(asOutsider.write.expire([0n])).to.be.rejectedWith("NotExpired");
    await time.increase(3601);
    await asOutsider.write.expire([0n]);
    const job = await escrow.read.getJob([0n]);
    expect(job.status).to.equal(4); // Refunded
    expect(getAddress(job.poster)).to.not.equal(getAddress(outsider.account.address));
  });

  it("poster can cancel an unaccepted job; settled jobs cannot be settled twice", async () => {
    const { asPlayer, asAgent, agentReg, agentWallet, asGm } = await loadFixture(withJob);
    await asPlayer.write.post(["cobblestone", 64, 0, 64, 0, 600n], { value: parseEther("1") });
    await asPlayer.write.cancel([1n]);
    await agentReg.write.register(["Digger", agentWallet.account.address]);
    await asAgent.write.accept([0n]);
    await asGm.write.settle([0n, true, zeroHash]);
    await expect(asGm.write.settle([0n, true, zeroHash])).to.be.rejectedWith("BadStatus");
  });

  it("agent names are unique", async () => {
    const { agentReg, agentWallet, registry, outsider } = await loadFixture(withJob);
    await agentReg.write.register(["Digger", agentWallet.account.address]);
    const other = await hre.viem.getContractAt("AgentRegistry", registry.address, { client: { wallet: outsider } });
    await expect(other.write.register(["Digger", outsider.account.address])).to.be.rejectedWith("NameTaken");
  });
});
