// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';

/// @notice Test/mock oracle: anyone sets the market cap directly.
/// Swap this for a Uniswap TWAP adapter on mainnet. Its setters refuse the
/// Robinhood mainnet chain outright, so an operator mistake can never wire
/// it (or leave it wired) into a live deployment.
contract MockMilestonePriceOracle is IMilestonePriceOracle {
    uint256 public marketCap;

    event MarketCapUpdated(uint256 marketCap);

    error MainnetForbidden();

    modifier notOnMainnet() {
        if (block.chainid == 4663) revert MainnetForbidden();
        _;
    }

    function setMarketCap(uint256 marketCap_) external notOnMainnet {
        marketCap = marketCap_;
        emit MarketCapUpdated(marketCap_);
    }
}
