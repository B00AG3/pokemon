# PokeCard Lab

## What this is

A token-backed collectibles airdrop. One ERC-20 ticker (POKE, fixed supply of
1,000,000,000) launches on the Robinhood Chain (an Arbitrum Orbit L2). Eight
market-cap milestones ($5,000 through $1,000,000) each airdrop one real
Pokemon TCG card, exactly once, free, to a drawn holder. Holding POKE is the
only draw ticket: wallets enter once via `MilestoneCards.enterDraw()`, the
winner must still hold POKE when the cap crosses (the contract re-checks and
skips sellers), and an empty draw falls back to the treasury. Each card
carries a chart value from birth: `redeemBasePrice x cap / launchMilestone`,
payable on demand by the holder via `redeem()` from the on-chain redemption
pool (the card burns). Holders can instead list on CardSwap for ETH above
that floor (2.5% royalty).

## Modes

- **Demo** (default): simulated drifting market cap, three test cards owned
  by seeded traders plus an open draw for card #04 (Base Set Gyarados, $50k
  slot), localStorage portfolio and draw entry. When the simulated cap
  crosses the milestone the airdrop fires. Lets visitors feel the mechanic
  before contracts deploy.
- **Live**: same UI bound to deployed contracts via `VITE_*` addresses in
  `.env`. On-chain cap, draw entries, ownership, listings, offers, and
  activity. CardSale remains only as an optional treasury fallback.

## Audience

Crypto-native traders and TCG collectors deciding whether to buy and hold
POKE. They need to understand the airdrop mechanic in one viewport, trust it
is backed by real cards, and find contract addresses.

## Success

A visitor gets the mechanic without scrolling, enters the draw, and a winner
has a card they can keep or trade without support.

## Constraints

- Facts live in `src/constants/ladder.ts` and the contracts; marketing copy
  must not contradict the draw rules or reference pricing.
- Card artwork comes from the public TCGdex API.
- The draw is trust-minimized, not a VRF; the site must not claim
  provable fairness.
- Not affiliated with Nintendo, The Pokemon Company, or Robinhood Markets; the
  site must say so.
