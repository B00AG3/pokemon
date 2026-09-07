import { describe, expect, it } from 'vitest';
import { LADDER_TCG_IDS } from '../constants/ladder';
import { LADDER_CARD_MANIFEST } from '../data/ladderCards';

describe('LADDER_CARD_MANIFEST', () => {
  it('has a local entry for every ladder card', () => {
    expect(Object.keys(LADDER_CARD_MANIFEST)).toHaveLength(LADDER_TCG_IDS.length);
    for (const id of LADDER_TCG_IDS) {
      expect(LADDER_CARD_MANIFEST, `manifest must answer ${id} without the TCG API`).toHaveProperty(id);
    }
  });

  it('holds no entries beyond the ladder', () => {
    expect([...Object.keys(LADDER_CARD_MANIFEST)].sort()).toEqual([...LADDER_TCG_IDS].sort());
  });

  it('serves each card with a name and the vendored image base /cards/<id>', () => {
    for (const id of LADDER_TCG_IDS) {
      const card = LADDER_CARD_MANIFEST[id];
      expect(card.id).toBe(id);
      expect(card.name, `${id} needs a display name`).toBeTruthy();
      expect(card.image, `${id} must point at the vendored art`).toBe(`/cards/${id}`);
    }
  });
});
