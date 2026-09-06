import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

/**
 * Live market-cap ticker for the Pons-launched POKE token. Polls the deployed
 * milestone oracle and prints the cap plus progress toward the next
 * milestone. If the card stack is not deployed yet but a curve is known, it
 * computes the raw curve cap instead (quoteReserve x supply / tokenReserve,
 * in ETH, and in USD when MANUAL_ETH_USD is set).
 *
 * Robinhood Chain publishes no websocket endpoint, so this polls the public
 * RPC - the cap only moves when a trade does, so a few seconds of interval is
 * effectively live.
 *
 * Env (all optional):
 *   ORACLE_ADDRESS   milestone oracle to read (default: the
 *                    deployments/robinhoodMainnet.json record)
 *   CARDS_ADDRESS    MilestoneCards address for the next-rung line (same default)
 *   CURVE_ADDRESS    Pons curve for raw pre-deploy watching (fallback mode)
 *   TOKEN_ADDRESS    POKE token for raw mode supply (same default as above)
 *   MANUAL_ETH_USD   USD price for raw mode, e.g. 3000 (oracle mode prices
 *                    itself)
 *   WATCH_RPC_URL    RPC endpoint (default: Robinhood mainnet public RPC)
 *   CAP_POLL_MS      poll interval (default 10000)
 *   CAP_POLLS        stop after N polls (default 0 = until Ctrl+C)
 *
 * Run: npm run watch:cap
 */

const rpc =
  process.env.WATCH_RPC_URL ??
  process.env.KEEPER_RPC_URL_MAINNET ??
  'https://rpc.mainnet.chain.robinhood.com';
const pollMs = Number(process.env.CAP_POLL_MS ?? '10_000');
const maxPolls = Number(process.env.CAP_POLLS ?? '0');

const provider = new ethers.JsonRpcProvider(rpc);

function fromRecord(): { oracle?: string; cards?: string; token?: string } {
  const recordPath = path.resolve(__dirname, '../deployments/robinhoodMainnet.json');
  if (!fs.existsSync(recordPath)) return {};
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    return { oracle: record.oracle, cards: record.cards, token: record.token };
  } catch {
    return {};
  }
}

async function main() {
  const record = fromRecord();
  const oracleAddress = process.env.ORACLE_ADDRESS ?? record.oracle;
  const cardsAddress = process.env.CARDS_ADDRESS ?? record.cards;
  const tokenAddress = process.env.TOKEN_ADDRESS ?? record.token;
  const curveAddress = process.env.CURVE_ADDRESS;
  const manualEthUsd = process.env.MANUAL_ETH_USD
    ? ethers.parseUnits(process.env.MANUAL_ETH_USD, 8)
    : null;

  if (!oracleAddress && !curveAddress) {
    throw new Error(
      'nothing to watch: deploy the card stack (robinhoodMainnet.json), or set ORACLE_ADDRESS / CURVE_ADDRESS',
    );
  }

  const oracle = oracleAddress
    ? new ethers.Contract(oracleAddress, ['function marketCap() view returns (uint256)'], provider)
    : null;
  const curve = curveAddress
    ? new ethers.Contract(curveAddress, ['function getReserves() view returns (uint256,uint256)'], provider)
    : null;
  const token = tokenAddress
    ? new ethers.Contract(tokenAddress, ['function totalSupply() view returns (uint256)'], provider)
    : null;
  const cards = cardsAddress
    ? new ethers.Contract(
        cardsAddress,
        ['function nextMilestone() view returns (uint256 index, uint256 marketCap)'],
        provider,
      )
    : null;

  console.log(
    `watching ${oracleAddress ?? `raw curve ${curveAddress}`} on ${rpc} every ${pollMs}ms (Ctrl+C stops)`,
  );

  let last: bigint | null = null;
  for (let i = 1; maxPolls === 0 || i <= maxPolls; i++) {
    const at = new Date().toISOString().slice(11, 19);
    try {
      let cap: bigint | null = null;
      let source = 'oracle';
      if (oracle) {
        try {
          cap = (await oracle.getFunction('marketCap')()) as bigint;
        } catch {
          cap = null; // e.g. no aged checkpoint pricing yet - fall through to raw
        }
      }
      if (cap === null && curve && token) {
        const [quoteReserve, tokenReserve]: [bigint, bigint] = await curve
          .getFunction('getReserves')();
        if (quoteReserve > 0n && tokenReserve > 0n) {
          const supply: bigint = await token.getFunction('totalSupply')();
          cap = (quoteReserve * supply) / tokenReserve; // ETH, 18 decimals
          source = 'raw curve';
          if (manualEthUsd) cap = (cap * manualEthUsd) / 10n ** 8n;
        }
      }

      if (cap === null) {
        console.log(`[${at}] cap not priced yet (no aged checkpoint and no curve read)`);
      } else {
        const usd = source === 'raw curve' && !manualEthUsd
          ? `${Number(ethers.formatUnits(cap, 18)).toFixed(3)} ETH`
          : `$${Math.round(Number(ethers.formatUnits(cap, 18))).toLocaleString('en-US')}`;
        const delta =
          last === null ? '' : cap === last ? ' (unchanged)' : cap > last ? ' (up)' : ' (down)';
        let rung = '';
        if (cards) {
          try {
            const [index, threshold]: [bigint, bigint] = await cards.getFunction('nextMilestone')();
            if (index === ethers.MaxUint256) rung = ' | ladder complete';
            else {
              const pctRaw = (cap * 100n) / threshold;
              const pct = pctRaw > 100n ? 100n : pctRaw;
              rung = ` | next $${Number(ethers.formatUnits(threshold, 18)).toLocaleString('en-US')} (${pct}%)`;
            }
          } catch {
            /* cards not deployed yet */
          }
        }
        console.log(`[${at}] cap ${usd} via ${source}${delta}${rung}`);
        last = cap;
      }
    } catch (error) {
      console.log(`[${at}] read failed: ${(error as Error).message?.split('\n')[0]?.slice(0, 120)}`);
    }
    if (maxPolls === 0 || i < maxPolls) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

main().catch((e) => {
  console.error('watch:cap failed:', (e as Error).message ?? e);
  process.exit(1);
});
