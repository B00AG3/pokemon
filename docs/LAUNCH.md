# Mainnet Launch Runbook

Everything rehearsed on Robinhood Chain testnet (chainId 46630): hardened
contracts (pause emergency-stops), a dedicated keeper with a confirm window
and cap checkpoints, the holder draw that airdrops each card for free,
chart-value redemption from the ETH pool, and CardSwap P2P escrowed listings
with exact royalty math.

## Same-day cutover around a Pons-launched token

This is the launch path of record. The user NEVER runs a script: the token is
created on the Pons website UI, the conductor hooks everything else around it,
and ongoing operation is 100% hosted (frontend on Vercel, keeper on Fly).

1. [USER-GATED] Create the main token on the Pons WEBSITE UI (connect the
   dev wallet, fill name/ticker/logo/socials; standard curve, zero creator
   tax, no buyback, native ETH). The scripted launcher
   (`npm run launch:pons`) is BACKUP ONLY - see the banner in
   `contracts/scripts/launch-pons.ts` - and is not part of this flow.
2. [USER-GATED] Fund the deployer wallet and the Fly keeper wallet with gas
   (the keeper needs >= 0.001 ETH, checked on-chain before launch), and
   choose the redemption economics: `REDEEM_BASE_PRICE_WEI` (0.01 ETH
   default) and `POOL_FUND_ETH` (worst-case full-ladder liability is
   ~93.85x the base price, ~0.94 ETH at the default; see
   `contracts/.env.example`).
3. [USER-GATED] Hand `TOKEN_ADDRESS` to the conductor.
4. Conductor dry-runs the hookup (read-only, aborts on the first check that
   fails - THRESHOLDS shape, keeper gas floor, curve resolution):
   ```bash
   cd contracts && TOKEN_ADDRESS=<pons token> DEPLOY_SALE=0 npm run launch:cards
   ```
   The dry run prints the resolved curve, the 30 rungs, the keeper check,
   pool sizing, and the Fly secrets block preview (the `VITE_*` block prints
   after GO=1, once the deployed addresses exist).
5. Conductor launches for real (deploys curve oracle + MilestoneCards +
   CardSwap around the EXISTING token - never creating one - prices the
   oracle, and funds the redemption pool; the Pons launch seeds only the
   bonding curve, nothing funds the MilestoneCards pool automatically).
   `DEPLOY_SALE=0` overrides any testnet `DEPLOY_SALE=1` left in `.env` -
   the cutover wires no treasury sale:
   ```bash
   TOKEN_ADDRESS=<pons token> POOL_FUND_ETH=<eth> GO=1 DEPLOY_SALE=0 npm run launch:cards
   ```
   It prints the `VITE_*` block and the Fly secrets block at the end, and
   warns loudly if `BASE_TOKEN_URI` is still the `ipfs://pokecard-lab/`
   placeholder (it prints the prefilled `npm run metadata` command for all
   30 rungs; pinning needs `PINATA_JWT`, user-gated).
6. Conductor commits the new `.env.production` (the five `VITE_*` addresses
   filled in, `VITE_PRELAUNCH` removed) and pushes - Vercel rebuilds and the
   site goes live in ~2 min.
7. Conductor cuts the hosted keeper over (the exact block launch-cards
   prints; keep `START_KEEPER=0`, the default - the local keeper behind
   `START_KEEPER=1` is a smoke-run escape hatch only):
   ```bash
   fly secrets set -a pokecard-keeper \
     CARDS_ADDRESS=<new cards> \
     POKE_TOKEN=<new token> \
     CURVE_ADDRESS=<new curve> \
     SWEEP_MODE=live \
     INTERVAL_MS=15000 \
     KEEPER_RPC_URL=https://rpc.mainnet.chain.robinhood.com
   fly apps restart -a pokecard-keeper
   ```
8. Verify: the site shows live mode, the first rung pending at $20,000, and
   `fly logs -a pokecard-keeper` shows marketCap reads each poll (keeper
   operation details live in the keeper section below).

## Quick path: same-day Pons smoke test (real money, throwaway values)

For testing the whole loop on mainnet the day the token launches, deploy a
throwaway stack bound to the Pons token with tiny thresholds and delays. The
real ladder launch is the same-day cutover section above; do not reuse the
smoke stack for it.

One-command version (steps 2-5 and 7 automated, keeper included):

    TOKEN_ADDRESS=<pons token> npm run smoke:mainnet

It resolves the token's Pons curve, creates and funds throwaway trader
wallets, buys POKE off the curve, deploys the smoke stack, sets the manual
ETH/USD price, funds the redemption pool, enters the draw, and starts the
keeper in the same console. It prints the VITE_* env block at the end. Knobs
and defaults are documented in scripts/smoke-mainnet.ts. Put the funded
deployer key in contracts/.env (gitignored) and use a burner wallet.

1. Launch POKE on Pons - two ways:
   - WEBSITE (simplest): connect the dev wallet and fill the form - name,
     ticker, logo, socials all go there. Pick the standard curve (config #0:
     1B supply, 4.2 ETH graduation), zero creator tax, no buyback, native
     ETH. If the form has a creator-fee-recipient field, set it to the keeper
     wallet; if it does not, run `npx ts-node scripts/point-fees-at-keeper.ts`
     right after (with EXECUTE=1, from the wallet that launched) so creator
     fees land where the keeper sweeps them into the card pool.
   - SCRIPTED (BACKUP ONLY - the website above is the launch path of
     record): `NAME=PokeCard SYMBOL=POKE npm run launch:pons`, then
     `EXECUTE=1` to fire. The fee wallet already defaults to the keeper.
   The keeper then claims the creator fees (70% of trading fees, paid in
   ETH + POKE) on its sweep
   cadence and tops the redemption pool to 150% of outstanding card
   liability, forwarding the overflow to TEAM_ADDRESS (keeper env). Flip
   SWEEP_MODE=live after the first claims are observed during the smoke run.
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
5. Enter the draw from wallet 2 (it holds POKE), then start the keeper from
   a shell that sourced the keeper env file (never inline the key: it would
   land in shell history and process listings):
   `set -a; . ./.env; set +a` then
   `CARDS_ADDRESS=<from deployments/robinhoodMainnet.json> KEEPER_RPC_URL=https://rpc.mainnet.chain.robinhood.com npm run keeper`.
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

- [ ] Milestone ladder + confirm window (the 30-rung ladder - $20,000 first
      card (instant, below the spawn cap), +$10,000 per rung up to $290,000 - is the default everywhere;
      confirm window in hours, not the testnet 60s)
- [ ] Redemption base price (`REDEEM_BASE_PRICE_WEI`; 0.01 ETH default) and
      redeem delay (`REDEEM_DELAY`; 21600s = 6h default). Chart values and the
      redemption pool liability both scale off the base price.
- [ ] Redemption pool funding: worst case for the full 30-rung ladder is
      `basePrice x 31 x (H(31) - 1)` = ~93.85x the base price (~0.94 ETH at
      the 0.01 base, ~1.41 ETH at the keeper's 150% sweep margin). Fund at
      least that before launch day; `POOL_FUND_ETH` below it draws a warning
      from launch-cards.
- [ ] Treasury multisig (Safe) address; keeper wallet generated + funded
- [ ] Final card artwork pinned to IPFS (`PINATA_JWT`, `npm run metadata`) -
      all 30 cards; the metadata command defaults to the full 30-card
      manifest
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
# keep KEEPER_PRIVATE_KEY / CARDS_ADDRESS / KEEPER_RPC_URL in a chmod 600
# ./.env (or `fly secrets set` on the Fly deployment) and source it - never
# inline the key on the command line, where shell history and process
# listings would capture it
set -a; . ./.env; set +a
npm run keeper
```

The keeper polls the oracle, stamps the first crossing (`confirmCrossing`),
waits out the confirm window, mints (`mintNext`) - the card airdrops to a
drawn POKE holder inside the contract, the keeper never touches it - and
records a market-cap checkpoint at least every 15 minutes (`checkpointCap`)
to feed chart-value pricing. Add monitoring: alert when the process dies,
when `totalMinted` changes, or when `lastCheckpointAt` stalls past an hour.
Upgrade path: swap the script for Gelato/Chainlink Automation tasks calling
`confirmCrossing`/`mintNext`/`checkpointCap`.

### Fly keeper cutover (pokecard-keeper)

The hosted keeper is the app `pokecard-keeper` (`contracts/fly.toml`; the
Dockerfile compiles `contracts/scripts/keeper.ts` to `dist/keeper.js`). It is
configured entirely through Fly secrets - no addresses live in the repo - and
one machine keeps polling the old stack until the secrets change. Cutover:

```bash
fly secrets set -a pokecard-keeper \
  CARDS_ADDRESS=<new cards> \
  POKE_TOKEN=<new token> \
  CURVE_ADDRESS=<new curve> \
  SWEEP_MODE=live \
  INTERVAL_MS=15000 \
  KEEPER_RPC_URL=https://rpc.mainnet.chain.robinhood.com
fly apps restart -a pokecard-keeper
```

Verify with `fly logs -a pokecard-keeper`:

- The boot summary line shows the NEW `CARDS_ADDRESS`, the mainnet RPC, the
  15000ms interval, sweep mode live, the keeper wallet address, and its ETH
  balance: `[keeper] boot: watching <cards> on <rpc> every 15000ms | sweep
  live | keeper <address> | wallet balance <x> ETH`.
- Every poll logs a market-cap read (`[keeper] market cap $...`), proving
  the oracle is reachable on the new stack.
- No dust warning (`too little for a transaction`) once the keeper wallet is
  funded; the old smoke stack receives no further writes after the restart.

Hazards and gates:

- `KEEPER_RPC_URL` defaults to the Robinhood TESTNET RPC when the secret is
  unset, which would silently poll the wrong chain. Always pin the mainnet
  URL (above); `CARDS_ADDRESS` and `KEEPER_PRIVATE_KEY` are required - with
  either missing the process exits non-zero at boot instead of polling
  anything.
- [USER-GATED] Keeper wallet gas funding: the Fly keeper wallet
  (`0xD805A36605391b1ed8C3E7d1C846d2D161541d6f`) holds dust only. Until it
  is funded (>= 0.001 ETH), the built-in dust guard keeps the free reads
  flowing (market-cap polls, boot balance) and skips paid writes -
  checkpoints, mints, sweeps - degrading to read-only rather than crashing.
  Fund it to enable the first checkpoint tx and milestone mints.

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
