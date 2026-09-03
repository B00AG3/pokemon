// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {ERC2981} from '@openzeppelin/contracts/token/common/ERC2981.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';

/// @title MilestoneCards
/// @notice One collectible card NFT per market-cap milestone of the PokeCard
/// token. A keeper watches the price oracle. When the market cap has held
/// above the next threshold for `confirmWindow` seconds, the keeper mints the
/// next card. Each card mints exactly once, ever. Cards go to the treasury
/// (the owner) to be listed for sale; ERC-2981 royalties accrue on resale.
/// Minting is pausable as an emergency stop.
/// @dev Keeper flow per poll: confirmCrossing() (records the crossing), then
/// mintNext() once confirmWindow has elapsed.
contract MilestoneCards is ERC721, ERC2981, Ownable, Pausable {
    struct Milestone {
        uint256 marketCap; // USD, 18 decimals
        bool minted;
    }

    IMilestonePriceOracle public immutable oracle;
    address public keeper;
    string public baseTokenURI;
    uint256 public confirmWindow;

    Milestone[] internal _milestones;
    mapping(uint256 index => uint256 timestamp) internal _crossedAt;

    event MilestoneMinted(uint256 indexed index, uint256 indexed tokenId, uint256 marketCap);
    event KeeperUpdated(address indexed keeper);
    event BaseTokenURIUpdated(string baseTokenURI);
    event ConfirmWindowUpdated(uint256 seconds_);

    error NotKeeper();
    error NotAboveThreshold();
    error ConfirmationPending();
    error AllMilestonesMinted();
    error InvalidThreshold();
    error InvalidAddress();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(
        address oracle_,
        address keeper_,
        string memory baseTokenURI_,
        uint256[] memory thresholds,
        uint256 confirmWindow_
    ) ERC721('PokeCard Milestone Cards', 'PCMC') Ownable(msg.sender) Pausable() {
        if (oracle_ == address(0)) revert InvalidAddress();
        if (keeper_ == address(0)) revert InvalidAddress();
        oracle = IMilestonePriceOracle(oracle_);
        keeper = keeper_;
        baseTokenURI = baseTokenURI_;
        confirmWindow = confirmWindow_;
        for (uint256 i = 0; i < thresholds.length; i++) {
            if (thresholds[i] == 0) revert InvalidThreshold();
            _milestones.push(Milestone({marketCap: thresholds[i], minted: false}));
        }
        // 2.5% default royalty to the treasury on secondary sales
        _setDefaultRoyalty(msg.sender, 250);
    }

    /// @notice Record that the market cap is currently above the next
    /// threshold. Must be called again after `confirmWindow` seconds to mint.
    function confirmCrossing() external onlyKeeper {
        uint256 idx = _nextIndex();
        if (oracle.marketCap() < _milestones[idx].marketCap) revert NotAboveThreshold();
        _crossedAt[idx] = block.timestamp;
    }

    /// @notice Mint the next milestone card, if its crossing is confirmed.
    function mintNext() external onlyKeeper whenNotPaused {
        uint256 idx = _nextIndex();
        Milestone storage m = _milestones[idx];

        uint256 mc = oracle.marketCap();
        if (mc < m.marketCap) revert NotAboveThreshold();

        if (confirmWindow > 0) {
            uint256 crossed = _crossedAt[idx];
            if (crossed == 0) revert ConfirmationPending();
            if (block.timestamp - crossed < confirmWindow) revert ConfirmationPending();
        }

        m.minted = true;
        uint256 tokenId = idx + 1; // card #01 has tokenId 1
        _safeMint(owner(), tokenId);
        emit MilestoneMinted(idx, tokenId, mc);
    }

    /// @return index of the next un-minted milestone (type(uint256).max when
    /// all are minted) and its market-cap threshold.
    function nextMilestone() external view returns (uint256 index, uint256 marketCap) {
        uint256 idx = _peekNextIndex();
        if (idx == type(uint256).max) return (type(uint256).max, 0);
        return (idx, _milestones[idx].marketCap);
    }

    function milestoneAt(uint256 index) external view returns (uint256 marketCap, bool minted) {
        Milestone storage m = _milestones[index];
        return (m.marketCap, m.minted);
    }

    function crossingAt(uint256 index) external view returns (uint256) {
        return _crossedAt[index];
    }

    function totalMilestones() external view returns (uint256) {
        return _milestones.length;
    }

    function totalMinted() external view returns (uint256 count) {
        for (uint256 i = 0; i < _milestones.length; i++) {
            if (_milestones[i].minted) count++;
        }
    }

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert InvalidAddress();
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    function setBaseTokenURI(string calldata uri_) external onlyOwner {
        baseTokenURI = uri_;
        emit BaseTokenURIUpdated(uri_);
    }

    function setConfirmWindow(uint256 seconds_) external onlyOwner {
        confirmWindow = seconds_;
        emit ConfirmWindowUpdated(seconds_);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    /// @notice Emergency stop: halt milestone mints.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(baseTokenURI, Strings.toString(tokenId), '.json');
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _peekNextIndex() internal view returns (uint256) {
        for (uint256 i = 0; i < _milestones.length; i++) {
            if (!_milestones[i].minted) return i;
        }
        return type(uint256).max;
    }

    function _nextIndex() internal view returns (uint256) {
        uint256 idx = _peekNextIndex();
        if (idx == type(uint256).max) revert AllMilestonesMinted();
        return idx;
    }
}
