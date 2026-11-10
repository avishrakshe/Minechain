import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, env } from "./config.js";

export const GATHERABLE = JSON.parse(readFileSync(join(ROOT, "config", "gatherable.json"), "utf8")).items;
const ITEMS = Object.keys(GATHERABLE);

const HireSchema = z.object({
  understood: z.boolean().describe("false if the request cannot be mapped to one deliverable item"),
  item: z.string().describe("one of the allowed item ids, or empty string if not understood"),
  count: z.number().int().describe("how many items, 1-256"),
  bounty_ore: z.number().describe("bounty in ORE the player offers; 0 if they did not say"),
  reason: z.string().describe("short explanation to show the player, max 15 words"),
});

const SYSTEM = `You turn Minecraft chat hiring requests into one structured delivery job for an AI worker bot.
Allowed item ids (the bot can only gather these): ${ITEMS.join(", ")}.
Map loose wording to the closest allowed id: "wood"/"logs" -> oak_log unless a species is named, "stone" -> cobblestone, "iron" -> raw_iron, "copper" -> raw_copper.
If the player asks for something the bot cannot gather (crafted items, diamonds, mob drops) or several different items, set understood=false and say why.
Never invent a bounty: use 0 when no number of ORE is stated.`;

const client = env.anthropicKey ? new Anthropic({ apiKey: env.anthropicKey }) : null;

/** Fast path for the canonical form: "<count> <item> <bounty>" e.g. "32 oak_log 5". */
export function parseExact(text) {
  const m = text.trim().match(/^(\d{1,3})\s+([a-z_]+)\s+(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const item = m[2].toLowerCase();
  if (!GATHERABLE[item]) return { understood: false, reason: `agents can't gather ${item}` };
  return { understood: true, item, count: Number(m[1]), bounty_ore: Number(m[3]), reason: "exact" };
}

/**
 * Parse a hiring request. Exact syntax skips the model; anything else goes to the LLM with a
 * schema-constrained answer, then is validated again here (the model never decides funds:
 * the bounty still has to be confirmed by the player and paid from their own wallet).
 */
export async function parseHire(text) {
  const exact = parseExact(text);
  if (exact) return exact;
  if (!client) return { understood: false, reason: "use: !hire <count> <item> <bounty>" };

  const res = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(HireSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: text.slice(0, 300) }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    return { understood: false, reason: "couldn't understand that; try !hire 32 oak_log 5" };
  }
  const out = res.parsed_output;
  if (!out.understood || !GATHERABLE[out.item]) return { understood: false, reason: out.reason };
  return { ...out, count: Math.min(256, Math.max(1, out.count)) };
}
