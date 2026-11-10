import mineflayer from "mineflayer";
import { formatEther, parseEther, decodeEventLog, keccak256, toHex } from "viem";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env, loadAbi, DATA_DIR } from "./config.js";
import { Console } from "./rcon.js";
import { MiningOracle } from "./mining.js";
import { parseHire } from "./llm.js";
import {
  publicClient, gameMasterAccount, playerAccount, agentAccount, walletFor, contracts, confirm, txLink,
} from "./chain.js";

const STATUS = ["None", "Open", "Accepted", "Paid", "Refunded"];
const escrowAbi = loadAbi("JobEscrow");

// jobId -> count of the job's item already in the chest when the job was posted (persisted).
const BASELINE_FILE = join(DATA_DIR, "job-baselines.json");
mkdirSync(DATA_DIR, { recursive: true });
const baselines = new Map(Object.entries(existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {}));
const saveBaselines = () => writeFileSync(BASELINE_FILE, JSON.stringify(Object.fromEntries(baselines), null, 2));

function jobIdFromReceipt(receipt) {
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "JobPosted") return ev.args.jobId;
    } catch {}
  }
  throw new Error("JobPosted event not found in receipt");
}
const con = new Console();
const gm = walletFor(gameMasterAccount());
const { rewards, escrow, registry } = contracts(gm);
const rewardsAbi = loadAbi("MiningRewards");
const agentNames = new Set(env.agentNames.map((n) => n.toLowerCase()));
const pendingHires = new Map(); // player -> { item, count, bounty, expires }
const fmt = (wei) => Number(formatEther(wei)).toFixed(2);

// ---------------------------------------------------------------- mining -> mint
const oracle = new MiningOracle({
  console: con,
  rewards,
  async onMinted(batch, receipt, hash) {
    const byPlayer = new Map();
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: rewardsAbi, data: log.data, topics: log.topics });
        if (ev.eventName !== "Mined") continue;
        const item = batch.find((b) => b.reportId === ev.args.reportId);
        if (!item) continue;
        const cur = byPlayer.get(item.player) ?? { wei: 0n, parts: [] };
        cur.wei += ev.args.reward;
        cur.parts.push(`${ev.args.count} ${item.block}`);
        byPlayer.set(item.player, cur);
      } catch {}
    }
    for (const [player, { wei, parts }] of byPlayer) {
      await con.tell(player, `+${fmt(wei)} ORE minted for ${parts.join(", ")}`, "green");
      console.log(`[mint] ${player} +${fmt(wei)} ORE (${parts.join(", ")}) ${txLink(hash)}`);
    }
  },
});

// ---------------------------------------------------------------- commands
const commands = {
  async wallet(player) {
    const addr = playerAccount(player).address;
    const bal = await publicClient.getBalance({ address: addr });
    const mined = await rewards.read.lifetimeMined([addr]);
    await con.tell(player, `wallet ${addr} | balance ${fmt(bal)} ORE | lifetime mined ${fmt(mined)} ORE`);
  },

  async hire(player, args) {
    if (!args) return con.tell(player, "usage: !hire <count> <item> <bounty>  or  !hire <describe what you need>", "red");
    const p = await parseHire(args);
    if (!p.understood) return con.tell(player, `can't post that job: ${p.reason}`, "red");
    if (!p.bounty_ore || p.bounty_ore <= 0) {
      return con.tell(player, `${p.count} ${p.item} understood - how much ORE will you pay? e.g. !hire ${p.count} ${p.item} 5`, "yellow");
    }
    pendingHires.set(player, { item: p.item, count: p.count, bounty: String(p.bounty_ore), expires: Date.now() + 60_000 });
    await con.tell(player, `Hire an agent: ${p.count} ${p.item} for ${p.bounty_ore} ORE, delivered to a chest next to you. Type !confirm within 60s.`, "yellow");
  },

  async confirm(player) {
    const h = pendingHires.get(player);
    pendingHires.delete(player);
    if (!h || h.expires < Date.now()) return con.tell(player, "nothing to confirm", "red");

    const pos = await con.position(player);
    if (!pos) return con.tell(player, "couldn't find your position", "red");
    const chest = await placeChest(pos);
    if (!chest) return con.tell(player, "no free space for a delivery chest next to you; move to open ground and !hire again", "red");

    // Baseline: items of this type already in the chest don't count towards this job.
    const before = await con.containerItems(chest.x, chest.y, chest.z);
    const baseline = before.counts.get(h.item) ?? 0;

    const wallet = walletFor(playerAccount(player));
    const { escrow: e } = contracts(wallet);
    try {
      const hash = await e.write.post([h.item, h.count, chest.x, chest.y, chest.z, 3600n], { value: parseEther(h.bounty) });
      const receipt = await confirm(hash);
      const jobId = jobIdFromReceipt(receipt);
      baselines.set(jobId.toString(), baseline);
      saveBaselines();
      await con.say(`Job #${jobId} posted by ${player}: ${h.count} ${h.item} -> chest at ${chest.x} ${chest.y} ${chest.z} for ${h.bounty} ORE`, "light_purple");
      console.log(`[job] #${jobId} posted ${txLink(hash)}`);
    } catch (err) {
      await con.tell(player, `posting failed: ${err.shortMessage ?? err.message}. Mine some ore for gas+bounty first.`, "red");
    }
  },

  async jobs(player) {
    const n = Number(await escrow.read.jobCount());
    const open = [];
    for (let i = Math.max(0, n - 20); i < n; i++) {
      const j = await escrow.read.getJob([BigInt(i)]);
      if (j.status === 1 || j.status === 2) open.push(`#${i} ${j.quantity} ${j.item} ${fmt(j.bounty)} ORE [${STATUS[j.status]}]`);
    }
    await con.tell(player, open.length ? open.join(" | ") : "no open jobs");
  },

  async top(player) {
    const names = Object.keys(oracle.state.reported);
    const rows = await Promise.all(names.map(async (n) => [n, await rewards.read.lifetimeMined([playerAccount(n).address])]));
    rows.sort((a, b) => (b[1] > a[1] ? 1 : -1));
    await con.tell(player, rows.slice(0, 5).map(([n, w], i) => `${i + 1}. ${n} ${fmt(w)}`).join("  ") || "nobody has mined yet");
  },

  async done(player, args) {
    const jobId = BigInt(args.split(/\s+/)[0] ?? "-1");
    await verifyAndSettle(jobId, player);
  },

  async giveup(player, args) {
    const jobId = BigInt(args.split(/\s+/)[0] ?? "-1");
    const j = await escrow.read.getJob([jobId]);
    if (j.status !== 2 || !isAgentFor(player, j.agent)) return;
    await confirm(await escrow.write.settle([jobId, false, keccak256(toHex("gave up"))]));
    await con.say(`Job #${jobId}: ${player} gave up, ${fmt(j.bounty)} ORE refunded`, "red");
  },

  async help(player) {
    await con.tell(player, "!wallet  !hire <count> <item> <bounty>  !confirm  !jobs  !top   Mine ore to mint ORE gas on MineChain.");
  },
};

/**
 * Put a delivery chest beside the player and prove it exists before any money moves.
 * `setblock ... keep` only fills air, so it never destroys blocks or another chest's contents.
 */
async function placeChest(pos) {
  const offsets = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]];
  for (const [dx, dy, dz] of offsets) {
    const c = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
    await con.send(`setblock ${c.x} ${c.y} ${c.z} chest keep`);
    if ((await con.containerItems(c.x, c.y, c.z)).ok) return c;
  }
  return null;
}

function isAgentFor(name, agentAddr) {
  const i = env.agentNames.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  return i >= 0 && agentAccount(i).address.toLowerCase() === agentAddr.toLowerCase();
}

async function verifyAndSettle(jobId, caller) {
  const j = await escrow.read.getJob([jobId]);
  if (j.status !== 2) return con.tell(caller, `job #${jobId} is ${STATUS[j.status] ?? "unknown"}`, "red");
  const { counts, raw, ok } = await con.containerItems(j.x, j.y, j.z);
  if (!ok) return con.say(`Job #${jobId}: no chest at ${j.x} ${j.y} ${j.z}`, "red");
  const baseline = baselines.get(jobId.toString());
  if (baseline === undefined) {
    // No recorded baseline (job posted outside this Oracle): never pay against pre-existing items.
    return con.say(`Job #${jobId}: no delivery baseline recorded; cannot verify`, "red");
  }
  const delivered = (counts.get(j.item) ?? 0) - baseline;
  if (delivered < j.quantity) {
    return con.say(`Job #${jobId}: ${Math.max(0, delivered)}/${j.quantity} ${j.item} delivered, not paid yet`, "yellow");
  }
  const hash = await escrow.write.settle([jobId, true, keccak256(toHex(raw))]);
  await confirm(hash);
  baselines.delete(jobId.toString());
  saveBaselines();
  await con.say(`Job #${jobId} verified: ${delivered} new ${j.item} in chest. Paid ${fmt(j.bounty)} ORE to the agent.`, "green");
  console.log(`[job] #${jobId} paid ${txLink(hash)}`);
}

async function expireOverdue() {
  const n = Number(await escrow.read.jobCount());
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (let i = 0; i < n; i++) {
    const j = await escrow.read.getJob([BigInt(i)]);
    if ((j.status === 1 || j.status === 2) && j.deadline <= now) {
      await confirm(await escrow.write.expire([BigInt(i)]));
      await con.say(`Job #${i} expired; ${fmt(j.bounty)} ORE refunded to the poster`, "gray");
    }
  }
}

async function fundAgents() {
  const starter = parseEther(env.agentStarterOre);
  for (let i = 0; i < env.agentNames.length; i++) {
    const addr = agentAccount(i).address;
    const bal = await publicClient.getBalance({ address: addr });
    if (bal < starter / 2n) {
      await confirm(await gm.sendTransaction({ to: addr, value: starter - bal }));
      console.log(`[fund] ${env.agentNames[i]} topped up to ${env.agentStarterOre} ORE for gas`);
    }
  }
}

// ---------------------------------------------------------------- bot
function startBot() {
  const bot = mineflayer.createBot({ host: env.mcHost, port: env.mcPort, username: "Oracle", version: env.mcVersion, auth: "offline" });
  bot.once("spawn", async () => {
    console.log("[gm] Oracle joined the server");
    await con.send("gamemode spectator Oracle");
    await con.say("Oracle online. Mine ore to mint ORE on MineChain. Type !help", "aqua");
  });
  bot.on("chat", async (username, message) => {
    if (username === bot.username || !message.startsWith("!")) return;
    const [cmd, ...rest] = message.slice(1).split(" ");
    const fn = commands[cmd?.toLowerCase()];
    if (!fn) return;
    try {
      await fn(username, rest.join(" ").trim());
    } catch (err) {
      console.error(`[cmd ${cmd}]`, err);
      await con.tell(username, `error: ${err.shortMessage ?? err.message}`, "red");
    }
  });
  bot.on("playerJoined", async (p) => {
    if (agentNames.has(p.username.toLowerCase())) {
      await new Promise((r) => setTimeout(r, 2000)); // let the entity spawn before reading its inventory
      const inv = await con.inventory(p.username).catch(() => new Map());
      for (const tool of ["iron_pickaxe", "iron_axe", "iron_shovel"]) {
        if (!inv.get(tool)) await con.send(`give ${p.username} ${tool}`);
      }
    }
  });
  bot.on("end", () => setTimeout(startBot, 5000));
  bot.on("error", (e) => console.error("[gm bot]", e.message));
}

async function main() {
  const chainId = await publicClient.getChainId();
  const gmBal = await publicClient.getBalance({ address: gm.account.address });
  console.log(`[gm] MineChain ${chainId} | game master ${gm.account.address} | ${fmt(gmBal)} ORE`);
  console.log(`[gm] verifier=${await escrow.read.isVerifier([gm.account.address])} gameMaster=${await rewards.read.isGameMaster([gm.account.address])} agents=${await registry.read.agentCount()}`);

  await oracle.setupObjectives();
  await fundAgents();
  oracle.run(10_000);
  setInterval(() => expireOverdue().catch((e) => console.error("[expire]", e.shortMessage ?? e.message)), 60_000);
  startBot();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
