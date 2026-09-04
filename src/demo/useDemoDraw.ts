import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The demo holder draw, persisted to localStorage. Mirrors the on-chain
 * standing draw in MilestoneCards: enter once, leave any time, and when the
 * simulated market cap crosses the next milestone the card airdrops to a
 * random entrant who is still around.
 *
 * Demo-only bias: the connected wallet's entry counts as three tickets
 * against the NPC entrants' one each, so a visitor who enters is likely to
 * actually experience winning. The chain draw is unweighted.
 */

const STORAGE_KEY = 'pokecard-draw-v1';

interface DrawState {
  /** Wallet keys currently in the draw (user + guests; NPCs are implicit). */
  entered: string[];
  /** Set once the crossing fired: the airdrop has landed. */
  winner?: string;
}

function load(): DrawState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DrawState;
  } catch {
    /* corrupted storage - start fresh */
  }
  return { entered: [] };
}

/** NPC entrants give the demo draw a real field to beat. */
export const DEMO_NPC_ENTRANTS = ['npc-1', 'npc-2', 'npc-3'];

export function useDemoDraw(address: string | undefined) {
  const userKey = address ?? 'guest';
  const [state, setState] = useState<DrawState>(load);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable - draw state stays in memory */
    }
  }, [state]);

  const entered = state.entered.includes(userKey);
  const entrantCount = DEMO_NPC_ENTRANTS.length + state.entered.length;

  const enter = useCallback(() => {
    setState((prev) =>
      prev.entered.includes(userKey) ? prev : { ...prev, entered: [...prev.entered, userKey] },
    );
  }, [userKey]);

  const leave = useCallback(() => {
    setState((prev) => ({ ...prev, entered: prev.entered.filter((k) => k !== userKey) }));
  }, [userKey]);

  /**
   * Fire the airdrop once the cap crosses the threshold. Picks a winner from
   * everyone still entered (the user's tickets are weighted, see above) and
   * persists the result so it never re-fires. Returns the winner key, or
   * null when the draw already settled.
   */
  const settle = useCallback((): string | null => {
    const current = stateRef.current;
    if (current.winner) return null;
    const tickets: string[] = [...DEMO_NPC_ENTRANTS];
    for (const key of current.entered) {
      // demo-only bias: the connected wallet gets three tickets so a visitor
      // who enters is likely to experience the win; NPCs carry one each
      if (key === userKey) {
        tickets.push(userKey, userKey, userKey);
      } else {
        tickets.push(key);
      }
    }
    const winner = tickets[Math.floor(Math.random() * tickets.length)] ?? DEMO_NPC_ENTRANTS[0];
    setState((prev) => (prev.winner ? prev : { ...prev, winner }));
    return winner;
  }, [userKey]);

  return { entered, entrantCount, winner: state.winner ?? null, enter, leave, settle };
}
