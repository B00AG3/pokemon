/**
 * Strict models for the TCGdex REST API (https://api.tcgdex.net/v2/en).
 * All fields other than id/localId/name are optional because the API omits
 * them per card category and between list vs detail endpoints.
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
  logo?: string;
  symbol?: string;
  cardCount?: {
    official: number;
    total: number;
  };
}

export interface CardAttack {
  name: string;
  cost: EnergyType[];
  damage?: number | string;
  effect?: string;
  text?: string;
}

export interface CardWeakness {
  type: EnergyType;
  value?: string;
}

export interface CardResistance {
  type: EnergyType;
  value?: string;
}

export interface CardLegality {
  standard?: boolean;
  expanded?: boolean;
  unlimited?: boolean;
}

/** Full card payload from GET /cards/:id */
export interface TCGCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  types?: EnergyType[];
  hp?: number;
  rarity?: string;
  stage?: string;
  evolveFrom?: string;
  dexId?: number[];
  description?: string;
  illustrator?: string;
  attacks?: CardAttack[];
  weaknesses?: CardWeakness[];
  resistances?: CardResistance[];
  retreat?: number;
  legalities?: CardLegality;
  set?: CardSet;
  variants?: Record<string, boolean>;
}

/** Slim item returned by list/filter queries (GET /cards?...) */
export interface CardListItem {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

/** Anything grid-renderable: a list item or a fully hydrated card */
export type CardLike = Pick<TCGCard, 'id' | 'localId' | 'name'> &
  Partial<Omit<TCGCard, 'id' | 'localId' | 'name'>>;

export interface CardImageOptions {
  quality?: 'low' | 'high';
  format?: 'webp' | 'png';
}

export interface CardSearchFilters {
  name?: string;
  set?: string;
  rarity?: string;
  types?: string[];
}

/**
 * TCGdex does not expose a total-count header readable from the browser,
 * so pagination is expressed as a cursor-style "hasNextPage" flag.
 */
export interface PaginationState {
  page: number;
  itemsPerPage: number;
  hasNextPage: boolean;
}

export interface CardListResult {
  items: CardListItem[];
  pagination: PaginationState;
}
