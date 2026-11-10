// Integration probe: checks every RCON response format the game master parses, against a live server.
import { Console } from "../src/rcon.js";
import { BLOCKS, objectiveFor } from "../src/mining.js";

const con = new Console();
const ok = (label, cond, detail = "") => console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " :: " + detail : ""}`);

const listOut = await con.send("list");
ok("list output parses", Array.isArray(await con.onlinePlayers()), listOut);

const addOut = await con.send(`scoreboard objectives add ${objectiveFor(BLOCKS[0])} minecraft.mined:minecraft.${BLOCKS[0]}`);
ok("objective add accepted", /Created new objective|already exists/.test(addOut), addOut);

await con.send(`scoreboard players set ProbeUser ${objectiveFor(BLOCKS[0])} 7`);
ok("score read", (await con.score("ProbeUser", objectiveFor(BLOCKS[0]))) === 7);
ok("missing score is null", (await con.score("NobodyHere", objectiveFor(BLOCKS[0]))) === null);

const [x, y, z] = [0, 200, 0];
await con.send(`forceload add ${x} ${z}`);
await con.send(`setblock ${x} ${y} ${z} chest replace`);
await con.send(`item replace block ${x} ${y} ${z} container.0 with oak_log 32`);
await con.send(`item replace block ${x} ${y} ${z} container.1 with oak_log 5`);
await con.send(`item replace block ${x} ${y} ${z} container.2 with cobblestone 64`);
const { counts, raw, ok: found } = await con.containerItems(x, y, z);
ok("chest read", found && counts.get("oak_log") === 37 && counts.get("cobblestone") === 64, raw);
await con.send(`setblock ${x} ${y} ${z} air`);
ok("empty position reads not-ok", !(await con.containerItems(x, y, z)).ok);
await con.send(`forceload remove ${x} ${z}`);

await con.send(`scoreboard players reset ProbeUser`);
process.exit(0);
