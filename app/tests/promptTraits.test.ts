/// <reference types="node" />
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
  test('preserves per-slider weights without rescaling to a fixed sum', () => {
    const normalized = normalizePromptTraits({
      tt: {
        ...DEFAULT_PROMPT_TRAITS.tt,
        w: {
          outdoors: 80,
          adventure: 10,
          culture: 15,
          food: 15,
          nightlife: 10,
          relax: 10,
          photography: 10,
          authentic_local: 8,
          iconic_landmarks: 7,
        },
      },
    });
    expect(normalized.tt.w.outdoors).toBe(80);
    expect(normalized.tt.w.adventure).toBe(10);
    expect(normalized.tt.w.iconic_landmarks).toBe(7);
  });

  test('clamps out-of-range slider values to [0, 100]', () => {
    const normalized = normalizePromptTraits({
      tt: {
        ...DEFAULT_PROMPT_TRAITS.tt,
        w: {
          outdoors: 250,
          adventure: -30,
          culture: 50,
          food: 50,
          nightlife: 50,
          relax: 50,
          photography: 50,
          authentic_local: 50,
          iconic_landmarks: 50,
        },
      },
    });
    expect(normalized.tt.w.outdoors).toBe(100);
    expect(normalized.tt.w.adventure).toBe(0);
    expect(normalized.tt.w.culture).toBe(50);
  });

  test('serializes and parses prompt traits payload', () => {
    const raw = serializePromptTraits({
      tt: { ...DEFAULT_PROMPT_TRAITS.tt, p: 'F', is: 'guided' },
      ut: { i: ['Food', 'Culture'], eb: true, no: false },
    });
    const parsed = parsePromptTraits(raw);
    expect(parsed?.tt.p).toBe('F');
    expect(parsed?.tt.is).toBe('guided');
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
