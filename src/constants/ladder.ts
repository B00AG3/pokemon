/**
 * The milestone ladder shared by the roadmap, market, and contracts. Index 1
 * is card #01. TCG ids come from contracts/scripts/generate-metadata.ts so
 * the site artwork matches the on-chain metadata. The launch ladder is 30
 * rungs: card #01 mines the moment the token is live (its $4,000 rung sits
 * below the ~$5,040 spawn cap), then one card every $10,000 of market cap
 * from $10,000 up, topping out at $290,000.
 */
export interface MilestoneSlot {
  index: number;
  usd: number;
  tcgId: string | null;
}

export const RUNG_COUNT = 30;
/** Card #01's rung: deliberately below the ~$5,040 spawn cap for an instant first mint. */
export const FIRST_RUNG_USD = 4_000;
/** Rungs 2-30 climb from $10,000 in $10,000 steps. */
export const RUNG_STEP_USD = 10_000;
/** First rung of the regular $10,000 staircase (card #02). */
export const STAIRCASE_START_USD = 10_000;

export const LADDER_USD: number[] = [
  FIRST_RUNG_USD,
  ...Array.from({ length: RUNG_COUNT - 1 }, (_, i) => STAIRCASE_START_USD + i * RUNG_STEP_USD),
];

/**
 * Ordered 1999 Base Set and Jungle holos, one per rung. Rungs 1-5 keep the
 * ids the site already shipped; rungs 6-16 complete the Base Set holos and
 * rungs 17-30 walk the Jungle holos. scripts/vendor-cards.ts downloads the
 * artwork for every id into public/cards.
 */
export const LADDER_TCG_IDS = [
  'base1-4', // 1  Charizard
  'base1-2', // 2  Blastoise
  'base1-1', // 3  Alakazam
  'base1-6', // 4  Gyarados
  'base1-15', // 5 Venusaur
  'base1-3', // 6  Chansey
  'base1-5', // 7  Clefairy
  'base1-7', // 8  Hitmonchan
  'base1-8', // 9  Machamp
  'base1-9', // 10 Magneton
  'base1-10', // 11 Mewtwo
  'base1-11', // 12 Nidoking
  'base1-12', // 13 Ninetales
  'base1-13', // 14 Poliwrath
  'base1-14', // 15 Raichu
  'base1-16', // 16 Zapdos
  'base2-1', // 17 Clefable
  'base2-2', // 18 Electrode
  'base2-3', // 19 Flareon
  'base2-4', // 20 Jolteon
  'base2-5', // 21 Kangaskhan
  'base2-6', // 22 Mr. Mime
  'base2-7', // 23 Nidoqueen
  'base2-8', // 24 Pidgeot
  'base2-9', // 25 Pinsir
  'base2-10', // 26 Scyther
  'base2-11', // 27 Snorlax
  'base2-12', // 28 Vaporeon
  'base2-13', // 29 Venomoth
  'base2-14', // 30 Victreebel
];

/** Card pinned to a 0-based rung, or null when that rung has no artwork. */
export function tcgIdForRung(rung: number): string | null {
  return LADDER_TCG_IDS[rung] ?? null;
}

export const MILESTONES: MilestoneSlot[] = LADDER_USD.map((usd, i) => ({
  index: i + 1,
  usd,
  tcgId: tcgIdForRung(i),
}));

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
