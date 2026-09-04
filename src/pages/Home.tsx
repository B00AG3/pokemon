import { Suspense, lazy, useMemo } from 'react';
import { Link } from 'react-router-dom';
import CardCoverflow from '../components/CardCoverflow';
import MarketSection from '../components/MarketSection';
import Reveal from '../components/Reveal';
import { useMarket } from '../state/MarketProvider';
import { LADDER_TCG_IDS } from '../constants/ladder';
import type { CardListItem } from '../types/tcgdex';

const IntroTour = lazy(() => import('../components/IntroTour'));

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Launch',
    body: 'One billion POKE goes live on the Robinhood Chain. The market cap does the rest.',
  },
  {
    step: '02',
    title: 'Airdrop',
    body: 'When the cap crosses a milestone and holds, the contract airdrops the next card to a drawn holder. Free, once per milestone, enforced on-chain.',
  },
  {
    step: '03',
    title: 'Sell',
    body: 'Won cards are yours to keep or sell to other holders at whatever price the market pays. The chart is the reference: double the cap, double the reference price.',
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

  // The hero belt is the milestone ladder itself, from a single source: once
  // a card enters the belt it keeps its slot, so nothing can swap identities
  // after mount (a second data source replacing shown cards read as a bug).
  const heroItems: CardListItem[] = useMemo(() => {
    return LADDER_TCG_IDS.map((id, i) => {
      const art = market.artFor(id);
      return art?.image
        ? { id, localId: String(i + 1), name: art.name, image: art.image }
        : null;
    }).flatMap((item) => (item ? [item] : []));
  }, [market]);

  return (
    <>
      {showTour && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
          <IntroTour onDone={onTourDone} />
        </Suspense>
      )}

      <header className="relative grid items-center gap-10 pb-12 pt-10 lg:grid-cols-[1.02fr_0.98fr] lg:pt-14">
        <div className="hero-aurora" aria-hidden />
        <div className="relative max-w-xl">
          <h1
            className="rise font-display text-5xl font-semibold leading-[1.06] tracking-tight sm:text-6xl xl:text-[4.4rem]"
            style={{ animationDelay: '40ms' }}
          >
            Every milestone airdrops a real Pokemon card.
          </h1>
          <p
            className="rise mt-6 max-w-md text-[15px] leading-relaxed text-white/60"
            style={{ animationDelay: '260ms' }}
          >
            POKE launches on the Robinhood Chain. At each market-cap
            milestone, the contract airdrops one real card to a drawn holder -
            free, exactly once. Hold, and the collection comes to you.
          </p>
          <div
            className="rise mt-8 flex flex-wrap gap-3"
            style={{ animationDelay: '380ms' }}
          >
            <Link to="/token" className="btn btn-primary">
              Get POKE
            </Link>
            <Link to="/roadmap" className="btn btn-ghost">
              See the roadmap
            </Link>
          </div>
        </div>

        <CardCoverflow items={heroItems} />
      </header>

      <section id="how" className="scroll-mt-10 border-t border-white/10 pb-12 pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            How it works
          </h2>
          <p className="font-mono text-xs text-white/40">
            8 milestones - $5,000 to $1,000,000
          </p>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {HOW_IT_WORKS.map((item, i) => (
            <Reveal key={item.step} delay={i * 90}>
              <div className="border-t border-white/15 pt-5">
                <p className="font-mono text-xs text-white/45">{item.step}</p>
                <h3 className="mt-3 font-display text-xl font-medium tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-white/55">
                  {item.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <div className="panel mt-10 grid gap-8 p-7 sm:p-9 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="max-w-xl font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
                Card #01 went to a holder for free. The next one could be you.
              </p>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/55">
                Every milestone card airdrops to a drawn wallet - no sale, no
                mint price, nothing to snipe. The only ticket is holding POKE
                when the cap crosses. After that, cards sell holder to holder
                at whatever the market pays.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-6 self-end lg:border-l lg:border-white/10 lg:pl-8">
              <div>
                <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
                  entry cost
                </dt>
                <dd className="mt-2 font-mono text-lg text-white">0 ETH</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
                  the ticket
                </dt>
                <dd className="mt-2 font-mono text-lg text-white">hold POKE</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
                  cards, one each
                </dt>
                <dd className="mt-2 font-mono text-lg text-white">8</dd>
              </div>
            </dl>
          </div>
        </Reveal>
      </section>

      <MarketSection />
    </>
  );
}
