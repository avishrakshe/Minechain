// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentRegistry} from "./AgentRegistry.sol";

/// @title JobEscrow
/// @notice Players lock native gas-token bounties for item-delivery jobs. A registered AI agent
/// accepts, gathers the items in Minecraft and puts them in the job's chest. The game master
/// (verifier) reads the chest contents and settles: pay the agent, or refund the poster.
/// After the deadline anyone can refund an unsettled job, so funds cannot be stranded by
/// an offline verifier.
contract JobEscrow {
    enum Status {
        None,
        Open,
        Accepted,
        Paid,
        Refunded
    }

    struct Job {
        address poster;
        address agent;
        uint96 bounty;
        uint32 quantity;
        uint64 deadline;
        Status status;
        int32 x;
        int32 y;
        int32 z;
        string item; // minecraft item id, e.g. "oak_log"
    }

    AgentRegistry public immutable registry;
    address public owner;
    mapping(address => bool) public isVerifier;

    Job[] private _jobs;

    event VerifierSet(address indexed account, bool enabled);
    event JobPosted(
        uint256 indexed jobId,
        address indexed poster,
        string item,
        uint32 quantity,
        uint256 bounty,
        uint64 deadline,
        int32 x,
        int32 y,
        int32 z
    );
    event JobAccepted(uint256 indexed jobId, address indexed agent);
    event JobPaid(uint256 indexed jobId, address indexed agent, uint256 bounty, bytes32 evidence);
    event JobRefunded(uint256 indexed jobId, address indexed poster, uint256 bounty, bytes32 evidence);

    error NotOwner();
    error NotVerifier();
    error NotAgent();
    error NotPoster();
    error BadStatus();
    error BadParams();
    error NotExpired();
    error TransferFailed();

    constructor(AgentRegistry registry_) {
        registry = registry_;
        owner = msg.sender;
    }

    function setVerifier(address account, bool enabled) external {
        if (msg.sender != owner) revert NotOwner();
        isVerifier[account] = enabled;
        emit VerifierSet(account, enabled);
    }

    function post(string calldata item, uint32 quantity, int32 x, int32 y, int32 z, uint64 duration)
        external
        payable
        returns (uint256 jobId)
    {
        if (msg.value == 0 || msg.value > type(uint96).max) revert BadParams();
        if (quantity == 0 || bytes(item).length == 0 || duration == 0 || duration > 7 days) revert BadParams();

        jobId = _jobs.length;
        uint64 deadline = uint64(block.timestamp) + duration;
        _jobs.push(Job(msg.sender, address(0), uint96(msg.value), quantity, deadline, Status.Open, x, y, z, item));
        emit JobPosted(jobId, msg.sender, item, quantity, msg.value, deadline, x, y, z);
    }

    function accept(uint256 jobId) external {
        if (!registry.isAgent(msg.sender)) revert NotAgent();
        Job storage j = _jobs[jobId];
        if (j.status != Status.Open || block.timestamp >= j.deadline) revert BadStatus();
        j.agent = msg.sender;
        j.status = Status.Accepted;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Poster withdraws a job nobody has accepted yet.
    function cancel(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.poster) revert NotPoster();
        if (j.status != Status.Open) revert BadStatus();
        _refund(jobId, j, bytes32("cancelled"));
    }

    /// @notice Verifier settles an accepted job after checking the delivery chest.
    /// @param evidence hash of the observed chest snapshot, for audit
    function settle(uint256 jobId, bool delivered, bytes32 evidence) external {
        if (!isVerifier[msg.sender]) revert NotVerifier();
        Job storage j = _jobs[jobId];
        if (j.status != Status.Accepted) revert BadStatus();
        if (delivered) {
            j.status = Status.Paid;
            uint256 amount = j.bounty;
            registry.recordOutcome(j.agent, true, amount);
            emit JobPaid(jobId, j.agent, amount, evidence);
            _send(j.agent, amount);
        } else {
            registry.recordOutcome(j.agent, false, 0);
            _refund(jobId, j, evidence);
        }
    }

    /// @notice Anyone may refund a job that passed its deadline without settlement.
    function expire(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Open && j.status != Status.Accepted) revert BadStatus();
        if (block.timestamp < j.deadline) revert NotExpired();
        if (j.status == Status.Accepted) registry.recordOutcome(j.agent, false, 0);
        _refund(jobId, j, bytes32("expired"));
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    function _refund(uint256 jobId, Job storage j, bytes32 evidence) private {
        j.status = Status.Refunded;
        uint256 amount = j.bounty;
        emit JobRefunded(jobId, j.poster, amount, evidence);
        _send(j.poster, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
