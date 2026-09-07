import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOnce, DEMO_STORAGE_KEYS } from '../demo/storage';

/**
 * The old smoke run left three localStorage keys on returning visitors:
 * demo portfolio ownership, the simulated draw, and seeded activity. The
 * wipe removes exactly those, exactly once, and keeps the pokemontcg card
 * art cache (the ladder manifest answers first, so cached art can never
 * resurrect old-run data).
 */

const WIPE_FLAG = 'pokecard-wipe-1';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    __store: store,
  };
}

describe('clearOnce', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('targets exactly the three demo-era keys', () => {
    expect([...DEMO_STORAGE_KEYS]).toEqual([
      'pokecard-demo-v3',
      'pokecard-draw-v1',
      'pokecard-events-v2',
    ]);
  });

  it('removes all three demo keys and keeps the pokemontcg cache', () => {
    const store = memoryStorage({
      'pokecard-demo-v3': '{"guest":{"eth":2}}',
      'pokecard-draw-v1': '{"entered":["guest"]}',
      'pokecard-events-v2': '[{"id":"ev-1"}]',
      'pokemontcg:card:base1-4': '{"name":"Charizard"}',
    });
    vi.stubGlobal('localStorage', store);

    const removed = clearOnce(WIPE_FLAG);

    expect(removed).toBe(3);
    expect(store.__store.has('pokecard-demo-v3')).toBe(false);
    expect(store.__store.has('pokecard-draw-v1')).toBe(false);
    expect(store.__store.has('pokecard-events-v2')).toBe(false);
    expect(store.__store.get('pokemontcg:card:base1-4')).toBe('{"name":"Charizard"}');
    expect(store.__store.get(WIPE_FLAG)).toBe('1');
  });

  it('counts only the keys that were actually present', () => {
    const removed = clearOnce(WIPE_FLAG, ['pokecard-demo-v3', 'pokecard-events-v2']);
    expect(removed).toBe(0);

    const store = memoryStorage({ 'pokecard-draw-v1': '{}' });
    vi.stubGlobal('localStorage', store);
    expect(clearOnce('pokecard-wipe-1b', ['pokecard-draw-v1'])).toBe(1);
  });

  it('runs only once per flag: re-added keys survive the second boot', () => {
    const store = memoryStorage({
      'pokecard-demo-v3': '{}',
      'pokecard-draw-v1': '{}',
      'pokecard-events-v2': '[]',
    });
    vi.stubGlobal('localStorage', store);

    expect(clearOnce(WIPE_FLAG)).toBe(3);

    // a later visit re-seeds one key somehow; the wipe must not re-fire
    store.__store.set('pokecard-demo-v3', '{}');
    expect(clearOnce(WIPE_FLAG)).toBe(0);
    expect(store.__store.get('pokecard-demo-v3')).toBe('{}');
  });

  it('survives unavailable storage instead of crashing the boot', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage blocked');
      },
    });
    expect(() => clearOnce(WIPE_FLAG)).not.toThrow();
    expect(clearOnce(WIPE_FLAG)).toBe(0);
  });
});
