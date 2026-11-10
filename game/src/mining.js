import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, keccak256 } from "viem";
import { DATA_DIR, rates } from "./config.js";
import { blockTypeId, confirm, playerAccount } from "./chain.js";

export const BLOCKS = Object.keys(rates.rates);
export const objectiveFor = (blockId) => `pom.${blockId}`;

/**
 * Mining oracle. Reads vanilla `minecraft.mined:<block>` scoreboards over RCON and reports
 * deltas to MiningRewards. Crash safety: a batch is persisted as `pending` before it is sent
 * and replayed verbatim on restart; report ids are derived from (player, block, from, to), so
 * the contract ignores replays and no range is ever counted twice or skipped.
 */
export class MiningOracle {
  constructor({ console: con, rewards, onMinted }) {
    this.con = con;
    this.rewards = rewards;
    this.onMinted = onMinted ?? (() => {});
    this.file = join(DATA_DIR, "mining-state.json");
    mkdirSync(DATA_DIR, { recursive: true });
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, "utf8"))
      : { reported: {}, pending: null };
  }

  save() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  async setupObjectives() {
    for (const b of BLOCKS) {
      await this.con.send(`scoreboard objectives add ${objectiveFor(b)} minecraft.mined:minecraft.${b}`);
    }
  }

  async collect() {
    const items = [];
    for (const player of await this.con.onlinePlayers()) {
      const seen = (this.state.reported[player] ??= {});
      for (const b of BLOCKS) {
        const now = await this.con.score(player, objectiveFor(b));
        const from = seen[b] ?? 0;
        if (now !== null && now > from) items.push({ player, block: b, from, to: now });
      }
    }
    return items;
  }

  async tick() {
    if (!this.state.pending) {
      const items = await this.collect();
      if (items.length === 0) return;
      this.state.pending = items.map((it) => ({
        ...it,
        address: playerAccount(it.player).address,
        reportId: keccak256(
          encodeAbiParameters(
            [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }],
            [it.player.toLowerCase(), it.block, BigInt(it.from), BigInt(it.to)],
          ),
        ),
      }));
      this.save();
    }

    const batch = this.state.pending;
    const hash = await this.rewards.write.reportBatch([
      batch.map((b) => b.reportId),
      batch.map((b) => b.address),
      batch.map((b) => blockTypeId(b.block)),
      batch.map((b) => BigInt(b.to - b.from)),
    ]);
    const receipt = await confirm(hash);

    for (const b of batch) (this.state.reported[b.player] ??= {})[b.block] = b.to;
    this.state.pending = null;
    this.save();
    await this.onMinted(batch, receipt, hash);
  }

  run(intervalMs = 10_000) {
    const loop = async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error("[mining]", e.shortMessage ?? e.message);
      }
      this.timer = setTimeout(loop, intervalMs);
    };
    loop();
  }
}
