/**
 * Deployed contract addresses + the ABIs the frontend needs. Fill
 * VITE_CARDS_ADDRESS / VITE_ORACLE_ADDRESS / VITE_SALE_ADDRESS /
 * VITE_SWAP_ADDRESS / VITE_TOKEN_ADDRESS in .env after running
 * `npm run deploy:testnet` in /contracts (addresses are printed and saved to
 * deployments/<network>.json). Addresses stay undefined until then, and the
 * web3 hooks disable themselves gracefully so the demo market keeps running.
 */
import { parseAbi } from 'viem';

function address(value: string | undefined): `0x${string}` | undefined {
  return value && value.startsWith('0x') ? (value as `0x${string}`) : undefined;
}

export const CONTRACTS = {
  token: address(import.meta.env.VITE_TOKEN_ADDRESS),
  cards: address(import.meta.env.VITE_CARDS_ADDRESS),
  oracle: address(import.meta.env.VITE_ORACLE_ADDRESS),
  sale: address(import.meta.env.VITE_SALE_ADDRESS),
  swap: address(import.meta.env.VITE_SWAP_ADDRESS),
};

/** True when the on-chain layer is fully deployed and wired via .env. */
export const LIVE_MODE = Boolean(CONTRACTS.cards && CONTRACTS.oracle && CONTRACTS.sale && CONTRACTS.swap);

export const pokeCardTokenAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

export const milestoneCardsAbi = parseAbi([
  'function nextMilestone() view returns (uint256 index, uint256 marketCap)',
  'function milestoneAt(uint256 index) view returns (uint256 marketCap, bool minted)',
  'function totalMilestones() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function crossingAt(uint256 index) view returns (uint256)',
  'function confirmWindow() view returns (uint256)',
  'function owner() view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function approve(address to, uint256 tokenId)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event MilestoneMinted(uint256 indexed index, uint256 indexed tokenId, uint256 marketCap)',
]);

export const priceOracleAbi = parseAbi([
  'function marketCap() view returns (uint256)',
]);

export const cardSaleAbi = parseAbi([
  'function priceOf(uint256 tokenId) view returns (uint256)',
  'function isListed(uint256 tokenId) view returns (bool)',
  'function basePriceWei() view returns (uint256)',
  'function buy(uint256 tokenId) payable',
  'event CardSold(uint256 indexed tokenId, address indexed buyer, uint256 price, uint256 marketCap)',
]);

export const cardSwapAbi = parseAbi([
  // component names are decode labels only; priceWei mirrors ChainCard usage
  'struct Listing { address seller; uint256 priceWei; }',
  'struct Offer { address maker; uint256 giveTokenId; uint256 wantTokenId; uint256 ethAsk; bool active; }',
  'function listings(uint256 tokenId) view returns (Listing listing)',
  'function offerCount() view returns (uint256)',
  'function offers(uint256 offerId) view returns (Offer offer)',
  'function list(uint256 tokenId, uint256 price)',
  'function cancelListing(uint256 tokenId)',
  'function buy(uint256 tokenId) payable',
  'function offerSwap(uint256 giveTokenId, uint256 wantTokenId, uint256 ethAsk)',
  'function cancelSwap(uint256 offerId)',
  'function acceptSwap(uint256 offerId) payable',
  'event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)',
  'event CardSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)',
  'event SwapOffered(uint256 indexed offerId, address indexed maker, uint256 giveTokenId, uint256 wantTokenId, uint256 ethAsk)',
  'event SwapAccepted(uint256 indexed offerId, address indexed taker)',
]);
