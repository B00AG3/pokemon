import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CardCoverflow from '../components/CardCoverflow';
import MarketSection from '../components/MarketSection';
import { getCardWall } from '../services/tcgdex';
import { useMarket } from '../state/MarketProvider';
import type { CardListItem } from '../types/tcgdex';

const IntroTour = lazy(() => import('../components/IntroTour'));

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

export default function Home({
  showTour,
  onTourDone,
}: {
  showTour: boolean;
  onTourDone: () => void;
}) {
  const market = useMarket();
  const [wallItems, setWallItems] = useState<CardListItem[]>([]);

  // decorative hero wall: one cheap pool request, failures are silent
  useEffect(() => {
    getCardWall(48)
      .then(setWallItems)
      .catch(() => {});
  }, []);

  const heroCards = useMemo(() => wallItems, [wallItems]);

  return (
    <>
      {showTour && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
          <IntroTour onDone={onTourDone} />
        </Suspense>
      )}

      <header className="grid items-center gap-10 pb-10 pt-8 lg:grid-cols-[1.02fr_0.98fr] lg:pt-10">
        <div className="max-w-xl">
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
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/token" className="btn btn-primary !px-5 !py-2.5 text-[13px]">
              Get POKE
            </Link>
            <Link to="/roadmap" className="btn btn-ghost !px-5 !py-2.5 text-[13px]">
              See the roadmap
            </Link>
          </div>
          {market.live.ready && market.live.capUsd !== undefined && (
            <p className="mt-5 font-mono text-xs text-[#00bd7d]">
              on-chain: ${market.live.capUsd.toLocaleString('en-US')} market cap -
              {market.live.totalMinted ?? 0} card{market.live.totalMinted === 1 ? '' : 's'} minted
            </p>
          )}
        </div>

        <CardCoverflow items={heroCards} />
      </header>

      <section id="how" className="scroll-mt-10 pb-12 pt-2">
        <p className="eyebrow mb-3">01 / The idea</p>
        <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          How it works
        </h2>

        <div className="mt-8 grid gap-10 md:grid-cols-3">
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

        <div className="terminal mt-10 p-7 sm:p-9">
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

      <MarketSection />
    </>
  );
}
