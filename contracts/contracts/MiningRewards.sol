// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INativeMinter, NATIVE_MINTER} from "./INativeMinter.sol";

/// @title MiningRewards
/// @notice Turns verified Minecraft mining into newly minted native gas (ORE) on MineChain.
/// The game master (server oracle) reports per-player block counts read from vanilla
/// `minecraft.mined` scoreboards; this contract prices them and mints through the
/// NativeMinter precompile. This contract is the only minter enabled on the chain,
/// so the per-day caps here bound total issuance.
contract MiningRewards {
    address public owner;
    mapping(address => bool) public isGameMaster;

    /// block type (e.g. keccak256("diamond_ore")) => reward in wei per block
    mapping(bytes32 => uint256) public rateOf;
    /// max wei a single player can earn per UTC day
    uint256 public dailyCap;
    /// player => day index => wei minted that day
    mapping(address => mapping(uint256 => uint256)) public mintedOn;
    /// report ids already applied (the game master retries with the same id)
    mapping(bytes32 => bool) public reportApplied;

    uint256 public totalMinted;
    mapping(address => uint256) public lifetimeMined; // wei earned per player

    event GameMasterSet(address indexed account, bool enabled);
    event RateSet(bytes32 indexed blockType, uint256 weiPerBlock);
    event DailyCapSet(uint256 cap);
    event Mined(
        bytes32 indexed reportId, address indexed player, bytes32 indexed blockType, uint256 count, uint256 reward
    );
    event CapHit(address indexed player, uint256 requested, uint256 granted);

    error NotOwner();
    error NotGameMaster();
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGameMaster() {
        if (!isGameMaster[msg.sender]) revert NotGameMaster();
        _;
    }

    constructor(uint256 dailyCap_) {
        owner = msg.sender;
        dailyCap = dailyCap_;
        emit DailyCapSet(dailyCap_);
    }

    function setGameMaster(address account, bool enabled) external onlyOwner {
        isGameMaster[account] = enabled;
        emit GameMasterSet(account, enabled);
    }

    function setRates(bytes32[] calldata blockTypes, uint256[] calldata weiPerBlock) external onlyOwner {
        if (blockTypes.length != weiPerBlock.length) revert LengthMismatch();
        for (uint256 i; i < blockTypes.length; ++i) {
            rateOf[blockTypes[i]] = weiPerBlock[i];
            emit RateSet(blockTypes[i], weiPerBlock[i]);
        }
    }

    function setDailyCap(uint256 cap) external onlyOwner {
        dailyCap = cap;
        emit DailyCapSet(cap);
    }

    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }

    /// @notice Apply one mining report. Idempotent per reportId so the oracle can safely retry.
    /// @return reward wei actually minted (0 if duplicate, unpriced, or capped out)
    function report(bytes32 reportId, address player, bytes32 blockType, uint256 count)
        public
        onlyGameMaster
        returns (uint256 reward)
    {
        if (reportApplied[reportId]) return 0;
        reportApplied[reportId] = true;

        uint256 requested = rateOf[blockType] * count;
        if (requested == 0) return 0;

        uint256 day = block.timestamp / 1 days;
        uint256 used = mintedOn[player][day];
        uint256 room = used >= dailyCap ? 0 : dailyCap - used;
        reward = requested > room ? room : requested;
        if (reward < requested) emit CapHit(player, requested, reward);
        if (reward == 0) return 0;

        mintedOn[player][day] = used + reward;
        totalMinted += reward;
        lifetimeMined[player] += reward;

        INativeMinter(NATIVE_MINTER).mintNativeCoin(player, reward);
        emit Mined(reportId, player, blockType, count, reward);
    }

    function reportBatch(
        bytes32[] calldata reportIds,
        address[] calldata players,
        bytes32[] calldata blockTypes,
        uint256[] calldata counts
    ) external onlyGameMaster returns (uint256 total) {
        uint256 n = reportIds.length;
        if (players.length != n || blockTypes.length != n || counts.length != n) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            total += report(reportIds[i], players[i], blockTypes[i], counts[i]);
        }
    }
}
