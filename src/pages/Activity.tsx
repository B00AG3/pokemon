import { useMarket, ownerLabel } from '../state/MarketProvider';
import { formatEth } from '../demo/market';
import type { MarketEvent } from '../demo/events';

function timeAgo(ts: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const TYPE_META: Record<MarketEvent['type'], { label: string; color: string }> = {
  mint: { label: 'Airdrop', color: 'text-[#00bd7d]' },
  buy: { label: 'Buy', color: 'text-white' },
  sell: { label: 'Sell', color: 'text-amber-400' },
};

function describe(
  event: MarketEvent,
  cardName: (id?: string) => string,
): string {
  switch (event.type) {
    case 'mint':
      return `${cardName(event.cardId)} airdropped to a drawn holder`;
    case 'buy':
      return `${cardName(event.cardId)} sold`;
    case 'sell':
      return `${cardName(event.cardId)} sold back to the market`;
  }
}

export default function Activity() {
  const market = useMarket();

  const cardName = (id?: string) =>
    (id ? market.cards.find((c) => c.id === id)?.name : undefined) ??
    (id?.startsWith('card-') ? `Card #${id.slice(5).padStart(2, '0')}` : 'a card');

  return (
    <section className="pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Activity
        </h1>
        {market.mode === 'demo' && (
          <span className="chip chip-neutral">Demo history</span>
        )}
      </div>

      {market.mode === 'demo' && (
        <p className="mb-6 max-w-2xl text-sm leading-relaxed text-white/55">
          Demo market history, newest first. When the contracts go live, this
          feed reads airdrops and sales from the Robinhood Chain.
        </p>
      )}

      {market.activity.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-sm text-white/60">
            No activity yet. Airdrops and sales will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/10 overflow-hidden rounded-[4px] border border-white/10 bg-white/[0.02]">
          {market.activity.map((event) => {
            const meta = TYPE_META[event.type];
            return (
              <li key={event.id} className="px-5 py-3.5">
                <div className="flex items-baseline gap-x-4">
                  <span className={`w-14 shrink-0 font-mono text-[10px] font-bold tracking-wider ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-white/75">
                    {describe(event, cardName)}
                    {event.priceEth !== undefined && event.priceEth !== 0 && (
                      <span className="ml-2 font-mono text-xs text-white/45">
                        {event.priceEth > 0 ? '' : '-'}
                        {formatEth(Math.abs(event.priceEth))}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-4 pl-16 sm:hidden">
                  <span className="font-mono text-xs text-white/45">
                    {ownerLabel(event.accountKey, market.userKey)}
                  </span>
                  <span className="font-mono text-xs text-white/45">
                    {timeAgo(event.ts)}
                  </span>
                </div>
                <div className="hidden items-baseline gap-4 sm:flex sm:justify-end">
                  <span className="font-mono text-xs text-white/45">
                    {ownerLabel(event.accountKey, market.userKey)}
                  </span>
                  <span className="w-16 text-right font-mono text-xs text-white/45">
                    {timeAgo(event.ts)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
