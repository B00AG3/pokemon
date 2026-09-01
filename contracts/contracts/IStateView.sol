// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';

/// @notice Minimal surface of the Uniswap v4 StateView periphery contract
/// used by the oracle. `poolId` is the PoolId.toId() bytes32 of the pool.
interface IStateView {
    function getSlot0SqrtPriceX96(bytes32 poolId) external view returns (uint160 sqrtPriceX96);
}
