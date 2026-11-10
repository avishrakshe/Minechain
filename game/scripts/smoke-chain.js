// Chain-only smoke test against a live MineChain: real NativeMinter issuance, then a full escrow cycle.
// Uses a throwaway player name so it never touches real players' scoreboard state.
import { formatEther, parseEther, keccak256, toHex } from "viem";
import { publicClient, gameMasterAccount, playerAccount, agentAccount, walletFor, contracts, confirm, blockTypeId } from "../src/chain.js";
import { env } from "../src/config.js";

const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " :: " + detail : ""}`);
  if (!cond) process.exitCode = 1;
};
const bal = (a) => publicClient.getBalance({ address: a });

const gm = walletFor(gameMasterAccount());
const c = contracts(gm);
const player = playerAccount(`smoke-${Date.now()}`);
const agentIdx = env.agentNames.length; // an index no real agent uses
const agent = agentAccount(agentIdx);

// 1. Mining report -> real native mint
const before = await bal(player.address);
const reportId = keccak256(toHex(`smoke-report-${player.address}`));
await confirm(await c.rewards.write.report([reportId, player.address, blockTypeId("diamond_ore"), 2n]));
const minted = (await bal(player.address)) - before;
ok("diamond_ore x2 mints 20 ORE natively", minted === parseEther("20"), `${formatEther(minted)} ORE`);

await confirm(await c.rewards.write.report([reportId, player.address, blockTypeId("diamond_ore"), 2n]));
ok("replayed report mints nothing", (await bal(player.address)) - before === parseEther("20"));

// 2. Player (paying gas in ORE it just mined) posts a job
const p = contracts(walletFor(player));
const jobId = await c.escrow.read.jobCount();
await confirm(await p.escrow.write.post(["oak_log", 4, 0, 64, 0, 600n], { value: parseEther("5") }));
ok("player posts job with mined ORE", (await c.escrow.read.getJob([jobId])).status === 1);

// 3. Agent: gas top-up from the game master, register, accept
await confirm(await gm.sendTransaction({ to: agent.address, value: parseEther("1") }));
const a = contracts(walletFor(agent));
if (!(await c.registry.read.isAgent([agent.address]))) {
  await confirm(await a.registry.write.register([`Smoke${Date.now() % 100000}`, agent.address]));
}
await confirm(await a.escrow.write.accept([jobId]));
ok("agent accepts", (await c.escrow.read.getJob([jobId])).status === 2);

// 4. Verifier settles -> agent paid, reputation recorded
const agentBefore = await bal(agent.address);
await confirm(await c.escrow.write.settle([jobId, true, keccak256(toHex("smoke chest snapshot"))]));
ok("agent receives 5 ORE bounty", (await bal(agent.address)) - agentBefore === parseEther("5"));
const rec = await c.registry.read.getAgent([agent.address]);
ok("reputation recorded", rec.completed >= 1, `completed=${rec.completed}`);
console.log(`totalMinted=${formatEther(await c.rewards.read.totalMinted())} ORE, block=${await publicClient.getBlockNumber()}`);
