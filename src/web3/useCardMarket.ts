import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, cardSwapAbi, milestoneCardsAbi, priceOracleAbi } from './contracts';
import { targetChain } from './config';
import { MILESTONES } from '../constants/ladder';

export interface SwapListing {
  seller: string;
  priceWei: bigint;
}

export interface ChainCard {
  tokenId: number;
  thresholdUsd: number;
  thresholdWei: bigint;
  minted: boolean;
  owner?: string;
  /** Peer-to-peer escrow listing (CardSwap); the only way cards change hands for ETH. */
  swapListing?: SwapListing;
  /** On-chain chart value in wei (aged cap x base / launch); undefined while no checkpoint has aged. */
  chartPriceWei?: bigint;
}

const MAX_SLOTS = MILESTONES.length;
const LIVE_READY = Boolean(CONTRACTS.cards && CONTRACTS.oracle && CONTRACTS.swap);

/**
 * On-chain state for every milestone slot: threshold, minted flag, current
 * owner, any escrow CardSwap listing, and the on-chain chart value, plus the
 * oracle market cap and the contract's treasury address (the airdrop fallback
 * recipient). Nothing runs until the contract addresses are set in .env;
 * before that the demo market powers the UI. Every read is pinned to the
 * target chain so a wallet sitting on another network cannot steer contract
 * reads to the wrong RPC.
 */
export function useCardMarket() {
  const calls = useMemo(() => {
    if (!LIVE_READY) return [];
    const list = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const tokenId = BigInt(i + 1);
      list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'milestoneAt', args: [BigInt(i)], chainId: targetChain.id });
      list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'ownerOf', args: [tokenId], chainId: targetChain.id });
      list.push({ address: CONTRACTS.swap!, abi: cardSwapAbi, functionName: 'listings', args: [tokenId], chainId: targetChain.id });
      list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'chartPriceOf', args: [tokenId], chainId: targetChain.id });
    }
    list.push({ address: CONTRACTS.oracle!, abi: priceOracleAbi, functionName: 'marketCap', chainId: targetChain.id });
    list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'owner', chainId: targetChain.id });
    return list;
  }, []);

  const query = useReadContracts({
    contracts: calls,
    query: { enabled: LIVE_READY, refetchInterval: 15_000 },
  });

  const cards: ChainCard[] = useMemo(() => {
    if (!LIVE_READY) return [];
    const out: ChainCard[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const base = i * 4;
      const milestone = query.data?.[base];
      const owner = query.data?.[base + 1];
      const swapListing = query.data?.[base + 2];
      const chartPrice = query.data?.[base + 3];
      if (milestone?.status !== 'success') continue;
      const [thresholdWei, minted] = milestone.result as unknown as [bigint, boolean];
      // listings() returns the Listing struct decoded as { seller, priceWei }
      const listing =
        swapListing?.status === 'success'
          ? (swapListing.result as unknown as { seller: string; priceWei: bigint })
          : undefined;
      out.push({
        tokenId: i + 1,
        thresholdWei,
        thresholdUsd: Number(formatUnits(thresholdWei, 18)),
        minted,
        owner: owner?.status === 'success' ? (owner.result as string) : undefined,
        swapListing:
          listing && listing.seller !== '0x0000000000000000000000000000000000000000'
            ? { seller: listing.seller, priceWei: listing.priceWei }
            : undefined,
        // reverts ChartNotReady until the keeper's first cap checkpoint ages
        chartPriceWei: chartPrice?.status === 'success' ? (chartPrice.result as bigint) : undefined,
      });
    }
    return out;
  }, [query.data]);

  const marketCapWei = useMemo(() => {
    const entry = query.data?.[MAX_SLOTS * 4];
    return entry?.status === 'success' ? (entry.result as bigint) : undefined;
  }, [query.data]);

  /** MilestoneCards owner: the treasury and airdrop fallback recipient. */
  const treasury = useMemo(() => {
    const entry = query.data?.[MAX_SLOTS * 4 + 1];
    return entry?.status === 'success' ? (entry.result as string) : undefined;
  }, [query.data]);

  return { cards, marketCapWei, treasury, ready: LIVE_READY, isLoading: query.isLoading };
}
