import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

import { config as loadEnv } from "dotenv";
loadEnv({ path: "../game/.env" });

// Deployer = game master = account 0 of GAME_MNEMONIC (same derivation as game/src/chain.js).
const mnemonic = process.env.GAME_MNEMONIC;
const accounts = mnemonic
  ? { mnemonic, path: "m/44'/60'/0'/0", initialIndex: 0, count: 1 }
  : process.env.DEPLOYER_PRIVATE_KEY
    ? [process.env.DEPLOYER_PRIVATE_KEY]
    : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai" },
  },
  networks: {
    fuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts,
    },
    // MineChain L1. RPC URL and chain id come from the L1 you create in the Builder Console.
    minechain: {
      url: process.env.MINECHAIN_RPC_URL ?? "http://127.0.0.1:9650/ext/bc/minechain/rpc",
      chainId: process.env.MINECHAIN_CHAIN_ID ? Number(process.env.MINECHAIN_CHAIN_ID) : undefined,
      accounts,
    },
    // MineChain L1 on Fuji (Subnet 2j4SbQdF…, blockchain 9jQgm4HW…). RPC from the validator node.
    minechainFuji: {
      url:
        process.env.MINECHAIN_FUJI_RPC_URL ??
        "http://127.0.0.1:9650/ext/bc/9jQgm4HWWJzvT38n4NtMEDXuFRd6AWqjEXjYXjceMDiLsTarh/rpc",
      chainId: 777333,
      accounts,
    },
  },
};

export default config;
