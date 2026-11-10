// Builds l1/genesis.minechain.json from an avalanche-cli generated template (which carries the
// PoA ValidatorManager proxy/implementation allocs and warpConfig) plus MineChain's own settings.
// Usage: node l1/build-genesis.mjs <template.genesis.json> <deployerAddress>
import { readFileSync, writeFileSync } from "node:fs";

const [templatePath, deployer] = process.argv.slice(2);
if (!templatePath || !/^0x[0-9a-fA-F]{40}$/.test(deployer ?? "")) {
  console.error("usage: node l1/build-genesis.mjs <template.genesis.json> <0xDeployer>");
  process.exit(1);
}

// The ewoq key's private key is public; anything it holds on a reachable chain can be taken.
const EWOQ = "8db97c7cece249c2b98bdc0226cc4c2a57bf52fc";

const g = JSON.parse(readFileSync(templatePath, "utf8"));
delete g.alloc[EWOQ];
g.alloc[deployer.slice(2).toLowerCase()] = { balance: "0x" + (1000n * 10n ** 18n).toString(16) }; // 1,000 ORE

g.config.chainId = 777333;
g.config.contractNativeMinterConfig = { blockTimestamp: 0, adminAddresses: [deployer] };
g.config.contractDeployerAllowListConfig = { blockTimestamp: 0, adminAddresses: [deployer] };

writeFileSync(new URL("./genesis.minechain.json", import.meta.url), JSON.stringify(g, null, 2) + "\n");
console.log("allocs:", Object.keys(g.alloc).join(", "));
console.log("precompiles:", Object.keys(g.config).filter((k) => k.endsWith("Config")).join(", "));
