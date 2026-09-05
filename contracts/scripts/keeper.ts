import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

/**
 * PokeCard milestone keeper for Robinhood Chain.
 * Polls the price oracle; confirms threshold crossings and mints the next
 * milestone card once the confirmation window has elapsed. Milestone cards
 * airdrop straight to a drawn POKE holder inside mintNext() - the keeper
 * never handles the card and there is nothing to list.
 *
 * Env:
 *   KEEPER_PRIVATE_KEY   EOA allowed to call mintNext/confirmCrossing
 *   CARDS_ADDRESS        deployed MilestoneCards address
 *   KEEPER_RPC_URL       JSON-RPC endpoint (defaults to Robinhood testnet)
 *   INTERVAL_MS          poll interval (default 30000)
 *
 * Fee sweep (Pons creator fees -> redemption pool, overflow -> team):
 *   SWEEP_MODE           off | observe (default) | live
 *   SWEEP_EVERY_MS       sweep cadence (default 600000)
 *   SWEEP_MARGIN_PCT     pool target as % of outstanding card liability (default 150)
 *   SWEEP_MIN_WEI        skip claims below this (default 0.0001 ETH)
 *   SWEEP_KEEP_WEI       gas buffer left in the keeper wallet (default 0.002 ETH)
 *   PONS_FEE_ESCROW      Pons v2 fee escrow (default: mainnet address)
 *   POKE_TOKEN           the Pons-launched token; sweep stays off until set
 *   SWEEP_QUOTE_TOKENS   comma list probed as the ETH side of fees
 *   TEAM_ADDRESS         overflow destination; held in the keeper if unset
 *
 * Run: npm run keeper
 */

const RPC = process.env.KEEPER_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com';
const CARDS_ADDRESS = process.env.CARDS_ADDRESS;
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 30_000);

// ---- fee sweep: Pons creator fees -> redemption pool, overflow -> team ----
// At launch the Pons fee recipient is the keeper wallet, so the 70% creator
// share accrues here. On its own cadence the keeper claims what has accrued
// and routes it: first top the redemption pool up to SWEEP_MARGIN_PCT of the
// outstanding card liability, then forward everything above the gas buffer to
// TEAM_ADDRESS (or hold it in the keeper if unset). SWEEP_MODE:
//   off      - never sweep
//   observe  - read and log pending fees only (default; proves the reads
//              against the live Pons deployment during the smoke run)
//   live     - claim and route for real
const SWEEP_MODE = (process.env.SWEEP_MODE ?? 'observe') as 'off' | 'observe' | 'live';
const SWEEP_EVERY_MS = Number(process.env.SWEEP_EVERY_MS ?? 600_000);
const SWEEP_MARGIN_PCT = Number(process.env.SWEEP_MARGIN_PCT ?? 150);
const SWEEP_MIN_WEI = BigInt(process.env.SWEEP_MIN_WEI ?? 10n ** 14n); // skip dust
const SWEEP_KEEP_WEI = BigInt(process.env.SWEEP_KEEP_WEI ?? 2n * 10n ** 15n); // gas buffer
const PONS_FEE_ESCROW = process.env.PONS_FEE_ESCROW ?? '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e';
const POKE_TOKEN = process.env.POKE_TOKEN; // set once the Pons token exists
// the ETH side of fees may be tracked as native or as WETH; probe both
const SWEEP_QUOTE_TOKENS = (
  process.env.SWEEP_QUOTE_TOKENS ?? `${ethers.ZeroAddress},0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
).split(',');
const TEAM_ADDRESS = process.env.TEAM_ADDRESS;

const escrowAbi = [
  'function balanceOfToken(address account, address token) view returns (uint256)',
  'function claimToken(address token, uint256 amount)',
];

const cardsAbi = [
  'function nextMilestone() view returns (uint256 index, uint256 marketCap)',
  'function oracle() view returns (address)',
  'function confirmWindow() view returns (uint256)',
  'function crossingAt(uint256) view returns (uint256)',
  'function confirmCrossing()',
  'function mintNext()',
  'function checkpointCap()',
  'function lastCheckpointAt() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function entrantCount() view returns (uint256)',
  'event MilestoneMinted(uint256 indexed index, uint256 indexed tokenId, uint256 marketCap, address indexed to)',
];
const oracleAbi = ['function marketCap() view returns (uint256)'];

let lastSweepAt = 0;

/** ETH the pool should hold: chart value of every minted card, times margin. */
async function poolTarget(cards: ethers.Contract): Promise<bigint> {
  const minted: bigint = await cards.totalMinted();
  let liability = 0n;
  for (let id = 1n; id <= minted; id++) {
    try {
      liability += await cards.chartPriceOf(id);
    } catch {
      /* no aged checkpoint yet: that card's chart value is not redeemable */
    }
  }
  return (liability * BigInt(SWEEP_MARGIN_PCT)) / 100n;
}

async function sweep(wallet: ethers.Wallet, cards: ethers.Contract): Promise<void> {
  if (SWEEP_MODE === 'off' || !POKE_TOKEN || Date.now() - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = Date.now();

  const escrow = new ethers.Contract(PONS_FEE_ESCROW, escrowAbi, wallet);
  const tokens = [ethers.ZeroAddress, ...SWEEP_QUOTE_TOKENS, POKE_TOKEN].filter(
    (t, i, all) => all.indexOf(t) === i,
  );
  const pending: Array<{ token: string; amount: bigint }> = [];
  for (const token of tokens) {
    try {
      const amount: bigint = await escrow.balanceOfToken(wallet.address, token);
      if (amount > 0n) pending.push({ token, amount });
    } catch {
      /* escrow does not track this token; ignore */
    }
  }
  const eth = pending.find((x) => x.token !== POKE_TOKEN)?.amount ?? 0n;
  const poke = pending.find((x) => x.token === POKE_TOKEN)?.amount ?? 0n;
  const fmt = (v: bigint) => Number(v) / 1e18;
  console.log(
    `[keeper][sweep:${SWEEP_MODE}] pending ${fmt(eth)} ETH / ${fmt(poke)} POKE across ${pending.length} tokens`,
  );

  if (SWEEP_MODE !== 'live' || pending.length === 0) return;

  for (const { token, amount } of pending) {
    if (amount < SWEEP_MIN_WEI) continue;
    const tx = await escrow.claimToken(token, amount);
    await tx.wait();
    console.log(`[keeper][sweep] claimed ${fmt(amount)} of ${token} - tx ${tx.hash}`);
  }

  // route what landed in the keeper wallet: pool first, team gets the rest
  const keeperBalance: bigint = await wallet.provider.getBalance(wallet.address);
  const spendable = keeperBalance - SWEEP_KEEP_WEI;
  if (spendable <= 0n) return;

  const poolBalance: bigint = await wallet.provider.getBalance(await cards.getAddress());
  const deficit = (await poolTarget(cards)) > poolBalance
    ? (await poolTarget(cards)) - poolBalance
    : 0n;
  const toPool = deficit < spendable ? deficit : spendable;
  if (toPool > 0n) {
    const tx = await wallet.sendTransaction({ to: await cards.getAddress(), value: toPool });
    await tx.wait();
    console.log(`[keeper][sweep] topped the redemption pool with ${fmt(toPool)} ETH - tx ${tx.hash}`);
  }

  const leftover = spendable - toPool;
  if (TEAM_ADDRESS && leftover > SWEEP_MIN_WEI) {
    const tx = await wallet.sendTransaction({ to: TEAM_ADDRESS, value: leftover });
    await tx.wait();
    console.log(`[keeper][sweep] forwarded ${fmt(leftover)} ETH to the team - tx ${tx.hash}`);
  }
}

let busy = false;

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY!, provider);
    const cards = new ethers.Contract(CARDS_ADDRESS!, cardsAbi, wallet);

    const [index, threshold] = await cards.nextMilestone();
    if (index === ethers.MaxUint256) {
      console.log('[keeper] all milestones minted - nothing to do');
      return;
    }

    const oracleAddress = await cards.oracle();
    const oracle = new ethers.Contract(oracleAddress, oracleAbi, provider);
    const mc: bigint = await oracle.marketCap();

    const fmt = (v: bigint) => Number(ethers.formatUnits(v, 18)).toLocaleString('en-US');
    let drawInfo = '';
    try {
      const entrants: bigint = await cards.entrantCount();
      drawInfo = ` | ${entrants} in the draw`;
    } catch {
      /* older deployment without the draw */
    }
    console.log(`[keeper] market cap $${fmt(mc)} | next milestone #${index} at $${fmt(threshold)}${drawInfo}`);

    if (mc < threshold) return;

    const now = BigInt(Math.floor(Date.now() / 1000));

    // Feed redemption pricing: checkpoint at most once per contract gap.
    // The contract no-ops on early calls; skip the tx when nothing is due.
    try {
      const lastCheckpoint: bigint = await cards.lastCheckpointAt();
      if (now - lastCheckpoint >= 840n) {
        // 14 min: just under the on-chain 15 min gap
        const cp = await cards.checkpointCap();
        await cp.wait();
        console.log(`[keeper] cap checkpoint recorded - tx ${cp.hash}`);
      }
    } catch {
      /* older deployment without checkpoint pricing */
    }

    const window: bigint = await cards.confirmWindow();
    let crossed: bigint = 0n;
    if (window > 0n) {
      crossed = await cards.crossingAt(index);
      if (crossed === 0n) {
        // first sighting of the crossing: stamp it once. The contract keeps
        // the first stamp, so the window cannot be pushed out by re-polling.
        const tx = await cards.confirmCrossing();
        await tx.wait();
        console.log(`[keeper] crossing confirmed at block ${tx.blockNumber}; waiting for window`);
        return;
      }
      if (now - crossed < window) return; // window still running; wait silently
    }

    const tx = await cards.mintNext();
    const receipt = await tx.wait();
    const tokenId = BigInt(index) + 1n;
    const minted = receipt?.logs
      .map((log) => {
        try {
          return cards.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === 'MilestoneMinted');
    const winner = (minted?.args?.to as string) ?? 'unknown';
    console.log(
      `[keeper] AIRDROPPED card #${tokenId} to ${winner} for milestone #${index} - tx ${receipt?.hash}`,
    );
  } catch (error) {
    console.error('[keeper] poll failed:', (error as Error).message ?? error);
  } finally {
    busy = false;
    // the sweep never blocks or breaks minting: it runs after the poll's work
    // (finally also covers the early returns) and swallows its own errors
    try {
      if (CARDS_ADDRESS) {
        const provider = new ethers.JsonRpcProvider(RPC);
        const wallet = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY!, provider);
        const cards = new ethers.Contract(CARDS_ADDRESS, cardsAbi, wallet);
        await sweep(wallet, cards);
      }
    } catch (error) {
      console.error('[keeper][sweep] failed:', (error as Error).message ?? error);
    }
  }
}

function main() {
  if (!process.env.KEEPER_PRIVATE_KEY || !process.env.CARDS_ADDRESS) {
    console.error('KEEPER_PRIVATE_KEY and CARDS_ADDRESS are required (see .env.example)');
    process.exit(1);
  }
  console.log(`[keeper] watching ${CARDS_ADDRESS} on ${RPC} every ${INTERVAL_MS}ms`);
  void poll();
  setInterval(() => void poll(), INTERVAL_MS);
}

main();
