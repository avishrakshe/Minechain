# Demo video script (under 3:00)

Setup before recording: Minecraft in **windowed** mode, joined as your player near spawn; browser open on the dashboard (http://localhost:5180). Switch between them with **Alt+Tab**. Speak the narration in your own words.

| Time | Screen | Do | Say |
| --- | --- | --- | --- |
| 0:00–0:15 | Dashboard | Nothing, let it show | "This is MineChain: an Avalanche L1 on Fuji where the only way to create gas is to mine it in Minecraft. You spend that gas to hire AI agents." |
| 0:15–0:35 | Dashboard | Point at chain 777333 · Fuji L1, ORE minted, Jobs, Agents | "MineChain is a sovereign L1 with its own gas token, ORE. The NativeMinter precompile lets only one contract, MiningRewards, create ORE, so issuance rules are on-chain." |
| 0:35–0:45 | Minecraft | `T` → `!wallet` → Enter | "I'm a player with a fresh wallet: zero ORE." |
| 0:45–1:10 | Minecraft | Mine the diamond, gold and emerald ore in front of you | "Minecraft itself counts the blocks I mine. Our Oracle reads those counts and reports them to MiningRewards, which mints ORE straight into my wallet." |
| 1:10–1:20 | Minecraft | Wait for `[MineChain] +… ORE minted`, then `!wallet` | "38 ORE, minted on Fuji from gameplay." |
| 1:20–1:30 | Dashboard | Show ORE minted went up and the new mining rows | "Here are those mints on-chain." |
| 1:30–1:45 | Minecraft | `!hire 4 spruce_log 2` → Enter → `!confirm` → Enter | "Now I hire an AI agent: 4 spruce logs for 2 ORE. The bounty is locked in the JobEscrow contract and a delivery chest appears." |
| 1:45–2:20 | Minecraft | Watch Digger accept, chop and come back | "Digger is an AI bot with its own wallet. It checks it can find spruce, accepts the job on-chain, gathers the logs and fills the chest." |
| 2:20–2:30 | Minecraft | Wait for `Job #… verified … Paid`, open the chest | "The Oracle checks the chest itself, not the agent's word, then releases payment." |
| 2:30–2:45 | Dashboard | Show the job as Paid and Digger's completed count | "Job paid, and the agent's reputation is recorded on-chain. If an agent fails, the player is refunded automatically." |
| 2:45–3:00 | Dashboard | Hold | "MineChain: gameplay mints the gas, AI agents earn it, and Avalanche enforces the rules. Testnet only, open source." |
