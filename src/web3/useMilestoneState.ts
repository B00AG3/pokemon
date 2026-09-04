import { useBalance, useReadContract } from 'wagmi';
import { CONTRACTS, milestoneCardsAbi, priceOracleAbi } from './contracts';
import { targetChain } from './config';

const REFRESH_MS = 15_000;

/**
 * Live milestone state for the hero, ticker, and roadmap: current market cap,
 * which milestone is next, how many cards have minted, and the airdrop draw
 * (entrant count plus whether a wallet has entered). Reads disable themselves
 * until contract addresses are set in .env, pin to the target chain, and
 * refresh on an interval so an open tab keeps ticking instead of freezing on
 * the first load.
 */
export function useMilestoneState(address?: string) {
  const cardsReady = Boolean(CONTRACTS.cards);
  const oracleReady = Boolean(CONTRACTS.oracle);

  const marketCap = useReadContract({
    address: CONTRACTS.oracle,
    abi: priceOracleAbi,
    functionName: 'marketCap',
    chainId: targetChain.id,
    query: { enabled: oracleReady, refetchInterval: REFRESH_MS },
  });

  const nextMilestone = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'nextMilestone',
    chainId: targetChain.id,
    query: { enabled: cardsReady, refetchInterval: REFRESH_MS },
  });

  const totalMinted = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'totalMinted',
    chainId: targetChain.id,
    query: { enabled: cardsReady, refetchInterval: REFRESH_MS },
  });

  const entrantCount = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'entrantCount',
    chainId: targetChain.id,
    query: { enabled: cardsReady, refetchInterval: REFRESH_MS },
  });

  const entered = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'isEntered',
    args: address ? ([address as `0x${string}`] as const) : undefined,
    chainId: targetChain.id,
    query: { enabled: cardsReady && Boolean(address), refetchInterval: REFRESH_MS },
  });

  const redeemBasePrice = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'redeemBasePrice',
    chainId: targetChain.id,
    query: { enabled: cardsReady },
  });

  const pool = useBalance({ address: CONTRACTS.cards, chainId: targetChain.id });

  return {
    marketCap: (marketCap.data ?? undefined) as bigint | undefined,
    nextMilestone: (nextMilestone.data ?? undefined) as
      | { index: bigint; marketCap: bigint }
      | undefined,
    totalMinted: (totalMinted.data ?? undefined) as bigint | undefined,
    /** Wallets currently in the standing airdrop draw. */
    entrantCount: entrantCount.data !== undefined ? Number(entrantCount.data) : undefined,
    hasEntered: address ? (entered.data ?? undefined) : undefined,
    /** ETH base for chart-value redemptions (price = base x cap / launch). */
    redeemBaseEth: redeemBasePrice.data !== undefined ? Number(redeemBasePrice.data) / 1e18 : undefined,
    /** ETH sitting in the on-chain redemption pool. */
    poolEth: pool.data ? Number(pool.data.formatted) : undefined,
    isLoading: marketCap.isLoading || nextMilestone.isLoading,
    ready: cardsReady && oracleReady,
  };
}
