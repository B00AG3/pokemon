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
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Milestone roadmap
          </h1>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[10px] font-bold text-white/60">
          {market.mode === 'demo' ? 'DEMO PROGRESS' : 'LIVE PROGRESS'}
        </span>
      </div>

      <div className="terminal p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">current market cap</p>
            <p className="mt-2 font-display text-3xl font-semibold tracking-tight">
              {formatUsd(Math.round(cap))}
            </p>
          </div>
          <p className="font-mono text-xs text-white/50">
            {nextMilestone
              ? `next mint: card #${String(nextMilestone.index).padStart(2, '0')} at ${formatUsd(nextMilestone.usd)} - ${formatUsd(Math.max(0, nextMilestone.usd - cap))} to go`
              : 'every milestone minted - the ladder is complete'}
          </p>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#00bd7d] transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ol className="mt-8 space-y-3">
        {MILESTONES.map((slot) => {
          const isMinted = slot.index <= mintedCount;
          const isNext = nextMilestone?.index === slot.index;
          const art = market.artFor(slot.tcgId);
          const marketCard = market.cards.find((c) => c.tokenId === slot.index);
          return (
            <li
              key={slot.index}
              className={`flex items-center gap-5 rounded-xl border p-4 ${
                isNext
                  ? 'border-[#00bd7d]/40 bg-[#00bd7d]/[0.05]'
                  : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <span className="font-mono text-xs text-white/35">
                #{String(slot.index).padStart(2, '0')}
              </span>
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md border border-white/10">
                {art?.image ? (
                  <img
                    src={getCardImageUrl({ image: art.image })}
                    alt={`Milestone card ${slot.index}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/[0.04] font-mono text-[9px] text-white/30">
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
                  mints once at {formatUsd(slot.usd)} market cap
                  {isMinted && marketCard?.ownerKey !== undefined && market.mode === 'live'
                    ? ' - held by the treasury until sold'
                    : ''}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold ${
                  isMinted
                    ? 'bg-[#00bd7d] text-slate-950'
                    : isNext
                      ? 'bg-[#00bd7d]/15 text-[#00bd7d]'
                      : 'bg-white/10 text-white/50'
                }`}
              >
                {isMinted ? 'MINTED' : isNext ? 'NEXT' : 'LOCKED'}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 max-w-2xl text-sm font-light leading-relaxed text-white/50">
        Each card mints exactly once, ever, to the treasury, then is yours to
        buy, sell, or trade. Prices scale with the same chart: a card that
        launched at {formatUsd(5000)} is quoted at 200x its base price when the
        token reaches {formatUsd(1000000)}.
      </p>
    </section>
  );
}
