import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { ethers } from 'ethers';
import {
  DEFAULT_KEEPER_INTERVAL_MS,
  DEFAULT_KEEPER_RPC_URL,
  formatKeeperBootLine,
  summarizeKeeperEnv,
} from '../scripts/keeperEnv';

const CARDS = '0x1111111111111111111111111111111111111111';
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com';
// well-formed throwaway key that exists only for this test file
const KEEPER_PK = `0x${'11'.repeat(32)}`;
const KEEPER_ADDRESS = new ethers.Wallet(KEEPER_PK).address;

describe('keeper env summary', () => {
  it('lists cards address, rpc url, interval, sweep mode and keeper address', () => {
    const summary = summarizeKeeperEnv({
      CARDS_ADDRESS: CARDS,
      KEEPER_PRIVATE_KEY: KEEPER_PK,
      KEEPER_RPC_URL: MAINNET_RPC,
      INTERVAL_MS: '15000',
      SWEEP_MODE: 'live',
    });
    expect(summary.cardsAddress).to.equal(CARDS);
    expect(summary.rpcUrl).to.equal(MAINNET_RPC);
    expect(summary.intervalMs).to.equal(15000);
    expect(summary.sweepMode).to.equal('live');
    expect(summary.keeperAddress).to.equal(KEEPER_ADDRESS);
    // the raw key must never ride along in the summary that reaches logs
    expect(JSON.stringify(summary)).to.not.contain(KEEPER_PK);
  });

  it('defaults rpc to the Robinhood TESTNET endpoint, interval to 30000ms and sweep to observe', () => {
    const summary = summarizeKeeperEnv({
      CARDS_ADDRESS: CARDS,
      KEEPER_PRIVATE_KEY: KEEPER_PK,
    });
    // the known cutover hazard: an unset KEEPER_RPC_URL silently polls testnet
    expect(summary.rpcUrl).to.equal(DEFAULT_KEEPER_RPC_URL);
    expect(DEFAULT_KEEPER_RPC_URL).to.contain('testnet');
    expect(DEFAULT_KEEPER_INTERVAL_MS).to.equal(30000);
    expect(summary.intervalMs).to.equal(DEFAULT_KEEPER_INTERVAL_MS);
    expect(summary.sweepMode).to.equal('observe');
  });

  it('throws the required-env error when CARDS_ADDRESS is missing', () => {
    expect(() => summarizeKeeperEnv({ KEEPER_PRIVATE_KEY: KEEPER_PK })).to.throw(
      /KEEPER_PRIVATE_KEY and CARDS_ADDRESS are required/,
    );
  });

  it('throws the required-env error when KEEPER_PRIVATE_KEY is missing', () => {
    expect(() => summarizeKeeperEnv({ CARDS_ADDRESS: CARDS })).to.throw(
      /KEEPER_PRIVATE_KEY and CARDS_ADDRESS are required/,
    );
  });
});

describe('keeper boot line', () => {
  it('states every config fact on one line', () => {
    const line = formatKeeperBootLine(
      summarizeKeeperEnv({
        CARDS_ADDRESS: CARDS,
        KEEPER_PRIVATE_KEY: KEEPER_PK,
        KEEPER_RPC_URL: MAINNET_RPC,
        INTERVAL_MS: '15000',
        SWEEP_MODE: 'live',
      }),
    );
    expect(line).to.contain(CARDS);
    expect(line).to.contain(MAINNET_RPC);
    expect(line).to.contain('15000ms');
    expect(line).to.contain('sweep live');
    expect(line).to.contain(KEEPER_ADDRESS);
    expect(line).to.not.contain(KEEPER_PK);
  });
});

describe('keeper script required-env contract', () => {
  // scripts/keeper.ts runs main() at import, so the exit contract can only be
  // asserted in a real subprocess with a scrubbed env. The cwd is a scratch
  // dir so the script's dotenv.config() cannot load contracts/.env and
  // resurrect the real secrets.
  it('exits non-zero with the required-env error when the env is unset', function () {
    this.timeout(90_000);
    const contractsDir = path.resolve(__dirname, '..');
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-env-'));
    const childEnv: Record<string, string> = {};
    for (const key of ['PATH', 'SYSTEMROOT', 'SYSTEM_ROOT', 'ComSpec', 'PATHEXT']) {
      const value = process.env[key];
      if (value !== undefined) childEnv[key] = value;
    }
    try {
      const result = cp.spawnSync(
        process.execPath,
        [
          path.join(contractsDir, 'node_modules', 'ts-node', 'dist', 'bin.js'),
          '-P',
          path.join(contractsDir, 'tsconfig.json'),
          path.join(contractsDir, 'scripts', 'keeper.ts'),
        ],
        { cwd: scratchDir, env: childEnv, encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.error, `spawn failed: ${String(result.error)}`).to.equal(undefined);
      expect(result.status, `stderr: ${result.stderr}`).to.not.equal(0);
      expect(result.stderr).to.match(/KEEPER_PRIVATE_KEY and CARDS_ADDRESS are required/);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
