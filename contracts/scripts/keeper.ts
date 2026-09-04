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
 * Run: npm run keeper
 */

const RPC = process.env.KEEPER_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com';
const CARDS_ADDRESS = process.env.CARDS_ADDRESS;
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 30_000);

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
