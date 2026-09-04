import { getCardImageUrl } from '../services/tcgdex';
import { useMarket } from '../state/MarketProvider';
import { MILESTONES, formatUsd } from '../constants/ladder';

/**
 * The full milestone ladder. Minted state comes from the chain in live mode;
 * in demo mode the first three cards are minted, matching the demo market.
 */
export default function Roadmap() {
  const market = useMarket();
  const mintedCount =
    market.mode === 'live' ? (market.live.totalMinted ?? 0) : 3;
  const nextMilestone = MILESTONES.find((m) => m.index > mintedCount);
  const cap = market.marketCap;
  const progressTarget = nextMilestone?.usd ?? MILESTONES[MILESTONES.length - 1].usd;
  const progress = Math.min(100, Math.max(0, (cap / progressTarget) * 100));

  return (
    <section className="pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">The ladder</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Milestone roadmap
          </h1>
        </div>
        {market.mode === 'demo' && (
          <span className="chip chip-neutral">Demo progress</span>
        )}
      </div>

      <div className="panel p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">current market cap</p>
            <p className="mt-2 font-display text-3xl font-semibold tracking-tight">
              {formatUsd(Math.round(cap))}
            </p>
          </div>
          <p className="font-mono text-xs text-white/50">
            {nextMilestone
              ? `next airdrop: card #${String(nextMilestone.index).padStart(2, '0')} at ${formatUsd(nextMilestone.usd)} - ${formatUsd(Math.max(0, nextMilestone.usd - cap))} to go`
              : 'every milestone airdropped - the ladder is complete'}
          </p>
        </div>
        <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#00bd7d,#5eead4)] shadow-[0_0_12px_rgb(0_189_125/0.45)] transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ol className="mt-8 border-t border-white/10">
        {MILESTONES.map((slot) => {
          const isMinted = slot.index <= mintedCount;
          const isNext = nextMilestone?.index === slot.index;
          const art = market.artFor(slot.tcgId);
          const marketCard = market.cards.find((c) => c.tokenId === slot.index);
          return (
            <li
              key={slot.index}
              className={`flex items-center gap-5 border-b border-white/10 px-3 py-4 ${
                isNext ? 'bg-[#00bd7d]/[0.05]' : ''
              }`}
            >
              <span className="w-8 font-mono text-xs text-white/45">
                #{String(slot.index).padStart(2, '0')}
              </span>
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-[4px] border border-white/12">
                {art?.image ? (
                  <img
                    src={getCardImageUrl({ image: art.image })}
                    alt={`Milestone card ${slot.index}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/[0.04] font-mono text-[9px] text-white/45">
                    TBD
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {art?.name ??
                    (slot.tcgId ? 'Loading...' : 'Artwork to be announced')}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-white/40">
                  airdrops free at {formatUsd(slot.usd)} market cap
                  {isMinted && marketCard?.ownerKey !== undefined && market.mode === 'live'
                    ? ` - held by ${marketCard.ownerKey === 'treasury' ? 'the treasury (fallback)' : 'its winner'}`
                    : ''}
                </p>
              </div>
              <span
                className={`chip ${
                  isMinted ? 'chip-solid' : isNext ? 'chip-up' : 'chip-neutral'
                }`}
              >
                {isMinted ? 'Airdropped' : isNext ? 'Draw open' : 'Locked'}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 max-w-2xl text-sm leading-relaxed text-white/55">
        Every card airdrops free to a drawn holder - the only ticket is
        holding POKE when the cap crosses. From there cards sell holder to
        holder, with the chart as the reference: at a {formatUsd(1000000)}{' '}
        cap, a card from the {formatUsd(5000)} milestone references 200x its
        base price.
      </p>
    </section>
  );
}
