import type { EnergyType } from '../types/tcgdex';

/** Curated from GET /types so the dropdown renders instantly without a round trip. */
export const POKEMON_TYPES: readonly EnergyType[] = [
  'Colorless',
  'Darkness',
  'Dragon',
  'Fairy',
  'Fighting',
  'Fire',
  'Grass',
  'Lightning',
  'Metal',
  'Psychic',
  'Water',
];

/** Curated from GET /rarities (the full list is long; these are the useful filters). */
export const RARITIES: readonly string[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Rare Holo',
  'Holo Rare',
  'Holo Rare V',
  'Holo Rare VMAX',
  'Holo Rare VSTAR',
  'Illustration rare',
  'Amazing Rare',
  'Radiant Rare',
  'ACE SPEC Rare',
  'Secret Rare',
  'Hyper rare',
  'Promo',
];

export const TYPE_COLORS: Record<string, string> = {
  Colorless: '#A8A878',
  Darkness: '#6D5847',
  Dragon: '#6F35FC',
  Fairy: '#D685AD',
  Fighting: '#C22E28',
  Fire: '#EE8130',
  Grass: '#7AC74C',
  Lightning: '#F7D02C',
  Metal: '#B7B7CE',
  Psychic: '#F95587',
  Water: '#6390F0',
};

const SPECIAL_HOLO_KEYWORDS = [
  'amazing rare',
  'illustration rare',
  'radiant rare',
  'ace spec rare',
  'secret rare',
  'hyper rare',
  'double rare',
  'ultra rare',
  'shiny',
  'crown',
  'legend',
];

/** Drives the holographic foil layer: holo and premium-print rarities get the rainbow treatment. */
export function isHoloRarity(rarity?: string): boolean {
  if (!rarity) return false;
  const normalized = rarity.toLowerCase();
  if (normalized.includes('holo')) return true;
  return SPECIAL_HOLO_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );
}
