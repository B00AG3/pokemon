// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMilestonePriceOracle {
    /// @notice Current market cap of the PokeCard token, in USD with 18 decimals.
    /// @dev Production implementation should read a TWAP from the token's
    ///      Uniswap v4 pool and multiply by circulating supply. A mock is
    ///      provided for testnet and local runs.
    function marketCap() external view returns (uint256);
}
