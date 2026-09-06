// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only attack helper for the redeem reentrancy regression test:
/// replays redeem() on a second card from inside the ETH payout. Never
/// deployed by deploy.ts; lives next to the mocks so hardhat compiles it for
/// the test suite.
contract ReentrantRedeemer {
    address internal immutable cards;
    uint256 internal _attacking;

    constructor(address cards_) {
        cards = cards_;
    }

    function attack(uint256 tokenId) external {
        _attacking = tokenId;
        (bool ok, ) = cards.call(abi.encodeWithSignature('redeem(uint256)', tokenId));
        require(ok, 'outer redeem failed');
    }

    receive() external payable {
        (bool ok, ) = cards.call(
            abi.encodeWithSignature('redeem(uint256)', _attacking == 1 ? 2 : 1)
        );
        require(ok, 'inner redeem failed');
    }
}
