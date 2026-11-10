// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test double installed at the NativeMinter precompile address via hardhat_setCode.
/// Real Subnet-EVM mints balance; here we record the calls so tests can assert issuance.
contract MockNativeMinter {
    mapping(address => uint256) public minted;

    event MintNativeCoin(address indexed sender, address indexed recipient, uint256 amount);

    function mintNativeCoin(address addr, uint256 amount) external {
        minted[addr] += amount;
        emit MintNativeCoin(msg.sender, addr, amount);
    }

    function readAllowList(address) external pure returns (uint256) {
        return 1;
    }
}
