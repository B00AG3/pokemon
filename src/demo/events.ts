/**
 * Market activity event log. In demo mode events live in localStorage and
 * include seeded trader history so the Activity page has context; in live
 * mode events come from contract logs instead.
 */
export type MarketEventType = 'buy' | 'sell' | 'mint';

export interface MarketEvent {
  id: string;
  type: MarketEventType;
  ts: number;
  accountKey: string; // 'you', 'npc-1', 'npc-2', 'treasury', or a wallet address
  cardId?: string;
  priceEth?: number; // buy/sell price
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * Demo history: the first three cards airdropped to the three seeded traders
 * (newest first, like every other event list). Card #04's draw is still open.
 */
export function seedEvents(now = Date.now()): MarketEvent[] {
  return [
    { id: 'seed-3', type: 'mint', ts: now - 8 * HOUR, accountKey: 'npc-2', cardId: 'demo-3' },
    { id: 'seed-2', type: 'mint', ts: now - 30 * HOUR, accountKey: 'npc-1', cardId: 'demo-2' },
    { id: 'seed-1', type: 'mint', ts: now - 50 * HOUR, accountKey: 'npc-3', cardId: 'demo-1' },
  ];
}
