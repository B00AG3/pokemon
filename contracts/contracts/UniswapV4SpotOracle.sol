// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {AggregatorV3Interface} from './AggregatorV3Interface.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';
import {IStateView} from './IStateView.sol';

/**
 * @title UniswapV4SpotOracle
 * @notice Reports the PokeCard token market cap in USD (18 decimals) from the
 * token's Uniswap v4 pool spot price and an ETH/USD price feed.
 *
 * marketCap = POKE-in-WETH price x WETH-in-USD price x totalSupply
 *
 * Price smoothing happens through MilestoneCards' `confirmWindow` (the market
 * cap must hold above a threshold across keeper polls for the whole window),
 * so a spot read is sufficient here. Upgrade path: replace the spot read with
 * a TWAP from the same StateView without changing the interface.
 *
 * Config requirements before mainnet:
 *  - stateView: the v4 StateView deployment active on the target chain
 *  - poolKey:   the exact PoolKey the pool was initialized with
 *  - ethUsdFeed: a Chainlink aggregator on the chain. If none exists yet,
 *    leave it zero and the owner sets a manual ETH/USD price instead.
 */
contract UniswapV4SpotOracle is IMilestonePriceOracle, Ownable {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    IStateView public immutable stateView;
    IERC20Metadata public immutable pokeToken;
    bytes32 public immutable poolId;
    bool public immutable pokeIsCurrency0;
    AggregatorV3Interface public ethUsdFeed;
    uint256 public maxStaleness;
    uint256 public manualEthUsdPrice; // USD, 8 decimals - used when feed is unset

    error StaleEthUsdPrice();
    error InvalidPool();

    event EthUsdFeedUpdated(address indexed feed);
    event ManualEthUsdPriceUpdated(uint256 price);
    event MaxStalenessUpdated(uint256 seconds_);

    constructor(
        IStateView stateView_,
        IERC20Metadata pokeToken_,
        address weth,
        PoolKey memory poolKey,
        AggregatorV3Interface ethUsdFeed_,
        uint256 maxStaleness_
    ) Ownable(msg.sender) {
        if (
            !((address(pokeToken_) == poolKey.currency0 && weth == poolKey.currency1) ||
                (address(pokeToken_) == poolKey.currency1 && weth == poolKey.currency0))
        ) revert InvalidPool();
        if (address(stateView_) == address(0)) revert InvalidPool();

        stateView = stateView_;
        pokeToken = pokeToken_;
        poolId = keccak256(abi.encode(poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks));
        pokeIsCurrency0 = address(pokeToken_) == poolKey.currency0;
        ethUsdFeed = ethUsdFeed_;
        maxStaleness = maxStaleness_;
    }

    /// @notice Current market cap in USD with 18 decimals.
    function marketCap() public view returns (uint256) {
        uint256 usdPerPokeWei = _usd18PerPokeWei();
        uint256 supply = IERC20Metadata(pokeToken).totalSupply();
        // USD18/POKEwei x POKEwei = USD18 total
        return Math.mulDiv(usdPerPokeWei, supply, 1);
    }

    /// @notice USD (18 decimals) value of a single POKE wei.
    function usd18PerPokeWei() external view returns (uint256) {
        return _usd18PerPokeWei();
    }

    function _usd18PerPokeWei() internal view returns (uint256) {
        uint256 ethUsd8 = _ethUsd8();

        uint160 sqrtPriceX96 = IStateView(stateView).getSlot0SqrtPriceX96(poolId);
        if (sqrtPriceX96 == 0) revert InvalidPool();

        // POKE wei per WETH wei = 2^192 / sqrtP^2 when POKE is currency1,
        // sqrtP^2 / 2^192 when POKE is currency0. mulDiv handles the 512-bit
        // numerator safely.
        if (pokeIsCurrency0) {
            // USD18 per POKE wei = (sqrtP^2 / 2^192) x ethUsd8 / 1e8
            uint256 wethWeiPerPokeWei = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 2 ** 192);
            return Math.mulDiv(wethWeiPerPokeWei, ethUsd8, 1e8);
        } else {
            // USD18 per POKE wei = (2^192 / sqrtP^2) x ethUsd8 / 1e8, split
            // across two divisions to keep intermediates in range.
            uint256 t = Math.mulDiv(2 ** 192, ethUsd8, sqrtPriceX96);
            return Math.mulDiv(t, 1, sqrtPriceX96 * 1e8);
        }
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
