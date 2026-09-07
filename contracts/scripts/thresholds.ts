/**
 * Shared THRESHOLDS parsing for deploy.ts and launch-cards.ts.
 *
 * THRESHOLDS is a comma-separated list of whole USD market-cap milestones,
 * low to high. The launch ladder of record is 30 rungs: $20,000 for the first
 * card (instantly, below the spawn cap), then +$10,000 per rung up to $290,000.
 *
 * Values are returned scaled by 1e18 (USD with 18 decimals), the unit the
 * MilestoneCards oracle comparisons expect.
 */

/** Number of cards on the launch ladder (one card per rung). */
export const LADDER_RUNG_COUNT = 30;

/** The 30-rung launch ladder as a THRESHOLDS string: 4000,10000,20000,...,290000. */
export const DEFAULT_THRESHOLDS: string = Array.from(
  { length: LADDER_RUNG_COUNT },
  (_, i) => (i === 0 ? 4000 : 10000 + (i - 1) * 10000),
).join(',');

const USD_SCALE = 10n ** 18n;

export interface ParseThresholdsOptions {
  /**
   * When set, the input must hold exactly this many values (launch-cards pins
   * LADDER_RUNG_COUNT so the on-chain ladder matches the site's 30 cards).
   * Unset = any count is fine (smoke stacks, rehearsals).
   */
  expectedCount?: number;
}

/**
 * Parse and validate a THRESHOLDS string into strictly ascending USD-wei
 * values. Throws (before any transaction is built anywhere) on:
 *   - malformed input (empty, blank or non-integer segments)
 *   - nonpositive values
 *   - non-ascending order (equal neighbors included)
 *   - wrong rung count, when opts.expectedCount is pinned
 */
export function parseThresholds(raw: string, opts: ParseThresholdsOptions = {}): bigint[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('THRESHOLDS must be a comma-separated list of whole USD amounts (got empty)');
  }
  const parts = trimmed.split(',').map((s) => s.trim());
  const values: bigint[] = [];
  for (const part of parts) {
    if (!part) {
      throw new Error(
        `THRESHOLDS must be a comma-separated list of whole USD amounts (got "${raw}")`,
      );
    }
    let value: bigint;
    try {
      value = BigInt(part);
    } catch {
      throw new Error(
        `THRESHOLDS must be a comma-separated list of whole USD amounts (got "${raw}")`,
      );
    }
    if (value <= 0n) {
      throw new Error(`THRESHOLDS values must be positive USD amounts (got ${part})`);
    }
    values.push(value * USD_SCALE);
  }
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) {
      throw new Error(
        `THRESHOLDS must be strictly ascending from low to high (${parts[i - 1]} then ${parts[i]})`,
      );
    }
  }
  if (opts.expectedCount !== undefined && values.length !== opts.expectedCount) {
    throw new Error(
      `THRESHOLDS must hold exactly ${opts.expectedCount} values for this launch, got ${values.length}`,
    );
  }
  return values;
}
