import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import collectBlockPkg from "mineflayer-collectblock";
import { Vec3 } from "vec3";
import { formatEther } from "viem";
import { env } from "./config.js";
import { GATHERABLE } from "./llm.js";
import { agentAccount, walletFor, contracts, confirm, publicClient, txLink } from "./chain.js";

const { pathfinder, Movements, goals } = pathfinderPkg;
const collectBlock = collectBlockPkg.plugin;

const index = Number(process.argv[2] ?? 0);
const name = env.agentNames[index];
if (!name) throw new Error(`No agent at index ${index}; AGENT_NAMES=${env.agentNames.join(",")}`);

const account = agentAccount(index);
const wallet = walletFor(account);
const { escrow, registry } = contracts(wallet);
const log = (...a) => console.log(`[${name}]`, ...a);
const WORK_TIMEOUT_MS = 15 * 60_000;

let busy = false;
let ready = false; // set once surrounding chunks are loaded, so feasibility checks see real terrain
let bot;

async function ensureRegistered() {
  if (await registry.read.isAgent([account.address])) return;
  const hash = await registry.write.register([name, account.address]);
  await confirm(hash);
  log(`registered on-chain as ${account.address} ${txLink(hash)}`);
}

const countOf = (item) => bot.inventory.items().filter((i) => i.name === item).reduce((s, i) => s + i.count, 0);

const SEARCH_RADIUS = 96;
const STALL_MS = 3 * 60_000;
const skipped = new Set(); // job ids judged infeasible, so we don't re-announce them every poll

const sourceIds = (item) => GATHERABLE[item].map((b) => bot.registry.blocksByName[b]?.id).filter((x) => x !== undefined);

/** Can this agent source the item from where it stands? Checked before accepting a job. */
function feasible(item) {
  if (!GATHERABLE[item]) return false;
  return bot.findBlocks({ matching: sourceIds(item), maxDistance: SEARCH_RADIUS, count: 1 }).length > 0;
}

/** Jobs this agent already accepted come first (resume after restart), then open jobs it can do. */
async function findJob() {
  const n = Number(await escrow.read.jobCount());
  const now = BigInt(Math.floor(Date.now() / 1000));
  const jobs = [];
  for (let i = Math.max(0, n - 30); i < n; i++) jobs.push({ id: BigInt(i), ...(await escrow.read.getJob([BigInt(i)])) });

  const mine = jobs.find((j) => j.status === 2 && j.agent.toLowerCase() === account.address.toLowerCase());
  if (mine) return { job: mine, resume: true };

  for (const j of jobs) {
    if (j.status !== 1 || j.deadline <= now + 120n || skipped.has(j.id)) continue;
    if (feasible(j.item)) return { job: j, resume: false };
    skipped.add(j.id);
    log(`skipping #${j.id}: no ${j.item} within ${SEARCH_RADIUS} blocks`);
    bot.chat(`Can't take job #${j.id}: no ${j.item} near me.`);
  }
  return null;
}

async function gather(item, quantity, deadline) {
  const blockIds = sourceIds(item);
  let lastCount = countOf(item);
  let lastProgress = Date.now();
  while (countOf(item) < quantity) {
    if (Date.now() > deadline) throw new Error("ran out of time");
    if (countOf(item) > lastCount) {
      lastCount = countOf(item);
      lastProgress = Date.now();
    } else if (Date.now() - lastProgress > STALL_MS) {
      throw new Error(`no ${item} progress for ${STALL_MS / 60_000} minutes`);
    }
    let targets = bot.findBlocks({ matching: blockIds, maxDistance: 64, count: 8 });
    if (targets.length === 0) targets = bot.findBlocks({ matching: blockIds, maxDistance: 128, count: 8 });
    if (targets.length === 0) {
      // Explore: walk to a random point and look again.
      const p = bot.entity.position;
      const dx = Math.round((Math.random() - 0.5) * 80), dz = Math.round((Math.random() - 0.5) * 80);
      bot.chat(`No ${item} nearby, exploring...`);
      await withTimeout(bot.pathfinder.goto(new goals.GoalNearXZ(p.x + dx, p.z + dz, 4)), 60_000).catch(() => bot.pathfinder.stop());
      continue;
    }
    // One block per call with a hard timeout: an unreachable target (e.g. a log high in a tree)
    // otherwise leaves collect() pending forever and the stall guard above never runs.
    for (const v of targets) {
      if (countOf(item) >= quantity) break;
      const block = bot.blockAt(v);
      if (!block || !blockIds.includes(block.type)) continue;
      try {
        await withTimeout(bot.collectBlock.collect(block, { ignoreNoPath: true }), COLLECT_TIMEOUT_MS);
      } catch (e) {
        log("collect:", e.message);
        bot.collectBlock.cancelTask?.().catch?.(() => {});
        bot.pathfinder.stop();
      }
      log(`${item}: ${countOf(item)}/${quantity}`);
    }
  }
}

const COLLECT_TIMEOUT_MS = 45_000;
function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => (t = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms))),
  ]);
}

async function deliver(job) {
  const target = { x: job.x, y: job.y, z: job.z };
  await withTimeout(bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2)), 5 * 60_000);
  const chestBlock = bot.blockAt(new Vec3(target.x, target.y, target.z));
  if (!chestBlock || !chestBlock.name.includes("chest")) throw new Error(`no chest at ${target.x} ${target.y} ${target.z}`);
  const before = countOf(job.item);
  const chest = await bot.openContainer(chestBlock);
  const itemType = bot.registry.itemsByName[job.item].id;
  await chest.deposit(itemType, null, job.quantity);
  chest.close();
  await new Promise((r) => setTimeout(r, 750)); // let the server apply the window transaction
  const moved = before - countOf(job.item);
  // Only claim delivery when the items actually left our inventory; the Oracle double-checks the chest anyway.
  if (moved < job.quantity) throw new Error(`deposit only moved ${moved}/${job.quantity} ${job.item}`);
}

async function work(job, resume) {
  busy = true;
  if (resume) {
    if (!feasible(job.item)) {
      log(`resumed #${job.id} but no ${job.item} nearby; giving up so the poster is refunded`);
      bot.chat(`!giveup ${job.id}`);
      busy = false;
      return;
    }
    bot.chat(`Resuming job #${job.id}: ${job.quantity} ${job.item}`);
  } else {
    try {
      await confirm(await escrow.write.accept([job.id]));
    } catch (e) {
      busy = false;
      return log(`could not accept #${job.id}: ${e.shortMessage ?? e.message}`);
    }
    bot.chat(`Accepted job #${job.id}: gathering ${job.quantity} ${job.item} for ${formatEther(job.bounty)} ORE`);
    log(`accepted #${job.id}`);
  }
  try {
    await gather(job.item, job.quantity, Date.now() + WORK_TIMEOUT_MS);
    bot.chat(`Got ${job.quantity} ${job.item}, delivering to ${job.x} ${job.y} ${job.z}`);
    await deliver(job);
    bot.chat(`!done ${job.id}`);
  } catch (e) {
    log(`job #${job.id} failed: ${e.message}`);
    bot.chat(`!giveup ${job.id}`);
  } finally {
    busy = false;
  }
}

async function poll() {
  if (busy || !ready || !bot?.entity) return;
  const found = await findJob();
  if (found) await work(found.job, found.resume);
}

function start() {
  bot = mineflayer.createBot({ host: env.mcHost, port: env.mcPort, username: name, version: env.mcVersion, auth: "offline" });
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.once("spawn", async () => {
    const moves = new Movements(bot);
    moves.canDig = true;
    bot.pathfinder.setMovements(moves);
    const bal = await publicClient.getBalance({ address: account.address });
    log(`spawned | wallet ${account.address} | ${formatEther(bal)} ORE`);
    bot.chat(`${name} reporting for work. Wallet ${account.address.slice(0, 10)}...`);
    await bot.waitForChunksToLoad().catch(() => {});
    ready = true;
  });
  bot.on("end", () => {
    ready = false;
    setTimeout(start, 5000);
  });
  bot.on("error", (e) => log("bot error:", e.message));
}

await ensureRegistered();
start();
setInterval(() => poll().catch((e) => log("poll:", e.shortMessage ?? e.message)), 5000);
