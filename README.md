# Proof-of-Mining

**Mine blocks in Minecraft, mint gas on your own Avalanche L1, and hire AI agents with it.**

Proof-of-Mining runs a Minecraft server on top of **MineChain**, an Avalanche L1 (Subnet-EVM) whose native gas token **ORE** can only be created by mining in-game. Players earn ORE by breaking ore blocks, spend it as gas, and lock it in escrow to hire AI worker bots that gather materials for them. Agents have their own wallets, pay their own gas, and build an on-chain track record.

## Why Avalanche

| Avalanche feature | How it's used |
| --- | --- |
| **Own L1 (Subnet-EVM)** | The game economy *is* the chain: ORE is the native gas token, not an ERC-20 on someone else's chain. Every player and agent action pays gas in game currency. |
| **NativeMinter precompile** | `MiningRewards` is the only address enabled to mint. Issuance policy (per-block rates, per-player daily caps, idempotent reports) lives in one auditable contract; the chain enforces that nothing else can create ORE. |
| **ContractDeployerAllowList precompile** | Only the operator can deploy contracts, so no one can deploy a contract that gets itself minting rights or impersonates game contracts. |
| **Fuji** | MineChain's validators are registered on the Fuji P-Chain (Etna-style L1, pay-as-you-go validator fee). |

## How it works

```
 player breaks diamond_ore
        │  vanilla scoreboard  minecraft.mined:diamond_ore
        ▼
 Oracle (game master) ── RCON read every 10s ──► MiningRewards.reportBatch()
                                                   │ NativeMinter.mintNativeCoin(player, 10 ORE)
                                                   ▼
 player: "!hire 32 oak_log 5"  ──► JobEscrow.post{value: 5 ORE}  (chest placed next to player)
        │
 AI agent bot (own wallet) ──► JobEscrow.accept() ──► pathfinds, chops 32 logs, fills chest, "!done 0"
        │
 Oracle reads chest over RCON ──► JobEscrow.settle(paid, keccak(chest snapshot)) ──► AgentRegistry reputation++
```

- **Mining detection** uses vanilla `minecraft.mined` statistics, so there's no client mod or server plugin. The oracle persists each batch before sending it. Report ids are `keccak(player, block, fromCount, toCount)`, so retries after a crash are no-ops on-chain and no mined range is counted twice or skipped.
- **Delivery verification** works from the server's own view of the chest (`data get block`), not from what the agent claims. The Oracle records how many of the item the chest already held when the job was posted, and pays only for items added since then. The hash of the snapshot is stored in the `JobPaid` event. A job is only posted on-chain after the chest is confirmed to exist.
- **Agents only take work they can do:** an agent accepts a job only if the source blocks are within range. After a restart it resumes jobs it already accepted, and if it gets stuck it gives up, so the poster is refunded at once instead of waiting for the deadline.
- **Escrow safety:** a job that passes its deadline without settlement can be refunded by anyone, so an offline oracle can't strand funds.
- **An LLM** (schema-constrained structured output) turns free-text requests ("bring me wood for a house, I'll pay 3") into a validated `{item, count, bounty}`. The model never moves funds: the player confirms with `!confirm`, and the bounty comes from their own wallet.

## Live on Fuji

MineChain runs as a **sovereign Avalanche L1 on Fuji** (ConvertSubnetToL1, Proof-of-Authority Validator Manager in genesis).

| Item | Value |
| --- | --- |
| Subnet ID | `2j4SbQdFev4rThHvZnBmwS89DnKzL52fPGvXY2HQf3NwTzrL1Z` |
| Blockchain ID | `9jQgm4HWWJzvT38n4NtMEDXuFRd6AWqjEXjYXjceMDiLsTarh` |
| EVM chain ID / gas token | `777333` / ORE |
| ConvertSubnetToL1Tx | `2hxsXUWX6b8USfekPXJNukz4kpD7y2n9yjV9eY5KjXT1q9NeXV` |
| Validator node | `NodeID-CBezsYF57n3oCzQT1DAqL1wt1G7NLy6Mm` |
| MiningRewards | `0xae10f3f8d26a0eaffc880f53112948fb09926c65` (enabled on the NativeMinter precompile) |
| AgentRegistry | `0xb2f20edd4290daf2e5381c68bc7f4469d4473c88` |
| JobEscrow | `0x80b97c8d627c37b7a68af6133f0f5942e13f524f` |
| Public RPC | `https://minechain-fuji-97xvrvw57gxqfx9v5-9650.app.github.dev/ext/bc/9jQgm4HWWJzvT38n4NtMEDXuFRd6AWqjEXjYXjceMDiLsTarh/rpc` (live while the validator codespace runs) |

The validator runs in a GitHub Codespace (`.devcontainer/`): it installs pinned, checksum-verified AvalancheGo + Subnet-EVM v1.15.3 and starts a partial-sync Fuji node tracking MineChain (`l1/fuji-node.sh`). `l1/fuji-api-proxy.mjs` gives avalanche-cli one endpoint that serves P-Chain calls the public API has dropped (e.g. `platform.getBalance`) from our own node.

## Repository

| Path | What |
| --- | --- |
| `contracts/` | `MiningRewards`, `AgentRegistry`, `JobEscrow` (+ Hardhat tests with a NativeMinter mock at the precompile address) |
| `l1/genesis.minechain.json` | Subnet-EVM genesis with NativeMinter + ContractDeployerAllowList enabled |
| `config/rates.json` | ORE minted per block type and daily cap |
| `config/gatherable.json` | Items agents can deliver and the blocks that drop them |
| `game/src/gamemaster.js` | "Oracle" bot: mining oracle, chat commands, job verification/settlement, expiry |
| `game/src/agent.js` | AI worker bot (Mineflayer + pathfinder + collectblock) with its own wallet |
| `game/docker-compose.yml` | Vanilla 1.21.11 server with RCON |

## Run it

Prereqs: Node 22+, Docker, and an Avalanche L1 RPC (local via avalanche-cli, or Fuji via the Builder Console).

```sh
# 1. Minecraft server
cd game && cp .env.example .env     # set RCON_PASSWORD; GAME_MNEMONIC (account 0 = deployer/oracle)
docker compose up -d

# 2. MineChain. Put the account-0 address in l1/genesis.minechain.json, then e.g. locally:
avalanche blockchain create minechain --evm --genesis l1/genesis.minechain.json
avalanche blockchain deploy minechain --local       # set MINECHAIN_RPC_URL / MINECHAIN_CHAIN_ID in game/.env

# 3. Contracts
cd contracts && npm ci && npx hardhat test
npx hardhat run scripts/deploy.ts --network minechain   # also enables MiningRewards on the NativeMinter

# 4. Game
cd game && npm ci
npm run gm            # Oracle bot + mining oracle
npm run agent -- 0    # first AI agent (AGENT_NAMES in .env)
npm run agent -- 1
```

In-game: `!help`, `!wallet`, `!hire 32 oak_log 5`, `!confirm`, `!jobs`, `!top`.

## Disclosures

- **Custodial wallets.** Player and agent wallets are derived server-side from `GAME_MNEMONIC`, so the server operator controls them. This is a testnet prototype.
- **Trusted oracle.** Mining reports and delivery checks come from the server operator's oracle. Daily caps bound the damage a compromised oracle could do. The contracts don't remove that trust.
- **Offline-mode server** so bots can join without Microsoft accounts. Run it on a private or LAN host.
- **Prior work:** none. Inspired by the idea of AI agents doing paid work in Minecraft (e.g. ETHCraft at ETHGlobal Mumbai), but no code, assets, or design from that project are used. Everything here was written during Avalanche Speedrun.
