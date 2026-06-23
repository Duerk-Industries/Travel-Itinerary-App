/// <reference types="jest" />
/// <reference types="node" />
import { rollUpTotals, detectCycle } from '../utils/coveredBy';

describe('Covered-By Logic', () => {
  it('should roll up a covered person\'s totals to the covering person', () => {
    const totals = { m1: 100, m2: 50, m3: 20 };
    const coveredBy = { m2: 'm1' }; // m2 is covered by m1
    const newTotals = rollUpTotals(totals, coveredBy);
    expect(newTotals).toEqual({ m1: 150, m3: 20 });
    expect(newTotals.m2).toBeUndefined();
  });

  it('should handle multiple covered people for one covering person', () => {
    const totals = { m1: 100, m2: 50, m3: 20 };
    const coveredBy = { m2: 'm1', m3: 'm1' };
    const newTotals = rollUpTotals(totals, coveredBy);
    expect(newTotals).toEqual({ m1: 170 });
  });

  it('should do nothing if the covered person has no totals', () => {
    const totals = { m1: 100, m3: 20 };
    const coveredBy = { m2: 'm1' };
    const newTotals = rollUpTotals(totals, coveredBy);
    expect(newTotals).toEqual({ m1: 100, m3: 20 });
  });

  it('should return original totals if coveredBy is empty', () => {
    const totals = { m1: 100, m2: 50 };
    expect(rollUpTotals(totals, {})).toEqual(totals);
  });

  describe('detectCycle', () => {
    it('should detect a simple cycle', () => {
      const coveredBy = { m1: 'm2', m2: 'm1' };
      expect(detectCycle(coveredBy)).toBe(true);
    });

    it('should detect a longer cycle', () => {
      const coveredBy = { m1: 'm2', m2: 'm3', m3: 'm1' };
      expect(detectCycle(coveredBy)).toBe(true);
    });

    it('should not detect a cycle in a linear chain', () => {
      const coveredBy = { m1: 'm2', m2: 'm3' };
      expect(detectCycle(coveredBy)).toBe(false);
    });

    it('should not detect a cycle when multiple people are covered by one person', () => {
      const coveredBy = { m1: 'm3', m2: 'm3' };
      expect(detectCycle(coveredBy)).toBe(false);
    });

    it('should return false for an empty object', () => {
      expect(detectCycle({})).toBe(false);
    });
  });
});