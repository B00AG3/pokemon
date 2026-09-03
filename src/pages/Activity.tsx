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
  mint: { label: 'MINT', color: 'text-[#00bd7d]' },
  buy: { label: 'BUY', color: 'text-white' },
  sell: { label: 'SELL', color: 'text-amber-300' },
  trade: { label: 'TRADE', color: 'text-sky-300' },
};

function describe(
  event: MarketEvent,
  cardName: (id?: string) => string,
): string {
  switch (event.type) {
    case 'mint':
      return `${cardName(event.cardId)} minted into the treasury`;
    case 'buy':
      return `${cardName(event.cardId)} sold`;
    case 'sell':
      return `${cardName(event.cardId)} sold back to the market`;
    case 'trade':
      return `${cardName(event.giveCardId)} traded for ${cardName(event.getCardId)}`;
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
        <div>
          <p className="eyebrow">The tape</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Activity
          </h1>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[10px] font-bold text-white/60">
          {market.mode === 'demo' ? 'DEMO HISTORY' : 'ON-CHAIN EVENTS'}
        </span>
      </div>

      {market.mode === 'demo' && (
        <p className="mb-6 max-w-2xl text-sm font-light leading-relaxed text-white/50">
          Demo market history, newest first. Once the contracts go live this
          feed reads mints, sales, and swaps straight from the Robinhood Chain.
        </p>
      )}

      {market.activity.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-sm text-white/55">
            No activity yet - the first trade writes the first line.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          {market.activity.map((event) => {
            const meta = TYPE_META[event.type];
            return (
              <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <span className={`w-12 font-mono text-[10px] font-bold ${meta.color}`}>
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
                <span className="font-mono text-xs text-white/45">
                  {ownerLabel(event.accountKey, market.userKey)}
                </span>
                <span className="w-16 text-right font-mono text-xs text-white/30">
                  {timeAgo(event.ts)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
