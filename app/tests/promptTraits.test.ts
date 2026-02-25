import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_PROMPT_TRAITS,
  PROMPT_PROFILE_TRAIT_NAME,
  extractPromptTraitsFromTraits,
  normalizePromptTraits,
  parsePromptTraits,
  serializePromptTraits,
} from '../utils/promptTraits';

describe('promptTraits utility', () => {
  test('normalizes and rescales weights to sum to 100', () => {
    const normalized = normalizePromptTraits({
      tt: {
        ...DEFAULT_PROMPT_TRAITS.tt,
        w: { o: 50, c: 50, f: 50, n: 50, r: 50 },
      },
    });
    const sum = normalized.tt.w.o + normalized.tt.w.c + normalized.tt.w.f + normalized.tt.w.n + normalized.tt.w.r;
    expect(sum).toBe(100);
  });

  test('serializes and parses prompt traits payload', () => {
    const raw = serializePromptTraits({
      tt: { ...DEFAULT_PROMPT_TRAITS.tt, p: 'F', tm: 'E' },
      ut: { i: ['Food', 'Culture'], eb: true, no: false },
    });
    const parsed = parsePromptTraits(raw);
    expect(parsed?.tt.p).toBe('F');
    expect(parsed?.tt.tm).toBe('E');
    expect(parsed?.ut.i).toEqual(['Food', 'Culture']);
    expect(parsed?.ut.eb).toBe(true);
  });

  test('extracts prompt trait profile from traits list and falls back to defaults', () => {
    const extracted = extractPromptTraitsFromTraits([
      {
        id: 't1',
        name: PROMPT_PROFILE_TRAIT_NAME,
        notes: serializePromptTraits({ tt: { ...DEFAULT_PROMPT_TRAITS.tt, p: 'R' }, ut: { i: ['Outdoors'] } }),
      },
    ]);
    expect(extracted.traitId).toBe('t1');
    expect(extracted.profile.tt.p).toBe('R');
    expect(extracted.profile.ut.i).toContain('Outdoors');

    const fallback = extractPromptTraitsFromTraits([]);
    expect(fallback.traitId).toBeNull();
    expect(fallback.profile.tt.p).toBe(DEFAULT_PROMPT_TRAITS.tt.p);
  });
});
