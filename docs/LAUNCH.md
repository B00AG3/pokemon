# Mainnet Launch Runbook

Everything rehearsed on Robinhood Chain testnet (chainId 46630): hardened
contracts (pause emergency-stops), a dedicated keeper with a confirm window
and cap checkpoints, the holder draw that airdrops each card for free,
chart-value redemption from the ETH pool, and CardSwap P2P escrowed listings
with exact royalty math.

## Quick path: same-day Pons smoke test (real money, throwaway values)

For testing the whole loop on mainnet the day the token launches, deploy a
throwaway stack bound to the Pons token with tiny thresholds and delays. The
real ladder launch (sections 1-5) happens later with real values; do not
reuse the smoke stack for it.

One-command version (steps 2-5 and 7 automated, keeper included):

    TOKEN_ADDRESS=<pons token> npm run smoke:mainnet

It discovers the pool, deploys the SmokeSwapper helper, creates and funds
throwaway trader wallets, buys POKE into them, deploys the smoke stack, sets
the manual ETH/USD price, funds the redemption pool, enters the draw, and
starts the keeper in the same console. It prints the VITE_* env block at the
end. Knobs and defaults are documented in scripts/smoke-mainnet.ts. Put the
funded deployer key in contracts/.env (gitignored) and use a burner wallet.

1. Launch POKE on Pons from the deployer wallet (0.0005 ETH fee). Set the
   Pons **fee wallet** to your ops/treasury wallet: creator fees (70% of
   trading fees, paid in WETH + POKE) accrue there and are claimable from
   the Pons interface at any time.
2. Note the token address; the pool comes from its `liquidityPool()` getter
   (Uniswap v3, 1% tier, quoted against WETH). Buy small POKE amounts into
   2-3 wallets after the first two launch-protection blocks.
3. Deploy the smoke stack:
   ```bash
   TOKEN_ADDRESS=<pons token> MOCK_ORACLE=0 \
   THRESHOLDS=50,100,250 CONFIRM_WINDOW=60 REDEEM_DELAY=60 \
   REDEEM_BASE_PRICE_WEI=1000000000000000 DEPLOY_SALE=0 \
   npm run deploy:mainnet
   ```
   The deploy auto-discovers the v3 pool and prints a live `marketCap()` read.
   If no Chainlink ETH/USD feed exists on the chain yet, set a manual price
   from the deployer: `oracle.setManualEthUsdPrice(300000000000)` ($3000).
4. Fund the redemption pool for the smoke ladder:
   `FUND_ETH=0.01 npm run fund:pool` (worst case at a $250 cap is
   0.001 x (5 + 2.5 + 1) = 0.0085 ETH). The script also prints the exact
   outstanding liability.
5. Enter the draw from wallet 2 (it holds POKE), then start the keeper:
   `KEEPER_PRIVATE_KEY=... CARDS_ADDRESS=<from deployments/robinhoodMainnet.json> KEEPER_RPC_URL=https://rpc.mainnet.chain.robinhood.com npm run keeper`.
   It checkpoints the cap, confirms the first crossing at the $50 threshold,
   waits the 60s window, and airdrops card #1 to the drawn holder.
6. Point the site at the smoke stack (VITE_* addresses, `VITE_ROBINHOOD_TESTNET` unset).
   Test sells both ways from the UI:
   - CardSwap: holder lists (confirm sheet), wallet 3 buys; seller receives
     the price minus the 2.5% royalty.
   - Redeem: after the 60s redeem delay ages a checkpoint, the holder
     redeems for the chart value; the card burns and the pool balance drops
     by exactly the payout.
7. Verify every tx on Blockscout, then decide: keep the smoke stack running
   for observation, or let it sit (the throwaway cards contract is separate
   from any future real-ladder deployment).

## 0. Decisions to lock before touching mainnet

- [ ] Milestone ladder + confirm window (hours, not the testnet 60s)
- [ ] Redemption base price (`REDEEM_BASE_PRICE_WEI`; 0.01 ETH default) and
      redeem delay (`REDEEM_DELAY`; 21600s = 6h default). Chart values and the
      redemption pool liability both scale off the base price.
- [ ] Redemption pool funding: worst case for the full ladder is
      `basePrice x (200 + 100 + 40 + 20 + 10 + 4 + 2 + 1)` = 377x the base
      price (3.77 ETH at 0.01). Fund at least that before launch day.
- [ ] Treasury multisig (Safe) address; keeper wallet generated + funded
- [ ] Final card artwork pinned to IPFS (`PINATA_JWT`, `npm run metadata`) -
      all 8 cards, not just the first 5
- [ ] IP + legal review of selling Pokemon card imagery and running a token

## 1. Price infrastructure

1. Launch or bind POKE (`TOKEN_ADDRESS` for a launchpad token), transfer
   ownership to the treasury, seed the POKE/WETH Uniswap v4 pool on mainnet
   with supply plus ETH, and initialize it. Record the exact PoolKey
   (currencies sorted, fee, tickSpacing, hooks).
2. Confirm the v4 StateView deployment address on the chain and the Chainlink
   ETH/USD aggregator (or plan to set a manual ETH/USD price on the oracle).
3. Deploy the oracle either standalone as
   `UniswapV4SpotOracle(stateView, POKE, WETH, poolKey, feed, 3600)` or let
   `deploy.ts` do it via `V4_*` env vars (section 2).
4. Sanity check: `oracle.marketCap()` should be
   `poolPrice x ethUsd x supply`. At launch that is a few thousand USD; a
   zero means the pool is not seeded yet, not an oracle bug.

## 2. Deploy

```bash
cd contracts && cp .env.example .env
# PRIVATE_KEY      = dedicated deployer (NOT the keeper, ideally NOT treasury)
# KEEPER_ADDRESS   = keeper wallet from the Safe/ops setup
# MOCK_ORACLE=0 V4_STATEVIEW_ADDRESS=... V4_WETH_ADDRESS=... ETH_USD_FEED_ADDRESS=...
# CONFIRM_WINDOW=<hours> REDEEM_DELAY=21600 REDEEM_BASE_PRICE_WEI=10000000000000000
# BASE_TOKEN_URI=ipfs://<final metadata cid>/
npm run deploy:mainnet
```

The script refuses `MOCK_ORACLE=1` on mainnet, prints every address, and
writes `deployments/robinhoodMainnet.json` (commit this file). Immediately
after:

- [ ] Fund the redemption pool: send the section 0 amount of ETH to the
      MilestoneCards address (plain transfer; `receive()` accepts it) and
      publish the tx hash. `redeem()` pays out of this balance only.
- [ ] Transfer `MilestoneCards`, `CardSale` (if deployed), and `CardSwap`
      ownership to the treasury Safe: `transferOwnership` on each contract.
- [ ] `cards.setDefaultRoyalty(treasurySafe, 250)` after ownership transfer.
- [ ] Keeper starts checkpointing immediately (section 3); chart values read
      `ChartNotReady` until the first checkpoint ages past `REDEEM_DELAY`.

## 3. Keeper operations

```bash
# keeper machine (separate key, separate host)
KEEPER_PRIVATE_KEY=... CARDS_ADDRESS=... \
KEEPER_RPC_URL=<paid RPC> npm run keeper
```

The keeper polls the oracle, stamps the first crossing (`confirmCrossing`),
waits out the confirm window, mints (`mintNext`) - the card airdrops to a
drawn POKE holder inside the contract, the keeper never touches it - and
records a market-cap checkpoint at least every 15 minutes (`checkpointCap`)
to feed chart-value pricing. Add monitoring: alert when the process dies,
when `totalMinted` changes, or when `lastCheckpointAt` stalls past an hour.
Upgrade path: swap the script for Gelato/Chainlink Automation tasks calling
`confirmCrossing`/`mintNext`/`checkpointCap`.

## 4. Frontend

```bash
# Vercel project env (production + preview):
VITE_ROBINHOOD_TESTNET=        # unset = mainnet 4663
VITE_TOKEN_ADDRESS=            # deployments/robinhoodMainnet.json
VITE_CARDS_ADDRESS=
VITE_ORACLE_ADDRESS=
VITE_SALE_ADDRESS=
VITE_SWAP_ADDRESS=
VITE_WALLETCONNECT_PROJECT_ID= # cloud.walletconnect.com (mobile connects)
VITE_DEX_POOL_URL=             # link to the POKE pool on a DEX
```

Then `vercel --prod`. The site flips to LIVE mode by itself; if the contracts
are unreachable the site shows a market-data error instead of demo data.
Check the hero shows a real market cap and `/activity` streams
`MilestoneMinted` events.

## 5. Launch-day checklist

- [ ] First mint end-to-end: cap crosses, keeper confirms, window elapses,
      card airdrops to a drawn holder from the UI's draw.
- [ ] Redemption: a funded card redeems for its chart value (the aged
      checkpoint cap, not the live tick) and burns; the pool balance drops by
      exactly the payout.
- [ ] P2P loop: list on CardSwap from the UI, buy from a second wallet,
      seller receives proceeds minus the 2.5% royalty, cancel returns escrow.
- [ ] Emergency drill: `cards.pause()` halts mints, draws, and redemptions;
      `swap.pause()` blocks trades but cancellations still return escrowed
      cards; unpause restores.
- [ ] Blockscout verifies: `npx hardhat verify --network robinhoodMainnet ...`
      for each deployed address.
- [ ] Incident contacts + who holds the Safe owner keys.

## Rehearsal provenance

`npx hardhat run scripts/rehearse-transactions.ts --network <network>` runs
the whole loop (draw entry, free airdrop, empty-draw treasury fallback,
CardSwap list with royalty-split buyback, chart-value redemption with pool
payout and burn, pause drill) and asserts every balance flow. Re-run it on
robinhoodTestnet against the final committed contracts before launch day;
the 2026-09-03 pass predates the draw/redeem contracts and does not count.
