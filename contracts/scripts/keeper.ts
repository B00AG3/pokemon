import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

/**
 * PokeCard milestone keeper for Robinhood Chain.
 * Polls the price oracle; confirms threshold crossings and mints the next
 * milestone card once the confirmation window has elapsed. Newly minted
 * cards are listed on the treasury CardSale automatically when
 * SALE_ADDRESS is configured (minting makes nothing buyable on its own).
 *
 * Env:
 *   KEEPER_PRIVATE_KEY   EOA allowed to call mintNext/confirmCrossing
 *   CARDS_ADDRESS        deployed MilestoneCards address
 *   SALE_ADDRESS         deployed CardSale address (enables auto-listing;
 *                        the keeper must be the sale owner, i.e. the
 *                        deployer, or listing fails gracefully)
 *   KEEPER_RPC_URL       JSON-RPC endpoint (defaults to Robinhood testnet)
 *   INTERVAL_MS          poll interval (default 30000)
 *
 * Run: npm run keeper
 */

const RPC = process.env.KEEPER_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com';
const CARDS_ADDRESS = process.env.CARDS_ADDRESS;
const SALE_ADDRESS = process.env.SALE_ADDRESS;
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 30_000);

const cardsAbi = [
  'function nextMilestone() view returns (uint256 index, uint256 marketCap)',
  'function oracle() view returns (address)',
  'function confirmWindow() view returns (uint256)',
  'function crossingAt(uint256) view returns (uint256)',
  'function confirmCrossing()',
  'function mintNext()',
  'function totalMinted() view returns (uint256)',
];
const saleAbi = [
  'function isListed(uint256 tokenId) view returns (bool)',
  'function list(uint256[] tokenIds)',
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
    console.log(`[keeper] market cap $${fmt(mc)} | next milestone #${index} at $${fmt(threshold)}`);

    if (mc < threshold) return;

    const window: bigint = await cards.confirmWindow();
    const now = BigInt(Math.floor(Date.now() / 1000));
    let crossed: bigint = 0n;
    if (window > 0n) {
      crossed = await cards.crossingAt(index);
      if (crossed === 0n || now - crossed < window) {
        const tx = await cards.confirmCrossing();
        await tx.wait();
        console.log(`[keeper] crossing confirmed at block ${tx.blockNumber}; waiting for window`);
        return;
      }
    }

    const tx = await cards.mintNext();
    const receipt = await tx.wait();
    const tokenId = BigInt(index) + 1n;
    console.log(`[keeper] MINTED card #${tokenId} for milestone #${index} - tx ${receipt?.hash}`);

    // a minted card is not buyable until it is listed on the treasury sale
    if (SALE_ADDRESS) {
      const sale = new ethers.Contract(SALE_ADDRESS, saleAbi, wallet);
      if (!(await sale.isListed(tokenId))) {
        const listTx = await sale.list([tokenId]);
        await listTx.wait();
        console.log(`[keeper] LISTED card #${tokenId} on CardSale - tx ${listTx.hash}`);
      }
    }
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
