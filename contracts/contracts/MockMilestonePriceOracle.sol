// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';

/// @notice Test/mock oracle: the owner sets the market cap directly.
/// Swap this for a Uniswap TWAP adapter on mainnet.
contract MockMilestonePriceOracle is IMilestonePriceOracle {
    uint256 public marketCap;

    event MarketCapUpdated(uint256 marketCap);

    function setMarketCap(uint256 marketCap_) external {
        marketCap = marketCap_;
        emit MarketCapUpdated(marketCap_);
    }
}
