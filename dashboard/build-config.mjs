// Writes dashboard/config.json from a deployment record + RPC settings.
// Usage: node dashboard/build-config.mjs <deployment-name> <rpcUrl> [explorerUrl] [networkLabel]
import { readFileSync, writeFileSync } from "node:fs";

const [name = "minechain", rpcUrl, explorerUrl = "", network = ""] = process.argv.slice(2);
if (!rpcUrl) {
  console.error("usage: node dashboard/build-config.mjs <deployment-name> <rpcUrl> [explorerUrl] [networkLabel]");
  process.exit(1);
}
const d = JSON.parse(readFileSync(new URL(`../deployments/${name}.json`, import.meta.url), "utf8"));
const rates = JSON.parse(readFileSync(new URL("../config/rates.json", import.meta.url), "utf8"));

const cfg = {
  network,
  chainId: d.chainId,
  rpcUrl,
  explorerUrl: explorerUrl.replace(/\/$/, ""),
  fromBlock: d.fromBlock ?? 0,
  contracts: d.contracts,
  blocks: Object.keys(rates.rates),
};
writeFileSync(new URL("./config.json", import.meta.url), JSON.stringify(cfg, null, 2) + "\n");
console.log(`dashboard/config.json -> chain ${cfg.chainId} @ ${rpcUrl}`);
