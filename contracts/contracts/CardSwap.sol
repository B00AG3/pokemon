// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {MilestoneCards} from './MilestoneCards.sol';

/**
 * @title CardSwap
 * @notice Peer-to-peer ETH market for milestone cards: a holder escrows the
 * NFT here and names an ETH price; anyone can buy. ERC-2981 royalties
 * (2.5% by default) are split out to the royalty receiver before the seller
 * is paid.
 *
 * Listings use escrow (the NFT moves into this contract when the offer is
 * created), so there is no approval race and no orderbook to trust: if the
 * NFT is here, the trade can execute; the seller can cancel any time while
 * it is still active.
 *
 * Pausable as an emergency stop: while paused, new listings and buys halt,
 * but cancellations stay open so escrowed cards can always be pulled back
 * out.
 */
contract CardSwap is Ownable, Pausable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
    }

    MilestoneCards public immutable cards;

    mapping(uint256 tokenId => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed tokenId);
    event CardSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    error NotOwner();
    error ZeroPrice();
    error NotListed();
    error NotSeller();
    error InsufficientPayment();
    error EthTransferFailed();

    constructor(address cards_) Ownable(msg.sender) Pausable() ReentrancyGuard() {
        cards = MilestoneCards(payable(cards_));
    }

    // ---------- fixed price listings ----------

    /// @notice Escrow `tokenId` and offer it for `price` wei.
    /// Requires setApprovalForAll or approve for this contract first.
    function list(uint256 tokenId, uint256 price) external whenNotPaused {
        if (cards.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (price == 0) revert ZeroPrice();
        listings[tokenId] = Listing({seller: msg.sender, price: price});
        cards.transferFrom(msg.sender, address(this), tokenId);
        emit Listed(tokenId, msg.sender, price);
    }

    /// @notice Pull an escrowed listing back.
    function cancelListing(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        cards.safeTransferFrom(address(this), msg.sender, tokenId);
        emit ListingCancelled(tokenId);
    }

    /// @notice Buy an escrowed listing. Overpayment is refunded; royalties
    /// go to the ERC-2981 receiver, the rest to the seller.
    function buy(uint256 tokenId) external payable whenNotPaused nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.value < l.price) revert InsufficientPayment();
        delete listings[tokenId];

        (address receiver, uint256 royalty) = cards.royaltyInfo(tokenId, l.price);
        _send(l.seller, l.price - royalty);
        if (royalty > 0 && receiver != address(0)) _send(receiver, royalty);

        cards.safeTransferFrom(address(this), msg.sender, tokenId);
        _refundExcess(msg.value - l.price);
        emit CardSold(tokenId, l.seller, msg.sender, l.price);
    }

    function _send(address to, uint256 amount) internal {
        (bool sent, ) = to.call{value: amount}('');
        if (!sent) revert EthTransferFailed();
    }

    function _refundExcess(uint256 amount) internal {
        if (amount > 0) _send(msg.sender, amount);
    }

    /// @notice Emergency stop: halt new trades. Cancellations stay open.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Accept ETH (accidental transfers).
    receive() external payable {}
}
