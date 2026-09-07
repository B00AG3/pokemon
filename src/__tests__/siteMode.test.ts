import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSiteMode, siteMode } from '../web3/contracts';

/**
 * Mode selection for the launch cutover. The site has exactly three faces:
 *
 * - live: the on-chain stack is wired (cards + oracle + swap addresses set)
 * - prelaunch: addresses blanked and VITE_PRELAUNCH=1, the launch-eve face
 * - demo: the dev-only simulated market (no addresses, no prelaunch flag)
 *
 * Live wins over the prelaunch flag: once the addresses land, the site goes
 * live even if the flag lingers in the env file for one commit.
 */

// synthetic addresses: no real run ever lived at these
const CARDS = '0x1111111111111111111111111111111111111111';
const ORACLE = '0x2222222222222222222222222222222222222222';
const SWAP = '0x3333333333333333333333333333333333333333';
const WIRED = { cards: CARDS, oracle: ORACLE, swap: SWAP };

describe('resolveSiteMode', () => {
  it('is live when cards, oracle, and swap are all wired', () => {
    expect(resolveSiteMode(WIRED, undefined)).toBe('live');
  });

  it('keeps live precedence over a lingering prelaunch flag', () => {
    expect(resolveSiteMode(WIRED, '1')).toBe('live');
    expect(resolveSiteMode(WIRED, true)).toBe('live');
  });

  it('is prelaunch when addresses are empty and the flag is on', () => {
    expect(resolveSiteMode({}, '1')).toBe('prelaunch');
    expect(resolveSiteMode({}, true)).toBe('prelaunch');
    expect(resolveSiteMode({}, 'true')).toBe('prelaunch');
    expect(resolveSiteMode({}, 'TRUE')).toBe('prelaunch');
  });

  it('is prelaunch for a partial address set, never demo-fallback live', () => {
    expect(resolveSiteMode({ cards: CARDS, oracle: ORACLE }, '1')).toBe('prelaunch');
    expect(resolveSiteMode({ cards: CARDS }, '1')).toBe('prelaunch');
  });

  it('is demo when addresses are empty and no flag is set', () => {
    expect(resolveSiteMode({}, undefined)).toBe('demo');
    expect(resolveSiteMode({}, '')).toBe('demo');
    expect(resolveSiteMode({}, '0')).toBe('demo');
    expect(resolveSiteMode({}, 'false')).toBe('demo');
  });

  it('ignores address values that are not 0x-prefixed', () => {
    expect(
      resolveSiteMode({ cards: 'not-an-address', oracle: ORACLE, swap: SWAP }, undefined),
    ).toBe('demo');
  });
});

describe('siteMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the env snapshot it is given', () => {
    expect(siteMode({ VITE_PRELAUNCH: '1' })).toBe('prelaunch');
    expect(
      siteMode({
        VITE_CARDS_ADDRESS: CARDS,
        VITE_ORACLE_ADDRESS: ORACLE,
        VITE_SWAP_ADDRESS: SWAP,
        VITE_PRELAUNCH: '1',
      }),
    ).toBe('live');
    expect(siteMode({})).toBe('demo');
  });

  it('answers prelaunch against the real import.meta.env with blanked addresses', () => {
    vi.stubEnv('VITE_TOKEN_ADDRESS', '');
    vi.stubEnv('VITE_CARDS_ADDRESS', '');
    vi.stubEnv('VITE_ORACLE_ADDRESS', '');
    vi.stubEnv('VITE_SALE_ADDRESS', '');
    vi.stubEnv('VITE_SWAP_ADDRESS', '');
    vi.stubEnv('VITE_PRELAUNCH', '1');
    expect(siteMode()).toBe('prelaunch');
  });
});
