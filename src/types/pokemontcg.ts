/**
 * Strict models for the Pokemon TCG Developer API
 * (https://pokemontcg.io, REST v2). The site only consumes a slice of each
 * card payload, so the service layer maps raw responses onto these.
 */

export type EnergyType =
  | 'Colorless'
  | 'Darkness'
  | 'Dragon'
  | 'Fairy'
  | 'Fighting'
  | 'Fire'
  | 'Grass'
  | 'Lightning'
  | 'Metal'
  | 'Psychic'
  | 'Water';

export interface CardSet {
  id: string;
  name: string;
}

/** Card payload the UI works with, mapped from GET /v2/cards/:id */
export interface TCGCard {
  id: string;
  localId: string;
  name: string;
  /** Extensionless image base; getCardImageUrl appends a size suffix. */
  image?: string;
  types?: EnergyType[];
  hp?: number;
  rarity?: string;
  evolveFrom?: string;
  description?: string;
  artist?: string;
  set?: CardSet;
}

/** Slim, grid-renderable card reference */
export interface CardListItem {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface CardImageOptions {
  quality?: 'low' | 'high';
}
