import { ethers } from 'ethers';

/**
 * Shared env summary for scripts/keeper.ts and its tests.
 *
 * The keeper is configured entirely through environment variables (Fly
 * secrets on the hosted deployment - see contracts/fly.toml). This module
 * turns that env into one validated summary so the boot log states exactly
 * what the process is watching, and so the required-env contract is
 * testable without starting the keeper.
 */

/**
 * JSON-RPC fallback when KEEPER_RPC_URL is unset. TESTNET by design: this
 * is the known cutover hazard - an unset URL silently polls the wrong
 * chain - so the launch runbook pins the mainnet RPC in Fly secrets.
 */
export const DEFAULT_KEEPER_RPC_URL = 'https://rpc.testnet.chain.robinhood.com';

/** Poll interval fallback in ms (the hosted launch stack runs 15000). */
export const DEFAULT_KEEPER_INTERVAL_MS = 30_000;

export type SweepMode = 'off' | 'observe' | 'live';

/** Sweep mode fallback: read-and-log only until SWEEP_MODE=live. */
export const DEFAULT_SWEEP_MODE: SweepMode = 'observe';

export interface KeeperEnvSummary {
  /** MilestoneCards address being watched (CARDS_ADDRESS). */
  cardsAddress: string;
  /** JSON-RPC endpoint (KEEPER_RPC_URL; testnet default). */
  rpcUrl: string;
  /** Poll interval in ms (INTERVAL_MS). */
  intervalMs: number;
  /** Fee sweep mode (SWEEP_MODE). */
  sweepMode: SweepMode;
  /** Address derived offline from KEEPER_PRIVATE_KEY. */
  keeperAddress: string;
}

/**
 * Summarize the keeper env. Pure: no network calls - the keeper address is
 * derived locally from the private key. Throws the required-env error when
 * CARDS_ADDRESS or KEEPER_PRIVATE_KEY is unset; keeper.ts catches it and
 * exits non-zero before any poll starts.
 */
export function summarizeKeeperEnv(
  env: Record<string, string | undefined> = process.env,
): KeeperEnvSummary {
  if (!env.KEEPER_PRIVATE_KEY || !env.CARDS_ADDRESS) {
    throw new Error('KEEPER_PRIVATE_KEY and CARDS_ADDRESS are required (see .env.example)');
  }
  return {
    cardsAddress: env.CARDS_ADDRESS,
    rpcUrl: env.KEEPER_RPC_URL ?? DEFAULT_KEEPER_RPC_URL,
    intervalMs: Number(env.INTERVAL_MS ?? DEFAULT_KEEPER_INTERVAL_MS),
    sweepMode: (env.SWEEP_MODE ?? DEFAULT_SWEEP_MODE) as SweepMode,
    keeperAddress: new ethers.Wallet(env.KEEPER_PRIVATE_KEY).address,
  };
}

/**
 * The one-line config summary the keeper logs at boot. The wallet balance
 * is appended by keeper.ts itself (a read-only RPC nicety, never a gate).
 */
export function formatKeeperBootLine(summary: KeeperEnvSummary): string {
  return (
    `watching ${summary.cardsAddress} on ${summary.rpcUrl} every ${summary.intervalMs}ms` +
    ` | sweep ${summary.sweepMode} | keeper ${summary.keeperAddress}`
  );
}
