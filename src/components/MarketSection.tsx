import { useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { getCardImageUrl } from '../services/tcgdex';
import CardDetail from './CardDetail';
import { useTxConfirm } from './ConfirmTx';
import { useMarket, ownerLabel } from '../state/MarketProvider';
import { formatEth, formatPokePrice, pokeUsdPrice, referencePriceEth } from '../demo/market';

/**
 * The holder-draw market. Milestone cards airdrop free to drawn holders;
 * this section shows the open draw for the next slot plus every minted card
 * selling holder to holder. In demo mode it runs on the simulated
 * market-cap ticker and localStorage portfolio; once the contracts are
 * deployed and set in .env the same UI switches to on-chain draw entries,
 * ownership, and real CardSwap transactions. Live builds never fall back to
 * simulated data: a failed read shows an explicit error state.
 */
export default function MarketSection() {
  const market = useMarket();
  const { openConnectModal } = useConnectModal();
  const { confirm } = useTxConfirm();
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const connectWallet = () => openConnectModal?.();

  const live = market.mode === 'live';
  const cards = market.cards;
  const drawCard = cards.find((c) => !c.minted) ?? null;

  const openCard = openCardId
    ? cards.find((c) => c.id === openCardId) ?? null
    : null;

  /** Money actions in live mode confirm in-app before the wallet prompt. */
  const guardedBuy = async (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    if (live && market.isGuest) {
      connectWallet();
      return;
    }
    if (live) {
      const ok = await confirm({
        title: `Buy ${card.name}`,
        lines: [
          { label: 'price', value: formatEth(card.priceEth) },
          { label: 'royalty', value: '2.5% to the treasury' },
          { label: 'network', value: 'Robinhood Chain' },
        ],
        actionLabel: 'Buy',
      });
      if (!ok) return;
    }
    await market.actions.buy(id);
  };

  const guardedSell = async (id: string, priceEth: number) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    if (live) {
      const ok = await confirm({
        title: card.listedByUser ? `Re-list ${card.name}` : `List ${card.name}`,
        lines: [
          { label: 'asking price', value: formatEth(priceEth) },
          { label: 'escrow', value: 'card locks until sold or unlisted' },
          { label: 'royalty on sale', value: '2.5% to the treasury' },
        ],
        actionLabel: card.listedByUser ? 'Re-list' : 'List',
      });
      if (!ok) return;
    }
    await market.actions.sell(id);
  };

  const enterDraw = async () => {
    if (live && market.isGuest) {
      connectWallet();
      return;
    }
    await market.draw.enter();
  };

  const ticker = (
    <div className="flex items-center gap-2.5 font-mono text-xs text-white/50">
      <span className="status-dot animate-pulse" aria-hidden />
      <span>
        {live
          ? `cap $${market.marketCap.toLocaleString('en-US')} - POKE ${formatPokePrice(pokeUsdPrice(market.marketCap))}`
          : `cap $${market.marketCap.toLocaleString('en-US')} - POKE ${formatPokePrice(pokeUsdPrice(market.marketCap))} (sim)`}
      </span>
      {live ? <span className="chip chip-up">Live</span> : <span className="chip chip-neutral">Demo</span>}
    </div>
  );

  // guests get the connect modal from the click handler; only a wrong-network
  // wallet hard-blocks the money buttons
  const writesBlocked = live && !market.live.chainOk;

  return (
    <section id="demo" className="scroll-mt-10 border-t border-white/10 pb-16 pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">The market</p>
          <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            The draw, then holder to holder
          </h2>
        </div>
        {ticker}
      </div>

      {live && market.live.status === 'error' && (
        <div className="panel mb-6 flex flex-wrap items-center justify-between gap-3 border-red-400/30 px-5 py-3 font-mono text-xs text-red-400/90">
          <span>
            market data unavailable - the contracts did not answer. trading is
            paused until they do; nothing here is simulated.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}
      {live && market.live.status === 'connecting' && (
        <div className="panel mb-6 px-5 py-3 font-mono text-xs text-white/55">
          reading the chain...
        </div>
      )}
      {live && !market.isGuest && !market.live.chainOk && (
        <div className="panel mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-400/30 px-5 py-3 font-mono text-xs text-amber-400/90">
          <span>wrong network - POKE and the cards live on Robinhood Chain</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={market.switchChain}>
            Switch network
          </button>
        </div>
      )}

      <div className="panel mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3 font-mono text-xs text-white/55">
        <span>
          balance: <span className="text-white">{formatEth(market.eth)}</span>
        </span>
        <span className="sm:border-l sm:border-white/10 sm:pl-8">
          your cards: <span className="text-white">{market.myCards.length}</span>
        </span>
        <span className="sm:border-l sm:border-white/10 sm:pl-8">
          in the draw:{' '}
          <span className={market.draw.entered ? 'text-[#00bd7d]' : 'text-white'}>
            {market.draw.entered ? 'yes' : 'no'}
          </span>
        </span>
        <span className="sm:border-l sm:border-white/10 sm:pl-8">
          network:{' '}
          <span className="text-white">
            Robinhood Chain{live ? '' : ' (demo)'}
          </span>
        </span>
        {!live && market.isGuest && (
          <span className="text-amber-400/85">
            connect your wallet to keep a persistent demo portfolio
          </span>
        )}
        {market.notice && <span className="w-full text-[#00bd7d]">{market.notice}</span>}
        {market.busy && <span className="w-full text-amber-400/90">{market.busy}...</span>}
        {market.txError && (
          <span className="w-full break-words text-red-400/90">{market.txError.slice(0, 180)}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {drawCard && market.draw.open && (
          <DrawTile onEnter={enterDraw} />
        )}
        {cards
          .filter((c) => c.minted)
          .map((card) => {
            const mine = market.myCards.some((c) => c.id === card.id);
            const sellReference =
              card.chartEth ?? referencePriceEth(card.launchUsd, market.marketCap);

            return (
              <article key={card.id} className="panel relative flex flex-col p-4">
                {mine && (
                  <span className="chip chip-solid absolute right-3 top-3 z-10">Yours</span>
                )}
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

                  <div className="mt-3">
                    <p className="truncate text-sm font-semibold">{card.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-white/40">
                      {ownerLabel(card.ownerKey, market.userKey)} - airdropped at $
                      {card.launchUsd.toLocaleString('en-US')}
                    </p>
                    <p className="mt-2 font-mono text-sm text-white">
                      {card.priceEth > 0 ? (
                        <>
                          {formatEth(card.priceEth)}{' '}
                          {card.usd !== undefined && (
                            <span className="text-[11px] text-white/40">
                              (~${card.usd.toFixed(2)})
                            </span>
                          )}
                        </>
                      ) : live ? (
                        <span className="text-[11px] text-white/40">
                          {card.chartEth !== undefined
                            ? `chart value ${formatEth(card.chartEth)}`
                            : 'chart value settling'}
                        </span>
                      ) : (
                        <span className="text-[11px] text-white/40">
                          chart value {formatEth(referencePriceEth(card.launchUsd, market.marketCap))}
                        </span>
                      )}
                    </p>
                  </div>
                </button>

                <div className="mt-auto pt-3">
                  <div className="flex flex-wrap gap-2">
                    {!mine && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!card.buyable || market.busy !== null || writesBlocked}
                        onClick={() => void guardedBuy(card.id)}
                      >
                        {card.buyable ? 'Buy' : 'Unlisted'}
                      </button>
                    )}
                    {mine && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={market.busy !== null || writesBlocked}
                        onClick={() => void guardedSell(card.id, sellReference)}
                      >
                        {card.listedByUser ? 'Sell again' : 'Sell'}
                      </button>
                    )}
                    {mine && card.listedByUser && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={market.busy !== null}
                        onClick={() => void market.actions.cancelListing(card.id)}
                      >
                        Unlist
                      </button>
                    )}
                  </div>
                </div>
              </article>
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
          marketCap={market.marketCap}
          chartValueEth={openCard.chartEth ?? (live ? undefined : referencePriceEth(openCard.launchUsd, market.marketCap))}
          onBack={() => setOpenCardId(null)}
          onBuy={() => void guardedBuy(openCard.id)}
          onSell={() => void guardedSell(openCard.id, openCard.chartEth ?? referencePriceEth(openCard.launchUsd, market.marketCap))}
          onRedeem={() => void guardedRedeem(openCard.id)}
        />
      )}
    </section>
  );

  async function guardedRedeem(id: string) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    if (live) {
      const ok = await confirm({
        title: `Redeem ${card.name}`,
        lines: [
          { label: 'payout', value: card.chartEth !== undefined ? formatEth(card.chartEth) : 'chart value (set on chain)' },
          { label: 'burns the card', value: 'one of one, gone after this' },
          { label: 'network', value: 'Robinhood Chain' },
        ],
        actionLabel: 'Redeem',
      });
      if (!ok) return;
    }
    await market.actions.redeem(id);
  }
}

/**
 * The open draw for the next ladder slot: art, entry state, and the one
 * rule that matters - hold POKE when the cap crosses.
 */
function DrawTile({ onEnter }: { onEnter: () => Promise<void> }) {
  const market = useMarket();
  const draw = market.draw;
  const nextCard = market.cards.find((c) => !c.minted);
  const art = market.artFor(nextCard?.tcgId);
  const name = art?.name ?? `Milestone Card #${String(nextCard?.tokenId ?? 0).padStart(2, '0')}`;

  return (
    <article className="panel relative flex flex-col border-[#00bd7d]/40 p-4">
      <span className="chip chip-up absolute right-3 top-3 z-10">Draw open</span>
      <div className="overflow-hidden rounded-[6px] border border-white/12">
        {art?.image ? (
          <img
            src={getCardImageUrl({ image: art.image })}
            alt={name}
            className="aspect-[245/342] w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="aspect-[245/342] w-full animate-pulse bg-white/[0.04]" />
        )}
      </div>

      <div className="mt-3">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="mt-1 font-mono text-[11px] text-white/40">
          {nextCard
            ? `airdrops free at $${nextCard.launchUsd.toLocaleString('en-US')} cap`
            : 'every milestone has airdropped'}
        </p>
        <p className="mt-2 font-mono text-sm text-white">
          {draw.entrantCount} holder{draw.entrantCount === 1 ? '' : 's'} in the draw
        </p>
      </div>

      <div className="mt-auto pt-3">
        {draw.entered ? (
          <div className="flex flex-wrap gap-2">
            <span className="chip chip-solid h-8 items-center">You are in</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={market.busy !== null}
              onClick={() => void draw.leave()}
            >
              Leave draw
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm w-full"
            disabled={market.busy !== null || (market.mode === 'live' && !market.live.chainOk)}
            onClick={() => void onEnter()}
          >
            Enter the draw - free
          </button>
        )}
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-white/45">
          one entry per wallet - winners must still hold POKE when the cap
          crosses
        </p>
      </div>
    </article>
  );
}
