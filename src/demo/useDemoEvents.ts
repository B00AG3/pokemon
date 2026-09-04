import { useCallback, useEffect, useState } from 'react';
import { seedEvents, type MarketEvent } from './events';

const STORAGE_KEY = 'pokecard-events-v2';
const MAX_EVENTS = 100;

/**
 * Rolling activity log for the demo market, persisted to localStorage.
 * Starts with seeded trader history so the Activity page is never empty.
 */
export function useDemoEvents() {
  const [events, setEvents] = useState<MarketEvent[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as MarketEvent[];
    } catch {
      /* corrupted storage - reseed */
    }
    return seedEvents();
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      /* storage unavailable - events stay in memory */
    }
  }, [events]);

  const record = useCallback((event: Omit<MarketEvent, 'id' | 'ts'>) => {
    setEvents((prev) =>
      [{ ...event, id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() }, ...prev].slice(
        0,
        MAX_EVENTS,
      ),
    );
  }, []);

  return { events, record };
}
