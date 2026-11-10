import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const DATA_DIR = join(here, "..", "data");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see game/.env.example)`);
  return v;
}

export const env = {
  mcHost: process.env.MC_HOST ?? "127.0.0.1",
  mcPort: Number(process.env.MC_PORT ?? 25565),
  mcVersion: process.env.MC_VERSION ?? "1.21.11",
  rconHost: process.env.RCON_HOST ?? "127.0.0.1",
  rconPort: Number(process.env.RCON_PORT ?? 25575),
  get rconPassword() {
    return need("RCON_PASSWORD");
  },
  rpcUrl: process.env.MINECHAIN_RPC_URL ?? "http://127.0.0.1:9650/ext/bc/minechain/rpc",
  chainId: Number(process.env.MINECHAIN_CHAIN_ID ?? 777333),
  explorerUrl: process.env.MINECHAIN_EXPLORER_URL || "",
  deployment: process.env.DEPLOYMENT ?? "minechain",
  get mnemonic() {
    return need("GAME_MNEMONIC");
  },
  agentNames: (process.env.AGENT_NAMES ?? "Digger,Lumberjack").split(",").map((s) => s.trim()).filter(Boolean),
  agentStarterOre: process.env.AGENT_STARTER_ORE ?? "2",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
};

export const rates = JSON.parse(readFileSync(join(ROOT, "config", "rates.json"), "utf8"));

export function loadDeployment() {
  const p = join(ROOT, "deployments", `${env.deployment}.json`);
  if (!existsSync(p)) throw new Error(`No deployment at ${p}; run contracts/scripts/deploy.ts first`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function loadAbi(name) {
  const p = join(ROOT, "contracts", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8")).abi;
}
