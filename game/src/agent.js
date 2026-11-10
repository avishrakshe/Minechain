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
let bot;

async function ensureRegistered() {
  if (await registry.read.isAgent([account.address])) return;
  const hash = await registry.write.register([name, account.address]);
  await confirm(hash);
  log(`registered on-chain as ${account.address} ${txLink(hash)}`);
}

const countOf = (item) => bot.inventory.items().filter((i) => i.name === item).reduce((s, i) => s + i.count, 0);

async function findOpenJob() {
  const n = Number(await escrow.read.jobCount());
  for (let i = Math.max(0, n - 30); i < n; i++) {
    const j = await escrow.read.getJob([BigInt(i)]);
    if (j.status === 1 && GATHERABLE[j.item] && j.deadline > BigInt(Math.floor(Date.now() / 1000)) + 120n) {
      return { id: BigInt(i), ...j };
    }
  }
  return null;
}

async function gather(item, quantity, deadline) {
  const blockIds = GATHERABLE[item].map((b) => bot.registry.blocksByName[b]?.id).filter((x) => x !== undefined);
  while (countOf(item) < quantity) {
    if (Date.now() > deadline) throw new Error("ran out of time");
    let targets = bot.findBlocks({ matching: blockIds, maxDistance: 64, count: 8 });
    if (targets.length === 0) targets = bot.findBlocks({ matching: blockIds, maxDistance: 128, count: 8 });
    if (targets.length === 0) {
      // Explore: walk to a random point and look again.
      const p = bot.entity.position;
      const dx = Math.round((Math.random() - 0.5) * 80), dz = Math.round((Math.random() - 0.5) * 80);
      bot.chat(`No ${item} nearby, exploring...`);
      await bot.pathfinder.goto(new goals.GoalNearXZ(p.x + dx, p.z + dz, 4)).catch(() => {});
      continue;
    }
    const blocks = targets.map((v) => bot.blockAt(v)).filter(Boolean);
    await bot.collectBlock.collect(blocks, { ignoreNoPath: true }).catch((e) => log("collect:", e.message));
    log(`${item}: ${countOf(item)}/${quantity}`);
  }
}

async function deliver(job) {
  const target = { x: job.x, y: job.y, z: job.z };
  await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2));
  const chestBlock = bot.blockAt(new Vec3(target.x, target.y, target.z));
  if (!chestBlock || !chestBlock.name.includes("chest")) throw new Error(`no chest at ${target.x} ${target.y} ${target.z}`);
  const chest = await bot.openContainer(chestBlock);
  const itemType = bot.registry.itemsByName[job.item].id;
  await chest.deposit(itemType, null, job.quantity);
  chest.close();
}

async function work(job) {
  busy = true;
  try {
    const hash = await escrow.write.accept([job.id]);
    await confirm(hash);
  } catch (e) {
    busy = false;
    return log(`could not accept #${job.id}: ${e.shortMessage ?? e.message}`);
  }
  bot.chat(`Accepted job #${job.id}: gathering ${job.quantity} ${job.item} for ${formatEther(job.bounty)} ORE`);
  log(`accepted #${job.id}`);
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
  if (busy || !bot?.entity) return;
  const job = await findOpenJob();
  if (job) await work(job);
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
  });
  bot.on("end", () => setTimeout(start, 5000));
  bot.on("error", (e) => log("bot error:", e.message));
}

await ensureRegistered();
start();
setInterval(() => poll().catch((e) => log("poll:", e.shortMessage ?? e.message)), 5000);
