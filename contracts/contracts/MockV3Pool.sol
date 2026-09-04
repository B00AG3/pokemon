// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IV3Pool} from './IV3Pool.sol';

/// @notice Test double for a Uniswap v3 pool.
contract MockV3Pool is IV3Pool {
    address public immutable mockToken0;
    address public immutable mockToken1;
    uint160 public sqrtPriceX96;

    constructor(address token0_, address token1_) {
        mockToken0 = token0_;
        mockToken1 = token1_;
    }

    function setSqrtPriceX96(uint160 price) external {
        sqrtPriceX96 = price;
    }

    function token0() external view returns (address) {
        return mockToken0;
    }

    function token1() external view returns (address) {
        return mockToken1;
    }

    function slot0()
        external
        view
        returns (
            uint160,
            int24,
            uint16,
            uint16,
            uint16,
            uint8,
            bool
        )
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}
