import { useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatEther, formatUnits, parseAbiItem, type Address } from 'viem';
import { CONTRACTS, cardSwapAbi, milestoneCardsAbi } from './contracts';
import { targetChain } from './config';
import type { MarketEvent } from '../demo/events';

/**
 * Live-mode market actions: entering and leaving the airdrop draw on
 * MilestoneCards, plus CardSwap escrowed ETH listings (list, buy, unlist).
 * Also hosts the recent on-chain activity read. Every helper no-ops (throws)
 * until the contract addresses are configured in .env. Writes pin the target
 * chain so a wallet on another network switches (or fails loudly) instead of
 * sending Robinhood addresses to the wrong chain.
 */

export function useMarketWrites() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: targetChain.id });
  const { address } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<`0x${string}`>): Promise<void> {
    setBusy(label);
    setTxError(null);
    try {
      const hash = await fn();
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'transaction failed';
      setTxError(message);
      throw cause;
    } finally {
      setBusy(null);
    }
  }

  const requireSwap = () => {
    if (!CONTRACTS.swap) throw new Error('CardSwap address not configured');
    return CONTRACTS.swap;
  };

  const requireCards = () => {
    if (!CONTRACTS.cards) throw new Error('MilestoneCards address not configured');
    return CONTRACTS.cards;
  };

  /** Approve one tokenId for the escrow when not already approved. */
  const ensureApproval = async (tokenId: bigint): Promise<void> => {
    if (!publicClient || !address) return;
    const swap = requireSwap();
    const approved = (await publicClient.readContract({
      address: CONTRACTS.cards!,
      abi: milestoneCardsAbi,
      functionName: 'getApproved',
      args: [tokenId],
    })) as Address;
    const allApproved = (await publicClient.readContract({
      address: CONTRACTS.cards!,
      abi: milestoneCardsAbi,
      functionName: 'isApprovedForAll',
      args: [address as Address, swap],
    })) as boolean;
    if (approved === swap || allApproved) return;
    await run(
      `Approve card #${tokenId} for trading`,
      () =>
        writeContractAsync({
          address: CONTRACTS.cards!,
          abi: milestoneCardsAbi,
          functionName: 'approve',
          args: [swap, tokenId],
          chainId: targetChain.id,
        }),
    );
  };

  return {
    busy,
    txError,
    address,
    connected: Boolean(address),

    enterDraw: () =>
      run(
        'Entering the holder draw',
        () =>
          writeContractAsync({
            address: requireCards(),
            abi: milestoneCardsAbi,
            functionName: 'enterDraw',
            chainId: targetChain.id,
          }),
      ),

    leaveDraw: () =>
      run(
        'Leaving the holder draw',
        () =>
          writeContractAsync({
            address: requireCards(),
            abi: milestoneCardsAbi,
            functionName: 'leaveDraw',
            chainId: targetChain.id,
          }),
      ),

    buyListing: (tokenId: bigint, priceWei: bigint) =>
      run(
        `Buying card #${tokenId} from its holder`,
        () =>
          writeContractAsync({
            address: requireSwap(),
            abi: cardSwapAbi,
            functionName: 'buy',
            args: [tokenId],
            value: priceWei, // escrow charges exactly the listing price
            chainId: targetChain.id,
          }),
      ),

    listForSale: async (tokenId: bigint, priceWei: bigint) => {
      await ensureApproval(tokenId);
      await run(`Listing card #${tokenId} for sale`, () =>
        writeContractAsync({
          address: requireSwap(),
          abi: cardSwapAbi,
          functionName: 'list',
          args: [tokenId, priceWei],
          chainId: targetChain.id,
        }),
      );
    },

    cancelListing: (tokenId: bigint) =>
      run(`Unlisting card #${tokenId}`, () =>
        writeContractAsync({
          address: requireSwap(),
          abi: cardSwapAbi,
          functionName: 'cancelListing',
          args: [tokenId],
          chainId: targetChain.id,
        }),
      ),

    redeemCard: (tokenId: bigint) =>
      run(
        `Redeeming card #${tokenId} at its chart value`,
        () =>
          writeContractAsync({
            address: requireCards(),
            abi: milestoneCardsAbi,
            functionName: 'redeem',
            args: [tokenId],
            chainId: targetChain.id,
          }),
      ),
  };
}

const milestoneMintedEvent = parseAbiItem(
  'event MilestoneMinted(uint256 indexed index, uint256 indexed tokenId, uint256 marketCap, address indexed to)',
);
const saleSoldEvent = parseAbiItem(
  'event CardSold(uint256 indexed tokenId, address indexed buyer, uint256 price, uint256 marketCap)',
);
const swapSoldEvent = parseAbiItem(
  'event CardSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)',
);
const cardRedeemedEvent = parseAbiItem(
  'event CardRedeemed(uint256 indexed tokenId, address indexed holder, uint256 price)',
);

/** Recent airdrops and ETH sales from contract logs, newest first. */
export function useChainActivity(enabled: boolean) {
  const publicClient = usePublicClient({ chainId: targetChain.id });
  return useQuery({
    queryKey: ['chain-activity', CONTRACTS.cards, publicClient?.chain.id],
    enabled: enabled && Boolean(CONTRACTS.cards && publicClient),
    refetchInterval: 30_000,
    queryFn: async (): Promise<MarketEvent[]> => {
      const client = publicClient!;
      const latest = await client.getBlockNumber();
      const fromBlock = latest > 50_000n ? latest - 50_000n : 0n;

      const [mints, saleSales, swapSales, redemptions] = await Promise.all([
        client.getLogs({ address: CONTRACTS.cards!, event: milestoneMintedEvent, fromBlock, toBlock: 'latest' }),
        CONTRACTS.sale
          ? client.getLogs({ address: CONTRACTS.sale, event: saleSoldEvent, fromBlock, toBlock: 'latest' })
          : Promise.resolve([]),
        CONTRACTS.swap
          ? client.getLogs({ address: CONTRACTS.swap, event: swapSoldEvent, fromBlock, toBlock: 'latest' })
          : Promise.resolve([]),
        client.getLogs({ address: CONTRACTS.cards!, event: cardRedeemedEvent, fromBlock, toBlock: 'latest' }),
      ]);

      const blockNumbers = new Set<bigint>();
      for (const log of [...mints, ...saleSales, ...swapSales, ...redemptions]) {
        if (log.blockNumber) blockNumbers.add(log.blockNumber);
      }
      const timestamps = new Map<bigint, number>();
      await Promise.all(
        [...blockNumbers].map(async (number) => {
          const block = await client.getBlock({ blockNumber: number });
          timestamps.set(number, Number(block.timestamp) * 1000);
        }),
      );

      const events: MarketEvent[] = [];
      const ts = (log: { blockNumber?: bigint }) =>
        (log.blockNumber ? timestamps.get(log.blockNumber) : undefined) ?? Date.now();

      for (const log of mints) {
        events.push({
          id: `chain-mint-${log.transactionHash}-${log.logIndex}`,
          type: 'mint',
          ts: ts(log),
          accountKey: log.args.to ?? 'treasury',
          cardId: `card-${log.args.tokenId ?? 0n}`,
          priceEth: undefined,
        });
      }
      for (const log of saleSales) {
        events.push({
          id: `chain-sale-${log.transactionHash}-${log.logIndex}`,
          type: 'buy',
          ts: ts(log),
          accountKey: log.args.buyer ?? 'unknown',
          cardId: `card-${log.args.tokenId ?? 0n}`,
          priceEth: Number(formatUnits(log.args.price ?? 0n, 18)),
        });
      }
      for (const log of redemptions) {
        events.push({
          id: `chain-redeem-${log.transactionHash}-${log.logIndex}`,
          type: 'sell',
          ts: ts(log),
          accountKey: log.args.holder ?? 'unknown',
          cardId: `card-${log.args.tokenId ?? 0n}`,
          priceEth: Number(formatEther(log.args.price ?? 0n)),
        });
      }
      for (const log of swapSales) {
        events.push({
          id: `chain-swapsale-${log.transactionHash}-${log.logIndex}`,
          type: 'buy',
          ts: ts(log),
          accountKey: log.args.buyer ?? 'unknown',
          cardId: `card-${log.args.tokenId ?? 0n}`,
          priceEth: Number(formatEther(log.args.price ?? 0n)),
        });
      }

      return events.sort((a, b) => b.ts - a.ts);
    },
  });
}
