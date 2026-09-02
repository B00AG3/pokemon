# PokeCard Lab

A live Pokémon TCG card explorer built with Vite, React 19, TypeScript, and
Tailwind CSS v4. Card data and artwork come from the public, keyless
[TCGdex API](https://tcgdex.dev). Design language: black canvas, Oswald
display type, JetBrains Mono terminal accents, and interactive 3D tilt cards
with holographic foil (inspired by pokepad.org and scrydex.com).

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
  constants/pokemon.ts   # type/rarity lists, type colors, holo detection
  components/
    HoloCard.tsx         # 3D tilt + glare + foil card (CSS vars + rAF)
    HeroFan.tsx          # Pokepad-style fanned 3-card cluster
    CardSkeleton.tsx     # loading placeholder
  App.tsx                # layout + search/draw state
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

Cards are flat 2D scans projected onto a perspective plane
(`.card-tilt` in `src/index.css`). Pointer position is written to CSS
variables inside one `requestAnimationFrame` batch, driving `rotateX`
and `rotateY`, a cursor-tracked specular glare, and an animated rainbow
`color-dodge` foil layer on holo-rarity prints. No WebGL dependency.

## Robinhood Chain contracts (`/contracts`)

On-chain layer for the token + milestone card loop. Robinhood Chain is an
Arbitrum Orbit L2: mainnet chainId `4663`, testnet `46630`, gas in ETH,
standard EVM tooling.

The site ships with a **simulated demo market** (`src/demo/`, "Demo market"
section): a drifting market-cap ticker, three test cards priced with the
contract formula (`basePrice x marketCap / launchCap`), and buy / sell /
trade flows against a localStorage portfolio. When the contracts deploy,
`DemoMarket` swaps to `useMilestoneState` + the sale contract 1:1.

| Contract | Purpose |
| --- | --- |
| `PokeCardToken` | Fixed-supply ERC-20, full supply to treasury for LP seeding |
| `MilestoneCards` | ERC-721 + ERC-2981; one card per market-cap milestone, mints exactly once, keeper-gated, cards mint to the treasury for sale |
| `UniswapV4SpotOracle` | Production `IMilestonePriceOracle`: POKE/WETH v4 pool price x Chainlink ETH/USD x totalSupply. Spot reads are smoothed by the keeper + confirm window; swap in a TWAP variant for fully trustless pricing |
| `CardSale` | Treasury sale with pricing that tracks the token: `price = basePrice x currentMarketCap / card's launch milestone` |
| `MockMilestonePriceOracle`, `MockStateView`, `MockAggregator` | Test doubles |

```bash
cd contracts
cp .env.example .env        # add a funded PRIVATE_KEY for testnet
npm install
npm test                    # 20 tests: ladder, one-time mint, keeper gate,
                            # confirm window, oracle math, sale + royalties
npm run metadata            # generate card metadata (+ Pinata upload with PINATA_JWT)
npm run deploy:testnet      # MOCK_ORACLE=1 by default; DEPLOY_SALE=1 adds CardSale
npm run keeper              # poll oracle, confirm crossings, mint on milestones
```

The keeper flow: `confirmCrossing()` records when the market cap rises above
the next threshold; once `confirmWindow` seconds pass and the cap is still
above it, `mintNext()` mints card #(index+1) to the treasury. Addresses are
written to `deployments/<network>.json`.

### Frontend wiring

The app already runs inside `WagmiProvider` + `QueryClientProvider`
(`src/web3/config.ts`, chains defined in `src/web3/chains.ts`, injected
connector covers MetaMask/Rabby/Robinhood Wallet). After deploying, set
`VITE_CARDS_ADDRESS`, `VITE_ORACLE_ADDRESS`, `VITE_TOKEN_ADDRESS` in `.env`
and use the `useMilestoneState()` hook (`src/web3/useMilestoneState.ts`) to
read live milestone data in components.

## Extending toward a game

Game logic, state management, and wallet/contract layers should import from
`services/tcgdex.ts` and `types/tcgdex.ts` only; they never touch `fetch`
directly. `getRandomCards` already returns gameplay-ready payloads (hp,
attacks, weaknesses, set) for custom mechanics.
