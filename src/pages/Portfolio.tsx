import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { getCardImageUrl } from '../services/tcgdex';
import CardDetail from '../components/CardDetail';
import { useTxConfirm } from '../components/ConfirmTx';
import { useMarket, ownerLabel } from '../state/MarketProvider';
import { formatEth, referencePriceEth } from '../demo/market';

function signed(value: number, digits = 3): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`;
}

export default function Portfolio() {
  const market = useMarket();
  const { openConnectModal } = useConnectModal();
  const { confirm } = useTxConfirm();
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const live = market.mode === 'live';
  const holdingsValue = market.myCards.reduce((sum, c) => sum + c.priceEth, 0);
  const totalCost = market.myCards.reduce(
    (sum, c) => sum + (market.costOf(c.id) ?? c.priceEth),
    0,
  );
  const unrealized = market.realizedEth === undefined ? undefined : holdingsValue - totalCost;
  const realized = market.realizedEth;

  const openCard = openCardId ? market.cards.find((c) => c.id === openCardId) ?? null : null;
  const hasCards = market.myCards.length > 0;

  /** Live listings confirm price + escrow before the wallet prompt. */
  const guardedSell = async (id: string) => {
    const card = market.cards.find((c) => c.id === id);
    if (!card) return;
    if (live && market.isGuest) {
      openConnectModal?.();
      return;
    }
    if (live) {
      const reference = card.chartEth ?? referencePriceEth(card.launchUsd, market.marketCap);
      const ok = await confirm({
        title: card.listedByUser ? `Re-list ${card.name}` : `List ${card.name}`,
        lines: [
          { label: 'asking price', value: formatEth(reference) },
          { label: 'escrow', value: 'card locks until sold or unlisted' },
          { label: 'royalty on sale', value: '2.5% to the treasury' },
        ],
        actionLabel: card.listedByUser ? 'Re-list' : 'List',
      });
      if (!ok) return;
    }
    await market.actions.sell(id);
  };

  return (
    <section className="pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your collection</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Portfolio
          </h1>
        </div>
        {!live && <span className="chip chip-neutral">Demo portfolio</span>}
      </div>

      {live && market.live.status === 'error' && (
        <div className="mb-6 rounded-[4px] border border-red-400/30 bg-red-400/5 px-5 py-3 font-mono text-xs text-red-400/90">
          market data unavailable - the contracts did not answer. nothing here
          is simulated; retry once the chain responds.
        </div>
      )}
      {live && !market.isGuest && !market.live.chainOk && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-amber-400/30 bg-amber-400/5 px-5 py-3 font-mono text-xs text-amber-400/90">
          <span>wrong network - POKE and the cards live on Robinhood Chain</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={market.switchChain}>
            Switch network
          </button>
        </div>
      )}

      {market.isGuest && !live && (
        <div className="mb-6 rounded-[4px] border border-amber-400/20 bg-amber-400/5 px-5 py-3 font-mono text-xs text-amber-400/85">
          connect your wallet to keep a portfolio - guests share a scratch
          account
        </div>
      )}

      <dl className="panel mb-8 grid grid-cols-2 gap-y-6 p-5 sm:grid-cols-4 sm:gap-y-0 lg:divide-x lg:divide-white/10">
        <div className="lg:pr-6">
          <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
            balance
          </dt>
          <dd className="mt-2 font-mono text-lg text-white">{formatEth(market.eth)}</dd>
        </div>
        <div className="lg:px-6">
          <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
            holdings value
          </dt>
          <dd className="mt-2 font-mono text-lg text-white">{formatEth(holdingsValue)}</dd>
        </div>
        <div className="lg:px-6">
          <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
            unrealized
          </dt>
          <dd
            className={`mt-2 font-mono text-lg ${
              unrealized === undefined
                ? 'text-white/40'
                : unrealized >= 0
                  ? 'text-[#00bd7d]'
                  : 'text-red-400'
            }`}
          >
            {unrealized === undefined ? '-' : `${signed(unrealized)} ETH`}
          </dd>
        </div>
        <div className="lg:pl-6">
          <dt className="font-mono text-[10px] tracking-[0.08em] text-white/40">
            realized
          </dt>
          <dd
            className={`mt-2 font-mono text-lg ${
              realized === undefined
                ? 'text-white/40'
                : realized >= 0
                  ? 'text-[#00bd7d]'
                  : 'text-red-400'
            }`}
          >
            {realized === undefined ? '-' : `${signed(realized)} ETH`}
          </dd>
        </div>
      </dl>

      {market.notice && (
        <p className="mb-4 font-mono text-xs text-[#00bd7d]">{market.notice}</p>
      )}
      {market.busy && (
        <p className="mb-4 font-mono text-xs text-amber-400/90">{market.busy}...</p>
      )}
      {market.txError && (
        <p className="mb-4 font-mono text-xs text-red-400/90">
          {market.txError.slice(0, 180)}
        </p>
      )}

      {/* owned cards */}
      <h2 className="font-display text-xl font-medium tracking-tight">
        Your cards
      </h2>
      {!hasCards ? (
        <div className="panel mt-4 p-8 text-center">
          <p className="text-sm text-white/60">
            Nothing here yet. Enter the draw on the market page and hold POKE -
            winning cards arrive free.
          </p>
          <Link to="/" className="btn btn-primary mt-5">
            Enter the draw
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {market.myCards.map((card) => {
            const cost = market.costOf(card.id);
            const pnl = cost === undefined ? undefined : card.priceEth - cost;
            return (
              <article key={card.id} className="panel card-lift flex flex-col p-4">
                <button
                  type="button"
                  className="block w-full cursor-pointer text-left"
                  onClick={() => setOpenCardId(card.id)}
                  aria-label={`Open ${card.name}`}
                >
                  <div className="overflow-hidden rounded-[6px] border border-white/12 transition hover:border-white/30">
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
                  <p className="mt-1 font-mono text-[11px] text-white/40">
                    card #{String(card.tokenId).padStart(2, '0')} - owner:{' '}
                    {ownerLabel(card.ownerKey, market.userKey)}
                  </p>
                </button>

                <div className="mt-2 font-mono text-[11px] text-white/50">
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

                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={market.busy !== null || (live && !market.live.chainOk)}
                    onClick={() => void guardedSell(card.id)}
                  >
                    {card.listedByUser ? 'Sell again' : 'Sell'}
                  </button>
                  {card.listedByUser && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void market.actions.cancelListing(card.id)}
                    >
                      Unlist
                    </button>
                  )}
                </div>
              </article>
            );
          })}
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
          marketCap={market.marketCap}
          chartValueEth={
            openCard.chartEth ?? (live ? undefined : referencePriceEth(openCard.launchUsd, market.marketCap))
          }
          onBack={() => setOpenCardId(null)}
          onBuy={() => undefined}
          onSell={() => void guardedSell(openCard.id)}
          onRedeem={() => void market.actions.redeem(openCard.id)}
        />
      )}
    </section>
  );
}
