import { useCallback, useEffect, useState } from 'react';

/**
 * Simulated portfolio ledger for the demo market, persisted to localStorage
 * and keyed by connected wallet address (guests share a scratch account).
 * Tracks a per-card cost basis plus realized P&L so the Portfolio page can
 * show unrealized vs realized returns. Three simulated traders own the other
 * cards so trading has counterparties; airdrop wins land with no cost basis.
 */

interface DemoAccount {
  eth: number;
  cards: string[];
  /** ETH paid per owned card (buy price, trade basis, or absent for airdrops). */
  cost: Record<string, number>;
  /** Cumulative realized profit or loss, in ETH. */
  realized: number;
}

type DemoState = Record<string, DemoAccount>;

const STORAGE_KEY = 'pokecard-demo-v3';
const GUEST_START_ETH = 2;

function emptyAccount(): DemoAccount {
  return { eth: 0, cards: [], cost: {}, realized: 0 };
}

const NPCS: DemoState = {
  'npc-1': { eth: 25, cards: ['demo-2'], cost: { 'demo-2': 0.05 }, realized: 0 },
  'npc-2': { eth: 25, cards: ['demo-3'], cost: { 'demo-3': 0.042 }, realized: 0 },
  // npc-3 won card #01 in the seeded airdrop and still holds it
  'npc-3': { eth: 25, cards: ['demo-1'], cost: {}, realized: 0 },
};

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...NPCS, ...(JSON.parse(raw) as DemoState) };
  } catch {
    /* corrupted storage - start fresh */
  }
  return { ...NPCS };
}

export function useDemoPortfolio(address?: string) {
  const userKey = address ?? 'guest';
  const [state, setState] = useState<DemoState>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable - demo state stays in memory */
    }
  }, [state]);

  const me = state[userKey] ?? { ...emptyAccount(), eth: GUEST_START_ETH };

  const ownerOf = useCallback(
    (cardId: string): string => {
      for (const [key, account] of Object.entries(state)) {
        if (account.cards.includes(cardId)) return key;
      }
      return 'treasury';
    },
    [state],
  );

  const mutate = useCallback(
    (update: (draft: DemoState) => void) => {
      setState((prev) => {
        const draft: DemoState = { ...NPCS, ...prev };
        if (!draft[userKey]) draft[userKey] = { ...emptyAccount(), eth: GUEST_START_ETH, cards: [] };
        const clone: DemoState = {};
        for (const [key, account] of Object.entries(draft)) {
          clone[key] = {
            eth: account.eth,
            cards: [...account.cards],
            cost: { ...account.cost },
            realized: account.realized,
          };
        }
        update(clone);
        return clone;
      });
    },
    [userKey],
  );

  const ensureAccount = (draft: DemoState, key: string) => {
    if (!draft[key]) draft[key] = emptyAccount();
    return draft[key];
  };

  const moveCard = (draft: DemoState, from: string, to: string, cardId: string) => {
    const sender = ensureAccount(draft, from);
    sender.cards = sender.cards.filter((c) => c !== cardId);
    delete sender.cost[cardId];
    const receiver = ensureAccount(draft, to);
    if (!receiver.cards.includes(cardId)) receiver.cards.push(cardId);
  };

  const buy = useCallback(
    (cardId: string, price: number) => {
      mutate((draft) => {
        // cards with no tracked holder are owned by the treasury
        const seller = Object.keys(draft).find((key) => draft[key].cards.includes(cardId));
        const me = ensureAccount(draft, userKey);
        if (me.eth < price) return;
        me.eth -= price;
        if (seller) draft[seller].eth += price;
        moveCard(draft, seller ?? 'treasury', userKey, cardId);
        me.cost[cardId] = price;
      });
    },
    [mutate, userKey],
  );

  const sell = useCallback(
    (cardId: string, price: number) => {
      mutate((draft) => {
        const me = ensureAccount(draft, userKey);
        if (!me.cards.includes(cardId)) return;
        me.eth += price;
        me.cards = me.cards.filter((c) => c !== cardId);
        me.realized += price - (me.cost[cardId] ?? price);
        delete me.cost[cardId];
      });
    },
    [mutate, userKey],
  );

  /**
   * Land an airdrop: the card moves from unowned to the winner with no ETH
   * changing hands and no cost basis (it was free).
   */
  const claimAirdrop = useCallback(
    (cardId: string, winnerKey: string) => {
      mutate((draft) => {
        const winner = ensureAccount(draft, winnerKey);
        if (!winner.cards.includes(cardId)) winner.cards.push(cardId);
      });
    },
    [mutate],
  );

  return {
    eth: me.eth,
    myCards: me.cards,
    costOf: (cardId: string) => me.cost[cardId],
    realized: me.realized,
    ownerOf,
    buy,
    sell,
    claimAirdrop,
    isGuest: !address,
  };
}
