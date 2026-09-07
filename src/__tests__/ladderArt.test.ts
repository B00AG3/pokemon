import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LADDER_TCG_IDS } from '../constants/ladder';

const CARDS_DIR = fileURLToPath(new URL('../../public/cards', import.meta.url));

/** PNG files start with the fixed 8-byte signature 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * The artwork ships with the repo, so every rung must resolve both sizes
 * locally. These fs asserts run before any build: a missing or empty
 * download from npm run vendor:cards fails the suite naming the file, never
 * leaving a silent TBD slot on the roadmap.
 */
describe('vendored ladder artwork', () => {
  for (const id of LADDER_TCG_IDS) {
    describe(id, () => {
      for (const file of [`${id}.png`, `${id}_hires.png`] as const) {
        it(`ships ${file} as a nonzero PNG`, () => {
          const full = path.join(CARDS_DIR, file);
          // statSync throws ENOENT when the file is absent: the failure
          // message names the exact missing path.
          const stat = fs.statSync(full);
          expect(stat.isFile()).toBe(true);
          expect(stat.size, `${file} must not be empty`).toBeGreaterThan(0);
          const head = new Uint8Array(fs.readFileSync(full).subarray(0, PNG_SIGNATURE.length));
          expect(head, `${file} must contain PNG data, not an error page`).toEqual(PNG_SIGNATURE);
        });
      }
    });
  }
});
