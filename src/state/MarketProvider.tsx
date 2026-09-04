import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAccount, useBalance, useSwitchChain } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { formatEther, maxUint256, parseEther } from 'viem';
import { getCardById } from '../services/pokemontcg';
import { DEMO_CARDS, ETH_USD, priceEth } from '../demo/market';
import { useDemoMarket } from '../demo/useDemoMarket';
import { useDemoPortfolio } from '../demo/useDemoPortfolio';
import { useDemoDraw } from '../demo/useDemoDraw';
import { useDemoEvents } from '../demo/useDemoEvents';
import type { MarketEvent } from '../demo/events';
import { useMilestoneState } from '../web3/useMilestoneState';
import { useCardMarket, type ChainCard } from '../web3/useCardMarket';
import { useMarketWrites, useChainActivity } from '../web3/useMarketWrites';
import { LIVE_MODE } from '../web3/contracts';
import { targetChain } from '../web3/config';
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
  priceWei?: bigint; // exact live listing price for buys (undefined when unlisted)
  usd?: number; // demo fiat reference
  ownerKey: string;
  minted: boolean;
  buyable: boolean;
  listedByUser?: boolean; // live: the user's escrow listing on CardSwap
  listingPriceEth?: number; // live: the user's asking price
  /** On-chain chart value the contract pays on redeem (aged cap x base / launch). */
  chartEth?: number;
  name: string;
  image?: string;
  setName?: string;
  rarity?: string;
  description?: string;
}

interface DrawApi {
  /** False once every milestone has airdropped. */
  open: boolean;
  entered: boolean;
  entrantCount: number;
  enter: () => Promise<void>;
  leave: () => Promise<void>;
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
    /**
     * 'off' = demo build (no contracts configured). 'connecting' = contracts
     * configured, first read in flight. 'ready' = on-chain data flowing.
     * 'error' = contracts configured but reads failed or returned nothing;
     * the UI must say so instead of quietly showing demo data.
     */
    status: 'off' | 'connecting' | 'ready' | 'error';
    capUsd?: number;
    nextMilestone?: { index: number; usd: number };
    totalMinted?: number;
    /** False when a connected wallet sits on a chain other than the target. */
    chainOk: boolean;
  };
  /** Ask a connected wallet to switch to the target chain. */
  switchChain: () => void;
  cards: MarketCard[];
  myCards: MarketCard[];
  eth: number;
  isGuest: boolean;
  realizedEth?: number;
  costOf: (id: string) => number | undefined;
  /** Artwork lookup by TCGdex id (works for un-minted ladder slots too). */
  artFor: (tcgId: string | null | undefined) => CardArt | undefined;
  activity: MarketEvent[];
  busy: string | null;
  txError: string | null;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  draw: DrawApi;
  actions: {
    buy: (id: string) => Promise<void>;
    sell: (id: string) => Promise<void>;
    redeem: (id: string) => Promise<void>;
    listForSale: (id: string, priceEth: number) => Promise<void>;
    cancelListing: (id: string) => Promise<void>;
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
  if (ownerKey === 'npc-3') return 'Trader 3';
  if (ownerKey === 'guest') return 'Guest';
  if (ownerKey === 'none') return 'Unminted';
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
  const { address, chain: connectedChain } = useAccount();
  const queryClient = useQueryClient();
  const { switchChain } = useSwitchChain();
  // the simulated ticker only runs when the demo market actually powers the UI
  const demoCap = useDemoMarket(1200, !LIVE_MODE);
  const live = useMilestoneState(address);
  const chain = useCardMarket();
  const portfolio = useDemoPortfolio(address);
  const demoDraw = useDemoDraw(address);
  const { events, record } = useDemoEvents();
  const writes = useMarketWrites();
  const chainActivity = useChainActivity(LIVE_MODE);
  const balance = useBalance({ address, chainId: targetChain.id });

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
  // Live readiness is strict: once contracts are configured, a failed or
  // empty read is an error state, never a reason to show simulated prices.
  const liveStatus: MarketApi['live']['status'] = !LIVE_MODE
    ? 'off'
    : chain.cards.length > 0
      ? 'ready'
      : chain.isLoading
        ? 'connecting'
        : 'error';
  const liveReady = liveStatus === 'ready';
  // reads only need the target chain; writes additionally require a
  // connected wallet to already be on it (or to accept the switch prompt)
  const chainOk =
    !LIVE_MODE || !address || !connectedChain || connectedChain.id === targetChain.id;

  // ---------- demo airdrop: settle the draw when the cap crosses ----------

  useEffect(() => {
    if (LIVE_MODE) return;
    if (demoDraw.winner) return;
    if (demoCap < DEMO_CARDS[DEMO_CARDS.length - 1].launchMc) return;
    const winner = demoDraw.settle();
    if (!winner) return;
    portfolio.claimAirdrop('demo-4', winner);
    record({ type: 'mint', accountKey: winner, cardId: 'demo-4' });
    flash(
      winner === userKey
        ? 'You won the draw - card #04 airdropped to you'
        : `Card #04 airdropped to ${ownerLabel(winner, userKey)}`,
      setNotice,
    );
  }, [liveReady, demoCap, demoDraw, portfolio, record, userKey]);

  const demoCards = useMemo<MarketCard[]>(
    () =>
      DEMO_CARDS.map((demo, i) => {
        const price = priceEth(demo, demoCap);
        const artInfo = art[demo.tcgId];
        const holder = portfolio.ownerOf(demo.id);
        const minted = i < DEMO_CARDS.length - 1 || holder !== 'treasury';
        const owner = minted ? holder : 'none';
        return {
          id: demo.id,
          tokenId: i + 1,
          tcgId: demo.tcgId,
          launchUsd: demo.launchMc,
          priceEth: price,
          usd: price * ETH_USD,
          ownerKey: owner,
          minted,
          buyable: minted && !isMine(owner, address),
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
    return chain.cards.map((chainCard) => buildLiveCard(chainCard, art, address, chain.treasury));
  }, [liveReady, chain.cards, chain.treasury, art, address]);

  // Demo data exists only in demo builds. In a live build a failed read shows
  // an explicit error state; fabricated prices must never stand in for chain
  // data at launch.
  const cards = liveStatus === 'off' ? demoCards : liveCards;

  // "treasury" is a display label for the MilestoneCards owner; when the
  // connected wallet IS the treasury (testnet deployer), its cards are mine
  const treasuryIsMe =
    Boolean(address) &&
    Boolean(chain.treasury) &&
    chain.treasury?.toLowerCase() === address?.toLowerCase();

  const myCards = useMemo(
    () =>
      cards.filter(
        (c) => isMine(c.ownerKey, address) || (c.ownerKey === 'treasury' && treasuryIsMe),
      ),
    [cards, address, treasuryIsMe],
  );

  const activity: MarketEvent[] = liveStatus === 'off' ? events : (chainActivity.data ?? []);

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

  // ---------- draw ----------

  const liveDraw: DrawApi = useMemo(
    () => ({
      open: live.nextMilestone !== undefined && live.nextMilestone.index !== maxUint256,
      entered: live.hasEntered ?? false,
      entrantCount: live.entrantCount ?? 0,
      enter: async () => {
        try {
          await writes.enterDraw();
          done('You are in the draw - hold POKE to stay eligible');
        } catch {
          /* txError carries the failure */
        }
      },
      leave: async () => {
        try {
          await writes.leaveDraw();
          done('You left the airdrop draw');
        } catch {
          /* txError carries the failure */
        }
      },
    }),
    [live.nextMilestone, live.hasEntered, live.entrantCount, writes, done],
  );

  const demoDrawApi: DrawApi = useMemo(
    () => ({
      open: !demoDraw.winner,
      entered: demoDraw.entered,
      entrantCount: demoDraw.entrantCount,
      enter: async () => {
        demoDraw.enter();
        done('You are in the draw - card #04 airdrops when the cap hits $50,000');
      },
      leave: async () => {
        demoDraw.leave();
        done('You left the airdrop draw');
      },
    }),
    [demoDraw, done],
  );

  const draw: DrawApi = LIVE_MODE ? liveDraw : demoDrawApi;

  // ---------- demo actions ----------

  const demoBuy = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      if (!card.minted) {
        flash('This card airdrops to the draw winner - enter the draw instead', setNotice);
        return;
      }
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

  // ---------- live actions ----------

  const liveBuy = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      try {
        if (card.priceWei) {
          await writes.buyListing(BigInt(card.tokenId), card.priceWei);
        } else {
          flash(`${card.name} is not listed - check back once the holder names a price`, setNotice);
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
        if (card.listedByUser) {
          // the card sits in CardSwap escrow: pull it back before re-listing
          // at the new price (list() would revert as a non-owner)
          await writes.cancelListing(BigInt(card.tokenId));
        }
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

  const liveRedeem = useCallback(
    async (id: string) => {
      const card = cardById(id);
      if (!card) return;
      try {
        await writes.redeemCard(BigInt(card.tokenId));
        done(`Redeemed ${card.name} for its chart value`);
      } catch {
        /* txError carries the failure */
      }
    },
    [cardById, writes, done],
  );

  const notLive = useCallback(
    async () => flash('Live trading activates with the contract deploy', setNotice),
    [],
  );

  // Live caps read 0 until the pool is seeded; show the real number (or 0),
  // never the demo ticker, once contracts are configured
  const liveCapUsd =
    live.marketCap !== undefined ? Number(live.marketCap) / 1e18 : liveStatus === 'off' ? demoCap : 0;
  const displayCap = liveStatus === 'off' ? demoCap : liveCapUsd;

  /** Listing reference: the on-chain chart value (what redeem pays), falling
   * back to the same formula computed from the live cap and the contract's
   * base price while the first cap checkpoint is still aging. */
  const sellReferenceEth = useCallback(
    (card: MarketCard) =>
      card.chartEth ??
      ((live.redeemBaseEth ?? 0.01) * Math.max(displayCap, 1)) / card.launchUsd,
    [live.redeemBaseEth, displayCap],
  );

  const value: MarketApi = {
    mode: liveStatus === 'off' ? 'demo' : 'live',
    marketCap: displayCap,
    demoCap,
    userKey,
    live: {
      ready: liveReady,
      status: liveStatus,
      capUsd: live.marketCap !== undefined ? liveCapUsd : undefined,
      nextMilestone:
        live.nextMilestone !== undefined
          ? {
              index: Number(live.nextMilestone.index),
              usd: Number(live.nextMilestone.marketCap) / 1e18,
            }
          : undefined,
      totalMinted: live.totalMinted !== undefined ? Number(live.totalMinted) : undefined,
      chainOk,
    },
    switchChain: () => switchChain({ chainId: targetChain.id }),
    cards,
    myCards,
    eth,
    isGuest: !address,
    realizedEth: liveStatus === 'off' ? portfolio.realized : undefined,
    costOf: (id) => (liveStatus === 'off' ? portfolio.costOf(id) : undefined),
    artFor: (tcgId) => (tcgId ? art[tcgId] : undefined),
    activity,
    busy: writes.busy,
    txError: writes.txError,
    notice,
    setNotice,
    draw,
    actions: {
      buy: LIVE_MODE ? liveBuy : demoBuy,
      // in live mode "sell" lists the card on CardSwap at the on-chain chart
      // value (agedCap x base / launchCap); sellers can re-list at any price
      sell: LIVE_MODE
        ? async (id) => {
            const card = cardById(id);
            if (!card) return;
            await liveList(id, sellReferenceEth(card));
          }
        : demoSell,
      // redeem sells the card back to the protocol at its chart value
      // (demo: the simulated market pays the same formula price)
      redeem: LIVE_MODE ? liveRedeem : demoSell,
      listForSale: LIVE_MODE ? liveList : notLive,
      cancelListing: LIVE_MODE ? liveCancel : async () => undefined,
    },
  };

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

/**
 * Live-mode card view built from chain reads plus TCGdex art. Milestone
 * cards airdrop to drawn holders, so a price exists only when a holder has
 * escrow-listed the card on CardSwap; everything else is unlisted until a
 * holder names a price.
 */
function buildLiveCard(
  chainCard: ChainCard,
  art: Record<string, CardArt>,
  address: string | undefined,
  treasury: string | undefined,
): MarketCard {
  const artInfo = art[LADDER_TCG_IDS[chainCard.tokenId - 1] ?? ''];
  // an un-minted slot has no owner; escrowed listings belong to the swap
  // contract but the seller is the real party; the treasury is the fallback
  const ownerKey = !chainCard.minted
    ? 'none'
    : chainCard.swapListing
      ? chainCard.swapListing.seller
      : treasury && chainCard.owner?.toLowerCase() === treasury.toLowerCase()
        ? 'treasury'
        : chainCard.owner ?? 'unknown';

  const listedByMe =
    chainCard.swapListing !== undefined &&
    Boolean(address) &&
    chainCard.swapListing.seller.toLowerCase() === address?.toLowerCase();

  const priceEth = chainCard.swapListing
    ? Number(formatEther(chainCard.swapListing.priceWei))
    : 0;
  const priceWei = chainCard.swapListing?.priceWei;

  return {
    id: `card-${chainCard.tokenId}`,
    tokenId: chainCard.tokenId,
    tcgId: LADDER_TCG_IDS[chainCard.tokenId - 1] ?? '',
    launchUsd: chainCard.thresholdUsd,
    priceEth,
    priceWei,
    ownerKey,
    minted: chainCard.minted,
    buyable: chainCard.minted && chainCard.swapListing !== undefined,
    listedByUser: listedByMe,
    listingPriceEth: chainCard.swapListing ? Number(formatEther(chainCard.swapListing.priceWei)) : undefined,
    chartEth: chainCard.chartPriceWei !== undefined ? Number(formatEther(chainCard.chartPriceWei)) : undefined,
    name: artInfo?.name ?? `Milestone Card #${String(chainCard.tokenId).padStart(2, '0')}`,
    image: artInfo?.image,
    setName: artInfo?.setName,
    rarity: artInfo?.rarity,
    description: artInfo?.description,
  };
}
