import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getCardImageUrl } from '../services/tcgdex';
import CardDetail from '../components/CardDetail';
import { useMarket, ownerLabel } from '../state/MarketProvider';
import { formatEth } from '../demo/market';

function signed(value: number, digits = 3): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`;
}

export default function Portfolio() {
  const market = useMarket();
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const holdingsValue = market.myCards.reduce((sum, c) => sum + c.priceEth, 0);
  const totalCost = market.myCards.reduce(
    (sum, c) => sum + (market.costOf(c.id) ?? c.priceEth),
    0,
  );
  const unrealized = market.realizedEth === undefined ? undefined : holdingsValue - totalCost;
  const realized = market.realizedEth;

  const openCard = openCardId ? market.cards.find((c) => c.id === openCardId) ?? null : null;
  const isDemo = market.mode === 'demo';
  const hasCards = market.myCards.length > 0;

  const tradeOptionsFor = (targetId: string) =>
    market.cards
      .filter((c) => c.id !== targetId)
      .map((c) => ({ id: c.id, name: c.name, image: c.image, price: c.priceEth }));

  const handleTrade = (giveId: string, getId: string) => {
    void market.actions.trade(giveId, getId);
    setOpenCardId(null);
  };

  const offerCardName = (tokenId: number) =>
    market.cards.find((c) => c.tokenId === tokenId)?.name ?? `Card #${tokenId}`;

  return (
    <section className="pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your collection</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Portfolio
          </h1>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[10px] font-bold text-white/60">
          {isDemo ? 'DEMO PORTFOLIO' : 'LIVE'}
        </span>
      </div>

      {market.isGuest && (
        <div className="mb-6 rounded-xl border border-amber-300/20 bg-amber-300/5 px-5 py-3 font-mono text-xs text-amber-300/80">
          connect your wallet to keep a persistent portfolio - guests share a
          scratch account
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-[11px] text-white/40">balance</p>
          <p className="mt-2 font-mono text-lg text-white">{formatEth(market.eth)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-[11px] text-white/40">holdings value</p>
          <p className="mt-2 font-mono text-lg text-white">{formatEth(holdingsValue)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-[11px] text-white/40">unrealized</p>
          <p
            className={`mt-2 font-mono text-lg ${
              unrealized === undefined
                ? 'text-white/40'
                : unrealized >= 0
                  ? 'text-[#00bd7d]'
                  : 'text-red-400'
            }`}
          >
            {unrealized === undefined ? 'live mode' : `${signed(unrealized)} ETH`}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-[11px] text-white/40">realized</p>
          <p
            className={`mt-2 font-mono text-lg ${
              realized === undefined
                ? 'text-white/40'
                : realized >= 0
                  ? 'text-[#00bd7d]'
                  : 'text-red-400'
            }`}
          >
            {realized === undefined ? 'live mode' : `${signed(realized)} ETH`}
          </p>
        </div>
      </div>

      {market.notice && (
        <p className="mb-4 font-mono text-xs text-[#00bd7d]">{market.notice}</p>
      )}
      {market.busy && (
        <p className="mb-4 font-mono text-xs text-amber-300/90">{market.busy}...</p>
      )}
      {market.txError && (
        <p className="mb-4 font-mono text-xs text-red-400/90">
          {market.txError.slice(0, 180)}
        </p>
      )}

      {/* owned cards */}
      <h2 className="font-display text-xl font-semibold tracking-tight">Your cards</h2>
      {!hasCards ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-sm text-white/55">
            No cards yet. Buy your first milestone card from the market -
            every card tracks the token.
          </p>
          <Link to="/" className="btn btn-primary mt-5 !px-5 !py-2.5 text-[13px]">
            Open the market
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {market.myCards.map((card) => {
            const cost = market.costOf(card.id);
            const pnl = cost === undefined ? undefined : card.priceEth - cost;
            return (
              <div
                key={card.id}
                className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <button
                  type="button"
                  className="block w-full cursor-pointer text-left"
                  onClick={() => setOpenCardId(card.id)}
                  aria-label={`Open ${card.name}`}
                >
                  <div className="overflow-hidden rounded-xl border border-white/10 transition hover:border-white/30">
                    {card.image ? (
                      <img
                        src={getCardImageUrl({ image: card.image })}
                        alt={card.name}
                        className="aspect-[245/342] w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="aspect-[245/342] w-full animate-pulse bg-white/[0.04]" />
                    )}
                  </div>
                  <p className="mt-3 truncate text-sm font-semibold">{card.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-white/40">
                    card #{String(card.tokenId).padStart(2, '0')} - owner:{' '}
                    {ownerLabel(card.ownerKey, market.userKey)}
                  </p>
                </button>

                <div className="mt-2 font-mono text-[11px] text-white/45">
                  <p>
                    value: <span className="text-white">{formatEth(card.priceEth)}</span>
                    {card.listingPriceEth !== undefined && (
                      <span className="text-white"> (listed at {formatEth(card.listingPriceEth)})</span>
                    )}
                  </p>
                  {cost !== undefined && (
                    <p className="mt-0.5">
                      cost: {formatEth(cost)}{' '}
                      {pnl !== undefined && (
                        <span className={pnl >= 0 ? 'text-[#00bd7d]' : 'text-red-400'}>
                          {signed(pnl)}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary !px-4 !py-2 text-xs"
                    disabled={market.busy !== null}
                    onClick={() => void market.actions.sell(card.id)}
                  >
                    {card.listedByUser ? 'Sell again' : 'Sell'}
                  </button>
                  {card.listedByUser && (
                    <button
                      type="button"
                      className="btn btn-ghost !px-4 !py-2 text-xs"
                      onClick={() => void market.actions.cancelListing(card.id)}
                    >
                      Unlist
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost !px-4 !py-2 text-xs"
                    onClick={() => setOpenCardId(card.id)}
                  >
                    Trade
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* live-only: swap offers */}
      {market.mode === 'live' && (
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Incoming swap offers
            </h2>
            {market.incomingOffers.length === 0 ? (
              <p className="mt-3 font-mono text-xs text-white/40">
                no open offers target your cards right now
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {market.incomingOffers.map((offer) => (
                  <li
                    key={offer.offerId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="text-sm text-white/70">
                      {ownerLabel(offer.maker, market.userKey)} offers{' '}
                      <span className="text-white">{offerCardName(offer.giveTokenId)}</span> for
                      your <span className="text-white">{offerCardName(offer.wantTokenId)}</span>
                      {offer.ethAskEth > 0 && ` + ${formatEth(offer.ethAskEth)}`}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary !px-4 !py-2 text-xs"
                      disabled={market.busy !== null}
                      onClick={() => void market.actions.acceptSwap(offer.offerId)}
                    >
                      Accept
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Your swap offers
            </h2>
            {market.outgoingOffers.length === 0 ? (
              <p className="mt-3 font-mono text-xs text-white/40">
                offer one of your cards for another from any card page
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {market.outgoingOffers.map((offer) => (
                  <li
                    key={offer.offerId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="text-sm text-white/70">
                      your <span className="text-white">{offerCardName(offer.giveTokenId)}</span> for{' '}
                      <span className="text-white">{offerCardName(offer.wantTokenId)}</span>
                      {offer.ethAskEth > 0 && ` + ${formatEth(offer.ethAskEth)} ask`}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost !px-4 !py-2 text-xs"
                      onClick={() => void market.actions.cancelSwap(offer.offerId)}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {openCard && (
        <CardDetail
          card={{
            id: openCard.id,
            cardNumber: openCard.tokenId,
            name: openCard.name,
            image: openCard.image,
            setName: openCard.setName,
            rarity: openCard.rarity,
            tcgDescription: openCard.description,
            launchMc: openCard.launchUsd,
            price: openCard.priceEth,
            ownerLabel: ownerLabel(openCard.ownerKey, market.userKey),
            isMine: true,
          }}
          tradeOptions={tradeOptionsFor(openCard.id)}
          eth={market.eth}
          marketCap={market.marketCap}
          onBack={() => setOpenCardId(null)}
          onBuy={() => undefined}
          onSell={() => void market.actions.sell(openCard.id)}
          onTrade={handleTrade}
        />
      )}
    </section>
  );
}
