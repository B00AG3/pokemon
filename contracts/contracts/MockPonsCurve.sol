// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test double for the slice of the Pons v2 curve PonsCurveOracle
/// reads. Setters refuse Robinhood mainnet so it can never price a live
/// deployment.
contract MockPonsCurve {
    uint256 public quoteReserve;
    uint256 public tokenReserve;

    error MainnetForbidden();

    modifier notOnMainnet() {
        if (block.chainid == 4663) revert MainnetForbidden();
        _;
    }

    function setReserves(uint256 quoteReserve_, uint256 tokenReserve_) external notOnMainnet {
        quoteReserve = quoteReserve_;
        tokenReserve = tokenReserve_;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (quoteReserve, tokenReserve);
    }
}
