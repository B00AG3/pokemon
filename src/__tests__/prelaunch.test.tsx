import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { robinhoodTestnet } from '../web3/chains';
import { useMarket, MarketProvider } from '../state/MarketProvider';
import Roadmap from '../pages/Roadmap';

/**
 * The prelaunch face: with every VITE_* address blanked and VITE_PRELAUNCH=1,
 * the market layer must expose no demo cards, no simulated cap ticker, no
 * buy/sell actions, and no activity, and the Roadmap must render the full
 * 30-rung ladder locked at zero minted.
 *
 * Rendering happens via renderToStaticMarkup: state initializers run (the
 * storage wipe fires during render) while transport/network effects never
 * execute, so the probe sees exactly the first-paint API a visitor gets.
 */

const testConfig = createConfig({
  chains: [robinhoodTestnet],
  transports: { [robinhoodTestnet.id]: http() },
  ssr: true,
});

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    __store: store,
  };
}

type StorageMock = ReturnType<typeof memoryStorage>;
let storage: StorageMock;

function renderTree(element: ReactElement): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <WagmiProvider config={testConfig}>
      <QueryClientProvider client={client}>
        {element}
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

function stubPrelaunchEnv() {
  vi.stubEnv('VITE_TOKEN_ADDRESS', '');
  vi.stubEnv('VITE_CARDS_ADDRESS', '');
  vi.stubEnv('VITE_ORACLE_ADDRESS', '');
  vi.stubEnv('VITE_SALE_ADDRESS', '');
  vi.stubEnv('VITE_SWAP_ADDRESS', '');
  vi.stubEnv('VITE_PRELAUNCH', '1');
}

/** Renders the provider once and returns the market API a consumer sees. */
function renderMarket(): ReturnType<typeof useMarket> {
  let captured: ReturnType<typeof useMarket> | undefined;
  function Probe() {
    // test-only context capture during a static render; effects never run
    // here, so reassignment during render is the only way to observe the API
    // oxlint-disable-next-line
    captured = useMarket();
    return null;
  }
  renderTree(
    <MarketProvider>
      <Probe />
    </MarketProvider>,
  );
  return captured!;
}

describe('MarketProvider in prelaunch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage({
      'pokecard-demo-v3': '{"guest":{"eth":2,"cards":["demo-1"]}}',
      'pokecard-draw-v1': '{"entered":["guest"],"winner":"npc-3"}',
      'pokecard-events-v2': '[{"id":"ev-1","type":"mint"}]',
      'pokemontcg:card:base1-4': '{"name":"Charizard"}',
    });
    vi.stubGlobal('localStorage', storage);
    stubPrelaunchEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('exposes no demo cards, no simulated cap, no activity, and no trading', () => {
    const market = renderMarket();

    expect(market.mode).toBe('prelaunch');
    expect(market.cards).toEqual([]);
    expect(market.myCards).toEqual([]);
    expect(market.activity).toEqual([]);
    // no simulated ticker: the cap reads 0, not the demo start value
    expect(market.marketCap).toBe(0);
    expect(market.eth).toBe(0);
    expect(market.realizedEth).toBeUndefined();
    expect(market.live.status).toBe('off');
    expect(market.live.ready).toBe(false);
  });

  it('closes the draw and makes every action a no-op', async () => {
    const market = renderMarket();

    expect(market.draw.open).toBe(false);
    expect(market.draw.entered).toBe(false);
    expect(market.draw.entrantCount).toBe(0);

    await market.draw.enter();
    await market.draw.leave();
    await market.actions.buy('demo-1');
    await market.actions.sell('demo-1');
    await market.actions.redeem('demo-1');
    await market.actions.listForSale('demo-1', 0.1);
    await market.actions.cancelListing('demo-1');
    vi.advanceTimersByTime(4000);

    // nothing wrote demo-era storage back
    expect(storage.__store.has('pokecard-demo-v3')).toBe(false);
    expect(storage.__store.has('pokecard-draw-v1')).toBe(false);
    expect(storage.__store.has('pokecard-events-v2')).toBe(false);
  });

  it('wipes the old demo storage once on the first prelaunch boot', () => {
    renderMarket();

    expect(storage.__store.has('pokecard-demo-v3')).toBe(false);
    expect(storage.__store.has('pokecard-draw-v1')).toBe(false);
    expect(storage.__store.has('pokecard-events-v2')).toBe(false);
    expect(storage.__store.get('pokemontcg:card:base1-4')).toBe('{"name":"Charizard"}');
    expect(storage.__store.get('pokecard-wipe-1')).toBe('1');

    // second boot: the wipe flag holds, so a re-seeded key survives
    storage.__store.set('pokecard-demo-v3', '{}');
    renderMarket();
    expect(storage.__store.get('pokecard-demo-v3')).toBe('{}');
  });
});

describe('MarketProvider in live mode with the chain unreachable', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    // addresses wired (synthetic; nothing will answer) and no prelaunch flag
    vi.stubEnv('VITE_TOKEN_ADDRESS', '0x1111111111111111111111111111111111111111');
    vi.stubEnv('VITE_CARDS_ADDRESS', '0x2222222222222222222222222222222222222222');
    vi.stubEnv('VITE_ORACLE_ADDRESS', '0x3333333333333333333333333333333333333333');
    vi.stubEnv('VITE_SALE_ADDRESS', '');
    vi.stubEnv('VITE_SWAP_ADDRESS', '0x4444444444444444444444444444444444444444');
    vi.stubEnv('VITE_PRELAUNCH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stays on the explicit live path and never falls back to demo data', () => {
    const market = renderMarket();

    expect(market.mode).toBe('live');
    // first paint keeps the live status ('connecting' while the read is in
    // flight, 'error' once it fails in a real browser) - never 'off', the
    // demo/prelaunch branch
    expect(market.live.status).toBe('connecting');
    expect(market.live.ready).toBe(false);
    expect(market.cards).toEqual([]);
    expect(market.activity).toEqual([]);
    // the cap reads the real number (0 until the oracle answers), never the
    // simulated demo ticker
    expect(market.marketCap).toBe(0);
  });
});

describe('Roadmap in prelaunch', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    stubPrelaunchEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('renders all 30 rungs locked with zero minted and launch copy', () => {
    const html = renderTree(
      <MarketProvider>
        <Roadmap />
      </MarketProvider>,
    );

    const locked = html.match(/>Locked</g) ?? [];
    expect(locked).toHaveLength(30);
    expect(html).not.toContain('>Airdropped<');
    expect(html).not.toContain('Draw open');
    expect(html).not.toContain('Demo progress');
    expect(html).toContain('#01');
    expect(html).toContain('#30');
    expect(html.toLowerCase()).toContain('opens at launch');
  });
});
