import { useEffect, useRef, useState } from 'react';
import { ETH_USD, formatEth } from '../demo/market';
import { getCardImageUrl } from '../services/pokemontcg';

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

interface CardDetailProps {
  card: DetailCard;
  marketCap: number;
  chartValueEth?: number;
  onBack: () => void;
  onBuy: () => void;
  onSell: () => void;
  onRedeem?: () => void;
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
      <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[11px] tracking-[0.08em] text-white/70">
        {label}
        <span className="text-white/45 transition group-open:rotate-90">›</span>
      </summary>
      <div className="pt-3 text-sm leading-relaxed text-white/55">{children}</div>
    </details>
  );
}

/**
 * Full product page for a single card (Balenciaga-style split layout):
 * flip artwork on the left, details / accordion / actions on the right.
 * Rendered as a fixed overlay so it behaves like its own page.
 */
export default function CardDetail({
  card,
  marketCap,
  chartValueEth,
  onBack,
  onBuy,
  onSell,
  onRedeem,
}: CardDetailProps) {
  const [flipped, setFlipped] = useState(false);
  const [backFailed, setBackFailed] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFlipped(false);
  }, [card.id]);

  // overlay behaves like a page: focus starts on the way out, Escape leaves
  useEffect(() => {
    backRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const imageUrl = getCardImageUrl(card);
  const usdValue = card.price * ETH_USD;
  const chartLabel = chartValueEth !== undefined ? formatEth(chartValueEth) : undefined;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[#050505]">
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-6">
        <button
          type="button"
          ref={backRef}
          onClick={onBack}
          className="font-mono text-xs text-white/50 transition hover:text-white"
        >
          ← back to market
        </button>

        <div className="mt-6 grid gap-12 lg:grid-cols-2">
          {/* left: flip artwork */}
          <div>
            <button
              type="button"
              className="flip-scene mx-auto block w-full max-w-[400px] cursor-pointer bg-transparent p-0"
              onClick={() => setFlipped((value) => !value)}
              aria-label="Flip card"
              aria-pressed={flipped}
            >
              <div className={`flip-inner ${flipped ? 'flipped' : ''}`}>
                <div className="flip-face">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={card.name}
                      className="aspect-[245/342] w-full rounded-[6px] border border-white/12 object-cover shadow-2xl shadow-black/70"
                      draggable={false}
                    />
                  ) : (
                    <div className="aspect-[245/342] w-full rounded-[6px] border border-white/12 bg-white/[0.04]" />
                  )}
                </div>
                <div className="flip-face flip-back">
                  <div className="aspect-[245/342] w-full overflow-hidden rounded-[6px] border border-white/12 bg-white/[0.04] shadow-2xl shadow-black/70">
                    {backFailed ? (
                      <PokeballBack />
                    ) : (
                      <img
                        src="/card-back.png"
                        alt="Card back"
                        className="h-full w-full object-cover"
                        draggable={false}
                        onError={() => setBackFailed(true)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </button>
            <p className="mt-4 text-center font-mono text-[11px] text-white/45">
              front / back
            </p>
          </div>

          {/* right: details */}
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {card.name}
            </h1>
            <p className="mt-2 font-mono text-lg text-white">
              {card.price > 0 ? (
                <>
                  {formatEth(card.price)}{' '}
                  <span className="text-xs text-white/40">
                    (~${usdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })})
                  </span>
                </>
              ) : (
                <span className="text-sm text-white/40">not listed - holder decides</span>
              )}
            </p>

            <p className="mt-6 text-sm leading-relaxed text-white/60">
              Airdropped free to a drawn holder when the token crossed $
              {card.launchMc.toLocaleString('en-US')} market cap on the
              Robinhood Chain. From there its price is whatever a holder asks,
              with the chart as the reference.
            </p>
            {card.tcgDescription && (
              <p className="mt-4 text-sm leading-relaxed text-white/60">
                {card.tcgDescription}
              </p>
            )}
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Currently held by <span className="text-white">{card.ownerLabel}</span>.
              Each card airdrops exactly once.
            </p>

            <div className="mt-8">
              <Accordion label={`The set: ${card.setName ?? 'Unknown'}`}>
                {card.setName
                  ? `From the ${card.setName} expansion of the Pokemon TCG.`
                  : 'Set information unavailable for this card.'}
              </Accordion>
              <Accordion label={`Rarity: ${card.rarity ?? 'Unknown'}`}>
                Original TCG print rarity. Holo prints carry the rainbow foil
                layer.
              </Accordion>
              <Accordion label="Backing">
                Every milestone card carries the artwork of a real Pokemon TCG
                card - one card per milestone, airdropped once, never again.
              </Accordion>
              <Accordion label={`Milestone: ${card.launchMc.toLocaleString('en-US')} market cap`}>
                This card airdropped when the token crossed{' '}
                ${card.launchMc.toLocaleString('en-US')}. The current market cap
                is ${marketCap.toLocaleString('en-US')}. Reference prices scale
                with that ratio: twice the launch cap, twice the reference.
              </Accordion>
              <Accordion label="Ownership">
                Held by {card.ownerLabel}. When they list it, anyone can buy -
                every transfer settles on the Robinhood Chain.
              </Accordion>
            </div>

            {/* actions */}
            <div className="mt-8 space-y-3">
              {!card.isMine && card.price > 0 && (
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={onBuy}
                >
                  Buy - {formatEth(card.price)}
                </button>
              )}
              {!card.isMine && card.price === 0 && (
                <p className="font-mono text-xs text-white/40">
                  Not listed for ETH.{' '}
                  {chartLabel
                    ? `Chart value: ${chartLabel} - redeemable by the holder at any time.`
                    : 'Chart value settles once the keeper records its first cap checkpoint.'}
                </p>
              )}
              {card.isMine && card.price > 0 && (
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={onSell}
                >
                  Sell - {formatEth(card.price)}
                </button>
              )}
              {card.isMine && card.price === 0 && onRedeem && (
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={onRedeem}
                >
                  {chartLabel ? `Redeem - ${chartLabel}` : 'Redeem at chart value'}
                </button>
              )}
            </div>

            <p className="mt-6 text-center font-mono text-[11px] text-white/45 lg:text-right">
              settlement on the Robinhood Chain
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
