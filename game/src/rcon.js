import { Rcon } from "rcon-client";
import { env } from "./config.js";

/** Serialized RCON connection with lazy reconnect. */
export class Console {
  #rcon = null;
  #queue = Promise.resolve();

  async #conn() {
    if (this.#rcon?.authenticated) return this.#rcon;
    this.#rcon = await Rcon.connect({ host: env.rconHost, port: env.rconPort, password: env.rconPassword });
    this.#rcon.on("end", () => (this.#rcon = null));
    return this.#rcon;
  }

  send(cmd) {
    const run = this.#queue.then(async () => {
      const c = await this.#conn();
      return c.send(cmd);
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async onlinePlayers() {
    const out = await this.send("list");
    const names = out.split(":")[1] ?? "";
    return names.split(",").map((s) => s.trim()).filter(Boolean);
  }

  /** @returns {Promise<number|null>} null when the player has no score yet */
  async score(player, objective) {
    const out = await this.send(`scoreboard players get ${player} ${objective}`);
    const m = out.match(/has (-?\d+) \[/);
    return m ? Number(m[1]) : null;
  }

  async position(player) {
    const out = await this.send(`data get entity ${player} Pos`);
    const m = out.match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
    if (!m) return null;
    return { x: Math.floor(Number(m[1])), y: Math.floor(Number(m[2])), z: Math.floor(Number(m[3])) };
  }

  /** Count items in a container block. Returns Map<itemId, count> and the raw snapshot. */
  async containerItems(x, y, z) {
    const raw = await this.send(`data get block ${x} ${y} ${z} Items`);
    const counts = new Map();
    if (!raw.includes("has the following block data")) return { counts, raw, ok: false };
    for (const entry of topLevelObjects(raw.slice(raw.indexOf("["))))
    {
      const id = entry.match(/id:\s*"minecraft:([a-z0-9_]+)"/)?.[1];
      const count = Number(entry.match(/count:\s*(\d+)/)?.[1] ?? 1);
      if (id) counts.set(id, (counts.get(id) ?? 0) + count);
    }
    return { counts, raw, ok: true };
  }

  /** Item totals in an online player's inventory. */
  async inventory(player) {
    const raw = await this.send(`data get entity ${player} Inventory`);
    const totals = new Map();
    for (const e of topLevelObjects(raw.slice(Math.max(0, raw.indexOf("["))))) {
      const id = e.match(/id:\s*"minecraft:([a-z0-9_]+)"/)?.[1];
      if (id) totals.set(id, (totals.get(id) ?? 0) + Number(e.match(/count:\s*(\d+)/)?.[1] ?? 1));
    }
    return totals;
  }

  tell(player, text, color = "gold") {
    return this.send(`tellraw ${player} ${JSON.stringify([{ text: "[MineChain] ", color: "aqua" }, { text, color }])}`);
  }

  say(text, color = "yellow") {
    return this.send(`tellraw @a ${JSON.stringify([{ text: "[MineChain] ", color: "aqua" }, { text, color }])}`);
  }
}

/** Split an SNBT list into its top-level {...} entries, respecting nesting and quoted strings. */
export function topLevelObjects(s) {
  const out = [];
  let depth = 0, start = -1, inStr = false, quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; }
    else if (ch === "{") { if (depth++ === 0) start = i; }
    else if (ch === "}") { if (--depth === 0 && start >= 0) out.push(s.slice(start, i + 1)); }
  }
  return out;
}
