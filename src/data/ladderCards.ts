import type { TCGCard } from '../types/pokemontcg';

/**
 * The five milestone ladder cards are fixed, known 1999 Base Set holos, so
 * their payloads and artwork ship with the site: images live in
 * public/cards/ (base.png + base_hires.png) and this manifest holds the
 * metadata. getCardById serves them locally first - visitors never hit the
 * Pokemon TCG API for them, and the hero, roadmap, and market keep their
 * art through card-API outages like the TCGdex one.
 */
export const LADDER_CARD_MANIFEST: Record<string, TCGCard> = {
  'base1-4': {
    id: 'base1-4',
    localId: '4',
    name: 'Charizard',
    image: '/cards/base1-4',
    types: ["Fire"],
    hp: 120,
    rarity: 'Rare Holo',
    evolveFrom: 'Charmeleon',
    description: 'Spits fire that is hot enough to melt boulders. Known to unintentionally cause forest fires.',
    artist: 'Mitsuhiro Arita',
    set: { id: 'base1', name: 'Base' },
  },
  'base1-2': {
    id: 'base1-2',
    localId: '2',
    name: 'Blastoise',
    image: '/cards/base1-2',
    types: ["Water"],
    hp: 100,
    rarity: 'Rare Holo',
    evolveFrom: 'Wartortle',
    description: 'A brutal Pokémon with pressurized water jets on its shell. They are used for high-speed tackles.',
    artist: 'Ken Sugimori',
    set: { id: 'base1', name: 'Base' },
  },
  'base1-1': {
    id: 'base1-1',
    localId: '1',
    name: 'Alakazam',
    image: '/cards/base1-1',
    types: ["Psychic"],
    hp: 80,
    rarity: 'Rare Holo',
    evolveFrom: 'Kadabra',
    description: 'Its brain can outperform a supercomputer. Its intelligence quotient is said to be 5000.',
    artist: 'Ken Sugimori',
    set: { id: 'base1', name: 'Base' },
  },
  'base1-6': {
    id: 'base1-6',
    localId: '6',
    name: 'Gyarados',
    image: '/cards/base1-6',
    types: ["Water"],
    hp: 100,
    rarity: 'Rare Holo',
    evolveFrom: 'Magikarp',
    description: 'Rarely seen in the wild. Huge and vicious, it is capable of destroying entire cities in a rage.',
    artist: 'Mitsuhiro Arita',
    set: { id: 'base1', name: 'Base' },
  },
  'base1-15': {
    id: 'base1-15',
    localId: '15',
    name: 'Venusaur',
    image: '/cards/base1-15',
    types: ["Grass"],
    hp: 100,
    rarity: 'Rare Holo',
    evolveFrom: 'Ivysaur',
    description: 'This plant blooms when it is absorbing solar energy. It stays on the move to seek sunlight.',
    artist: 'Mitsuhiro Arita',
    set: { id: 'base1', name: 'Base' },
  },
};
