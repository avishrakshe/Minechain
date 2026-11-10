import { test } from "node:test";
import assert from "node:assert/strict";
import { topLevelObjects } from "../src/rcon.js";
import { parseExact } from "../src/llm.js";

test("splits SNBT chest contents including nested components", () => {
  const raw =
    'Chest has the following block data: [{Slot: 0b, count: 32, id: "minecraft:oak_log"}, ' +
    '{Slot: 1b, components: {"minecraft:custom_name": \'{"text":"a}b"}\'}, count: 5, id: "minecraft:oak_log"}, ' +
    '{Slot: 2b, count: 64, id: "minecraft:cobblestone"}]';
  const entries = topLevelObjects(raw.slice(raw.indexOf("[")));
  assert.equal(entries.length, 3);
  const counts = new Map();
  for (const e of entries) {
    const id = e.match(/id:\s*"minecraft:([a-z0-9_]+)"/)[1];
    counts.set(id, (counts.get(id) ?? 0) + Number(e.match(/count:\s*(\d+)/)[1]));
  }
  assert.equal(counts.get("oak_log"), 37);
  assert.equal(counts.get("cobblestone"), 64);
});

test("exact hire syntax is parsed without the model", () => {
  assert.deepEqual(parseExact("32 oak_log 5"), { understood: true, item: "oak_log", count: 32, bounty_ore: 5, reason: "exact" });
  assert.equal(parseExact("2 diamond 50").understood, false);
  assert.equal(parseExact("bring me some wood"), null);
});
