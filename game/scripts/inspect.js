// Debug helper: print a player's/bot's position and inventory totals via RCON.
// Usage: node scripts/inspect.js <playerName>
import { Console, topLevelObjects } from "../src/rcon.js";

const name = process.argv[2];
if (!name) throw new Error("usage: node scripts/inspect.js <playerName>");
const con = new Console();
console.log(await con.send(`data get entity ${name} Pos`));
const raw = await con.send(`data get entity ${name} Inventory`);
const totals = new Map();
for (const e of topLevelObjects(raw.slice(raw.indexOf("[")))) {
  const id = e.match(/id:\s*"minecraft:([a-z0-9_]+)"/)?.[1];
  if (id) totals.set(id, (totals.get(id) ?? 0) + Number(e.match(/count:\s*(\d+)/)?.[1] ?? 1));
}
console.log(Object.fromEntries(totals));
process.exit(0);
