import { useState } from 'react';
import { getCardImageUrl } from '../services/tcgdex';
import CardDetail from './CardDetail';
import { useMarket, ownerLabel } from '../state/MarketProvider';
import { formatEth, pokeUsdPrice } from '../demo/market';

/**
 * The buy / sell / trade market. In demo mode it runs on the simulated
 * market-cap ticker and localStorage portfolio; once the contracts are
 * deployed and set in .env the same UI switches to on-chain prices,
 * ownership, and real CardSale / CardSwap transactions.
 */
export default function MarketSection() {
  const market = useMarket();
  const [tradeFor, setTradeFor] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const cards = market.cards;

  const openCard = openCardId ? cards.find((c) => c.id === openCardId) ?? null : null;

  const tradeOptionsFor = (targetId: string) => {
    const target = cards.find((c) => c.id === targetId);
    if (!target) return [];
    // acquiring this card: you give one of your other cards.
    // trading this card away: you receive one of the other cards.
    const source = market.myCards.some((c) => c.id === targetId)
      ? cards.filter((c) => c.id !== targetId)
      : market.myCards.filter((c) => c.id !== targetId);
    return source.map((c) => ({ id: c.id, name: c.name, image: c.image, price: c.priceEth }));
  };

  const handleTrade = (giveCardId: string, getCardId: string) => {
    void market.actions.trade(giveCardId, getCardId);
    setTradeFor(null);
    setOpenCardId(null);
  };

  const hasCards = market.myCards.length > 0;

  const ticker = (
    <div className="flex items-center gap-2.5 font-mono text-xs text-white/45">
      <span className="status-dot animate-pulse" aria-hidden />
      <span>
        market cap ${market.marketCap.toLocaleString('en-US')} - POKE $
        {pokeUsdPrice(market.marketCap).toFixed(4)}
      </span>
      {market.mode === 'live' ? (
        <span className="rounded-full bg-[#00bd7d]/15 px-2 py-0.5 text-[10px] font-bold text-[#00bd7d]">
          LIVE
        </span>
      ) : (
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/60">
          DEMO
        </span>
      )}
    </div>
  );

  return (
    <section id="demo" className="scroll-mt-10 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">02 / Market</p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Buy, sell, trade
          </h2>
        </div>
        {ticker}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 font-mono text-xs text-white/60">
        <span>
          balance: <span className="text-white">{formatEth(market.eth)}</span>
        </span>
        <span>
          your cards: <span className="text-white">{market.myCards.length}</span>
        </span>
        <span>
          network: <span className="text-white">Robinhood Chain{market.mode === 'demo' ? ' (demo)' : ''}</span>
        </span>
        {market.mode === 'demo' && market.isGuest && (
          <span className="text-amber-300/80">
            connect your wallet to keep a persistent demo portfolio
          </span>
        )}
        {market.notice && <span className="text-[#00bd7d]">{market.notice}</span>}
        {market.busy && <span className="text-amber-300/90">{market.busy}...</span>}
        {market.txError && (
          <span className="text-red-400/90">{market.txError.slice(0, 140)}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {cards.map((card) => {
          const mine = market.myCards.some((c) => c.id === card.id);
          const tradeGive = tradeFor === card.id && hasCards ? market.myCards[0] : null;
          const giveCard = tradeGive ? cards.find((c) => c.id === tradeGive.id) : null;
          const delta =
            giveCard && tradeGive
              ? Math.round((card.priceEth - giveCard.priceEth) * 1000) / 1000
              : 0;

          return (
            <div
              key={card.id}
              className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              {mine && (
                <span className="absolute right-3 top-3 z-10 rounded-full bg-[#00bd7d] px-2 py-0.5 font-mono text-[10px] font-bold text-slate-950">
                  YOURS
                </span>
              )}
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

                <div className="mt-3">
                  <p className="truncate text-sm font-semibold">{card.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-white/40">
                    owner: {ownerLabel(card.ownerKey, market.userKey)} - launched at $
                    {card.launchUsd.toLocaleString('en-US')}
                  </p>
                  <p className="mt-2 font-mono text-sm text-white">
                    {formatEth(card.priceEth)}{' '}
                    {card.usd !== undefined && (
                      <span className="text-[11px] text-white/40">
                        (~${card.usd.toFixed(2)})
                      </span>
                    )}
                  </p>
                </div>
              </button>

              <div className="mt-3 flex flex-wrap gap-2">
                {!mine && (
                  <button
                    type="button"
                    className="btn btn-primary !px-4 !py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={market.mode === 'live' && !card.buyable}
                    onClick={() => void market.actions.buy(card.id)}
                  >
                    {market.mode === 'live' && !card.buyable ? 'Unlisted' : 'Buy'}
                  </button>
                )}
                {mine && (
                  <button
                    type="button"
                    className="btn btn-ghost !px-4 !py-2 text-xs"
                    disabled={market.busy !== null}
                    onClick={() => void market.actions.sell(card.id)}
                  >
                    {card.listedByUser ? 'Sell again' : 'Sell'}
                  </button>
                )}
                {mine && card.listedByUser && (
                  <button
                    type="button"
                    className="btn btn-ghost !px-4 !py-2 text-xs"
                    onClick={() => void market.actions.cancelListing(card.id)}
                  >
                    Unlist
                  </button>
                )}
                {!mine && hasCards && (
                  <button
                    type="button"
                    className="btn btn-ghost !px-4 !py-2 text-xs"
                    onClick={() => setTradeFor(tradeFor === card.id ? null : card.id)}
                  >
                    Trade
                  </button>
                )}
              </div>

              {tradeFor === card.id && giveCard && (
                <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
                  <p className="font-mono text-[11px] leading-relaxed text-white/60">
                    give {giveCard.name} for {card.name}
                    {delta !== 0 && (
                      <>
                        {' '}
                        {delta > 0 ? '+' : '-'} {formatEth(Math.abs(delta))}
                      </>
                    )}
                    {market.mode === 'live' && ' (opens a swap offer)'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary mt-2 w-full !px-3 !py-2 text-xs"
                    onClick={() => handleTrade(giveCard.id, card.id)}
                  >
                    {market.mode === 'live' ? 'Create swap offer' : 'Confirm trade'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
            isMine: market.myCards.some((c) => c.id === openCard.id),
          }}
          tradeOptions={tradeOptionsFor(openCard.id)}
          eth={market.eth}
          marketCap={market.marketCap}
          onBack={() => setOpenCardId(null)}
          onBuy={() => void market.actions.buy(openCard.id)}
          onSell={() => void market.actions.sell(openCard.id)}
          onTrade={(giveId, getId) => handleTrade(giveId, getId)}
        />
      )}
    </section>
  );
}
