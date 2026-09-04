// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {ERC2981} from '@openzeppelin/contracts/token/common/ERC2981.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {IMilestonePriceOracle} from './IMilestonePriceOracle.sol';

/// @dev Minimal ERC-20 surface the draw needs: is this wallet still a holder?
interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @title MilestoneCards
/// @notice One collectible card NFT per market-cap milestone of the PokeCard
/// token, airdropped free to holders. A keeper watches the price oracle. When
/// the market cap has held above the next threshold for `confirmWindow`
/// seconds, the keeper mints the next card straight to a drawn holder.
/// Any wallet holding POKE can enter the standing draw once with
/// `enterDraw()`; the winner must still hold POKE at mint time, otherwise the
/// draw skips to the next entrant. With no eligible entrants the card falls
/// back to the treasury (owner), which can dispose of it manually. Each card
/// mints exactly once, ever.
///
/// Every card carries a chart-tracked value: `chartPriceOf` is
/// `redeemBasePrice x agedMarketCap / launchMilestone`, so a card from the
/// $10k milestone is redeemable for double once the cap reaches $20k. The cap
/// behind that price is the newest keeper `checkpointCap` sample at least
/// REDEEM_DELAY old, which keeps a momentary pool-price spike from being
/// redeemed straight out of the pool. Any holder can `redeem()` their card
/// for exactly that amount, paid from this contract's ETH pool (the owner
/// funds it; `receive` accepts deposits), and the card burns. Holders who
/// want more than the chart price can list on CardSwap instead. ERC-2981
/// royalties accrue on those secondary sales. Minting is pausable as an
/// emergency stop.
/// @dev Keeper flow per poll: confirmCrossing() once the cap first crosses
/// (the stamp sticks), mintNext() once confirmWindow has elapsed, and
/// checkpointCap() at least every CHECKPOINT_GAP to feed redemption pricing.
/// @dev Randomness: the winner is seeded from block.prevrandao plus milestone
/// data. A validator/keeper can influence it, so this is a trust-minimized
/// raffle, not a cryptographic VRF - the same trust placed in the keeper for
/// gating mints. For adversarial stake levels, swap in a VRF callback.
contract MilestoneCards is ERC721, ERC2981, Ownable, Pausable {
    struct Milestone {
        uint256 marketCap; // USD, 18 decimals
        bool minted;
    }

    IMilestonePriceOracle public immutable oracle;
    address public immutable pokeToken; // POKE: holding it is the draw ticket
    address public keeper;
    string public baseTokenURI;
    uint256 public confirmWindow;
    uint256 public redeemBasePrice; // ETH value of a card at its own launch cap

    /// @dev Caps how many entrants a single mint will scan (entrants who sold
    /// their POKE are skipped until a current holder is found). Keeps gas
    /// bounded no matter how large the draw; griefing the draw into a treasury
    /// fallback requires a contiguous wall of sold-out entrants this long.
    uint256 public constant MAX_DRAW_CHECKS = 256;

    /// @dev Redemptions and treasury sale pricing use the newest market-cap
    /// checkpoint at least `redeemDelay` seconds old, so a pool-price spike
    /// cannot be minted into ETH and unwound within the same move. The keeper
    /// records checkpoints at most CHECKPOINT_GAP apart; CAP_HISTORY points
    /// are kept, covering redeemDelay plus slack for keeper downtime.
    /// Mainnet deploys with 6 hours; rehearsals shorten it.
    uint256 public immutable redeemDelay;
    uint256 internal constant CHECKPOINT_GAP = 15 minutes;
    uint256 internal constant CAP_HISTORY = 32;

    struct CapPoint {
        uint128 at;
        uint128 cap; // USD, 18 decimals
    }

    Milestone[] internal _milestones;
    mapping(uint256 index => uint256 timestamp) internal _crossedAt;
    address[] internal _entrantList;
    mapping(address account => bool entered) internal _entered;
    CapPoint[CAP_HISTORY] internal _capPoints; // ring buffer, index = count % CAP_HISTORY
    uint256 internal _capPointCount;

    event MilestoneMinted(uint256 indexed index, uint256 indexed tokenId, uint256 marketCap, address indexed to);
    event CardRedeemed(uint256 indexed tokenId, address indexed holder, uint256 price);
    event DrawEntered(address indexed account);
    event DrawLeft(address indexed account);
    event KeeperUpdated(address indexed keeper);
    event BaseTokenURIUpdated(string baseTokenURI);
    event ConfirmWindowUpdated(uint256 seconds_);
    event RedeemBasePriceUpdated(uint256 basePrice);
    event CapCheckpointed(uint256 cap, uint256 at);

    error NotKeeper();
    error NotAboveThreshold();
    error ConfirmationPending();
    error AllMilestonesMinted();
    error InvalidThreshold();
    error InvalidAddress();
    error NotHolder();
    error AlreadyEntered();
    error NotEntered();
    error NotCardHolder();
    error InsufficientPool();
    error EthTransferFailed();
    error ChartNotReady();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(
        address oracle_,
        address keeper_,
        address pokeToken_,
        uint256 redeemBasePrice_,
        string memory baseTokenURI_,
        uint256[] memory thresholds,
        uint256 confirmWindow_,
        uint256 redeemDelay_
    ) ERC721('PokeCard Milestone Cards', 'PCMC') Ownable(msg.sender) Pausable() {
        if (oracle_ == address(0)) revert InvalidAddress();
        if (keeper_ == address(0)) revert InvalidAddress();
        if (pokeToken_ == address(0)) revert InvalidAddress();
        if (redeemBasePrice_ == 0) revert InvalidAddress();
        oracle = IMilestonePriceOracle(oracle_);
        pokeToken = pokeToken_;
        keeper = keeper_;
        redeemBasePrice = redeemBasePrice_;
        baseTokenURI = baseTokenURI_;
        confirmWindow = confirmWindow_;
        redeemDelay = redeemDelay_;
        for (uint256 i = 0; i < thresholds.length; i++) {
            if (thresholds[i] == 0) revert InvalidThreshold();
            _milestones.push(Milestone({marketCap: thresholds[i], minted: false}));
        }
        // 2.5% default royalty to the treasury on secondary sales
        _setDefaultRoyalty(msg.sender, 250);
    }

    /// @notice Fund the redemption pool. Redemptions pay out of this balance.
    receive() external payable {}

    /// @notice Ops: pull ETH out of the redemption pool.
    function withdrawPool(address to, uint256 amount) external onlyOwner {
        _send(to, amount);
    }

    /// @notice Join the standing airdrop draw. One entry per wallet, and the
    /// wallet must hold POKE. Winners are re-checked at mint time, so staying
    /// in the draw means staying a holder.
    function enterDraw() external whenNotPaused {
        if (_entered[msg.sender]) revert AlreadyEntered();
        if (IERC20Balance(pokeToken).balanceOf(msg.sender) == 0) revert NotHolder();
        _entered[msg.sender] = true;
        _entrantList.push(msg.sender);
        emit DrawEntered(msg.sender);
    }

    /// @notice Leave the draw. Swap-and-pop removal; gas grows with the
    /// entrant list, which is expected to stay small (one entry per wallet).
    function leaveDraw() external {
        if (!_entered[msg.sender]) revert NotEntered();
        _entered[msg.sender] = false;
        uint256 len = _entrantList.length;
        for (uint256 i = 0; i < len; i++) {
            if (_entrantList[i] == msg.sender) {
                _entrantList[i] = _entrantList[len - 1];
                _entrantList.pop();
                break;
            }
        }
        emit DrawLeft(msg.sender);
    }

    function entrantCount() external view returns (uint256) {
        return _entrantList.length;
    }

    function isEntered(address account) external view returns (bool) {
        return _entered[account];
    }

    /// @notice The current chart value of a card in the redemption pool:
    /// `redeemBasePrice x agedMarketCap / launchMilestone`. A card from the
    /// $10k milestone at a $20k cap is redeemable for 2x its base price. The
    /// cap is the newest keeper checkpoint at least `redeemDelay` old, so the
    /// payout tracks the chart without being mintable from a spot spike.
    /// Reverts ChartNotReady until a checkpoint has aged.
    function chartPriceOf(uint256 tokenId) public view returns (uint256) {
        uint256 threshold = _milestones[tokenId - 1].marketCap;
        uint256 cap = agedMarketCap();
        if (cap == 0) revert ChartNotReady();
        return (redeemBasePrice * cap) / threshold;
    }

    /// @notice Keeper records the current market cap into the history that
    /// prices redemptions. No-op when the last checkpoint is younger than
    /// CHECKPOINT_GAP; reverts NotAboveThreshold never (a checkpoint is a
    /// sample, not a crossing).
    function checkpointCap() external onlyKeeper {
        uint256 mc = oracle.marketCap();
        uint256 n = _capPointCount;
        if (n > 0 && block.timestamp - _capPoints[(n - 1) % CAP_HISTORY].at < CHECKPOINT_GAP) {
            return;
        }
        _capPoints[n % CAP_HISTORY] = CapPoint(uint128(block.timestamp), uint128(mc));
        _capPointCount = n + 1;
        emit CapCheckpointed(mc, block.timestamp);
    }

    /// @notice Newest recorded checkpoint at least `redeemDelay` seconds old.
    /// Zero before the first checkpoint has aged. Keeper downtime older than
    /// the ring simply prices redemptions off the newest surviving point.
    function agedMarketCap() public view returns (uint256) {
        uint256 n = _capPointCount;
        if (n == 0) return 0;
        uint256 cutoff = block.timestamp - redeemDelay;
        uint256 oldest = n < CAP_HISTORY ? 1 : n - CAP_HISTORY + 1;
        for (uint256 i = n; i >= oldest; i--) {
            CapPoint memory p = _capPoints[(i - 1) % CAP_HISTORY];
            if (p.at <= cutoff) return p.cap;
        }
        return 0;
    }

    function lastCheckpointAt() external view returns (uint256) {
        uint256 n = _capPointCount;
        if (n == 0) return 0;
        return _capPoints[(n - 1) % CAP_HISTORY].at;
    }

    /// @notice Sell a card back to the protocol for its chart value, paid
    /// from the redemption pool. The card burns, keeping the collection
    /// scarce. Checks-effects-interactions: the burn settles before the ETH
    /// leaves, so reentry can only redeem other cards legitimately.
    function redeem(uint256 tokenId) external whenNotPaused {
        if (ownerOf(tokenId) != msg.sender) revert NotCardHolder();

        uint256 price = chartPriceOf(tokenId);
        if (address(this).balance < price) revert InsufficientPool();

        _burn(tokenId);
        emit CardRedeemed(tokenId, msg.sender, price);
        _send(msg.sender, price);
    }

    /// @notice Record that the market cap is currently above the next
    /// threshold. The first confirmation sticks: later calls are no-ops, so
    /// the confirm window always runs off the original crossing and a
    /// keep-polling keeper can never push the mint out forever.
    function confirmCrossing() external onlyKeeper {
        uint256 idx = _nextIndex();
        if (_crossedAt[idx] != 0) return;
        if (oracle.marketCap() < _milestones[idx].marketCap) revert NotAboveThreshold();
        _crossedAt[idx] = block.timestamp;
    }

    /// @notice Mint the next milestone card to a drawn holder, if its
    /// crossing is confirmed.
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

        address winner = _drawWinner(idx, mc);
        address to = winner == address(0) ? owner() : winner; // treasury fallback

        m.minted = true;
        uint256 tokenId = idx + 1; // card #01 has tokenId 1
        _safeMint(to, tokenId);
        emit MilestoneMinted(idx, tokenId, mc, to);
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

    function setRedeemBasePrice(uint256 basePrice_) external onlyOwner {
        if (basePrice_ == 0) revert InvalidAddress();
        redeemBasePrice = basePrice_;
        emit RedeemBasePriceUpdated(basePrice_);
    }

    function _send(address to, uint256 amount) internal {
        (bool sent, ) = to.call{value: amount}('');
        if (!sent) revert EthTransferFailed();
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

    /// @dev Pick the airdrop recipient. Scans up to MAX_DRAW_CHECKS entrants
    /// from a pseudorandom start, skipping entrants who sold their POKE, and
    /// returns the first current holder. Returns address(0) when the draw is
    /// empty or the whole scanned window sold out; the caller falls back to
    /// the treasury.
    function _drawWinner(uint256 idx, uint256 marketCap) internal view returns (address) {
        uint256 len = _entrantList.length;
        if (len == 0) return address(0);

        bytes32 seed = keccak256(abi.encode(block.prevrandao, idx, marketCap, _crossedAt[idx]));
        uint256 start = uint256(seed) % len;
        uint256 checks = len < MAX_DRAW_CHECKS ? len : MAX_DRAW_CHECKS;

        for (uint256 i = 0; i < checks; i++) {
            address candidate = _entrantList[(start + i) % len];
            if (IERC20Balance(pokeToken).balanceOf(candidate) > 0) return candidate;
        }
        return address(0);
    }
}
