import {
  buildNamespacedKey,
  computeFingerprint,
  normalizeCacheInput,
  stableStringify,
} from '../src/utils/cacheKey';

describe('normalizeCacheInput', () => {
  it('lowercases and trims strings', () => {
    expect(normalizeCacheInput('  Paris  ')).toBe('paris');
  });

  it('drops null and undefined entries from arrays and objects', () => {
    expect(normalizeCacheInput([1, null, undefined, 2])).toEqual([1, 2]);
    expect(normalizeCacheInput({ a: 1, b: null, c: undefined, d: 2 })).toEqual({ a: 1, d: 2 });
  });

  it('recursively normalizes nested structures and sorts object keys', () => {
    const input = {
      b: ' hello ',
      a: [{ z: 1, a: 2 }, { a: 2, z: 1 }],
    };
    const normalized = normalizeCacheInput(input);
    expect(JSON.stringify(normalized)).toBe(
      JSON.stringify({ a: [{ a: 2, z: 1 }, { a: 2, z: 1 }], b: 'hello' })
    );
  });

  it('replaces non-finite numbers with null (dropped from objects and arrays)', () => {
    expect(normalizeCacheInput(NaN)).toBeNull();
    expect(normalizeCacheInput({ a: NaN, b: 1 })).toEqual({ b: 1 });
  });
});

describe('stableStringify', () => {
  it('produces identical output for semantically equal inputs with different key orders', () => {
    const a = stableStringify({ city: 'Paris', days: 7 });
    const b = stableStringify({ days: 7, city: 'Paris' });
    expect(a).toBe(b);
  });
});

describe('computeFingerprint', () => {
  it('returns the same hash for equivalent inputs regardless of key order or string casing', () => {
    const a = computeFingerprint({ city: '  Paris ', interests: ['Food', 'history'] });
    const b = computeFingerprint({ interests: ['FOOD', 'HISTORY'], city: 'paris' });
    expect(a).toBe(b);
  });

  it('treats array order as significant (callers must sort set-like inputs)', () => {
    const a = computeFingerprint({ interests: ['food', 'history'] });
    const b = computeFingerprint({ interests: ['history', 'food'] });
    expect(a).not.toBe(b);
  });

  it('returns different hashes for semantically different inputs', () => {
    const a = computeFingerprint({ city: 'Paris', days: 7 });
    const b = computeFingerprint({ city: 'Paris', days: 8 });
    expect(a).not.toBe(b);
  });

  it('changes when the version is bumped', () => {
    const input = { city: 'Paris', days: 7 };
    const v1 = computeFingerprint(input, { version: '1' });
    const v2 = computeFingerprint(input, { version: '2' });
    expect(v1).not.toBe(v2);
  });

  it('is deterministic across invocations', () => {
    const input = { a: 1, b: [2, 3], c: { x: 'y' } };
    expect(computeFingerprint(input)).toBe(computeFingerprint(input));
  });
});

describe('buildNamespacedKey', () => {
  it('joins namespace and parts with :: separator', () => {
    expect(buildNamespacedKey('unsplash', 'location', 'Paris')).toBe('unsplash::location::paris');
  });

  it('skips null and undefined parts', () => {
    expect(buildNamespacedKey('unsplash', 'location', null, undefined, 'paris')).toBe(
      'unsplash::location::paris'
    );
  });
});
