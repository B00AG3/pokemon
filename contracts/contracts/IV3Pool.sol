// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface of a Uniswap v3 pool used by the oracle. Pons
/// launches trade in exactly one v3 pool per token, quoted against WETH.
interface IV3Pool {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}
