import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DEFAULT_THRESHOLDS,
  LADDER_RUNG_COUNT,
  parseThresholds,
} from '../scripts/thresholds';

const ONE_USD = 10n ** 18n;

describe('threshold parser', () => {
  it('defaults to the 30-rung ladder string 20000,30000,...,310000', () => {
    const parts = DEFAULT_THRESHOLDS.split(',');
    expect(parts).to.have.length(LADDER_RUNG_COUNT);
    expect(LADDER_RUNG_COUNT).to.equal(30);
    expect(parts[0]).to.equal('20000');
    expect(parts[parts.length - 1]).to.equal('310000');
  });

  it('turns the 30-value string into 30 strictly ascending USD-wei thresholds', () => {
    const values = parseThresholds(DEFAULT_THRESHOLDS, { expectedCount: LADDER_RUNG_COUNT });
    expect(values).to.have.length(30);
    expect(values[0]).to.equal(20000n * ONE_USD);
    expect(values[29]).to.equal(310000n * ONE_USD);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `rung ${i} must exceed rung ${i - 1}`).to.be.greaterThan(values[i - 1]);
    }
  });

  it('keeps the +10000 spacing of the launch ladder', () => {
    const values = parseThresholds(DEFAULT_THRESHOLDS);
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).to.equal(BigInt(20000 + i * 10000) * ONE_USD);
    }
  });

  it('rejects a wrong rung count when 30 are expected', () => {
    const oneShort = DEFAULT_THRESHOLDS.split(',').slice(0, 29).join(',');
    expect(() => parseThresholds(oneShort, { expectedCount: LADDER_RUNG_COUNT })).to.throw(
      /exactly 30/,
    );
    const oneLong = DEFAULT_THRESHOLDS + ',320000';
    expect(() => parseThresholds(oneLong, { expectedCount: LADDER_RUNG_COUNT })).to.throw(
      /exactly 30/,
    );
  });

  it('rejects non-ascending ladders', () => {
    expect(() => parseThresholds('20000,20000,30000')).to.throw(/ascending/);
    expect(() => parseThresholds('30000,20000')).to.throw(/ascending/);
    expect(() => parseThresholds('20000,30000,25000,40000')).to.throw(/ascending/);
  });

  it('rejects nonpositive values', () => {
    expect(() => parseThresholds('0,10000')).to.throw(/positive/);
    expect(() => parseThresholds('10000,-20000')).to.throw(/positive/);
  });

  it('rejects malformed input', () => {
    expect(() => parseThresholds('')).to.throw(/comma-separated/);
    expect(() => parseThresholds('20000,,30000')).to.throw(/comma-separated/);
    expect(() => parseThresholds('20000,abc')).to.throw(/comma-separated/);
    expect(() => parseThresholds('20000.5,30000')).to.throw(/comma-separated/);
  });

  it('still accepts short smoke ladders when no rung count is pinned', () => {
    const smoke = parseThresholds('50,100,250');
    expect(smoke.map(String)).to.deep.equal([
      (50n * ONE_USD).toString(),
      (100n * ONE_USD).toString(),
      (250n * ONE_USD).toString(),
    ]);
  });
});

describe('local deploy with the 30-rung THRESHOLDS', () => {
  const deploymentFile = path.resolve(__dirname, '../deployments/hardhat.json');
  const deployScript = path.resolve(__dirname, '../scripts/deploy.ts');

  /**
   * Run scripts/deploy.ts in-process on this test's hardhat network with a
   * scrubbed env, and return the record it wrote. deploy.ts is required
   * directly (cache purged so each run re-executes) because the `hardhat run`
   * task executes scripts in a subprocess whose chain state dies with it.
   */
  async function runDeploy(env: Record<string, string | undefined>) {
    const snapshot = new Map(Object.entries(process.env));
    const existed = fs.existsSync(deploymentFile);
    const original = existed ? fs.readFileSync(deploymentFile, 'utf8') : null;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      delete require.cache[require.resolve(deployScript)];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { deployment } = require(deployScript) as { deployment: Promise<void> };
      await deployment;
      return JSON.parse(fs.readFileSync(deploymentFile, 'utf8')) as {
        cards: string;
        thresholds: string[];
      };
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!snapshot.has(key)) delete process.env[key];
      }
      for (const [key, value] of snapshot) process.env[key] = value;
      if (original === null) fs.rmSync(deploymentFile, { force: true });
      else fs.writeFileSync(deploymentFile, original);
    }
  }

  it('yields totalMilestones() === 30 with the launch ladder', async () => {
    const record = await runDeploy({
      THRESHOLDS: DEFAULT_THRESHOLDS,
      TOKEN_ADDRESS: '',
      KEEPER_ADDRESS: '',
      DEPLOY_SALE: '',
      CURVE_ADDRESS: '',
      ORACLE_ADDRESS: '',
      MOCK_ORACLE: '',
    });
    expect(record.thresholds).to.have.length(30);
    expect(record.thresholds[0]).to.equal((20000n * ONE_USD).toString());
    expect(record.thresholds[29]).to.equal((310000n * ONE_USD).toString());
    const cards = await ethers.getContractAt('MilestoneCards', record.cards);
    expect(await cards.totalMilestones()).to.equal(30n);
  });

  it('defaults to the 30-rung ladder when THRESHOLDS is unset', async () => {
    const record = await runDeploy({
      THRESHOLDS: undefined,
      TOKEN_ADDRESS: '',
      KEEPER_ADDRESS: '',
      DEPLOY_SALE: '',
      CURVE_ADDRESS: '',
      ORACLE_ADDRESS: '',
      MOCK_ORACLE: '',
    });
    const cards = await ethers.getContractAt('MilestoneCards', record.cards);
    expect(await cards.totalMilestones()).to.equal(30n);
  });
});
