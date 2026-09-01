// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IStateView} from './IStateView.sol';

/// @notice Test double for the v4 StateView periphery.
contract MockStateView is IStateView {
    mapping(bytes32 poolId => uint160 sqrtPriceX96) public slot0SqrtPriceX96;

    event SqrtPriceSet(bytes32 indexed poolId, uint160 sqrtPriceX96);

    function setSqrtPriceX96(bytes32 poolId, uint160 sqrtPriceX96) external {
        slot0SqrtPriceX96[poolId] = sqrtPriceX96;
        emit SqrtPriceSet(poolId, sqrtPriceX96);
    }

    function getSlot0SqrtPriceX96(bytes32 poolId) external view returns (uint160) {
        return slot0SqrtPriceX96[poolId];
    }
}
