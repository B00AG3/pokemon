/**
 * Dev-time artwork vendoring for the milestone ladder: npm run vendor:cards.
 *
 * Downloads <id>.png + <id>_hires.png for every LADDER_TCG_IDS entry from
 * the Pokemon TCG API the site already uses (src/services/pokemontcg.ts)
 * into public/cards, matching the file naming getCardImageUrl serves. Every
 * request retries with backoff because the free tier intermittently 500s,
 * and the run re-verifies the files afterwards: it exits 1 naming each id
 * that is missing or empty, so a rung without artwork can never slip into a
 * build as a silent TBD slot. The test suite independently fs-asserts the
 * committed files, which is what actually gates CI.
 *
 * Flags: --ids=<csv> vendor only these ids, --out=<dir> write elsewhere
 * than public/cards (both exist so the helper behavior stays testable).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import { pathToFileURL } from 'node:url';
import { LADDER_TCG_IDS } from '../src/constants/ladder';

const API_BASE = 'https://api.pokemontcg.io/v2';
const DEFAULT_OUT_DIR = 'public/cards';
/** Same backoff ladder the site client uses for the flaky free tier. */
const RETRY_DELAYS_MS = [0, 800, 2000, 4000];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

export interface VendorArgs {
  ids: string[] | null;
  outDir: string | null;
}

export interface MissingArt {
  id: string;
  file: string;
  reason: 'absent' | 'empty';
}

export function splitIds(csv: string): string[] {
  return csv
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseArgs(argv: readonly string[]): VendorArgs {
  const args: VendorArgs = { ids: null, outDir: null };
  for (const arg of argv) {
    if (arg.startsWith('--ids=')) args.ids = splitIds(arg.slice('--ids='.length));
    else if (arg.startsWith('--out=')) args.outDir = arg.slice('--out='.length);
  }
  return args;
}

export function artFileNames(id: string): string[] {
  return [`${id}.png`, `${id}_hires.png`];
}

/** Artwork files that do not exist or are zero bytes, named per id. */
export function findMissingArt(ids: readonly string[], outDir: string): MissingArt[] {
  const missing: MissingArt[] = [];
  for (const id of ids) {
    for (const file of artFileNames(id)) {
      const full = path.join(outDir, file);
      let size: number;
      try {
        size = fs.statSync(full).size;
      } catch {
        missing.push({ id, file, reason: 'absent' });
        continue;
      }
      if (size <= 0) missing.push({ id, file, reason: 'empty' });
    }
  }
  return missing;
}

export function describeMissing(missing: readonly MissingArt[]): string {
  const lines = missing.map((entry) => `  ${entry.id}: ${entry.file} is ${entry.reason}`);
  return (
    `Vendoring incomplete: ${missing.length} artwork file(s) missing or empty\n` +
    lines.join('\n') +
    '\nRe-run npm run vendor:cards; npm test blocks builds on these files.'
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** GET with retries on network errors and 5xx; a 4xx never improves. */
async function fetchWithRetries(url: string): Promise<Response> {
  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    let response: Response | undefined;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (cause) {
      lastError = cause;
    }
    if (response) {
      if (response.ok) return response;
      lastError = new Error(`${url} -> HTTP ${response.status}`);
      if (response.status < 500) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`);
}

interface AdvertisedImages {
  small: string;
  large: string;
}

async function fetchAdvertisedImages(id: string): Promise<AdvertisedImages> {
  const response = await fetchWithRetries(`${API_BASE}/cards/${encodeURIComponent(id)}`);
  const payload = (await response.json()) as {
    data?: { images?: { small?: string; large?: string } };
  };
  const images = payload.data?.images;
  if (!images?.small || !images?.large) {
    throw new Error(`no small+large artwork advertised for ${id}`);
  }
  return { small: images.small, large: images.large };
}

async function downloadPng(url: string): Promise<Uint8Array> {
  const response = await fetchWithRetries(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`${url} returned an empty body`);
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new Error(`${url} did not return PNG data`);
  }
  return bytes;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.ids ?? LADDER_TCG_IDS;
  const outDir = args.outDir ?? DEFAULT_OUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  const failures: { id: string; detail: string }[] = [];
  for (const id of ids) {
    try {
      const advertised = await fetchAdvertisedImages(id);
      const downloads: [file: string, url: string][] = [
        [`${id}.png`, advertised.small],
        [`${id}_hires.png`, advertised.large],
      ];
      for (const [file, url] of downloads) {
        fs.writeFileSync(path.join(outDir, file), await downloadPng(url));
      }
      console.log(`vendored ${id}`);
    } catch (error) {
      failures.push({ id, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const missing = findMissingArt(ids, outDir);
  if (failures.length > 0 || missing.length > 0) {
    for (const failure of failures) {
      console.error(`failed to vendor ${failure.id}: ${failure.detail}`);
    }
    if (missing.length > 0) console.error(describeMissing(missing));
    process.exit(1);
  }
  console.log(`all ${ids.length} ladder cards vendored into ${outDir}`);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
