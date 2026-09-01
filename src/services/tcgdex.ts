/**
 * Isolated client for the public, keyless TCGdex API.
 * Base docs: https://tcgdex.dev / https://api.tcgdex.net/v2/en
 *
 * This module is the single place that knows about HTTP concerns. Game logic,
 * state management, and wallet/contract layers should consume these typed
 * functions rather than calling fetch directly.
 */
import type {
  CardImageOptions,
  CardLike,
  CardListItem,
  CardListResult,
  CardSearchFilters,
  TCGCard,
} from '../types/tcgdex';

const BASE_URL = 'https://api.tcgdex.net/v2/en';
const DEFAULT_TIMEOUT_MS = 12_000;

export class TcgdexError extends Error {
  readonly status?: number;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'TcgdexError';
    this.url = url;
    this.status = status;
  }
}

type QueryParams = Record<string, string | number | string[] | undefined>;

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v) url.searchParams.append(key, v);
        }
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

async function tcgdexFetch<T>(path: string, params?: QueryParams): Promise<T> {
  const url = buildUrl(path, params);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new TcgdexError(
      `Network error reaching TCGdex: ${(cause as Error).message}`,
      url,
    );
  }
  if (!response.ok) {
    throw new TcgdexError(
      `TCGdex request failed (${response.status} ${response.statusText || 'Error'})`,
      url,
      response.status,
    );
  }
  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new TcgdexError(
      `TCGdex returned an invalid JSON payload: ${(cause as Error).message}`,
      url,
      response.status,
    );
  }
}

/**
 * TCGdex image fields are asset base URLs, e.g.
 * https://assets.tcgdex.net/en/base/base1/4
 * Append /high.webp, /high.png, /low.webp ... to get a concrete file.
 */
export function getCardImageUrl(
  card: Pick<TCGCard, 'image'>,
  options: CardImageOptions = {},
): string | undefined {
  const { quality = 'high', format = 'webp' } = options;
  return card.image ? `${card.image}/${quality}.${format}` : undefined;
}

/** GET /cards/:id - full metadata for one card. */
export async function getCardById(id: string): Promise<TCGCard> {
  return tcgdexFetch<TCGCard>(`/cards/${encodeURIComponent(id)}`);
}

/**
 * GET /cards with TCGdex filter query params.
 * The API sends no total-count header a browser can read, so we over-fetch by
 * one item to compute hasNextPage without an extra round trip.
 */
export async function searchCards(
  filters: CardSearchFilters = {},
  pagination: { page?: number; itemsPerPage?: number } = {},
): Promise<CardListResult> {
  const page = Math.max(1, Math.floor(pagination.page ?? 1));
  const itemsPerPage = Math.min(
    250,
    Math.max(1, Math.floor(pagination.itemsPerPage ?? 24)),
  );

  const raw = await tcgdexFetch<CardListItem[]>('/cards', {
    name: filters.name,
    set: filters.set,
    rarity: filters.rarity,
    types: filters.types,
    'pagination:page': page,
    'pagination:itemsPerPage': itemsPerPage + 1,
  });

  return {
    items: raw.slice(0, itemsPerPage),
    pagination: {
      page,
      itemsPerPage,
      hasNextPage: raw.length > itemsPerPage,
    },
  };
}

const RANDOM_POOL_SIZE = 64;
const RANDOM_POOL_MAX_PAGE = 40;

function shuffle<T>(input: T[]): T[] {
  const items = [...input];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function withArtwork(items: CardListItem[]): CardListItem[] {
  return items.filter((card) => card.image && card.name);
}

function verifyImage(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

/**
 * Keep only items whose artwork actually loads (the API's image field can
 * point at missing assets). Verified images land in the browser cache, so
 * rendering them later is instant. Batches requests and tops up from the
 * queue until `count` good ones are found.
 */
async function pickRenderable(
  items: CardListItem[],
  count: number,
): Promise<CardListItem[]> {
  const queue = [...items];
  const verified: CardListItem[] = [];
  while (verified.length < count && queue.length > 0) {
    const batch = queue.splice(0, 12);
    const urls = batch.map((card) => getCardImageUrl(card));
    const ok = await Promise.all(
      urls.map((url) => (url ? verifyImage(url) : Promise.resolve(false))),
    );
    batch.forEach((card, i) => {
      if (ok[i]) verified.push(card);
    });
  }
  return verified.slice(0, count);
}

async function fetchPool(
  filters: CardSearchFilters,
  page: number,
): Promise<CardListItem[]> {
  return tcgdexFetch<CardListItem[]>('/cards', {
    name: filters.name,
    set: filters.set,
    rarity: filters.rarity,
    types: filters.types,
    'pagination:page': page,
    'pagination:itemsPerPage': RANDOM_POOL_SIZE,
  });
}

/**
 * TCGdex has no server-side random endpoint, so we sample a random page from
 * the filtered card pool, shuffle it, and hydrate the drawn ids with full
 * detail payloads (attacks, hp, rarity...) for pack-opening or hand-drawing
 * mechanics. Detail fetch failures degrade gracefully to the slim list item.
 */
export async function getRandomCards(
  count: number,
  filters: CardSearchFilters = {},
): Promise<CardLike[]> {
  const drawCount = Math.min(60, Math.max(1, Math.floor(count)));

  const drawable = withArtwork(
    await fetchPool(
      filters,
      1 + Math.floor(Math.random() * RANDOM_POOL_MAX_PAGE),
    ),
  );
  const fallback =
    drawable.length > 0 ? drawable : withArtwork(await fetchPool(filters, 1));

  const drawn = await pickRenderable(shuffle(fallback), drawCount);
  const details = await Promise.allSettled(
    drawn.map((card) => getCardById(card.id)),
  );

  return drawn.map((base, i) => {
    const result = details[i];
    if (result.status !== 'fulfilled') return base;
    return { ...base, ...result.value, image: result.value.image ?? base.image };
  });
}

/**
 * One-shot pool of display-ready list items for the hero card wall: a random
 * page of the full index, filtered to cards that have artwork. Single
 * request, no detail hydration.
 */
export async function getCardWall(count = 48): Promise<CardListItem[]> {
  const target = Math.min(64, Math.max(8, Math.floor(count)));
  let pool = withArtwork(
    await fetchPool({}, 1 + Math.floor(Math.random() * RANDOM_POOL_MAX_PAGE)),
  );
  if (pool.length === 0) {
    pool = withArtwork(await fetchPool({}, 1));
  }
  return pickRenderable(shuffle(pool), target);
}

/** GET /types - reference list of energy types. */
export async function getEnergyTypes(): Promise<string[]> {
  return tcgdexFetch<string[]>('/types');
}

/** GET /rarities - reference list of rarity names. */
export async function getRarities(): Promise<string[]> {
  return tcgdexFetch<string[]>('/rarities');
}
