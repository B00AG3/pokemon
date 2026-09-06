/**
 * The milestone ladder shared by the roadmap, market, and contracts. Index 1
 * is card #01. TCG ids come from contracts/scripts/generate-metadata.ts so
 * the site artwork matches the on-chain metadata; trailing slots with no
 * pinned artwork carry tcgId null. Currently mirrors the LIVE mainnet smoke
 * stack (cards 0xA45e...c3Fe3): three rungs at $4k/$6k/$7k - the coin
 * spawned near a $5k cap, so the first rung was crossed at launch. At the
 * real-ladder launch, restore [10000, 25000, 50000, 100000, 250000, 500000,
 * 1000000] together with the new card addresses.
 */
export interface MilestoneSlot {
  index: number;
  usd: number;
  tcgId: string | null;
}

export const LADDER_USD = [4000, 6000, 7000];

export const LADDER_TCG_IDS = ['base1-4', 'base1-2', 'base1-1', 'base1-6', 'base1-15'];

export const MILESTONES: MilestoneSlot[] = LADDER_USD.map((usd, i) => ({
  index: i + 1,
  usd,
  tcgId: LADDER_TCG_IDS[i] ?? null,
}));

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
