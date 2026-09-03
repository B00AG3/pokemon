import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { formatUnits, type ContractFunctionParameters } from 'viem';
import { CONTRACTS, cardSaleAbi, cardSwapAbi, milestoneCardsAbi, priceOracleAbi } from './contracts';
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
  /** Treasury sale listing (CardSale). */
  saleListed: boolean;
  salePriceWei?: bigint;
  /** Peer-to-peer escrow listing (CardSwap). */
  swapListing?: SwapListing;
}

const MAX_SLOTS = MILESTONES.length;
const LIVE_READY = Boolean(CONTRACTS.cards && CONTRACTS.oracle && CONTRACTS.sale && CONTRACTS.swap);

/**
 * On-chain state for every milestone slot: threshold, minted flag, current
 * owner, treasury listing (CardSale), escrow listing (CardSwap), plus the
 * oracle market cap and sale base price. Nothing runs until the contract
 * addresses are set in .env; before that the demo market powers the UI.
 */
export function useCardMarket() {
  const calls = useMemo<readonly ContractFunctionParameters[]>(() => {
    if (!LIVE_READY) return [];
    const list: ContractFunctionParameters[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const tokenId = BigInt(i + 1);
      list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'milestoneAt', args: [BigInt(i)] });
      list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'ownerOf', args: [tokenId] });
      list.push({ address: CONTRACTS.sale!, abi: cardSaleAbi, functionName: 'isListed', args: [tokenId] });
      list.push({ address: CONTRACTS.sale!, abi: cardSaleAbi, functionName: 'priceOf', args: [tokenId] });
      list.push({ address: CONTRACTS.swap!, abi: cardSwapAbi, functionName: 'listings', args: [tokenId] });
    }
    list.push({ address: CONTRACTS.oracle!, abi: priceOracleAbi, functionName: 'marketCap' });
    list.push({ address: CONTRACTS.sale!, abi: cardSaleAbi, functionName: 'basePriceWei' });
    list.push({ address: CONTRACTS.cards!, abi: milestoneCardsAbi, functionName: 'owner' });
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
      const base = i * 5;
      const milestone = query.data?.[base];
      const owner = query.data?.[base + 1];
      const saleListed = query.data?.[base + 2];
      const salePrice = query.data?.[base + 3];
      const swapListing = query.data?.[base + 4];
      if (milestone?.status !== 'success') continue;
      const [thresholdWei, minted] = milestone.result as [bigint, boolean];
      const listed = saleListed?.status === 'success' && (saleListed.result as boolean);
      // listings() returns the Listing struct decoded as { seller, priceWei }
      const listing =
        swapListing?.status === 'success'
          ? (swapListing.result as { seller: string; priceWei: bigint })
          : undefined;
      out.push({
        tokenId: i + 1,
        thresholdWei,
        thresholdUsd: Number(formatUnits(thresholdWei, 18)),
        minted,
        owner: owner?.status === 'success' ? (owner.result as string) : undefined,
        saleListed: Boolean(listed),
        salePriceWei: listed && salePrice?.status === 'success' ? (salePrice.result as bigint) : undefined,
        swapListing:
          listing && listing.seller !== '0x0000000000000000000000000000000000000000'
            ? { seller: listing.seller, priceWei: listing.priceWei }
            : undefined,
      });
    }
    return out;
  }, [query.data]);

  const marketCapWei = useMemo(() => {
    const entry = query.data?.[MAX_SLOTS * 5];
    return entry?.status === 'success' ? (entry.result as bigint) : undefined;
  }, [query.data]);

  const basePriceWei = useMemo(() => {
    const entry = query.data?.[MAX_SLOTS * 5 + 1];
    return entry?.status === 'success' ? (entry.result as bigint) : undefined;
  }, [query.data]);

  /** MilestoneCards owner: the treasury that receives sale proceeds. */
  const treasury = useMemo(() => {
    const entry = query.data?.[MAX_SLOTS * 5 + 2];
    return entry?.status === 'success' ? (entry.result as string) : undefined;
  }, [query.data]);

  return { cards, marketCapWei, basePriceWei, treasury, ready: LIVE_READY, isLoading: query.isLoading };
}
