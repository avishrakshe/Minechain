// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice On-chain identity and track record for AI worker bots. An agent's wallet registers
/// itself; only the JobEscrow can write job outcomes, so reputation reflects settled work.
contract AgentRegistry {
    struct Agent {
        string name; // in-game username of the bot
        address operator; // who runs the bot
        uint64 registeredAt;
        uint32 completed;
        uint32 failed;
        uint256 earned; // wei paid out through escrow
    }

    address public owner;
    address public escrow;
    mapping(address => Agent) private _agents;
    mapping(bytes32 => address) public agentByName;
    address[] public agentList;

    event AgentRegistered(address indexed agent, string name, address indexed operator);
    event Outcome(address indexed agent, bool success, uint256 paid);

    error NotOwner();
    error NotEscrow();
    error AlreadyRegistered();
    error NameTaken();
    error EmptyName();

    constructor() {
        owner = msg.sender;
    }

    function setEscrow(address escrow_) external {
        if (msg.sender != owner) revert NotOwner();
        escrow = escrow_;
    }

    function register(string calldata name, address operator) external {
        if (bytes(name).length == 0) revert EmptyName();
        if (_agents[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        bytes32 key = keccak256(bytes(name));
        if (agentByName[key] != address(0)) revert NameTaken();

        _agents[msg.sender] = Agent(name, operator, uint64(block.timestamp), 0, 0, 0);
        agentByName[key] = msg.sender;
        agentList.push(msg.sender);
        emit AgentRegistered(msg.sender, name, operator);
    }

    function recordOutcome(address agent, bool success, uint256 paid) external {
        if (msg.sender != escrow) revert NotEscrow();
        Agent storage a = _agents[agent];
        if (success) {
            a.completed += 1;
            a.earned += paid;
        } else {
            a.failed += 1;
        }
        emit Outcome(agent, success, paid);
    }

    function isAgent(address account) external view returns (bool) {
        return _agents[account].registeredAt != 0;
    }

    function getAgent(address account) external view returns (Agent memory) {
        return _agents[account];
    }

    function agentCount() external view returns (uint256) {
        return agentList.length;
    }
}
