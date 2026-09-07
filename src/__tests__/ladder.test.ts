import { describe, expect, it } from 'vitest';
import {
  formatUsd,
  LADDER_TCG_IDS,
  LADDER_USD,
  MILESTONES,
  tcgIdForRung,
} from '../constants/ladder';

/**
 * Ladder arithmetic for the 30-rung launch: card #01 mines the moment the
 * token is live (rung 1 sits below the spawn cap), rungs 2-30 climb from
 * $10,000 in $10,000 steps, and the ladder tops out at $290,000.
 */
const RUNG_COUNT = 30;
const FIRST_RUNG_USD = 4_000;
const STAIRCASE_START_USD = 10_000;
const RUNG_STEP_USD = 10_000;
const LAST_RUNG_USD = STAIRCASE_START_USD + (RUNG_COUNT - 2) * RUNG_STEP_USD;

function expectedRung(i: number): number {
  return i === 0 ? FIRST_RUNG_USD : STAIRCASE_START_USD + (i - 1) * RUNG_STEP_USD;
}

describe('LADDER_USD', () => {
  it('has exactly 30 rungs', () => {
    expect(LADDER_USD).toHaveLength(RUNG_COUNT);
  });

  it('starts at $4,000, then steps $10,000 per rung from $10,000', () => {
    LADDER_USD.forEach((usd, i) => {
      expect(usd, `rung ${i + 1} should be ${expectedRung(i)}`).toBe(expectedRung(i));
    });
  });

  it('is strictly increasing', () => {
    for (let i = 1; i < LADDER_USD.length; i++) {
      expect(LADDER_USD[i], `rung ${i + 1} must exceed rung ${i}`).toBeGreaterThan(LADDER_USD[i - 1]);
    }
  });

  it(`ends at ${formatUsd(LAST_RUNG_USD)}`, () => {
    expect(LADDER_USD[LADDER_USD.length - 1]).toBe(LAST_RUNG_USD);
  });
});

describe('LADDER_TCG_IDS', () => {
  it('pins one unique TCG card per rung', () => {
    expect(LADDER_TCG_IDS).toHaveLength(RUNG_COUNT);
    expect(new Set(LADDER_TCG_IDS).size, 'ids must be unique').toBe(RUNG_COUNT);
  });

  it('keeps the original five ladder cards on rungs 1-5', () => {
    expect(LADDER_TCG_IDS.slice(0, 5)).toEqual(['base1-4', 'base1-2', 'base1-1', 'base1-6', 'base1-15']);
  });
});

describe('MILESTONES', () => {
  it('maps every rung to a 1-based slot with its threshold and card', () => {
    expect(MILESTONES).toHaveLength(RUNG_COUNT);
    MILESTONES.forEach((slot, i) => {
      expect(slot.index).toBe(i + 1);
      expect(slot.usd).toBe(expectedRung(i));
      expect(slot.tcgId).toBe(LADDER_TCG_IDS[i]);
      expect(slot.tcgId).not.toBeNull();
    });
  });
});

describe('tcgIdForRung', () => {
  it('answers the pinned card inside the ladder and null past its end', () => {
    expect(tcgIdForRung(0)).toBe(LADDER_TCG_IDS[0]);
    expect(tcgIdForRung(RUNG_COUNT - 1)).toBe(LADDER_TCG_IDS[RUNG_COUNT - 1]);
    expect(tcgIdForRung(RUNG_COUNT)).toBeNull();
  });
});

describe('formatUsd', () => {
  it('renders USD amounts with en-US grouping', () => {
    expect(formatUsd(FIRST_RUNG_USD)).toBe('$4,000');
    expect(formatUsd(LAST_RUNG_USD)).toBe('$290,000');
  });
});
