import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAccount, useBalance } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { formatEther, parseEther } from 'viem';
import { getCardById } from '../services/tcgdex';
import { DEMO_CARDS, ETH_USD, priceEth } from '../demo/market';
import { useDemoMarket } from '../demo/useDemoMarket';
import { useDemoPortfolio } from '../demo/useDemoPortfolio';
import { useDemoEvents } from '../demo/useDemoEvents';
import type { MarketEvent } from '../demo/events';
import { useMilestoneState } from '../web3/useMilestoneState';
import { useCardMarket, type ChainCard } from '../web3/useCardMarket';
import { useMarketWrites, useSwapOffers, useChainActivity } from '../web3/useMarketWrites';
import { LIVE_MODE } from '../web3/contracts';
import { LADDER_TCG_IDS } from '../constants/ladder';

export interface CardArt {
  name: string;
  image?: string;
  setName?: string;
  rarity?: string;
  description?: string;
}

export interface MarketCard {
  id: string; // demo id ('demo-1') in demo mode, 'card-<tokenId>' in live mode
  tokenId: number; // 1-based milestone number
  tcgId: string;
  launchUsd: number;
  priceEth: number;
  priceWei?: bigint; // exact live price for buys (undefined when unlisted)
  usd?: number; // demo fiat reference
  ownerKey: string;
  minted: boolean;
  buyable: boolean;
  listedByUser?: boolean; // live: the user's escrow listing on CardSwap
  listingPriceEth?: number; // live: the user's asking price
  name: string;
  image?: string;
  setName?: string;
  rarity?: string;
  description?: string;
}

export interface SwapOffer {
  offerId: number;
  maker: string;
  giveTokenId: number;
  wantTokenId: number;
  ethAskEth: number;
}

interface MarketApi {
  mode: 'demo' | 'live';
  /** Display cap: live on-chain cap when available, else the demo ticker. */
  marketCap: number;
  demoCap: number;
  /** 'guest' or the connected wallet address. */
  userKey: string;
  live: {
    ready: boolean;
    capUsd?: number;
    nextMilestone?: { index: number; usd: number };
    totalMinted?: number;
  };
  cards: MarketCard[];
  myCards: MarketCard[];
  eth: number;
  isGuest: boolean;
  realizedEth?: number;
  costOf: (id: string) => number | undefined;
  /** Artwork lookup by TCGdex id (works for un-minted ladder slots too). */
  artFor: (tcgId: string | null | undefined) => CardArt | undefined;
  offers: SwapOffer[];
  incomingOffers: SwapOffer[];
  outgoingOffers: SwapOffer[];
  activity: MarketEvent[];
  busy: string | null;
  txError: string | null;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  actions: {
    buy: (id: string) => Promise<void>;
    sell: (id: string) => Promise<void>;
    trade: (giveId: string, getId: string) => Promise<void>;
    listForSale: (id: string, priceEth: number) => Promise<void>;
    cancelListing: (id: string) => Promise<void>;
    createSwapOffer: (giveId: string, getId: string, ethAskEth: number) => Promise<void>;
    acceptSwap: (offerId: number) => Promise<void>;
    cancelSwap: (offerId: number) => Promise<void>;
  };
}

const MarketContext = createContext<MarketApi | null>(null);

export function useMarket(): MarketApi {
  const value = useContext(MarketContext);
  if (!value) throw new Error('useMarket must be used inside MarketProvider');
  return value;
}

/** Human label for a card owner key (demo accounts or wallet addresses). */
export function ownerLabel(ownerKey: string, userKey?: string): string {
  if (ownerKey === 'treasury') return 'Treasury';
  if (ownerKey === 'npc-1') return 'Trader 1';
  if (ownerKey === 'npc-2') return 'Trader 2';
  if (ownerKey === 'guest') return 'Guest';
  if (userKey && ownerKey.toLowerCase() === userKey.toLowerCase()) return 'You';
  if (ownerKey.startsWith('0x')) return `${ownerKey.slice(0, 6)}...${ownerKey.slice(-4)}`;
  return 'Unknown';
}

function flash(notice: string, setNotice: (n: string | null) => void) {
  setNotice(notice);
  setTimeout(() => setNotice(null), 3200);
}

function isMine(ownerKey: string, address?: string): boolean {
  if (!address) return ownerKey === 'guest';
  return ownerKey.toLowerCase() === address.toLowerCase();
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const demoCap = useDemoMarket();
  const live = useMilestoneState();
  const chain = useCardMarket();
  const portfolio = useDemoPortfolio(address);
  const { events, record } = useDemoEvents();
  const writes = useMarketWrites();
  const offersQuery = useSwapOffers(LIVE_MODE);
  const chainActivity = useChainActivity(LIVE_MODE);
  const balance = useBalance({ address });

  const [notice, setNotice] = useState<string | null>(null);
  const [art, setArt] = useState<Record<string, CardArt>>({});

  const tcgIds = useMemo(
    () => [...new Set([...DEMO_CARDS.map((c) => c.tcgId), ...LADDER_TCG_IDS])],
    [],
  );

  useEffect(() => {
    let alive = true;
    Promise.all(tcgIds.map((id) => getCardById(id).catch(() => null))).then((results) => {
      if (!alive) return;
      const map: Record<string, CardArt> = {};
      results.forEach((card, i) => {
        if (card) {
          map[tcgIds[i]] = {
            name: card.name,
            image: card.image,
            setName: card.set?.name,
            rarity: card.rarity,
            description: card.description,
          };
        }
      });
      setArt(map);
    });
    return () => {
      alive = false;
    };
  }, [tcgIds]);

  const userKey = address ?? 'guest';
  const liveReady = LIVE_MODE && chain.ready && chain.cards.length > 0;

  const demoCards = useMemo<MarketCard[]>(
    () =>
      DEMO_CARDS.map((demo, i) => {
        const price = priceEth(demo, demoCap);
        const artInfo = art[demo.tcgId];
        const owner = portfolio.ownerOf(demo.id);
        return {
          id: demo.id,
          tokenId: i + 1,
          tcgId: demo.tcgId,
          launchUsd: demo.launchMc,
          priceEth: price,
          usd: price * ETH_USD,
          ownerKey: owner,
          minted: true,
          buyable: !isMine(owner, address),
          name: artInfo?.name ?? `Test Card #${i + 1}`,
          image: artInfo?.image,
          setName: artInfo?.setName,
          rarity: artInfo?.rarity,
          description: artInfo?.description,
        };
      }),
    [art, demoCap, portfolio, address],
  );

  const liveCards = useMemo<MarketCard[]>(() => {
    if (!liveReady) return [];
    return chain.cards
      .filter((c) => c.minted)
      .map((chainCard) =>
        buildLiveCard(chainCard, art, address, chain.marketCapWei, chain.basePriceWei, chain.treasury),
      );
  }, [liveReady, chain.cards, chain.marketCapWei, chain.basePriceWei, chain.treasury, art, address]);

  const cards = liveReady ? liveCards : demoCards;

  const myCards = useMemo(() => cards.filter((c) => isMine(c.ownerKey, address)), [cards, address]);

  const offers = useMemo<SwapOffer[]>(
    () =>
      (offersQuery.data ?? [])
        .filter((o) => o.active)
        .map((o) => ({
          offerId: o.offerId,
          maker: o.maker,
          giveTokenId: o.giveTokenId,
          wantTokenId: o.wantTokenId,
          ethAskEth: o.ethAskEth,
        })),
    [offersQuery.data],
  );

  const incomingOffers = useMemo(
    () =>
      offers.filter(
        (o) =>
          myCards.some((c) => c.tokenId === o.wantTokenId) &&
          !isMine(o.maker, address),
      ),
    [offers, myCards, address],
  );

  const outgoingOffers = useMemo(
    () => offers.filter((o) => isMine(o.maker, address)),
    [offers, address],
  );

  const activity: MarketEvent[] = liveReady ? (chainActivity.data ?? []) : events;

  const cardById = useCallback((id: string) => cards.find((c) => c.id === id), [cards]);

  // without a connected wallet there is no live balance to show
  const eth = liveReady
    ? balance.data
      ? Number(formatEther(balance.data.value))
      : 0
    : portfolio.eth;

  const done = useCallback(
    (message: string) => {
      flash(message, setNotice);
      if (LIVE_MODE) void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  // ---------- demo actions ----------

  const demoBuy = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      if (portfolio.eth < card.priceEth) {
        flash('Not enough demo ETH', setNotice);
        return;
      }
      portfolio.buy(id, card.priceEth);
      record({ type: 'buy', accountKey: userKey, cardId: id, priceEth: card.priceEth });
      done(`Bought ${card.name} for ${card.priceEth.toFixed(3)} ETH`);
    },
    [cardById, portfolio, record, userKey, done],
  );

  const demoSell = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      portfolio.sell(id, card.priceEth);
      record({ type: 'sell', accountKey: userKey, cardId: id, priceEth: card.priceEth });
      done(`Sold ${card.name} for ${card.priceEth.toFixed(3)} ETH`);
    },
    [cardById, portfolio, record, userKey, done],
  );

  const demoTrade = useCallback(
    async (giveId: string, getId: string) => {
      const give = cardById(giveId);
      const get = cardById(getId);
      if (!give || !get) return;
      const delta = Math.round((get.priceEth - give.priceEth) * 1000) / 1000;
      if (delta > 0 && portfolio.eth < delta) {
        flash('Not enough demo ETH for the swap', setNotice);
        return;
      }
      portfolio.trade(giveId, getId, delta, give.priceEth);
      record({
        type: 'trade',
        accountKey: userKey,
        giveCardId: giveId,
        getCardId: getId,
        priceEth: delta,
      });
      done(`Traded ${give.name} for ${get.name}`);
    },
    [cardById, portfolio, record, userKey, done],
  );

  // ---------- live actions ----------

  const liveBuy = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      try {
        if (card.priceWei) {
          await writes.buyFromSale(BigInt(card.tokenId), card.priceWei);
        } else if (card.listingPriceEth) {
          await writes.buyListing(BigInt(card.tokenId), parseEther(card.listingPriceEth.toFixed(18)));
        } else {
          flash(`${card.name} is not listed for sale`, setNotice);
          return;
        }
        done(`Bought ${card.name}`);
      } catch {
        /* txError carries the failure */
      }
    },
    [cardById, writes, done],
  );

  const liveList = useCallback(
    async (id: string, priceEth: number) => {
      const card = cardById(id);
      if (!card || !(priceEth > 0)) return;
      try {
        await writes.listForSale(BigInt(card.tokenId), parseEther(priceEth.toFixed(18)));
        done(`Listed ${card.name} for ${priceEth.toFixed(3)} ETH`);
      } catch {
        /* txError carries the failure */
      }
    },
    [cardById, writes, done],
  );

  const liveCancel = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      try {
        await writes.cancelListing(BigInt(card.tokenId));
        done(`Unlisted ${card.name}`);
      } catch {
        /* txError carries the failure */
      }
    },
    [cardById, writes, done],
  );

  const liveOffer = useCallback(
    async (giveId: string, getId: string, ethAskEth: number) => {
      const give = cardById(giveId);
      const get = cardById(getId);
      if (!give || !get) return;
      try {
        await writes.createSwapOffer(
          BigInt(give.tokenId),
          BigInt(get.tokenId),
          parseEther(String(ethAskEth)),
        );
        done(`Offered ${give.name} for ${get.name}`);
      } catch {
        /* txError carries the failure */
      }
    },
    [cardById, writes, done],
  );

  const liveAccept = useCallback(
    async (offerId: number) => {
      const offer = offers.find((o) => o.offerId === offerId);
      if (!offer) return;
      const want = cardById(`card-${offer.wantTokenId}`);
      if (!want) return;
      try {
        await writes.acceptSwapOffer(
          offerId,
          BigInt(offer.wantTokenId),
          parseEther(String(offer.ethAskEth)),
        );
        done(`Swap accepted: received card #${offer.giveTokenId}`);
      } catch {
        /* txError carries the failure */
      }
    },
    [offers, cardById, writes, done],
  );

  const liveCancelSwap = useCallback(
    async (offerId: number) => {
      try {
        await writes.cancelSwapOffer(offerId);
        done('Swap offer cancelled');
      } catch {
        /* txError carries the failure */
      }
    },
    [writes, done],
  );

  const notLive = useCallback(
    async () => flash('Live trading activates with the contract deploy', setNotice),
    [],
  );

  const value: MarketApi = {
    mode: liveReady ? 'live' : 'demo',
    marketCap: liveReady && live.marketCap ? Number(live.marketCap) / 1e18 : demoCap,
    demoCap,
    userKey,
    live: {
      ready: liveReady,
      capUsd: live.marketCap !== undefined ? Number(live.marketCap) / 1e18 : undefined,
      nextMilestone:
        live.nextMilestone !== undefined
          ? {
              index: Number(live.nextMilestone.index),
              usd: Number(live.nextMilestone.marketCap) / 1e18,
            }
          : undefined,
      totalMinted: live.totalMinted !== undefined ? Number(live.totalMinted) : undefined,
    },
    cards,
    myCards,
    eth,
    isGuest: !address,
    realizedEth: liveReady ? undefined : portfolio.realized,
    costOf: (id) => (liveReady ? undefined : portfolio.costOf(id)),
    artFor: (tcgId) => (tcgId ? art[tcgId] : undefined),
    offers,
    incomingOffers,
    outgoingOffers,
    activity,
    busy: writes.busy,
    txError: writes.txError,
    notice,
    setNotice,
    actions: {
      buy: liveReady ? liveBuy : demoBuy,
      // in live mode "sell" lists the card on CardSwap at its dynamic price
      sell: liveReady
        ? async (id) => {
            const card = cardById(id);
            if (card) await liveList(id, card.priceEth);
          }
        : demoSell,
      // in live mode "trade" opens a card-for-card swap offer
      trade: liveReady
        ? async (giveId, getId) => liveOffer(giveId, getId, 0)
        : demoTrade,
      listForSale: liveReady ? liveList : notLive,
      cancelListing: liveReady ? liveCancel : async () => undefined,
      createSwapOffer: liveReady ? liveOffer : notLive,
      acceptSwap: liveReady ? liveAccept : async () => undefined,
      cancelSwap: liveReady ? liveCancelSwap : async () => undefined,
    },
  };

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

/**
 * Live-mode card view built from chain reads plus TCGdex art. Price shown is
 * the treasury sale price when listed, the holder's escrow price on CardSwap
 * otherwise, and the sale formula estimate as a last resort.
 */
function buildLiveCard(
  chainCard: ChainCard,
  art: Record<string, CardArt>,
  address: string | undefined,
  marketCapWei: bigint | undefined,
  basePriceWei: bigint | undefined,
  treasury: string | undefined,
): MarketCard {
  const artInfo = art[LADDER_TCG_IDS[chainCard.tokenId - 1] ?? ''];
  // the treasury is the MilestoneCards owner; label it cleanly
  const ownerKey =
    treasury && chainCard.owner?.toLowerCase() === treasury.toLowerCase()
      ? 'treasury'
      : chainCard.owner ?? 'unknown';
  const listedByMe =
    chainCard.swapListing !== undefined &&
    Boolean(address) &&
    chainCard.swapListing.seller.toLowerCase() === address?.toLowerCase();

  const priceOf = (value: bigint | undefined): number => (value === undefined ? 0 : Number(formatEther(value)));
  let priceEth = 0;
  let priceWei: bigint | undefined;
  if (chainCard.saleListed && chainCard.salePriceWei !== undefined) {
    priceWei = chainCard.salePriceWei;
    priceEth = priceOf(priceWei);
  } else if (chainCard.swapListing) {
    priceWei = chainCard.swapListing.priceWei;
    priceEth = priceOf(priceWei);
  } else if (marketCapWei !== undefined && basePriceWei !== undefined) {
    const threshold = chainCard.thresholdWei > 0n ? chainCard.thresholdWei : 1n;
    priceEth = priceOf((basePriceWei * marketCapWei) / threshold);
  }

  return {
    id: `card-${chainCard.tokenId}`,
    tokenId: chainCard.tokenId,
    tcgId: LADDER_TCG_IDS[chainCard.tokenId - 1] ?? '',
    launchUsd: chainCard.thresholdUsd,
    priceEth,
    priceWei,
    ownerKey,
    minted: chainCard.minted,
    buyable: chainCard.saleListed || chainCard.swapListing !== undefined,
    listedByUser: listedByMe,
    listingPriceEth: chainCard.swapListing ? priceOf(chainCard.swapListing.priceWei) : undefined,
    name: artInfo?.name ?? `Milestone Card #${String(chainCard.tokenId).padStart(2, '0')}`,
    image: artInfo?.image,
    setName: artInfo?.setName,
    rarity: artInfo?.rarity,
    description: artInfo?.description,
  };
}
