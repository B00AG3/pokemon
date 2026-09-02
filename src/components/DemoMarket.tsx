import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { getCardById, getCardImageUrl } from '../services/tcgdex';
import CardDetail from './CardDetail';
import {
  DEMO_CARDS,
  ETH_USD,
  formatEth,
  pokeUsdPrice,
  priceEth,
} from '../demo/market';
import { useDemoMarket } from '../demo/useDemoMarket';
import { useDemoPortfolio } from '../demo/useDemoPortfolio';

interface DemoArt {
  tcgId: string;
  name: string;
  image?: string;
  setName?: string;
  rarity?: string;
  tcgDescription?: string;
}

function ownerLabel(owner: string): string {
  if (owner === 'treasury') return 'Treasury';
  if (owner === 'npc-1') return 'Trader 1';
  if (owner === 'npc-2') return 'Trader 2';
  return 'You';
}

/**
 * Buy / sell / trade preview on a simulated market. Prices move with a fake
 * market-cap ticker using the exact mechanic the contracts implement
 * (price = basePrice x marketCap / launchCap), and balances live in
 * localStorage - no real ETH moves until the contracts deploy.
 */
export default function DemoMarket() {
  const { address, isConnected } = useAccount();
  const marketCap = useDemoMarket();
  const portfolio = useDemoPortfolio(address);
  const [art, setArt] = useState<Record<string, DemoArt>>({});
  const [tradeFor, setTradeFor] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(
      DEMO_CARDS.map((card) =>
        getCardById(card.tcgId).catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      const map: Record<string, DemoArt> = {};
      results.forEach((card, i) => {
        if (card) {
          map[DEMO_CARDS[i].id] = {
            tcgId: card.id,
            name: card.name,
            image: card.image,
            setName: card.set?.name,
            rarity: card.rarity,
            tcgDescription: card.description,
          };
        }
      });
      setArt(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  const userKey = address ?? 'guest';

  const cards = useMemo(
    () =>
      DEMO_CARDS.map((demo) => {
        const price = priceEth(demo, marketCap);
        return {
          ...demo,
          ...art[demo.id],
          name: art[demo.id]?.name ?? `Test Card #${demo.id.slice(-1)}`,
          image: art[demo.id]?.image,
          price,
          usd: price * ETH_USD,
          owner: portfolio.ownerOf(demo.id),
        };
      }),
    [art, marketCap, portfolio],
  );

  const openCard = openCardId
    ? cards.find((c) => c.id === openCardId) ?? null
    : null;

  const tradeOptionsFor = (targetId: string) => {
    const target = cards.find((c) => c.id === targetId);
    if (!target) return [];
    // acquiring this card: you give one of your other cards.
    // selling/trading this card away: you receive one of the other cards.
    const source = target.owner === userKey
      ? cards.filter((c) => c.id !== targetId)
      : portfolio.myCards
          .map((id) => cards.find((c) => c.id === id))
          .filter((c): c is (typeof cards)[number] => Boolean(c) && c!.id !== targetId);
    return source.map((c) => ({ id: c.id, name: c.name, image: c.image, price: c.price }));
  };

  const handleBuy = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId)!;
    if (portfolio.eth < card.price) {
      setStatus('Not enough demo ETH');
      return;
    }
    portfolio.buy(cardId, card.price);
    setStatus(`Bought ${card.name} for ${formatEth(card.price)}`);
    setTimeout(() => setStatus(null), 2500);
  };

  const handleSell = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId)!;
    portfolio.sell(cardId, card.price);
    setStatus(`Sold ${card.name} for ${formatEth(card.price)}`);
    setTimeout(() => setStatus(null), 2500);
  };

  const handleTrade = (giveCardId: string, getCardId: string) => {
    const give = cards.find((c) => c.id === giveCardId)!;
    const get = cards.find((c) => c.id === getCardId)!;
    const delta = Math.round((get.price - give.price) * 1000) / 1000;
    if (delta > 0 && portfolio.eth < delta) {
      setStatus('Not enough demo ETH for the swap');
      return;
    }
    portfolio.trade(giveCardId, getCardId, delta);
    setTradeFor(null);
    setStatus(
      delta === 0
        ? `Traded ${give.name} for ${get.name}`
        : delta > 0
          ? `Traded ${give.name} + ${formatEth(delta)} for ${get.name}`
          : `Traded ${give.name} for ${get.name} + ${formatEth(-delta)}`,
    );
    setTimeout(() => setStatus(null), 2500);
  };

  return (
    <section id="demo" className="scroll-mt-10 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">02 / Market</p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Buy, sell, trade
          </h2>
          <p className="mt-1.5 text-sm text-white/45">
            tap a card to open it
          </p>
        </div>
        <div className="flex items-center gap-2.5 font-mono text-xs text-white/45">
          <span className="status-dot animate-pulse" aria-hidden />
          <span>
            market cap ${marketCap.toLocaleString('en-US')} - POKE $
            {pokeUsdPrice(marketCap).toFixed(4)}
          </span>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 font-mono text-xs text-white/60">
        <span>
          demo balance: <span className="text-white">{formatEth(portfolio.eth)}</span>
        </span>
        <span>
          your cards: <span className="text-white">{portfolio.myCards.length}</span>
        </span>
        <span>
          network: <span className="text-white">Robinhood Chain</span>
        </span>
        {!isConnected && (
          <span className="text-amber-300/80">
            connect your wallet to keep a persistent demo portfolio
          </span>
        )}
        {status && <span className="text-[#00bd7d]">{status}</span>}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {cards.map((card) => {
          const mine = card.owner === userKey;
          const hasCards = portfolio.myCards.length > 0;
          const tradeGive = tradeFor === card.id && hasCards ? portfolio.myCards[0] : null;
          const giveCard = tradeGive ? cards.find((c) => c.id === tradeGive) : null;
          const delta =
            giveCard && tradeGive
              ? Math.round((card.price - giveCard.price) * 1000) / 1000
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
                    owner: {ownerLabel(card.owner)} - launched at $
                    {card.launchMc.toLocaleString('en-US')}
                  </p>
                  <p className="mt-2 font-mono text-sm text-white">
                    {formatEth(card.price)}{' '}
                    <span className="text-[11px] text-white/40">(~${card.usd.toFixed(2)})</span>
                  </p>
                </div>
              </button>

              <div className="mt-3 flex flex-wrap gap-2">
                {!mine && (
                  <button
                    type="button"
                    className="btn btn-primary !px-4 !py-2 text-xs"
                    onClick={() => handleBuy(card.id)}
                  >
                    Buy
                  </button>
                )}
                {mine && (
                  <button
                    type="button"
                    className="btn btn-ghost !px-4 !py-2 text-xs"
                    onClick={() => handleSell(card.id)}
                  >
                    Sell
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

              {tradeFor === card.id && giveCard && delta !== undefined && (
                <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
                  <p className="font-mono text-[11px] leading-relaxed text-white/60">
                    give {giveCard.name} for {card.name}
                    {delta !== 0 && (
                      <>
                        {' '}
                        {delta > 0 ? '+' : '-'} {formatEth(Math.abs(delta))}
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary mt-2 w-full !px-3 !py-2 text-xs"
                    onClick={() => handleTrade(tradeGive!, card.id)}
                  >
                    Confirm trade
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
            cardNumber: Number(openCard.id.slice(-1)),
            name: openCard.name,
            image: openCard.image,
            setName: openCard.setName,
            rarity: openCard.rarity,
            tcgDescription: openCard.tcgDescription,
            launchMc: openCard.launchMc,
            price: openCard.price,
            ownerLabel: ownerLabel(openCard.owner),
            isMine: openCard.owner === userKey,
          }}
          tradeOptions={tradeOptionsFor(openCard.id)}
          eth={portfolio.eth}
          marketCap={marketCap}
          onBack={() => setOpenCardId(null)}
          onBuy={() => handleBuy(openCard.id)}
          onSell={() => handleSell(openCard.id)}
          onTrade={(giveId, getId) => {
            const give = cards.find((c) => c.id === giveId);
            const get = cards.find((c) => c.id === getId);
            if (!give || !get) return;
            const delta = Math.round((get.price - give.price) * 1000) / 1000;
            portfolio.trade(giveId, getId, delta);
            setOpenCardId(null);
            setStatus(`Traded ${give.name} for ${get.name}`);
            setTimeout(() => setStatus(null), 2500);
          }}
        />
      )}
    </section>
  );
}
