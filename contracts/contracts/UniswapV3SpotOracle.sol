// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {AggregatorV3Interface} from './AggregatorV3Interface.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';
import {IV3Pool} from './IV3Pool.sol';

/**
 * @title UniswapV3SpotOracle
 * @notice Reports the PokeCard token market cap in USD (18 decimals) from the
 * token's Uniswap v3 pool spot price and an ETH/USD price feed. This is the
 * oracle for tokens launched on Pons, which list straight into a v3 pool
 * quoted against WETH and never migrate.
 *
 * marketCap = POKE-in-WETH price x WETH-in-USD price x totalSupply
 *
 * Milestone gating smooths spot through MilestoneCards' `confirmWindow`, and
 * redemptions price off MilestoneCards' aged checkpoint history, so this
 * contract can stay a pure spot read. Upgrade path: swap the spot read for a
 * v3 TWAP (the pool's oracle observations) without changing the interface.
 *
 * Config requirements:
 *  - pool: the token's v3 pool (Pons: the `liquidityPool()` getter)
 *  - ethUsdFeed: a Chainlink aggregator on the chain. If none exists yet,
 *    leave it zero and the owner sets a manual ETH/USD price instead.
 */
contract UniswapV3SpotOracle is IMilestonePriceOracle, Ownable {
    IV3Pool public immutable pool;
    IERC20Metadata public immutable pokeToken;
    bool public immutable pokeIsToken0;
    AggregatorV3Interface public ethUsdFeed;
    uint256 public maxStaleness;
    uint256 public manualEthUsdPrice; // USD, 8 decimals - used when feed is unset

    error StaleEthUsdPrice();
    error InvalidPool();

    event EthUsdFeedUpdated(address indexed feed);
    event ManualEthUsdPriceUpdated(uint256 price);
    event MaxStalenessUpdated(uint256 seconds_);

    constructor(
        IV3Pool pool_,
        IERC20Metadata pokeToken_,
        address weth,
        AggregatorV3Interface ethUsdFeed_,
        uint256 maxStaleness_
    ) Ownable(msg.sender) {
        address token0 = pool_.token0();
        address token1 = pool_.token1();
        bool pokeIs0 = token0 == address(pokeToken_);
        if (!((pokeIs0 && token1 == weth) || (!pokeIs0 && token0 == weth && token1 == address(pokeToken_)))) {
            revert InvalidPool();
        }
        pool = pool_;
        pokeToken = pokeToken_;
        pokeIsToken0 = pokeIs0;
        ethUsdFeed = ethUsdFeed_;
        maxStaleness = maxStaleness_;
    }

    /// @notice Current market cap in USD with 18 decimals.
    /// @dev All intermediate ratios stay scaled; the only flooring division is
    /// the last one. POKE will trade far below 1 ETH for the whole ladder
    /// (1B fixed supply, $5k to $1M caps = $0.000005 to $0.001 per POKE), so
    /// dividing the per-wei price out early would floor every read to zero.
    function marketCap() public view returns (uint256) {
        uint256 ethUsd8 = _ethUsd8();
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        if (sqrtPriceX96 == 0) revert InvalidPool();

        uint256 supply = IERC20Metadata(pokeToken).totalSupply();
        if (pokeIsToken0) {
            // WETH wei per POKE wei = sqrtP^2 / 2^192. Keep sqrtP^2 scaled by
            // 2^96 and divide by 2^96 once at the very end:
            //   cap = sqrtP^2 x ethUsd8 x supply / (2^192 x 1e8)
            uint256 sq = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 2 ** 96);
            return Math.mulDiv(sq, Math.mulDiv(ethUsd8, supply, 1e8), 2 ** 96);
        } else {
            // POKE wei per WETH wei = sqrtP^2 / 2^192, so invert it while
            // keeping scale: cap = ethUsd8 x supply x 2^192 / (sqrtP^2 x 1e8),
            // with the two sqrtP divisions chained so nothing floors early.
            uint256 t = Math.mulDiv(ethUsd8 * supply, 2 ** 96, sqrtPriceX96);
            return Math.mulDiv(t, 2 ** 96, uint256(sqrtPriceX96) * 1e8);
        }
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
        (, int256 answer,, uint256 updatedAt,) = ethUsdFeed.latestRoundData();
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
