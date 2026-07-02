/// <reference types="jest" />
/// <reference types="node" />
/**
 * Verifies that modules touching `Intl` build their formatters lazily and
 * survive a runtime where the Intl constructor throws. Before these
 * helpers were lazy, evaluating `following.tsx` or `tripDates.ts` on a
 * stripped-down Hermes build would throw at module top level, which
 * would silently break the entire App.tsx import graph (presenting on
 * iOS as "AppRoot module did not export a React component").
 */

describe('Intl formatters are lazy + defensive', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('tripDates module loads when Intl.DateTimeFormat throws', () => {
    jest.isolateModules(() => {
      const realDTF = Intl.DateTimeFormat;
      // Force the constructor to throw; the module should still load.
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function ThrowingDTF() {
        throw new Error('synthetic: Intl unavailable');
      } as unknown as typeof Intl.DateTimeFormat;
      try {
        const mod = require('../utils/tripDates');
        expect(typeof mod.formatMonthYear).toBe('function');
        // The fallback formatter should still produce a sensible string for
        // a known month/year pair.
        const formatted = mod.formatMonthYear(3, 2026);
        expect(formatted).toMatch(/March\s+2026/);
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = realDTF;
      }
    });
  });

  it('following module loads when Intl.RelativeTimeFormat throws', () => {
    jest.isolateModules(() => {
      const realRTF = (Intl as { RelativeTimeFormat?: unknown }).RelativeTimeFormat;
      (Intl as { RelativeTimeFormat: unknown }).RelativeTimeFormat = function ThrowingRTF() {
        throw new Error('synthetic: Intl.RelativeTimeFormat unavailable');
      } as unknown as typeof Intl.RelativeTimeFormat;
      try {
        // Mock the tab module's tight deps so we only exercise top-level eval.
        expect(() => require('../tabs/following')).not.toThrow();
      } finally {
        if (realRTF) {
          (Intl as { RelativeTimeFormat: unknown }).RelativeTimeFormat = realRTF;
        }
      }
    });
  });
});
