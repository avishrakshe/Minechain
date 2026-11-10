// End-to-end in-game test with a simulated player "Tester":
//  1) really digs diamond_ore blocks (vanilla mined-stat increments -> Oracle mints ORE)
//  2) hires an agent through chat (!hire / !confirm) and waits for the job to be verified and paid.
import mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { env } from "../src/config.js";
import { Console } from "../src/rcon.js";

const NAME = process.argv[2] ?? "Tester";
const HIRE = process.argv[3] ?? "4 oak_log 2";
const con = new Console();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const bot = mineflayer.createBot({ host: env.mcHost, port: env.mcPort, username: NAME, version: env.mcVersion, auth: "offline" });
bot.on("messagestr", (m) => {
  if (m.includes("[MineChain]") || m.includes("<")) log("chat:", m);
  if (/Job #\d+ verified/.test(m)) {
    log("RESULT: job verified and paid");
    finish(0);
  }
});
bot.on("error", (e) => log("error", e.message));

function finish(code) {
  setTimeout(() => process.exit(code), 3000);
}

bot.once("spawn", async () => {
  log("spawned at", bot.entity.position.floored().toString());
  await sleep(2000);
  await con.send(`gamemode survival ${NAME}`);
  await con.send(`clear ${NAME}`);
  await con.send(`give ${NAME} iron_pickaxe`);
  await sleep(1000);

  // 1) Mine 3 diamond ore for real.
  const p = bot.entity.position.floored();
  for (let i = 0; i < 3; i++) {
    const pos = p.offset(-2, i, 0);
    await con.send(`setblock ${pos.x} ${pos.y} ${pos.z} diamond_ore replace`);
    await sleep(300);
    const pick = bot.inventory.items().find((it) => it.name === "iron_pickaxe");
    if (pick) await bot.equip(pick, "hand");
    const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
    log("digging", block?.name, "at", pos.toString());
    await bot.dig(block, true).catch((e) => log("dig failed:", e.message));
  }
  log("mined 3 diamond_ore; waiting for Oracle mint...");
  await sleep(25_000);
  bot.chat("!wallet");
  await sleep(3000);

  // 2) Hire an agent.
  bot.chat(`!hire ${HIRE}`);
  await sleep(4000);
  bot.chat("!confirm");
  log("hired; waiting for agent to deliver (up to 15 min)...");
  setTimeout(() => {
    log("RESULT: timed out waiting for delivery");
    finish(1);
  }, 15 * 60_000);
});
