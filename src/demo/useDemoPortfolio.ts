import { useCallback, useEffect, useState } from 'react';

/**
 * Simulated portfolio ledger for the demo market, persisted to localStorage
 * and keyed by connected wallet address (guests share a scratch account).
 * Tracks a per-card cost basis plus realized P&L so the Portfolio page can
 * show unrealized vs realized returns. Two simulated traders own the other
 * cards so trading has counterparties.
 */

interface DemoAccount {
  eth: number;
  cards: string[];
  /** ETH paid per owned card (buy price, or trade basis). */
  cost: Record<string, number>;
  /** Cumulative realized profit or loss, in ETH. */
  realized: number;
}

type DemoState = Record<string, DemoAccount>;

const STORAGE_KEY = 'pokecard-demo-v2';
const LEGACY_KEY = 'pokecard-demo-v1';
const GUEST_START_ETH = 2;

function emptyAccount(): DemoAccount {
  return { eth: 0, cards: [], cost: {}, realized: 0 };
}

const NPCS: DemoState = {
  'npc-1': { eth: 25, cards: ['demo-2'], cost: { 'demo-2': 0.05 }, realized: 0 },
  'npc-2': { eth: 25, cards: ['demo-3'], cost: { 'demo-3': 0.042 }, realized: 0 },
};

function load(): DemoState {
  // one-time migration from v1: carry balances and holdings, cost basis
  // defaults to the current price at first render (unrealized starts at 0)
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !localStorage.getItem(STORAGE_KEY)) {
      const parsed = JSON.parse(legacy) as Record<string, { eth: number; cards: string[] }>;
      const migrated: DemoState = {};
      for (const [key, account] of Object.entries(parsed)) {
        migrated[key] = { ...emptyAccount(), eth: account.eth, cards: account.cards };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* unreadable legacy state - skip migration */
  }
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
   * Swap one of your cards for another card, settling the ETH price
   * difference. Booked as a sale of the given card plus a buy of the
   * received card at (give price + delta) so P&L stays consistent.
   */
  const trade = useCallback(
    (giveCardId: string, getCardId: string, deltaEth: number, givePrice: number) => {
      mutate((draft) => {
        const me = ensureAccount(draft, userKey);
        if (!me.cards.includes(giveCardId)) return;
        const counterparty =
          Object.keys(draft).find((key) => draft[key].cards.includes(getCardId)) ?? 'treasury';
        if (counterparty === userKey) return;
        if (deltaEth > 0 && me.eth < deltaEth) return;

        me.eth -= deltaEth;
        if (counterparty !== 'treasury') draft[counterparty].eth += deltaEth;
        const basis = givePrice + deltaEth;
        moveCard(draft, userKey, counterparty, giveCardId);
        moveCard(draft, counterparty, userKey, getCardId);
        me.realized += givePrice - (me.cost[giveCardId] ?? givePrice);
        me.cost[getCardId] = basis;
      });
    },
    [mutate, userKey],
  );

  return {
    eth: me.eth,
    myCards: me.cards,
    costOf: (cardId: string) => me.cost[cardId],
    realized: me.realized,
    ownerOf,
    buy,
    sell,
    trade,
    isGuest: !address,
  };
}
