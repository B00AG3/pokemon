import { useEffect, useMemo, useState } from 'react';
import CardCoverflow from './components/CardCoverflow';
import WalletButton from './components/WalletButton';
import { getCardWall } from './services/tcgdex';
import type { CardListItem } from './types/tcgdex';

function PokeballMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle
        cx="16"
        cy="16"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M6 16h6M20 16h6" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.2" fill="currentColor" />
    </svg>
  );
}

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Launch',
    body: 'One ticker goes live on the Robinhood Chain. Holding the token means holding the collection.',
  },
  {
    step: '2',
    title: 'Mint',
    body: 'Every market cap milestone mints the next Pokemon card into the collection. Supply is gated by the chart, not by us.',
  },
  {
    step: '3',
    title: 'Trade',
    body: 'Cards are yours to buy, sell, or trade, and every card tracks the token - so the whole collection climbs with the chart.',
  },
];

export default function App() {
  const [wallItems, setWallItems] = useState<CardListItem[]>([]);

  // decorative hero wall: one cheap pool request, failures are silent
  useEffect(() => {
    getCardWall(48)
      .then(setWallItems)
      .catch(() => {});
  }, []);

  // NOTE: search, filters, hand-drawing, and the card gallery are parked
  // until the token backend lands. The service layer (src/services/tcgdex.ts)
  // and the gallery components are kept ready in the codebase.

  const heroCards = useMemo(() => wallItems, [wallItems]);

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto max-w-6xl px-6">
        <nav className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5">
            <PokeballMark className="h-6 w-6 text-white" />
            <span className="text-[15px] font-semibold tracking-tight">
              PokeCard Lab
            </span>
          </div>
          <WalletButton />
        </nav>

        <header className="grid items-center gap-12 pb-20 pt-12 lg:grid-cols-[1.02fr_0.98fr] lg:pt-16">
          <div className="max-w-xl">
            <p className="eyebrow mb-6">
              Robinhood Chain / launching soon
            </p>
            <h1 className="font-display text-5xl font-semibold leading-[1.06] tracking-tight sm:text-6xl xl:text-[4.2rem]">
              Every milestone,
              <br />a real Pokemon card.
            </h1>
            <p className="mt-6 max-w-md text-[15px] font-light leading-relaxed text-white/55">
              The token launches on the Robinhood Chain. As market cap climbs,
              each milestone mints the next Pokemon card into the collection -
              minted once, then yours to buy, sell, or trade as it rides the
              token up.
            </p>
          </div>

          <CardCoverflow items={heroCards} />
        </header>

        <section id="how" className="scroll-mt-10 pb-28">
          <p className="eyebrow mb-3">01 / The idea</p>
          <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            How it works
          </h2>

          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step}>
                <p className="font-mono text-xs text-white/30">{item.step}</p>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2.5 text-sm font-light leading-relaxed text-white/50">
                  {item.body}
                </p>
              </div>
            ))}
          </div>

          <div className="terminal mt-14 p-8 sm:p-10">
            <p className="eyebrow">card #01 / single mint</p>
            <p className="mt-4 max-w-2xl font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              Card #01 is the cheapest this collection will ever be.
            </p>
            <p className="mt-4 max-w-xl text-sm font-light leading-relaxed text-white/50">
              It mints at a $5,000 market cap and never again. If the token
              runs to $1,000,000, that entry sits 200x under the same chart -
              and every milestone after it prices in higher.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
