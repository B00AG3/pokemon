/**
 * Isolated client for the Pokemon TCG Developer API
 * (https://pokemontcg.io, REST v2). This module is the single place that
 * knows about HTTP concerns; game logic and UI consume the mapped models.
 *
 * Chosen over TCGdex after that API went dark: same `set-number` card id
 * scheme (base1-4 is Charizard on both), so ladder ids are unchanged, and
 * artwork is served from pokemontcg's own CDN.
 *
 * Without an API key the endpoint serves ~1000 requests/day and occasionally
 * answers 500 from individual nodes, so every call retries once. A free key
 * from https://dev.pokemontcg.io raises the ceiling: set it as
 * VITE_POKEMONTCG_API_KEY.
 */
import type { CardImageOptions, EnergyType, TCGCard } from '../types/pokemontcg';

const BASE_URL = 'https://api.pokemontcg.io/v2';
const IMAGES_BASE = 'https://images.pokemontcg.io';
const DEFAULT_TIMEOUT_MS = 12_000;

export class PokemonTcgError extends Error {
  readonly status?: number;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'PokemonTcgError';
    this.url = url;
    this.status = status;
  }
}

async function fetchOnce<T>(url: string, headers: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  } catch (cause) {
    throw new PokemonTcgError(
      `Network error reaching the Pokemon TCG API: ${(cause as Error).message}`,
      url,
    );
  }
  if (!response.ok) {
    throw new PokemonTcgError(
      `Pokemon TCG API request failed (${response.status} ${response.statusText || 'Error'})`,
      url,
      response.status,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new PokemonTcgError(
      'Pokemon TCG API returned an invalid JSON payload',
      url,
      response.status,
    );
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = import.meta.env.VITE_POKEMONTCG_API_KEY as string | undefined;
  if (key) headers['X-Api-Key'] = key;
  // The free tier intermittently answers 502 from overloaded nodes, so every
  // call retries with a short backoff before giving up.
  let lastError: unknown;
  for (const delayMs of [0, 600, 1800]) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await fetchOnce<T>(url, headers);
    } catch (error) {
      lastError = error;
      const status = error instanceof PokemonTcgError ? error.status : undefined;
      if (status !== undefined && status < 500) throw error; // 4xx will not improve
    }
  }
  throw lastError;
}

/**
 * Card payloads are static for released cards, so successful fetches are
 * cached in localStorage and reused across visits. A stale entry still
 * answers when the API is unreachable: old data beats a broken hero.
 */
const CACHE_PREFIX = 'pokemontcg:card:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedCard {
  at: number;
  card: TCGCard;
}

function readCache(id: string): CachedCard | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    return raw ? (JSON.parse(raw) as CachedCard) : null;
  } catch {
    return null;
  }
}

function writeCache(id: string, card: TCGCard) {
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ at: Date.now(), card } satisfies CachedCard));
  } catch {
    /* storage full or unavailable */
  }
}

/** Raw card shape from GET /v2/cards/:id - only the fields we consume. */
interface RawCard {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  flavorText?: string;
  hp?: string;
  artist?: string;
  evolvesFrom?: string;
  types?: string[];
  set?: { id?: string; name?: string };
  images?: { small?: string; large?: string };
}

/**
 * pokemontcg serves artwork as extensionless-base + suffix:
 * images.small  = <base>.png, images.large = <base>_hires.png. We store the
 * base so getCardImageUrl can rebuild either exactly as the API advertised.
 */
function toImageBase(raw: RawCard): string | undefined {
  const advertised = raw.images?.large ?? raw.images?.small;
  if (advertised) return advertised.replace(/(_hires)?\.(png|webp|jpg)$/, '');
  if (raw.set?.id && raw.number) return `${IMAGES_BASE}/${raw.set.id}/${raw.number}`;
  return undefined;
}

/**
 * Artwork URL for a card. TCGCard.image is the extensionless base, so
 * "high" maps to the API's hires png and "low" to the standard png.
 */
export function getCardImageUrl(
  card: Pick<TCGCard, 'image'>,
  options: CardImageOptions = {},
): string | undefined {
  if (!card.image) return undefined;
  return options.quality === 'low' ? `${card.image}.png` : `${card.image}_hires.png`;
}

/** GET /v2/cards/:id - full card payload mapped onto the UI models. */
export async function getCardById(id: string): Promise<TCGCard> {
  const cached = readCache(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.card;
  try {
    const raw = await apiFetch<{ data: RawCard }>(`/cards/${encodeURIComponent(id)}`);
    const card = mapCard(id, raw.data);
    writeCache(id, card);
    return card;
  } catch (error) {
    if (cached) return cached.card; // stale but better than a broken page
    throw error;
  }
}

function mapCard(id: string, card: RawCard): TCGCard {
  return {
    id: card.id ?? id,
    localId: card.number ?? id.split('-')[1] ?? '',
    name: card.name,
    image: toImageBase(card),
    types: card.types as EnergyType[] | undefined,
    hp: card.hp ? Number.parseInt(card.hp, 10) || undefined : undefined,
    rarity: card.rarity,
    evolveFrom: card.evolvesFrom,
    description: card.flavorText,
    artist: card.artist,
    set:
      card.set?.id || card.set?.name
        ? { id: card.set?.id ?? '', name: card.set?.name ?? '' }
        : undefined,
  };
}
