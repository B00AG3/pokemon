import { useCallback, useEffect, useState } from 'react';

/**
 * Simulated portfolio ledger for the demo market, persisted to localStorage
 * and keyed by connected wallet address (guests share a scratch account).
 * Two simulated traders own the other cards so trading has counterparties.
 */

interface DemoAccount {
  eth: number;
  cards: string[];
}

type DemoState = Record<string, DemoAccount>;

const STORAGE_KEY = 'pokecard-demo-v1';
const GUEST_START_ETH = 2;

const NPCS: DemoState = {
  'npc-1': { eth: 25, cards: ['demo-2'] },
  'npc-2': { eth: 25, cards: ['demo-3'] },
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

  const me = state[userKey] ?? { eth: GUEST_START_ETH, cards: [] as string[] };

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
        if (!draft[userKey]) draft[userKey] = { eth: GUEST_START_ETH, cards: [] };
        const clone: DemoState = {};
        for (const [key, account] of Object.entries(draft)) {
          clone[key] = { eth: account.eth, cards: [...account.cards] };
        }
        update(clone);
        return clone;
      });
    },
    [userKey],
  );

  const ensureAccount = (draft: DemoState, key: string) => {
    if (!draft[key]) draft[key] = { eth: 0, cards: [] };
    return draft[key];
  };

  const moveCard = (draft: DemoState, from: string, to: string, cardId: string) => {
    const sender = ensureAccount(draft, from);
    sender.cards = sender.cards.filter((c) => c !== cardId);
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
      });
    },
    [mutate, userKey],
  );

  /** Swap one of your cards for another card, settling the ETH price difference. */
  const trade = useCallback(
    (giveCardId: string, getCardId: string, deltaEth: number) => {
      mutate((draft) => {
        const me = ensureAccount(draft, userKey);
        if (!me.cards.includes(giveCardId)) return;
        const counterparty =
          Object.keys(draft).find((key) => draft[key].cards.includes(getCardId)) ?? 'treasury';
        if (counterparty === userKey) return;
        if (deltaEth > 0 && me.eth < deltaEth) return;

        me.eth -= deltaEth;
        if (counterparty !== 'treasury') draft[counterparty].eth += deltaEth;
        moveCard(draft, userKey, counterparty, giveCardId);
        moveCard(draft, counterparty, userKey, getCardId);
      });
    },
    [mutate, userKey],
  );

  return {
    eth: me.eth,
    myCards: me.cards,
    ownerOf,
    buy,
    sell,
    trade,
    isGuest: !address,
  };
}
