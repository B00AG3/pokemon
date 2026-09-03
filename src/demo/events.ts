/**
 * Market activity event log. In demo mode events live in localStorage and
 * include seeded trader history so the Activity page has context; in live
 * mode events come from contract logs instead.
 */
export type MarketEventType = 'buy' | 'sell' | 'trade' | 'mint';

export interface MarketEvent {
  id: string;
  type: MarketEventType;
  ts: number;
  accountKey: string; // 'you', 'npc-1', 'npc-2', 'treasury', or a wallet address
  cardId?: string;
  giveCardId?: string; // trade: card given away
  getCardId?: string; // trade: card received
  priceEth?: number; // buy/sell price or trade ETH delta
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * Demo history: the first three cards minted, then the two NPC traders
 * picked up cards 2 and 3. Newest first, like every other event list.
 */
export function seedEvents(now = Date.now()): MarketEvent[] {
  return [
    { id: 'seed-5', type: 'buy', ts: now - 2 * HOUR, accountKey: 'npc-2', cardId: 'demo-3', priceEth: 0.042 },
    { id: 'seed-4', type: 'mint', ts: now - 8 * HOUR, accountKey: 'treasury', cardId: 'demo-3', priceEth: 0.05 },
    { id: 'seed-3', type: 'buy', ts: now - 20 * HOUR, accountKey: 'npc-1', cardId: 'demo-2', priceEth: 0.05 },
    { id: 'seed-2', type: 'mint', ts: now - 30 * HOUR, accountKey: 'treasury', cardId: 'demo-2', priceEth: 0.05 },
    { id: 'seed-1', type: 'mint', ts: now - 50 * HOUR, accountKey: 'treasury', cardId: 'demo-1', priceEth: 0.05 },
  ];
}
