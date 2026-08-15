import { __deterministicUnitIntervalForTests as deterministicUnitInterval } from '../src/ingestion/extraction';

describe('deterministicUnitInterval (parser-consensus sampling key)', () => {
  it('is deterministic: the same key always maps to the same value', () => {
    const key = 'user-1:content-hash-abc';
    expect(deterministicUnitInterval(key)).toBe(deterministicUnitInterval(key));
  });

  it('returns a value in [0, 1)', () => {
    for (const key of ['a', 'b', 'user-2:hash-xyz', '']) {
      const value = deterministicUnitInterval(key);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads distinct documents across the interval instead of collapsing to one bucket', () => {
    // Not a statistical rigor test — just a smoke check that hashing 50 distinct content
    // hashes doesn't degenerate into a handful of duplicate values, which would silently
    // break the "N% of documents get consensus parsing" guarantee this key feeds into.
    const values = new Set(
      Array.from({ length: 50 }, (_, i) => deterministicUnitInterval(`user-1:content-hash-${i}`))
    );
    expect(values.size).toBeGreaterThan(45);
  });

  it('changes when the content hash changes, even for the same user', () => {
    const a = deterministicUnitInterval('user-1:content-hash-a');
    const b = deterministicUnitInterval('user-1:content-hash-b');
    expect(a).not.toBe(b);
  });
});
