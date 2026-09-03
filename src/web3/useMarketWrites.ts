import { useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatEther, formatUnits, parseAbiItem, type Address } from 'viem';
import { CONTRACTS, cardSaleAbi, cardSwapAbi, milestoneCardsAbi } from './contracts';
import type { MarketEvent } from '../demo/events';

/**
 * Live-mode market actions against CardSale (treasury buys) and CardSwap
 * (peer-to-peer listings and card-for-card swaps), plus reads for open swap
 * offers and recent on-chain activity. Every helper no-ops (throws) until
 * the contract addresses are configured in .env.
 */

export interface SwapOfferView {
  offerId: number;
  maker: string;
  giveTokenId: number;
  wantTokenId: number;
  ethAskEth: number;
  active: boolean;
}

const MAX_OFFERS_SCANNED = 64;

export function useMarketWrites() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
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

  /** Approve one tokenId for the swap escrow when not already approved. */
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
        }),
    );
  };

  return {
    busy,
    txError,
    address,
    connected: Boolean(address),

    buyFromSale: (tokenId: bigint, priceWei: bigint) =>
      run(
        `Buying card #${tokenId} from the treasury`,
        () =>
          writeContractAsync({
            address: CONTRACTS.sale!,
            abi: cardSaleAbi,
            functionName: 'buy',
            args: [tokenId],
            // 5% buffer over the dynamic price; the contract refunds excess
            value: (priceWei * 105n) / 100n,
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
            value: (priceWei * 105n) / 100n,
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
        }),
      ),

    createSwapOffer: async (giveTokenId: bigint, wantTokenId: bigint, ethAskWei: bigint) => {
      await ensureApproval(giveTokenId);
      await run('Creating swap offer', () =>
        writeContractAsync({
          address: requireSwap(),
          abi: cardSwapAbi,
          functionName: 'offerSwap',
          args: [giveTokenId, wantTokenId, ethAskWei],
        }),
      );
    },

    cancelSwapOffer: (offerId: number) =>
      run('Cancelling swap offer', () =>
        writeContractAsync({
          address: requireSwap(),
          abi: cardSwapAbi,
          functionName: 'cancelSwap',
          args: [BigInt(offerId)],
        }),
      ),

    acceptSwapOffer: async (offerId: number, wantTokenId: bigint, ethAskWei: bigint) => {
      await ensureApproval(wantTokenId);
      await run('Accepting swap offer', () =>
        writeContractAsync({
          address: requireSwap(),
          abi: cardSwapAbi,
          functionName: 'acceptSwap',
          args: [BigInt(offerId)],
          value: ethAskWei > 0n ? (ethAskWei * 105n) / 100n : undefined,
        }),
      );
    },
  };
}

/** Open (and recently finished) swap offers on CardSwap. */
export function useSwapOffers(enabled: boolean) {
  const publicClient = usePublicClient();
  return useQuery({
    queryKey: ['swap-offers', CONTRACTS.swap, publicClient?.chain.id],
    enabled: enabled && Boolean(CONTRACTS.swap && publicClient),
    refetchInterval: 15_000,
    queryFn: async (): Promise<SwapOfferView[]> => {
      const swap = CONTRACTS.swap!;
      const count = Number(
        (await publicClient!.readContract({ address: swap, abi: cardSwapAbi, functionName: 'offerCount' })) as bigint,
      );
      const scanned = Math.min(count, MAX_OFFERS_SCANNED);
      const offers: SwapOfferView[] = [];
      for (let i = 0; i < scanned; i++) {
        const raw = (await publicClient!.readContract({
          address: swap,
          abi: cardSwapAbi,
          functionName: 'offers',
          args: [BigInt(i)],
        })) as { maker: string; giveTokenId: bigint; wantTokenId: bigint; ethAsk: bigint; active: boolean };
        offers.push({
          offerId: i,
          maker: raw.maker,
          giveTokenId: Number(raw.giveTokenId),
          wantTokenId: Number(raw.wantTokenId),
          ethAskEth: Number(formatEther(raw.ethAsk)),
          active: raw.active,
        });
      }
      return offers;
    },
  });
}

const milestoneMintedEvent = parseAbiItem(
  'event MilestoneMinted(uint256 indexed index, uint256 indexed tokenId, uint256 marketCap)',
);
const saleSoldEvent = parseAbiItem(
  'event CardSold(uint256 indexed tokenId, address indexed buyer, uint256 price, uint256 marketCap)',
);
const swapSoldEvent = parseAbiItem(
  'event CardSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)',
);
const swapOfferedEvent = parseAbiItem(
  'event SwapOffered(uint256 indexed offerId, address indexed maker, uint256 giveTokenId, uint256 wantTokenId, uint256 ethAsk)',
);
const swapAcceptedEvent = parseAbiItem(
  'event SwapAccepted(uint256 indexed offerId, address indexed taker)',
);

/** Recent mints, sales, and swaps from contract logs, newest first. */
export function useChainActivity(enabled: boolean) {
  const publicClient = usePublicClient();
  return useQuery({
    queryKey: ['chain-activity', CONTRACTS.cards, publicClient?.chain.id],
    enabled: enabled && Boolean(CONTRACTS.cards && publicClient),
    refetchInterval: 30_000,
    queryFn: async (): Promise<MarketEvent[]> => {
      const client = publicClient!;
      const latest = await client.getBlockNumber();
      const fromBlock = latest > 50_000n ? latest - 50_000n : 0n;

      const [mints, saleSales, swapSales, offered, accepted] = await Promise.all([
        client.getLogs({ address: CONTRACTS.cards!, event: milestoneMintedEvent, fromBlock, toBlock: 'latest' }),
        CONTRACTS.sale
          ? client.getLogs({ address: CONTRACTS.sale, event: saleSoldEvent, fromBlock, toBlock: 'latest' })
          : Promise.resolve([]),
        CONTRACTS.swap
          ? client.getLogs({ address: CONTRACTS.swap, event: swapSoldEvent, fromBlock, toBlock: 'latest' })
          : Promise.resolve([]),
        CONTRACTS.swap
          ? client.getLogs({ address: CONTRACTS.swap, event: swapOfferedEvent, fromBlock, toBlock: 'latest' })
          : Promise.resolve([]),
        CONTRACTS.swap
          ? client.getLogs({ address: CONTRACTS.swap, event: swapAcceptedEvent, fromBlock, toBlock: 'latest' })
          : Promise.resolve([]),
      ]);

      const blockNumbers = new Set<bigint>();
      for (const log of [...mints, ...saleSales, ...swapSales, ...offered, ...accepted]) {
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
          accountKey: 'treasury',
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
      for (const log of offered) {
        events.push({
          id: `chain-offer-${log.transactionHash}-${log.logIndex}`,
          type: 'trade',
          ts: ts(log),
          accountKey: log.args.maker ?? 'unknown',
          giveCardId: `card-${log.args.giveTokenId ?? 0n}`,
          getCardId: `card-${log.args.wantTokenId ?? 0n}`,
          priceEth: Number(formatEther(log.args.ethAsk ?? 0n)),
        });
      }
      // SwapAccepted only carries the offer id; resolve the token pair from
      // the offered logs, falling back to a chain read for old offers
      const offerDetails = new Map<number, { give: bigint; want: bigint }>();
      for (const log of offered) {
        offerDetails.set(Number(log.args.offerId ?? -1n), {
          give: log.args.giveTokenId ?? 0n,
          want: log.args.wantTokenId ?? 0n,
        });
      }
      for (const log of accepted) {
        const offerId = Number(log.args.offerId ?? -1n);
        let give = offerDetails.get(offerId)?.give;
        let want = offerDetails.get(offerId)?.want;
        if (give === undefined && CONTRACTS.swap) {
          try {
            const raw = (await client.readContract({
              address: CONTRACTS.swap,
              abi: cardSwapAbi,
              functionName: 'offers',
              args: [BigInt(offerId)],
            })) as { giveTokenId: bigint; wantTokenId: bigint };
            give = raw.giveTokenId;
            want = raw.wantTokenId;
          } catch {
            give = 0n;
            want = 0n;
          }
        }
        events.push({
          id: `chain-accept-${log.transactionHash}-${log.logIndex}`,
          type: 'trade',
          ts: ts(log),
          accountKey: log.args.taker ?? 'unknown',
          giveCardId: `card-${want ?? 0n}`,
          getCardId: `card-${give ?? 0n}`,
          priceEth: 0,
        });
      }

      return events.sort((a, b) => b.ts - a.ts);
    },
  });
}
