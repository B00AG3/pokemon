// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IStateView} from './IStateView.sol';

/// @notice Test double mirroring the real v4 StateView.getSlot0 shape.
contract MockStateView is IStateView {
    mapping(bytes32 poolId => uint160 sqrtPriceX96) public slot0SqrtPriceX96;

    event SqrtPriceSet(bytes32 indexed poolId, uint160 sqrtPriceX96);

    function setSqrtPriceX96(bytes32 poolId, uint160 sqrtPriceX96) external {
        slot0SqrtPriceX96[poolId] = sqrtPriceX96;
        emit SqrtPriceSet(poolId, sqrtPriceX96);
    }

    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        return (slot0SqrtPriceX96[poolId], 0, 0, 0);
    }
}
