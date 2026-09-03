// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {MilestoneCards} from './MilestoneCards.sol';

/**
 * @title CardSwap
 * @notice Peer-to-peer secondary market for milestone cards, the missing
 * piece beside the treasury-run CardSale:
 *
 *  - Fixed price listings: a holder escrows the NFT here and names an ETH
 *    price. Anyone can buy. ERC-2981 royalties (2.5% by default) are split
 *    out to the royalty receiver before the seller is paid.
 *  - Card-for-card swap offers: a holder escrows their card and names the
 *    card they want plus an optional ETH ask. Whoever holds that card can
 *    accept, paying (or just handing over) the requested card.
 *
 * Both flows use escrow (the NFT moves into this contract when the offer is
 * created), so there is no approval race and no orderbook to trust: if the
 * NFT is here, the trade can execute; the maker can cancel any time while
 * it is still active.
 *
 * Pausable as an emergency stop: while paused, new listings, buys, offers,
 * and accepts halt, but cancellations stay open so escrowed cards can
 * always be pulled back out.
 */
contract CardSwap is Ownable, Pausable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
    }

    struct Offer {
        address maker;
        uint256 giveTokenId;
        uint256 wantTokenId;
        uint256 ethAsk;
        bool active;
    }

    MilestoneCards public immutable cards;

    mapping(uint256 tokenId => Listing) public listings;
    Offer[] internal _offers;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed tokenId);
    event CardSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event SwapOffered(uint256 indexed offerId, address indexed maker, uint256 giveTokenId, uint256 wantTokenId, uint256 ethAsk);
    event SwapCancelled(uint256 indexed offerId);
    event SwapAccepted(uint256 indexed offerId, address indexed taker);

    error NotOwner();
    error ZeroPrice();
    error NotListed();
    error NotSeller();
    error OfferInactive();
    error NotCardHolder();
    error SelfSwap();
    error InsufficientPayment();
    error EthTransferFailed();

    constructor(address cards_) Ownable(msg.sender) Pausable() ReentrancyGuard() {
        cards = MilestoneCards(cards_);
    }

    /// @notice Total number of swap offers ever created.
    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    /// @notice Read a swap offer by id (index into the offer list).
    function offers(uint256 offerId) external view returns (Offer memory) {
        return _offers[offerId];
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

    // ---------- card-for-card swaps ----------

    /// @notice Escrow your card and ask for `wantTokenId` plus `ethAsk` wei.
    /// The holder of `wantTokenId` accepts to complete the trade.
    function offerSwap(uint256 giveTokenId, uint256 wantTokenId, uint256 ethAsk) external whenNotPaused {
        if (cards.ownerOf(giveTokenId) != msg.sender) revert NotOwner();
        if (giveTokenId == wantTokenId) revert SelfSwap();
        _offers.push(
            Offer({maker: msg.sender, giveTokenId: giveTokenId, wantTokenId: wantTokenId, ethAsk: ethAsk, active: true})
        );
        cards.transferFrom(msg.sender, address(this), giveTokenId);
        emit SwapOffered(_offers.length - 1, msg.sender, giveTokenId, wantTokenId, ethAsk);
    }

    /// @notice Pull an escrowed swap offer back.
    function cancelSwap(uint256 offerId) external {
        Offer storage offer = _offers[offerId];
        if (!offer.active) revert OfferInactive();
        if (offer.maker != msg.sender) revert NotSeller();
        offer.active = false;
        cards.safeTransferFrom(address(this), msg.sender, offer.giveTokenId);
        emit SwapCancelled(offerId);
    }

    /// @notice Accept a swap offer as the holder of the wanted card. Requires
    /// setApprovalForAll or approve for this contract first, and pays ethAsk.
    function acceptSwap(uint256 offerId) external payable whenNotPaused nonReentrant {
        Offer memory offer = _offers[offerId];
        if (!offer.active) revert OfferInactive();
        if (cards.ownerOf(offer.wantTokenId) != msg.sender) revert NotCardHolder();
        if (msg.value < offer.ethAsk) revert InsufficientPayment();
        _offers[offerId].active = false;

        cards.transferFrom(msg.sender, offer.maker, offer.wantTokenId);
        cards.safeTransferFrom(address(this), msg.sender, offer.giveTokenId);
        if (offer.ethAsk > 0) _send(offer.maker, offer.ethAsk);
        _refundExcess(msg.value - offer.ethAsk);
        emit SwapAccepted(offerId, msg.sender);
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
