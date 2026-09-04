// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal WETH-9 surface the swapper needs.
interface IWETH9 {
    function deposit() external payable;

    function transfer(address to, uint256 value) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

/// @dev Minimal ERC-20 surface the swapper needs.
interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

/// @dev Minimal surface of a Uniswap v3 pool for exact-input swaps.
interface IV3SwapPool {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @notice Throwaway smoke-test tooling: converts ETH into a launchpad token
/// through its Uniswap v3 pool in one transaction. v3 pools can only be
/// swapped through a contract (the swap callback must pay the pool), and the
/// chain has no guaranteed router address, so the smoke run deploys this
/// tiny helper instead. Hold no funds here beyond a swap; recover() exists
/// for strays.
contract SmokeSwapper {
    uint160 private constant MIN_SQRT_RATIO = 4295128740;
    uint160 private constant MAX_SQRT_RATIO =
        1461446703485210103287273052203988822378723970341;

    address public immutable owner;
    IWETH9 public immutable weth;

    error Slippage();
    error NotPool(address sender);
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IWETH9 weth_) {
        owner = msg.sender;
        weth = weth_;
    }

    /// @notice Wrap msg.value into WETH and swap all of it for outToken
    /// through the pool, delivering the output to `to`. Reverts when the
    /// fill lands under minOut.
    function swapEthToToken(
        address pool,
        address outToken,
        address to,
        uint256 minOut
    ) external payable onlyOwner returns (uint256 out) {
        weth.deposit{value: msg.value}();
        bool zeroForOne = IV3SwapPool(pool).token0() == address(weth);
        (int256 amount0, int256 amount1) = IV3SwapPool(pool).swap(
            address(this),
            zeroForOne,
            int256(msg.value),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(outToken, to)
        );
        out = uint256(-(zeroForOne ? amount1 : amount0));
        if (out < minOut) revert Slippage();
        IERC20Minimal(outToken).transfer(to, out);
    }

    /// @notice Pays the pool from our wrapped balance. Only a pool that
    /// actually holds our WETH as one end of the pair can call this.
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata
    ) external {
        if (
            IV3SwapPool(msg.sender).token0() != address(weth) &&
            IV3SwapPool(msg.sender).token1() != address(weth)
        ) {
            revert NotPool(msg.sender);
        }
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        weth.transfer(msg.sender, owed);
    }

    /// @notice Rescue stray ETH (token = address(0)) or tokens.
    function recover(address token, address to) external onlyOwner {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: address(this).balance}('');
            require(ok, 'eth transfer failed');
        } else {
            IERC20Minimal(token).transfer(to, IERC20Minimal(token).balanceOf(address(this)));
        }
    }
}
