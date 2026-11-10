import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const pk = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = pk ? [pk] : [];

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
  },
};

export default config;
