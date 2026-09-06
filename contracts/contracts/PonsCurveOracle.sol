// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {AggregatorV3Interface} from './AggregatorV3Interface.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';

/// @dev The slice of the Pons v2 curve this oracle reads. The quote side of
/// the pricing reserves includes Pons' phantom quote, which is what makes the
/// spawn cap nonzero.
interface IPonsCurveState {
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
}

/**
 * @title PonsCurveOracle
 * @notice Reports the PokeCard token market cap in USD (18 decimals) while the
 * token still trades on its Pons v2 bonding curve, before graduation. A
 * pre-graduation token has no pool to read - Pons graduates it into a locked
 * Uniswap v4 pool only after the threshold - so the cap prices off the
 * curve's own reserves, per the Pons docs' marginal-price definition:
 *
 *   marginal price (ETH per POKE) = quoteReserve / tokenReserve
 *   marketCap (ETH)               = price x totalSupply
 *   marketCap (USD)               = marketCap(ETH) x ETH/USD
 *
 * The quote reserve carries the phantom quote (config #0 seeds 1.68 ETH, so
 * the spawn cap is ~$5,040 at $3000/ETH), which is exactly what a launch
 * watcher expects to see at mint zero. Milestone gating smooths spot through
 * MilestoneCards' confirmWindow and redemptions price off the aged checkpoint
 * history, so a spot read is fine here. After graduation the curve stops
 * trading: redeploy the oracle path with UniswapV4SpotOracle against the
 * locked v4 pool.
 */
contract PonsCurveOracle is IMilestonePriceOracle, Ownable {
    IPonsCurveState public immutable curve;
    IERC20Metadata public immutable pokeToken;
    AggregatorV3Interface public ethUsdFeed;
    uint256 public maxStaleness;
    uint256 public manualEthUsdPrice; // USD, 8 decimals - used when feed is unset

    error CurveEmpty();
    error StaleEthUsdPrice();

    event EthUsdFeedUpdated(address indexed feed);
    event ManualEthUsdPriceUpdated(uint256 price);
    event MaxStalenessUpdated(uint256 seconds_);

    constructor(
        IPonsCurveState curve_,
        IERC20Metadata pokeToken_,
        AggregatorV3Interface ethUsdFeed_,
        uint256 maxStaleness_
    ) Ownable(msg.sender) {
        curve = curve_;
        pokeToken = pokeToken_;
        ethUsdFeed = ethUsdFeed_;
        maxStaleness = maxStaleness_;
    }

    /// @notice Current market cap in USD with 18 decimals.
    /// @dev Only the last division floors: the price stays scaled inside
    /// quoteReserve x supply so the tiny per-POKE price never rounds to zero.
    function marketCap() public view returns (uint256) {
        uint256 ethUsd8 = _ethUsd8();
        (uint256 quoteReserve, uint256 tokenReserve) = curve.getReserves();
        if (quoteReserve == 0 || tokenReserve == 0) revert CurveEmpty();

        uint256 supply = IERC20Metadata(pokeToken).totalSupply();
        uint256 capEth = Math.mulDiv(quoteReserve, supply, tokenReserve);
        return Math.mulDiv(capEth, ethUsd8, 1e8);
    }

    /// @notice USD (18 decimals) per whole POKE token.
    function usdPerPoke() external view returns (uint256) {
        return Math.mulDiv(marketCap(), 1e18, IERC20Metadata(pokeToken).totalSupply());
    }

    function _ethUsd8() internal view returns (uint256) {
        if (address(ethUsdFeed) == address(0)) {
            require(manualEthUsdPrice > 0, 'eth usd unset');
            return manualEthUsdPrice;
        }
        (, int256 answer, , uint256 updatedAt, ) = ethUsdFeed.latestRoundData();
        require(answer > 0, 'bad eth usd');
        if (maxStaleness > 0 && block.timestamp - updatedAt > maxStaleness) {
            revert StaleEthUsdPrice();
        }
        return uint256(answer);
    }

    function setEthUsdFeed(AggregatorV3Interface feed) external onlyOwner {
        ethUsdFeed = feed;
        emit EthUsdFeedUpdated(address(feed));
    }

    function setManualEthUsdPrice(uint256 price) external onlyOwner {
        manualEthUsdPrice = price;
        emit ManualEthUsdPriceUpdated(price);
    }

    function setMaxStaleness(uint256 seconds_) external onlyOwner {
        maxStaleness = seconds_;
        emit MaxStalenessUpdated(seconds_);
    }
}
