import { useReadContract } from 'wagmi';
import { CONTRACTS, milestoneCardsAbi, priceOracleAbi } from './contracts';

/**
 * Live milestone state for the hero and the future gallery: current market
 * cap, which milestone is next, and how many cards have minted. All reads
 * disable themselves until contract addresses are set in .env.
 */
export function useMilestoneState() {
  const cardsReady = Boolean(CONTRACTS.cards);
  const oracleReady = Boolean(CONTRACTS.oracle);

  const marketCap = useReadContract({
    address: CONTRACTS.oracle,
    abi: priceOracleAbi,
    functionName: 'marketCap',
    query: { enabled: oracleReady },
  });

  const nextMilestone = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'nextMilestone',
    query: { enabled: cardsReady },
  });

  const totalMinted = useReadContract({
    address: CONTRACTS.cards,
    abi: milestoneCardsAbi,
    functionName: 'totalMinted',
    query: { enabled: cardsReady },
  });

  return {
    marketCap: (marketCap.data ?? undefined) as bigint | undefined,
    nextMilestone: (nextMilestone.data ?? undefined) as
      | { index: bigint; marketCap: bigint }
      | undefined,
    totalMinted: (totalMinted.data ?? undefined) as bigint | undefined,
    isLoading: marketCap.isLoading || nextMilestone.isLoading,
    ready: cardsReady && oracleReady,
  };
}
