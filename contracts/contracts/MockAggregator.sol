// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AggregatorV3Interface} from './AggregatorV3Interface.sol';

/// @notice Test double for a Chainlink-style ETH/USD aggregator (8 decimals).
contract MockAggregator is AggregatorV3Interface {
    uint256 public immutable decimalsOverride = 8;
    int256 public price = 3000e8;
    uint256 public updatedAtTime = block.timestamp;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return 'ETH / USD';
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, price, updatedAtTime, updatedAtTime, 1);
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, updatedAtTime, updatedAtTime, 1);
    }

    function setPrice(int256 price_) external {
        price = price_;
    }

    function setUpdatedAt(uint256 time_) external {
        updatedAtTime = time_;
    }
}
