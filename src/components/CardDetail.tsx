import { useEffect, useState } from 'react';
import { formatEth } from '../demo/market';

export interface DetailCard {
  id: string;
  cardNumber: number;
  name: string;
  image?: string;
  setName?: string;
  rarity?: string;
  tcgDescription?: string;
  launchMc: number;
  price: number;
  ownerLabel: string;
  isMine: boolean;
}

export interface TradeTarget {
  id: string;
  name: string;
  image?: string;
  price: number;
}

interface CardDetailProps {
  card: DetailCard;
  tradeOptions: TradeTarget[];
  eth: number;
  marketCap: number;
  onBack: () => void;
  onBuy: () => void;
  onSell: () => void;
  onTrade: (giveId: string, getId: string) => void;
}

function PokeballBack() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#101622] via-[#0b0b0c] to-[#0f1410]">
      <svg viewBox="0 0 200 280" className="h-3/4 opacity-25" aria-hidden>
        <circle cx="100" cy="140" r="70" fill="none" stroke="#ffffff" strokeWidth="6" />
        <path d="M30 140h48M122 140h48" stroke="#ffffff" strokeWidth="6" />
        <circle cx="100" cy="140" r="20" fill="none" stroke="#ffffff" strokeWidth="6" />
        <circle cx="100" cy="140" r="8" fill="#ffffff" />
      </svg>
    </div>
  );
}

function Accordion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-white/10 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/70">
        {label}
        <span className="text-white/30 transition group-open:rotate-90">›</span>
      </summary>
      <div className="pt-3 text-sm font-light leading-relaxed text-white/55">{children}</div>
    </details>
  );
}

/**
 * Full product page for a single card (Balenciaga-style split layout):
 * flip artwork on the left, details / accordion / trade picker / actions on
 * the right. Rendered as a fixed overlay so it behaves like its own page.
 */
export default function CardDetail({
  card,
  tradeOptions,
  eth,
  marketCap,
  onBack,
  onBuy,
  onSell,
  onTrade,
}: CardDetailProps) {
  const [flipped, setFlipped] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);

  useEffect(() => {
    setFlipped(false);
    setTargetId(null);
  }, [card.id]);

  const imageUrl = card.image ? `${card.image}/high.png` : undefined;
  const usdValue = card.price * 3000;

  // trade bookkeeping: acquiring this card (give one of yours) or swapping
  // this card away for another one you want
  const giveMode = card.isMine;
  const selected = tradeOptions.find((t) => t.id === targetId) ?? null;
  const delta =
    giveMode && selected
      ? Math.round((selected.price - card.price) * 1000) / 1000
      : 0;
  const affordable = delta <= 0 || eth >= delta;

  // auto-select the first trade option whenever the option set changes
  const optionKey = tradeOptions.map((t) => t.id).join(',');
  useEffect(() => {
    setTargetId(tradeOptions[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionKey]);

  const confirmTrade = () => {
    if (giveMode && selected) onTrade(card.id, selected.id);
    if (!giveMode && selected) onTrade(selected.id, card.id);
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[#050505]">
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-6">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-xs text-white/50 transition hover:text-white"
        >
          ← back to market
        </button>

        <div className="mt-6 grid gap-12 lg:grid-cols-2">
          {/* left: flip artwork */}
          <div>
            <div
              className="flip-scene mx-auto w-full max-w-[400px] cursor-pointer"
              onClick={() => setFlipped((value) => !value)}
              role="button"
              aria-label="Flip card"
            >
              <div className={`flip-inner ${flipped ? 'flipped' : ''}`}>
                <div className="flip-face">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={card.name}
                      className="aspect-[245/342] w-full rounded-xl border border-white/10 object-cover shadow-2xl shadow-black/70"
                      draggable={false}
                    />
                  ) : (
                    <div className="aspect-[245/342] w-full rounded-xl border border-white/10 bg-white/[0.04]" />
                  )}
                </div>
                <div className="flip-face flip-back">
                  <div className="aspect-[245/342] w-full overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/70">
                    <PokeballBack />
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center font-mono text-[11px] text-white/35">
              tap the card to flip it
            </p>
          </div>

          {/* right: details */}
          <div>
            <p className="eyebrow">
              PokeCard milestone card - #{String(card.cardNumber).padStart(2, '0')}
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {card.name}
            </h1>
            <p className="mt-2 font-mono text-lg text-white">
              {formatEth(card.price)}{' '}
              <span className="text-xs text-white/40">
                (~${usdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })})
              </span>
            </p>

            <p className="mt-6 text-sm font-light leading-relaxed text-white/60">
              Official PokeCard Lab milestone card, minted once when the token
              crossed ${card.launchMc.toLocaleString('en-US')} market cap on the
              Robinhood Chain. Its price rides the token: as the chart climbs,
              so does the value of every card in the collection.
            </p>
            {card.tcgDescription && (
              <p className="mt-4 text-sm font-light leading-relaxed text-white/60">
                {card.tcgDescription}
              </p>
            )}
            <p className="mt-4 text-sm font-light leading-relaxed text-white/60">
              Currently held by{' '}
              <span className="text-white">{card.ownerLabel}</span>. Each card
              mints exactly once and can be bought, sold, or traded with other
              holders - the cheapest it will ever be is the day it mints.
            </p>

            <div className="mt-8">
              <Accordion label={`The set: ${card.setName ?? 'Unknown'}`}>
                {card.setName
                  ? `From the ${card.setName} expansion - one of the most iconic releases in the TCG.`
                  : 'Set information unavailable for this card.'}
              </Accordion>
              <Accordion label={`Rarity: ${card.rarity ?? 'Unknown'}`}>
                Original TCG print rarity. Holo rarities carry the rainbow foil
                layer in your PokeCard collection.
              </Accordion>
              <Accordion label={`Milestone: ${card.launchMc.toLocaleString('en-US')} market cap`}>
                This card minted when the token crossed{' '}
                ${card.launchMc.toLocaleString('en-US')}. The current market cap
                is ${marketCap.toLocaleString('en-US')} - the gap between the
                two is exactly how much the card has appreciated.
              </Accordion>
              <Accordion label="Ownership">
                Held by {card.ownerLabel}. Cards are yours to buy, sell, or
                trade with other holders - every transfer settles instantly on
                the Robinhood Chain.
              </Accordion>
            </div>

            {/* actions */}
            <div className="mt-8 space-y-3">
              {!card.isMine && (
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={onBuy}
                >
                  Buy - {formatEth(card.price)}
                </button>
              )}
              {card.isMine && (
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={onSell}
                >
                  Sell - {formatEth(card.price)}
                </button>
              )}
            </div>

            {/* trade-for picker, mirroring the "other sizes" pattern */}
            {tradeOptions.length > 0 && (
              <div className="mt-8 border-t border-white/10 pt-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/70">
                  {giveMode ? 'Trade this card for' : 'Trade one of your cards for this'}
                </p>
                <div className="mt-4 flex gap-4">
                  {tradeOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="group w-24 text-left"
                      onClick={() => setTargetId(option.id)}
                    >
                      <div
                        className={`overflow-hidden rounded-lg border-2 transition ${
                          targetId === option.id
                            ? 'border-[#00bd7d]'
                            : 'border-white/10 group-hover:border-white/30'
                        }`}
                      >
                        {option.image ? (
                          <img
                            src={`${option.image}/low.webp`}
                            alt={option.name}
                            className="aspect-[245/342] w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <div className="aspect-[245/342] w-full bg-white/[0.04]" />
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-center text-[11px] text-white/55">
                        {option.name}
                      </p>
                    </button>
                  ))}
                </div>

                {selected && (
                  <button
                    type="button"
                    className="btn btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!affordable}
                    onClick={() => confirmTrade()}
                  >
                    {delta > 0
                      ? `Confirm trade - pay ${formatEth(delta)}`
                      : delta < 0
                        ? `Confirm trade - receive ${formatEth(-delta)}`
                        : 'Confirm trade'}
                    {!affordable && ' (not enough demo ETH)'}
                  </button>
                )}
              </div>
            )}
            {!card.isMine && tradeOptions.length === 0 && (
              <p className="mt-8 border-t border-white/10 pt-6 font-mono text-xs text-white/40">
                buy a card first to unlock trading with other holders.
              </p>
            )}

            <p className="mt-6 text-center font-mono text-[11px] text-white/30 lg:text-right">
              settlement: instant on the Robinhood Chain
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
