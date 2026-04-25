// Contract test: server/src/utils/{coveredBy,itineraryStatus}.ts maintain the
// same behavior as packages/domain/src/{coveredBy,itineraryStatus}.ts.
// Tsjest's __tests__ tsconfig lets us import across workspaces here even
// though the production server tsconfig does not.

import * as serverCoveredBy from '../src/utils/coveredBy';
import * as serverStatus from '../src/utils/itineraryStatus';
import * as domainCoveredBy from '../../packages/domain/src/coveredBy';
import * as domainStatus from '../../packages/domain/src/itineraryStatus';

describe('packages/domain contract', () => {
  describe('itineraryStatus', () => {
    it('has identical status constants', () => {
      expect([...serverStatus.ITINERARY_STATUSES]).toEqual([...domainStatus.ITINERARY_STATUSES]);
      expect(serverStatus.DEFAULT_NEW_ITINERARY_STATUS).toBe(domainStatus.DEFAULT_NEW_ITINERARY_STATUS);
      expect(serverStatus.LEGACY_ITINERARY_STATUS).toBe(domainStatus.LEGACY_ITINERARY_STATUS);
    });

    const normalizeCases: unknown[] = [
      'Needed', 'Proposed', 'Booked', 'Cancelled', 'Completed',
      'needed', 'booked', null, undefined, '', 0, {}, [],
    ];
    it.each(normalizeCases.map((v) => [String(v)]))(
      'normalizeItineraryStatus agrees for %p',
      (_label) => {
        for (const v of normalizeCases) {
          expect(serverStatus.normalizeItineraryStatus(v)).toBe(
            domainStatus.normalizeItineraryStatus(v)
          );
        }
      }
    );

    it('shouldRelaxRequiredFields agrees across status variants', () => {
      for (const v of normalizeCases) {
        expect(serverStatus.shouldRelaxRequiredFields(v)).toBe(
          domainStatus.shouldRelaxRequiredFields(v)
        );
      }
    });
  });

  describe('coveredBy', () => {
    const cases: Array<Record<string, string>> = [
      {},
      { a: 'b' },
      { a: 'b', b: 'a' }, // cycle
      { a: 'b', b: 'c', c: 'a' }, // longer cycle
      { a: 'b', b: 'c' }, // chain, no cycle
      { a: 'b', c: 'a' }, // conflict (a both covered and covering)
      { a: 'b', c: 'd' }, // independent, no cycle, no conflict
    ];

    it('detectCycle agrees for all cases', () => {
      for (const c of cases) {
        expect(serverCoveredBy.detectCycle(c)).toBe(domainCoveredBy.detectCycle(c));
      }
    });

    it('detectCoveringConflict agrees for all cases', () => {
      for (const c of cases) {
        expect(serverCoveredBy.detectCoveringConflict(c)).toBe(
          domainCoveredBy.detectCoveringConflict(c)
        );
      }
    });
  });
});
