// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface of the Uniswap v4 StateView periphery contract
/// used by the oracle. `poolId` is the PoolId.toId() bytes32 of the pool.
/// Signature mirrors the real v4 periphery StateView.getSlot0.
interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}
