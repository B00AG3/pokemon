import { useEffect, useState } from 'react';

const START = 5000;
const MIN = 1200;
const MAX = 250_000;

/**
 * Simulated token market cap that drifts every few seconds, like a live
 * chart. The interval stops entirely in live mode so the demo ticker never
 * burns CPU re-rendering the tree underneath the on-chain data.
 */
export function useDemoMarket(intervalMs = 2500, enabled = true): number {
  const [marketCap, setMarketCap] = useState(START);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      setMarketCap((current) => {
        const drift = 1 + (Math.random() - 0.48) * 0.06;
        const next = Math.round(current * drift);
        return Math.min(MAX, Math.max(MIN, next));
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);

  return marketCap;
}
