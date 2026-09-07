import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Signer } from 'ethers';
import { ethers, network } from 'hardhat';
import { DEFAULT_THRESHOLDS, LADDER_RUNG_COUNT, parseThresholds } from './thresholds';

/**
 * One-command REAL launch of the card stack around a Pons token. This is the
 * production sibling of smoke-mainnet.ts: no throwaway traders, no SMOKE_*
 * knobs - real thresholds, real delays, real pool money from .env.
 *
 *   TOKEN_ADDRESS=<pons token> npm run launch:cards        (dry run)
 *   TOKEN_ADDRESS=... POOL_FUND_ETH=0.5 GO=1 npm run launch:cards
 *
 * This script NEVER creates the token. The user launches POKE on the Pons
 * website UI and hands over TOKEN_ADDRESS; this script only hooks the rest of
 * the stack (curve oracle + MilestoneCards + CardSwap) around that existing
 * token. (launch-pons.ts, the scripted token creation, is backup tooling.)
 *
 * Steps: resolve the token's Pons curve from the factory, deploy the stack,
 * price the oracle (manual ETH/USD when the chain has no feed), fund the
 * redemption pool, print the VITE_* block and the Fly keeper secrets block.
 *
 * Env:
 *   TOKEN_ADDRESS        REQUIRED - the Pons-launched POKE token (UI-created)
 *   POOL_FUND_ETH        REQUIRED for GO=1 - ETH put into the redemption pool
 *   GO                   1 = send transactions (default: dry run)
 *   PONS_FACTORY         factory override (default: mainnet Pons v2 factory)
 *   CURVE_ADDRESS        curve override (default: resolve from the factory)
 *   MANUAL_ETH_USD       manual ETH/USD when no Chainlink feed (default 3000;
 *                        required at GO=1 when ETH_USD_FEED_ADDRESS is unset)
 *   ETH_USD_FEED_ADDRESS Chainlink ETH/USD aggregator, when one exists
 *   KEEPER_ADDRESS       distinct keeper wallet (e.g. the Fly keeper). It must
 *                        already hold gas: the launch aborts unless its
 *                        on-chain balance is >= KEEPER_GAS_FLOOR_ETH.
 *   KEEPER_GAS_FLOOR_ETH gas floor for the KEEPER_ADDRESS precheck (0.001 ETH)
 *   START_KEEPER         0 (default) = print the fly secrets block for the
 *                        hosted pokecard-keeper; 1 = start a local keeper
 *                        (escape hatch for smoke runs only)
 *
 * Real values come from contracts/.env (THRESHOLDS, CONFIRM_WINDOW,
 * REDEEM_DELAY, REDEEM_BASE_PRICE_WEI) and default sanely when absent:
 * the 30-rung ladder 20000,30000,...,310000 / 3600s / 21600s / 0.01 ETH.
 * THRESHOLDS must hold exactly 30 strictly ascending values - the site
 * ladder serves exactly 30 cards, one per rung.
 *
 * Keeper safety: the deployer keeps the minting right unless KEEPER_ADDRESS
 * names a DIFFERENT wallet - then that wallet must already be funded on-chain
 * (>= KEEPER_GAS_FLOOR_ETH, checked read-only before any transaction). This
 * avoids the trap a smoke run hit: an unfunded keeper address in .env.
 *
 * Run: npm run launch:cards
 */

const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CURVE_ABI = [
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
];

const num = (name: string, fallback: string) => process.env[name] ?? fallback;

async function resolveCurve(
  factoryAddress: string,
  tokenAddress: string,
  signer: Signer,
): Promise<string> {
  const provider = signer.provider!;
  const probe = async (candidate: string): Promise<boolean> => {
    if (candidate === ethers.ZeroAddress) return false;
    if ((await provider.getCode(candidate)) === '0x') return false;
    try {
      const c = new ethers.Contract(candidate, CURVE_ABI, provider);
      const [q, t]: [bigint, bigint] = await c.getReserves();
      return q > 0n && t > 0n;
    } catch {
      return false;
    }
  };

  if (process.env.CURVE_ADDRESS) {
    if (!(await probe(process.env.CURVE_ADDRESS))) {
      throw new Error(`CURVE_ADDRESS ${process.env.CURVE_ADDRESS} is not a live Pons curve`);
    }
    return process.env.CURVE_ADDRESS;
  }

  const selector = ethers.id('getLaunchedToken(address)').slice(0, 10);
  const args = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [tokenAddress]).slice(2);
  const raw: string = await provider.call({ to: factoryAddress, data: selector + args });
  const data = raw.replace(/^0x/, '');
  for (let o = 0; o + 64 <= data.length; o += 64) {
    const candidate = ethers.getAddress('0x' + data.slice(o, o + 64).slice(24));
    if (await probe(candidate)) return candidate;
  }
  throw new Error('could not resolve the curve from the factory record - set CURVE_ADDRESS');
}

async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) throw new Error('TOKEN_ADDRESS is required (the Pons-launched POKE token)');
  const poolFund = process.env.POOL_FUND_ETH;
  const go = process.env.GO === '1';
  if (go && !poolFund) {
    throw new Error('POOL_FUND_ETH is required with GO=1 (ETH into the redemption pool)');
  }

  const [deployerSigner] = await ethers.getSigners();
  // 30-rung launch ladder of record. The parser aborts on malformed input,
  // nonpositive or non-ascending values, and any count other than 30 - the
  // site ladder serves exactly 30 cards, one per rung.
  const thresholdsRaw = num('THRESHOLDS', DEFAULT_THRESHOLDS);
  const thresholds = parseThresholds(thresholdsRaw, { expectedCount: LADDER_RUNG_COUNT });
  const confirmWindow = num('CONFIRM_WINDOW', '3600');
  const redeemDelay = num('REDEEM_DELAY', '21600');
  const redeemBase = num('REDEEM_BASE_PRICE_WEI', (10n ** 16n).toString());
  const manualEthUsd = num('MANUAL_ETH_USD', '3000');
  const hasFeed = Boolean(process.env.ETH_USD_FEED_ADDRESS);
  const baseTokenUri = num('BASE_TOKEN_URI', 'ipfs://pokecard-lab/');
  const startKeeper = process.env.START_KEEPER === '1';

  // Keeper resolution: the deployer keeps the minting right unless
  // KEEPER_ADDRESS names a different wallet (the Fly keeper). A distinct
  // keeper is accepted only when it already holds gas: the precheck is a
  // read-only balance check that aborts BEFORE any transaction when the
  // wallet is below the floor - the exact trap a smoke run hit (an unfunded
  // keeper address in .env).
  let keeperAddress = deployerSigner.address;
  let keeperNote = 'deployer (one key deploys and signs keeper ops)';
  const customKeeper = process.env.KEEPER_ADDRESS;
  if (customKeeper && customKeeper.toLowerCase() !== deployerSigner.address.toLowerCase()) {
    keeperAddress = ethers.getAddress(customKeeper);
    const gasFloorEth = num('KEEPER_GAS_FLOOR_ETH', '0.001');
    const keeperBalance = await ethers.provider.getBalance(keeperAddress);
    keeperNote = `${keeperAddress} | on-chain balance ${ethers.formatEther(keeperBalance)} ETH (floor ${gasFloorEth} ETH)`;
    if (keeperBalance < ethers.parseEther(gasFloorEth)) {
      throw new Error(
        `KEEPER_ADDRESS ${keeperAddress} holds ${ethers.formatEther(keeperBalance)} ETH, below the ${gasFloorEth} ETH gas floor (KEEPER_GAS_FLOOR_ETH). Fund the keeper wallet first - aborting before any transaction.`,
      );
    }
  }

  // Worst-case full-ladder redemption liability: redeemBasePrice x (N+1) x
  // (H(N+1) - 1), about 93.85x the base price at N = 30 (see docs/LAUNCH.md).
  let harmonic = 0;
  for (let k = 1; k <= thresholds.length + 1; k++) harmonic += 1 / k;
  const liabilityFactor = (thresholds.length + 1) * (harmonic - 1);
  const liabilityEth = Number(ethers.formatEther(redeemBase)) * liabilityFactor;

  const balance = await ethers.provider.getBalance(deployerSigner.address);
  console.log('=== PokeCard card-stack launch (REAL values) ===');
  console.log(`network:      ${network.name} (${Number((await ethers.provider.getNetwork()).chainId)})`);
  console.log(`deployer:     ${deployerSigner.address} | balance ${ethers.formatEther(balance)} ETH`);
  console.log(`token:        ${tokenAddress} (existing Pons token - this script creates none)`);
  console.log(`keeper:       ${keeperNote}`);
  console.log(`ladder:       ${thresholds.length} rungs [${thresholdsRaw}] USD | windows ${confirmWindow}s / ${redeemDelay}s`);
  if (BigInt(confirmWindow) < 600n) {
    console.log(
      `WARNING:      CONFIRM_WINDOW=${confirmWindow}s is smoke-grade. A real launch wants the cap to hold for hours - raise it in contracts/.env (e.g. 3600).`,
    );
  }
  console.log(`redeem base:  ${ethers.formatEther(redeemBase)} ETH | pool funding: ${poolFund ?? 'SKIPPED (dry run?)'}`);
  console.log(`pool sizing:  worst-case full-ladder liability ~${liabilityEth.toFixed(2)} ETH (${liabilityFactor.toFixed(2)}x base) - funding below that underfunds late redemptions`);
  console.log(`eth usd:      ${hasFeed ? 'feed ' + process.env.ETH_USD_FEED_ADDRESS : 'manual $' + manualEthUsd}`);

  const curveAddress = await resolveCurve(num('PONS_FACTORY', PONS_FACTORY), tokenAddress, deployerSigner);
  const curve = new ethers.Contract(curveAddress, CURVE_ABI, deployerSigner);
  const [quoteReserve, tokenReserve]: [bigint, bigint] = await curve.getReserves();
  const token = new ethers.Contract(tokenAddress, ['function totalSupply() view returns (uint256)'], deployerSigner);
  const supply: bigint = await token.totalSupply();
  const capEth = (quoteReserve * supply) / tokenReserve;
  console.log(`curve:        ${curveAddress} | live cap ~${ethers.formatEther(capEth)} ETH of supply value`);

  if (!go) {
    console.log('\nDRY RUN - nothing sent. Re-run with GO=1 POOL_FUND_ETH=<eth> to launch.');
    console.log('\nAfter GO=1, cut the hosted keeper over (conductor-run):');
    console.log('fly secrets set -a pokecard-keeper \\');
    console.log('  CARDS_ADDRESS=<new cards address> \\');
    console.log(`  POKE_TOKEN=${tokenAddress} \\`);
    console.log(`  CURVE_ADDRESS=${curveAddress} \\`);
    console.log('  SWEEP_MODE=live \\');
    console.log('  INTERVAL_MS=15000 \\');
    console.log(`  KEEPER_RPC_URL=${MAINNET_RPC}`);
    console.log('fly apps restart -a pokecard-keeper');
    return;
  }

  // 1. Deploy the stack through the existing deploy script (oracle path is
  //    the curve oracle; keeper is forced to the deployer).
  console.log('\ndeploying the card stack...');
  const childEnv = {
    ...process.env,
    TOKEN_ADDRESS: tokenAddress,
    MOCK_ORACLE: '0',
    CURVE_ADDRESS: curveAddress,
    THRESHOLDS: thresholdsRaw,
    CONFIRM_WINDOW: confirmWindow,
    REDEEM_DELAY: redeemDelay,
    REDEEM_BASE_PRICE_WEI: redeemBase,
    KEEPER_ADDRESS: keeperAddress,
    DEPLOY_SALE: num('DEPLOY_SALE', '0'),
    BASE_TOKEN_URI: baseTokenUri,
  };
  const result = spawnSync(`npx hardhat run scripts/deploy.ts --network ${network.name}`, {
    shell: true,
    stdio: 'inherit',
    env: childEnv,
  });
  if (result.status !== 0) throw new Error('deploy.ts failed - see output above');

  const record = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'),
  ) as { oracle: string; cards: string; swap: string };

  // 2. Price the oracle when the chain has no ETH/USD feed.
  const oracle = new ethers.Contract(
    record.oracle,
    [
      'function ethUsdFeed() view returns (address)',
      'function setManualEthUsdPrice(uint256 price)',
      'function marketCap() view returns (uint256)',
    ],
    deployerSigner,
  );
  let feed = ethers.ZeroAddress;
  try {
    feed = await oracle.ethUsdFeed();
  } catch {
    /* treat as manual */
  }
  if (feed === ethers.ZeroAddress) {
    if (!process.env.MANUAL_ETH_USD && !hasFeed) {
      console.log(`setting manual ETH/USD to $${manualEthUsd} (set MANUAL_ETH_USD to change)`);
    }
    await (await oracle.setManualEthUsdPrice(ethers.parseUnits(manualEthUsd, 8))).wait();
    console.log(`oracle:       manual ETH/USD set to $${manualEthUsd}`);
  }
  try {
    const cap: bigint = await oracle.marketCap();
    console.log(`market cap:   $${Number(ethers.formatUnits(cap, 18)).toLocaleString('en-US')}`);
  } catch (e) {
    console.log(`WARNING: marketCap() reverted: ${(e as Error).message?.slice(0, 140)}`);
  }

  // 3. Fund the redemption pool.
  if (poolFund) {
    if (Number(poolFund) < liabilityEth) {
      console.log(
        `WARNING:     POOL_FUND_ETH=${poolFund} is below the worst-case full-ladder liability ~${liabilityEth.toFixed(2)} ETH - late redemptions could drain the pool. Top up later with npm run fund:pool.`,
      );
    }
    const tx = await deployerSigner.sendTransaction({
      to: record.cards,
      value: ethers.parseEther(poolFund),
    });
    await tx.wait();
    console.log(`pool:         funded with ${poolFund} ETH (withdrawable anytime by the owner)`);
  }

  // 4. Loud warning when metadata is still the placeholder: minted cards
  //    would serve ipfs://pokecard-lab/ JSON until real metadata is pinned.
  if (baseTokenUri === 'ipfs://pokecard-lab/') {
    console.log('\n*** WARNING: BASE_TOKEN_URI is still the placeholder ipfs://pokecard-lab/ ***');
    console.log('    Cards minted from this stack serve placeholder metadata until real metadata');
    console.log('    is pinned and cards.setBaseTokenURI(<cid uri>) is called. Prefilled metadata');
    console.log('    command for all 30 rungs (MILESTONE_CARDS defaults to the 30-card manifest');
    console.log('    in scripts/generate-metadata.ts):');
    console.log(`      PINATA_JWT=<jwt> THRESHOLDS=${thresholdsRaw} npm run metadata`);
  }

  // 5. Hand off.
  console.log('\n=== Point the site at this stack ===');
  console.log('VITE_ROBINHOOD_TESTNET=  # unset = mainnet');
  console.log(`VITE_TOKEN_ADDRESS=${tokenAddress}`);
  console.log(`VITE_CARDS_ADDRESS=${record.cards}`);
  console.log(`VITE_ORACLE_ADDRESS=${record.oracle}`);
  console.log('VITE_SALE_ADDRESS=');
  console.log(`VITE_SWAP_ADDRESS=${record.swap}`);
  console.log('\nCommit that to .env.production and push - Vercel rebuilds in ~2 min.');

  // 6. Keeper handoff. Default is the hosted keeper on Fly (START_KEEPER=0):
  // print the exact secrets block for the conductor; the local keeper stays
  // available behind START_KEEPER=1 as a smoke-run escape hatch.
  if (!startKeeper) {
    console.log('\n=== Fly keeper cutover (conductor-run; the user never runs a script) ===');
    console.log('fly secrets set -a pokecard-keeper \\');
    console.log(`  CARDS_ADDRESS=${record.cards} \\`);
    console.log(`  POKE_TOKEN=${tokenAddress} \\`);
    console.log(`  CURVE_ADDRESS=${curveAddress} \\`);
    console.log('  SWEEP_MODE=live \\');
    console.log('  INTERVAL_MS=15000 \\');
    console.log(`  KEEPER_RPC_URL=${MAINNET_RPC}`);
    console.log('fly apps restart -a pokecard-keeper');
    console.log('(KEEPER_PRIVATE_KEY is already a secret on the Fly app - it is never printed here.)');
    return;
  }
  console.log('\n=== Local keeper starting (START_KEEPER=1 escape hatch; Ctrl+C stops it) ===');
  const keeperSpawn = spawnSync('npm run keeper', [], {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      KEEPER_PRIVATE_KEY: process.env.PRIVATE_KEY!,
      CARDS_ADDRESS: record.cards,
      KEEPER_RPC_URL: MAINNET_RPC,
      CURVE_ADDRESS: curveAddress,
      INTERVAL_MS: num('INTERVAL_MS', '15000'),
    },
  });
  process.exit(keeperSpawn.status ?? 0);
}

main().catch((e) => {
  console.error('launch:cards failed:', (e as Error).message ?? e);
  // exitCode (not process.exit): a hard exit races the RPC keep-alive sockets
  // on Windows and can crash libuv mid-teardown; draining exits cleanly as 1.
  process.exitCode = 1;
});
