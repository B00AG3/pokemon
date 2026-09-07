import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  artFileNames,
  describeMissing,
  findMissingArt,
  parseArgs,
  splitIds,
} from '../../scripts/vendor-cards';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-cards-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('parseArgs', () => {
  it('reads --ids and --out overrides', () => {
    expect(parseArgs(['--ids=base1-4,bogus-99', '--out=/tmp/cards'])).toEqual({
      ids: ['base1-4', 'bogus-99'],
      outDir: '/tmp/cards',
    });
  });

  it('defaults both overrides to null so the run vendors the full ladder', () => {
    expect(parseArgs([])).toEqual({ ids: null, outDir: null });
  });

  it('tolerates extra flags', () => {
    expect(parseArgs(['--verbose', '--ids=base1-1']).ids).toEqual(['base1-1']);
  });
});

describe('splitIds', () => {
  it('trims and drops blank entries', () => {
    expect(splitIds(' base1-4 , , base1-2 ,')).toEqual(['base1-4', 'base1-2']);
  });

  it('yields an empty list for a blank string', () => {
    expect(splitIds('   ')).toEqual([]);
  });
});

describe('artFileNames', () => {
  it('uses the public/cards naming convention for both sizes', () => {
    expect(artFileNames('base1-4')).toEqual(['base1-4.png', 'base1-4_hires.png']);
  });
});

describe('findMissingArt', () => {
  it('reports absent, empty, and fully-missing cards', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'base1-4.png'), 'x'); // complete card
    fs.writeFileSync(path.join(dir, 'base1-4_hires.png'), 'xx');
    fs.writeFileSync(path.join(dir, 'base1-2.png'), ''); // empty file
    // base1-2_hires.png and all of base1-1 are absent

    const missing = findMissingArt(['base1-4', 'base1-2', 'base1-1'], dir);

    expect(missing).toContainEqual({ id: 'base1-2', file: 'base1-2.png', reason: 'empty' });
    expect(missing).toContainEqual({ id: 'base1-2', file: 'base1-2_hires.png', reason: 'absent' });
    expect(missing).toContainEqual({ id: 'base1-1', file: 'base1-1.png', reason: 'absent' });
    expect(missing).toContainEqual({ id: 'base1-1', file: 'base1-1_hires.png', reason: 'absent' });
    expect(missing.filter((entry) => entry.id === 'base1-4')).toEqual([]);
  });
});

describe('describeMissing', () => {
  it('fails loudly, naming every missing id and file', () => {
    const message = describeMissing([
      { id: 'bogus-99', file: 'bogus-99.png', reason: 'absent' },
      { id: 'bogus-99', file: 'bogus-99_hires.png', reason: 'empty' },
    ]);
    expect(message).toContain('bogus-99.png');
    expect(message).toContain('bogus-99_hires.png');
    expect(message).toMatch(/empty|absent/i);
  });
});
