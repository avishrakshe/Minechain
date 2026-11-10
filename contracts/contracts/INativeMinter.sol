// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Subnet-EVM NativeMinter stateful precompile.
// Enabled in the MineChain genesis; only allow-listed callers may mint the chain's native gas token.
address constant NATIVE_MINTER = 0x0200000000000000000000000000000000000001;

interface INativeMinter {
    function mintNativeCoin(address addr, uint256 amount) external;
    function readAllowList(address addr) external view returns (uint256 role);
}
