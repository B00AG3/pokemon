// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';
import {MilestoneCards} from './MilestoneCards.sol';

/**
 * @title CardSale
 * @notice Sells milestone cards held by the treasury with pricing that
 * tracks the token, the signature PokeCard mechanic:
 *
 *   price(card) = basePriceWei x currentMarketCap / milestoneCapOfThatCard
 *
 * A card that launched at a $5,000 market cap is quoted at 200x its base
 * price once the token reaches $1,000,000 - exactly the "first card is the
 * cheapest it will ever be" story. Every card can be bought from the
 * treasury once; secondary trading then happens on marketplaces (OpenSea
 * supports Robinhood Chain) with ERC-2981 royalties applied there.
 *
 * Pausable as an emergency stop: while paused, buys halt but nothing is
 * lost - the owner can unpause at any time.
 */
contract CardSale is Ownable, Pausable, ReentrancyGuard {
    MilestoneCards public immutable cards;
    IMilestonePriceOracle public immutable oracle;
    uint256 public basePriceWei;

    mapping(uint256 tokenId => bool listed) internal _listed;

    event CardListed(uint256 indexed tokenId);
    event CardDelisted(uint256 indexed tokenId);
    event CardSold(uint256 indexed tokenId, address indexed buyer, uint256 price, uint256 marketCap);
    event BasePriceUpdated(uint256 basePriceWei);
    event TreasuryWithdrawal(address indexed to, uint256 amount);

    error CardNotMinted();
    error NotListed();
    error InsufficientPayment();
    error EthTransferFailed();

    constructor(address cards_, address oracle_, uint256 basePriceWei_) Ownable(msg.sender) Pausable() ReentrancyGuard() {
        cards = MilestoneCards(cards_);
        oracle = IMilestonePriceOracle(oracle_);
        basePriceWei = basePriceWei_;
    }

    /// @notice Current ETH price (wei) of a milestone card. Scales linearly
    /// with market cap relative to the card's own launch milestone.
    function priceOf(uint256 tokenId) public view returns (uint256) {
        (uint256 threshold, bool minted) = cards.milestoneAt(tokenId - 1);
        if (!minted) revert CardNotMinted();
        uint256 mc = oracle.marketCap();
        return Math.mulDiv(basePriceWei, mc, threshold);
    }

    function isListed(uint256 tokenId) external view returns (bool) {
        return _listed[tokenId];
    }

    function buy(uint256 tokenId) external payable whenNotPaused nonReentrant {
        if (!_listed[tokenId]) revert NotListed();

        uint256 price = priceOf(tokenId);
        if (msg.value < price) revert InsufficientPayment();

        _listed[tokenId] = false; // each card sells from the treasury once
        address seller = cards.ownerOf(tokenId);
        cards.transferFrom(seller, msg.sender, tokenId);

        address treasury = owner();
        (bool sent, ) = treasury.call{value: price}('');
        if (!sent) revert EthTransferFailed();

        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool refunded, ) = msg.sender.call{value: excess}('');
            if (!refunded) revert EthTransferFailed();
        }

        emit CardSold(tokenId, msg.sender, price, oracle.marketCap());
    }

    function list(uint256[] calldata tokenIds) external onlyOwner {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _listed[tokenIds[i]] = true;
            emit CardListed(tokenIds[i]);
        }
    }

    function delist(uint256[] calldata tokenIds) external onlyOwner {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _listed[tokenIds[i]] = false;
            emit CardDelisted(tokenIds[i]);
        }
    }

    function setBasePriceWei(uint256 basePriceWei_) external onlyOwner {
        basePriceWei = basePriceWei_;
        emit BasePriceUpdated(basePriceWei_);
    }

    /// @notice Emergency stop: halt treasury buys.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address to) external onlyOwner {
        uint256 balance = address(this).balance;
        (bool sent, ) = to.call{value: balance}('');
        if (!sent) revert EthTransferFailed();
        emit TreasuryWithdrawal(to, balance);
    }

    /// @notice Accept ETH (accidental transfers, treasury top-ups).
    receive() external payable {}
}
