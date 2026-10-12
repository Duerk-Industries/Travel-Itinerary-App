/// <reference types="jest" />
/// <reference types="node" />
// Contract test: server/src/utils/{coveredBy,itineraryStatus,packingListDisplayImpl}.ts maintain
// the same behavior as packages/domain/src/{coveredBy,itineraryStatus,packingListDisplay}.ts.
// Tsjest's __tests__ tsconfig lets us import across workspaces here even
// though the production server tsconfig does not.

import * as serverCoveredBy from '../src/utils/coveredBy';
import * as serverStatus from '../src/utils/itineraryStatus';
import * as domainCoveredBy from '../../packages/domain/src/coveredBy';
import * as domainStatus from '../../packages/domain/src/itineraryStatus';
import { buildPackingListDisplayGroups as serverBuildPackingListDisplayGroups, type PackingDisplayInputGroup } from '../src/utils/packingListDisplayImpl';
import { buildPackingListDisplayGroups as domainBuildPackingListDisplayGroups } from '../../packages/domain/src/packingListDisplay';

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

  describe('packingListDisplay', () => {
    // Regression fixture for the bug where a traveler's own name reappeared as a bare packing
    // item (instead of only as their matrix column header): a preset whose catalog repeats its
    // own name as an item, and two personal contributions each seeded with a single item whose
    // label matches the contributing traveler's own name.
    const cases: PackingDisplayInputGroup[][] = [
      [
        { key: 'preset:general', label: 'General', kind: 'preset', order: 0, items: [
          { id: 'i-shoes', category: 'Clothing', label: 'Comfortable walking shoes', position: 0 },
          { id: 'i-general-heading', category: '', label: 'General', position: 1 },
        ] },
        { key: 'c1', label: 'Bryan', kind: 'personal', ownerMemberId: 'bryan', items: [
          { id: 'i-bryan', category: '', label: 'Bryan', position: 0 },
        ] },
        { key: 'c2', label: 'Linda', kind: 'personal', ownerMemberId: 'linda', items: [
          { id: 'i-linda', category: '', label: 'Linda', position: 0 },
        ] },
      ],
      [
        { key: 'personal:b', label: 'Bob personal', kind: 'personal', ownerMemberId: 'b', items: [{ id: 'b1', label: 'Kindle', category: 'Personal' }] },
        { key: 'personal:a', label: 'Alex personal', kind: 'personal', ownerMemberId: 'a', items: [{ id: 'a1', label: 'Kindle', category: 'Personal' }, { id: 'a2', label: 'Passport', category: 'Personal' }] },
        { key: 'trip_manual', label: 'Trip additions', kind: 'trip_manual', items: [{ id: 't1', label: 'Group Snacks', category: 'Food' }] },
        { key: 'beach', label: 'Beach', kind: 'preset', items: [{ id: 'p1', label: 'Towel', category: 'Beach' }] },
        { key: 'general', label: 'General', kind: 'preset', items: [{ id: 'g1', label: 'Passport', category: 'Basics' }] },
      ],
      [],
    ];

    it('agrees with the canonical domain implementation', () => {
      for (const inputGroups of cases) {
        expect(serverBuildPackingListDisplayGroups(inputGroups, 'a')).toEqual(
          domainBuildPackingListDisplayGroups(inputGroups as any, 'a')
        );
      }
    });

    it('strips a self-titled heading artifact for every group kind, not only presets', () => {
      const [regressionCase] = cases;
      for (const build of [serverBuildPackingListDisplayGroups, domainBuildPackingListDisplayGroups] as const) {
        const result = build(regressionCase as any, null);
        const labels = result.flatMap((group) => group.items.map((item) => item.label));
        expect(labels).not.toContain('General');
        expect(labels).not.toContain('Bryan');
        expect(labels).not.toContain('Linda');
        expect(labels).toEqual(['Comfortable walking shoes']);
      }
    });
  });
});
