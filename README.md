# PokeCard Lab

A live Pokemon TCG card explorer and milestone-card airdrop built with Vite,
React 19, TypeScript, React Router, and Tailwind CSS v4. Card data and artwork
come from the public, keyless [TCGdex API](https://tcgdex.dev). Design
language ("exchange board", see DESIGN.md): flat near-black canvas, hairline
rules, Oswald display type, Archivo body, JetBrains Mono for every number and
label, and semantic green for live/up states.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Hero, how it works, the open draw, and the holder-to-holder market |
| `/portfolio` | Owned cards, cost basis, unrealized vs realized P&L |
| `/activity` | Airdrops and sales (localStorage in demo, contract logs when live) |
| `/roadmap` | Full 8-slot milestone ladder with live market-cap progress |
| `/token` | Get POKE: how to enter the draw, contract addresses, add-to-wallet, DEX link |

The market runs in two modes. **Demo mode** (default): a drifting market-cap
ticker, three test cards held by seeded traders, and an open draw for card
#04 that airdrops to a random entrant when the simulated cap crosses $50,000
(`src/demo/`). **Live mode**: once the contracts are deployed and the
`VITE_*` addresses are set in `.env`, the same UI switches to on-chain draw
entries, ownership, escrowed ETH listings (`CardSwap`), and contract-event
activity. No code changes are needed to flip modes.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle in dist/
```

## Architecture

```
src/
  services/tcgdex.ts     # the only module that talks to the API
  types/tcgdex.ts        # strict API models (card, set, attack, weakness...)
  constants/             # milestone ladder + TCG type/rarity lists
  state/MarketProvider.tsx  # demo/live market, draw, portfolio, actions
  demo/                  # simulated ticker, portfolio, draw, events (localStorage)
  web3/                  # chains, wagmi config, ABIs, reads/writes
  pages/                 # Home, Portfolio, Activity, Roadmap, TokenPage
  components/            # CardCoverflow, MarketSection, CardDetail, IntroTour,
                         # ConfirmTx (live-mode tx confirmation), Nav, Footer
  App.tsx                # routes + shell (nav, footer)
```

### Service layer (`src/services/tcgdex.ts`)

- `getCardById(id)` - full card payload from `GET /cards/:id`
- `searchCards(filters, pagination)` - filtered list from `GET /cards` with
  `name`, `set`, `rarity`, `types` query params; over-fetches one item to
  compute `hasNextPage` (the API exposes no browser-readable total count)
- `getRandomCards(count, filters)` - samples a random page of the filtered
  pool, shuffles, and hydrates full details for pack-open / hand-draw
  mechanics; cards without artwork are excluded from the pool
- `getCardImageUrl(card, { quality, format })` - builds `/high.webp`,
  `/low.png`, ... URLs from the asset base URL

All requests run through a single `tcgdexFetch` helper with a 12s timeout and
typed `TcgdexError` failures (network, HTTP status, bad JSON).

### 3D card rendering

The hero coverflow fans cards along a draggable arc (flat projected context,
z-index stacking, snap-on-release). The card detail overlay flips front/back
in 3D. Motion is limited to state transitions and honors
`prefers-reduced-motion`.

## Robinhood Chain contracts (`/contracts`)

On-chain layer for the token + milestone airdrop loop. Robinhood Chain is an
Arbitrum Orbit L2: mainnet chainId `4663`, testnet `46630`, gas in ETH,
standard EVM tooling.

| Contract | Purpose |
| --- | --- |
| `PokeCardToken` | Fixed-supply ERC-20, full supply to treasury for LP seeding; holding it is the draw ticket |
| `MilestoneCards` | ERC-721 + ERC-2981; one card per market-cap milestone, airdropped free to a drawn POKE holder (holder re-check at mint, treasury fallback on an empty draw), keeper-gated, mints exactly once. Chart-value redemption: `redeem()` pays the holder `redeemBasePrice x cap / launch` from the on-chain pool and burns the card |
| `UniswapV4SpotOracle` | Production `IMilestonePriceOracle`: POKE/WETH v4 pool price x Chainlink ETH/USD x totalSupply. Spot reads are smoothed by the keeper + confirm window; swap in a TWAP variant for fully trustless pricing |
| `CardSale` | Optional treasury fallback sale with chart-tracked pricing (only ever moves treasury-held fallback cards) |
| `CardSwap` | Peer-to-peer secondary market: escrowed fixed-price listings with ERC-2981 royalty splits |
| `MockMilestonePriceOracle`, `MockStateView`, `MockAggregator` | Test doubles |

The draw is trust-minimized: the winner is seeded from `block.prevrandao`
plus milestone data, so the keeper can influence it. That matches the trust
already placed in the keeper for gating mints; swap in a VRF callback if the
stakes ever demand provable fairness.

Every card carries a chart-tracked value: `redeemBasePrice x agedCap /
launchMilestone`, viewable via `chartPriceOf`. The cap behind that price is
the newest keeper `checkpointCap()` sample at least `REDEEM_DELAY` seconds
old (6h on mainnet), so a momentary pool-price spike cannot be redeemed out
of the pool. The contract's ETH pool (funded by the owner via `receive`,
default base 0.01 ETH at deploy) backstops that value - a holder can
`redeem()` for the exact chart price at any time, and the card burns.
CardSale and CardSwap listings are for selling above the floor.
Set `REDEEM_BASE_PRICE_WEI` and `REDEEM_DELAY` at deploy to change either.

```bash
cd contracts
cp .env.example .env        # add a funded PRIVATE_KEY for testnet
npm install
npm test                    # 40 tests: ladder, one-time airdrop, draw rules,
                            # holder re-check, treasury fallback, keeper gate,
                            # confirm window, oracle math at ladder prices,
                            # aged-cap redemption vs spot spikes, escrow
                            # listings, royalty splits, pause stops
npm run metadata            # generate card metadata (+ Pinata upload with PINATA_JWT)
npm run deploy:testnet      # MOCK_ORACLE=1 by default; DEPLOY_SALE=1 adds the fallback CardSale
npm run seed:testnet        # fund entrants, enter the draw, mint through the keeper
npx hardhat run scripts/rehearse-transactions.ts --network robinhoodTestnet
                            # full airdrop + listing rehearsal with royalty asserts
npm run keeper              # poll oracle, confirm crossings, airdrop on milestones
```

The keeper flow: `confirmCrossing()` records the FIRST time the market cap
rises above the next threshold (the stamp sticks; re-confirming is a no-op),
`checkpointCap()` records a market-cap sample at least every 15 minutes to
feed chart-value pricing, and once `confirmWindow` seconds pass with the cap
still above the threshold, `mintNext()` mints card #(index+1) directly to a
drawn POKE holder (treasury fallback when the draw is empty). Addresses are
written to `deployments/<network>.json`. All three core contracts have
owner-controlled pause emergency-stops. The mainnet launch procedure lives in
[docs/LAUNCH.md](docs/LAUNCH.md).

### Frontend wiring

The app runs inside `WagmiProvider` + `QueryClientProvider` + RainbowKit
(`src/web3/config.ts`, chains defined in `src/web3/chains.ts`) and a shared
`MarketProvider` (`src/state/MarketProvider.tsx`) that exposes market data,
the draw, portfolio, activity, and trade actions to every page. After
deploying, set `VITE_TOKEN_ADDRESS`, `VITE_CARDS_ADDRESS`,
`VITE_ORACLE_ADDRESS`, `VITE_SALE_ADDRESS`, and `VITE_SWAP_ADDRESS` in `.env`
(addresses are printed by the deploy script and saved to
`deployments/<network>.json`). When the cards, oracle, and swap addresses
are present the site switches to live mode automatically:
`useMilestoneState` powers the hero/roadmap plus the draw counts,
`useCardMarket` reads ownership/listings, `useMarketWrites` sends enter-draw/
list/buy transactions, and `/activity` reads contract logs. `VITE_SALE_ADDRESS`
is optional (treasury fallback only). `VITE_DEX_POOL_URL` (optionally) links
the launch pool on `/token`.

## Extending toward a game

Game logic, state management, and wallet/contract layers should import from
`services/tcgdex.ts` and `types/tcgdex.ts` only; they never touch `fetch`
directly. `getRandomCards` already returns gameplay-ready payloads (hp,
attacks, weaknesses, set) for custom mechanics.
