/**
 * The milestone ladder shared by the roadmap, market, and contracts. Index 1
 * is card #01. TCG ids come from contracts/scripts/generate-metadata.ts so
 * the site artwork matches the on-chain metadata; slots 6 to 7 are minted
 * once the team pins artwork for them (tcgId null until then). The ladder
 * starts at $10k because the coin spawns near a $5k cap at launch.
 */
export interface MilestoneSlot {
  index: number;
  usd: number;
  tcgId: string | null;
}

export const LADDER_USD = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];

export const LADDER_TCG_IDS = ['base1-4', 'base1-2', 'base1-1', 'base1-6', 'base1-15'];

export const MILESTONES: MilestoneSlot[] = LADDER_USD.map((usd, i) => ({
  index: i + 1,
  usd,
  tcgId: LADDER_TCG_IDS[i] ?? null,
}));

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
