// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Minimal} from './SmokeSwapper.sol';

/// @dev Adds transferFrom for seeding the float.
interface IERC20Seed is IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice Test double for a Uniswap v3 pool that actually swaps: fills at
/// the constant price implied by sqrtPriceX96 (out = in x (sq/2^96)^2 for
/// token0 in), takes the input token from the caller's callback payment, and
/// pays the output from its own float. Good enough to exercise SmokeSwapper
/// end to end; not a real curve.
contract MockV3SwapPool {
    address public immutable token0;
    address public immutable token1;
    uint160 public sqrtPriceX96;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setSqrtPriceX96(uint160 price) external {
        sqrtPriceX96 = price;
    }

    function seed(address token, uint256 amount) external {
        IERC20Seed(token).transferFrom(msg.sender, address(this), amount);
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160,
        bytes calldata
    ) external returns (int256 amount0, int256 amount1) {
        require(amountSpecified > 0, 'exact input only');
        uint256 inAmount = uint256(amountSpecified);
        uint256 sq = uint256(sqrtPriceX96);
        uint256 price = (sq * sq) / (1 << 192); // token1 per token0
        if (zeroForOne) {
            uint256 out0 = inAmount * price;
            IERC20Minimal(token1).transfer(recipient, out0);
            return (amountSpecified, -int256(out0));
        } else {
            uint256 out1 = (inAmount * (1 << 192)) / sq / sq;
            IERC20Minimal(token0).transfer(recipient, out1);
            return (-int256(out1), amountSpecified);
        }
    }
}
