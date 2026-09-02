import type { CardListItem } from '../types/tcgdex';

/**
 * Demo market data for the trading preview. Everything here is simulated:
 * balances are fake, prices are derived from a drifting market-cap ticker.
 * When the contracts deploy, this UI swaps to on-chain reads 1:1.
 */
export interface DemoCard {
  id: string;
  tcgId: string;
  launchMc: number; // USD market cap this card "minted" at
}

export const DEMO_CARDS: DemoCard[] = [
  { id: 'demo-1', tcgId: 'base1-4', launchMc: 5000 },
  { id: 'demo-2', tcgId: 'base1-2', launchMc: 10000 },
  { id: 'demo-3', tcgId: 'base1-1', launchMc: 25000 },
];

export const BASE_PRICE_ETH = 0.05;
export const SUPPLY = 1_000_000_000; // 1B POKE
export const START_MARKET_CAP = 5000;
export const ETH_USD = 3000; // demo fiat reference for card prices

/** ETH price of a card, tracking the simulated market cap (the signature mechanic). */
export function priceEth(card: DemoCard, marketCap: number): number {
  return BASE_PRICE_ETH * (marketCap / card.launchMc);
}

/** USD price of one POKE from the simulated cap. */
export function pokeUsdPrice(marketCap: number): number {
  return marketCap / SUPPLY;
}

export function formatEth(value: number): string {
  return `${value.toFixed(3)} ETH`;
}

/** Format a TCGdex card into the slim shape the demo grid needs. */
export function toDemoArt(card: CardListItem & { rarity?: string }) {
  return { tcgId: card.id, name: card.name, image: card.image };
}
