/**
 * Deployed contract addresses + the minimal ABIs the frontend needs.
 * Fill VITE_CARDS_ADDRESS / VITE_ORACLE_ADDRESS / VITE_TOKEN_ADDRESS in .env
 * after running `npm run deploy:testnet` in /contracts. Addresses stay
 * undefined until then, and the web3 hooks disable themselves gracefully.
 */
function address(value: string | undefined): `0x${string}` | undefined {
  return value && value.startsWith('0x') ? (value as `0x${string}`) : undefined;
}

export const CONTRACTS = {
  token: address(import.meta.env.VITE_TOKEN_ADDRESS),
  cards: address(import.meta.env.VITE_CARDS_ADDRESS),
  oracle: address(import.meta.env.VITE_ORACLE_ADDRESS),
};

export const pokeCardTokenAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const;

export const milestoneCardsAbi = [
  'function nextMilestone() view returns (uint256 index, uint256 marketCap)',
  'function milestoneAt(uint256 index) view returns (uint256 marketCap, bool minted)',
  'function totalMilestones() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function crossingAt(uint256 index) view returns (uint256)',
  'function confirmWindow() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
] as const;

export const priceOracleAbi = [
  'function marketCap() view returns (uint256)',
] as const;
