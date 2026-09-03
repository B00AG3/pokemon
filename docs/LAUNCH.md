# Mainnet Launch Runbook

Everything rehearsed on Robinhood Chain testnet (chainId 46630): hardened
contracts (pause emergency-stops), dedicated keeper with a confirm window,
treasury sale with dynamic pricing, CardSwap P2P listings and swaps, and the
full buy/sell/trade loop with real transactions and exact royalty math.

## 0. Decisions to lock before touching mainnet

- [ ] Milestone ladder + confirm window (hours, not the testnet 60s)
- [ ] CardSale base price (`SALE_BASE_PRICE_WEI`)
- [ ] Treasury multisig (Safe) address; keeper wallet generated + funded
- [ ] Final card artwork pinned to IPFS (`PINATA_JWT`, `npm run metadata`)
- [ ] IP + legal review of selling Pokemon card imagery and running a token

## 1. Price infrastructure

1. Deploy `PokeCardToken` ownership to the treasury, seed the POKE/WETH
   Uniswap v4 pool on mainnet with the 1B supply plus ETH.
2. Initialize the pool; record the exact PoolKey (currencies sorted, fee,
   tickSpacing, hooks).
3. Find the Chainlink ETH/USD aggregator on Robinhood Chain mainnet.
4. Deploy `UniswapV4SpotOracle(stateView, POKE, WETH, poolKey, feed, 3600)`.
   The v4 StateView deployment address for the chain must be confirmed.
5. Sanity check: `oracle.marketCap()` should be `poolPrice x ethUsd x supply`.

## 2. Deploy

```bash
cd contracts && cp .env.example .env
# PRIVATE_KEY      = dedicated deployer (NOT the keeper, ideally NOT treasury)
# KEEPER_ADDRESS   = keeper wallet from the Safe/ops setup
# MOCK_ORACLE=0 ORACLE_ADDRESS=<step 1.4>
# CONFIRM_WINDOW=<hours> SALE_BASE_PRICE_WEI=<decision> DEPLOY_SALE=1
# BASE_TOKEN_URI=ipfs://<final metadata cid>/
npm run deploy:mainnet
```

The script prints every address and writes `deployments/robinhoodMainnet.json`
(commit this file). Immediately after:

- [ ] `cards.setApprovalForAll(sale, true)` happens automatically when
      `DEPLOY_SALE=1`; verify with `sale.isListed` after each mint.
- [ ] Transfer `MilestoneCards`, `CardSale`, and `CardSwap` ownership to the
      treasury Safe: `transferOwnership` on each contract.
- [ ] `cards.setDefaultRoyalty(treasurySafe, 250)` after ownership transfer.

## 3. Keeper operations

```bash
# keeper machine (separate key, separate host)
KEEPER_PRIVATE_KEY=... CARDS_ADDRESS=... SALE_ADDRESS=... \
KEEPER_RPC_URL=<paid RPC> npm run keeper
```

The keeper confirms threshold crossings, waits out the confirm window, mints,
and lists each new card on CardSale automatically. Add monitoring: alert when
the process dies or when `totalMinted` changes. Upgrade path: swap the script
for Gelato/Chainlink Automation tasks calling `confirmCrossing`/`mintNext`.

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

Then `vercel --prod`. The site flips to LIVE mode by itself; check the hero
shows a real market cap and `/activity` streams `MilestoneMinted` events.

## 5. Launch-day checklist

- [ ] First mint end-to-end: cap crosses, keeper confirms, window elapses,
      card mints, keeper lists it, buy from the UI works, seller receives
      proceeds minus the 2.5% royalty.
- [ ] P2P loop: list on CardSwap, buy from a second wallet, card-for-card
      swap with an ETH ask.
- [ ] Emergency drill: `sale.pause()` blocks buys; `swap.pause()` blocks
      trades but cancellations still return escrowed cards; unpause restores.
- [ ] Blockscout verifies: `npx hardhat verify --network robinhoodMainnet ...`
      for each deployed address.
- [ ] Incident contacts + who holds the Safe owner keys.

## Rehearsal provenance

`npx hardhat run scripts/rehearse-transactions.ts --network <network>` runs
the whole loop (treasury buy, holder listing, royalty-split buyback, swap
with ETH ask, re-list, pause drill) and asserts every balance flow. It passed
on robinhoodTestnet 2026-09-03 against the current contract set.
