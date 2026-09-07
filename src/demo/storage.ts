/**
 * One-time cleanup of the retired demo market's localStorage keys. Visitors
 * from the smoke-run era still carry simulated ownership, a simulated draw
 * entry, and seeded activity in their browsers; on the first prelaunch or
 * live boot the market layer wipes exactly those keys (see MarketProvider).
 * The pokemontcg:card:* art cache is deliberately kept: the ladder manifest
 * answers before any cached API payload, so cached art can never resurrect
 * old-run card data.
 */

export const DEMO_STORAGE_KEYS = [
  'pokecard-demo-v3',
  'pokecard-draw-v1',
  'pokecard-events-v2',
] as const;

/**
 * Removes `keys` from localStorage exactly once per `flag` (the flag itself
 * is stored afterwards). Returns how many keys were actually present and
 * removed; a second call under the same flag is a no-op. Storage failures
 * (private mode, SSR) are swallowed - a blocked wipe must never crash boot.
 */
export function clearOnce(
  flag: string,
  keys: readonly string[] = DEMO_STORAGE_KEYS,
): number {
  try {
    if (localStorage.getItem(flag) !== null) return 0;
    let removed = 0;
    for (const key of keys) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        removed += 1;
      }
    }
    localStorage.setItem(flag, '1');
    return removed;
  } catch {
    return 0;
  }
}
