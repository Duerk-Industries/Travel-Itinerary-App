import { applyHardFilters } from '../src/services/candidateHardFilterService';
import { buildItineraryPreferenceContract, type PreferenceContractInput } from '../src/services/itineraryPreferenceContract';
import { buildPodBasedShortlist } from '../src/services/podBasedShortlisterService';
import type { AttractionCatalogEntry, InterestTag } from '../src/types';

const weights = { outdoors: 10, adventure: 5, culture: 45, food: 10, nightlife: 5, relax: 5, photography: 5, authentic_local: 10, iconic_landmarks: 5 };
const make = (name: string, rank: number, tags: InterestTag[]): AttractionCatalogEntry => ({
  id: name, destinationKey: 'x', destinationDisplayName: 'X', name, rank, activityType: 'Open Access',
  interestTags: tags, updatedAt: '2026-01-01T00:00:00Z',
});

const base: PreferenceContractInput = {
  trip: {
    p: 'F', c: 'M', mob: 'H', car: 'P', is: 'mixed',
    w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
  },
  account: { interests: [] }, travelers: [],
};

describe('itinerary Phase 2A candidate hard filter', () => {
  test('rejects (not down-scores) a candidate matching a traveler exclusion tag', () => {
    const museum = make('History Museum', 1, ['culture']);
    const market = make('Food Market', 2, ['food']);
    const result = applyHardFilters({
      entries: [museum, market],
      exclusions: [{ tag: 'culture', source: 'traveler', reason: 'Recognized traveler exclusion: no museums' }],
    });
    expect(result.admitted.map((entry) => entry.name)).toEqual(['Food Market']);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'excluded_interest', entry: museum }),
    ]);
  });

  test('passes candidates through untouched when there are no exclusions', () => {
    const entries = [make('Museum', 1, ['culture']), make('Market', 2, ['food'])];
    const result = applyHardFilters({ entries });
    expect(result.admitted).toEqual(entries);
    expect(result.rejected).toEqual([]);
  });

  test('booked-time-conflict and verified-closure rejections apply only for the matching date', () => {
    const museum = make('Museum', 1, ['culture']);
    const other = make('Park', 2, ['outdoors']);
    const result = applyHardFilters({
      entries: [museum, other],
      dateKey: '2026-08-01',
      bookedConstraints: [{ dateKey: '2026-08-01', conflictingEntryIds: ['Museum'], label: 'Booked train departs 10:00' }],
    });
    expect(result.admitted.map((e) => e.name)).toEqual(['Park']);
    expect(result.rejected[0]).toMatchObject({ reason: 'booked_time_conflict' });

    const notConflictingOnOtherDate = applyHardFilters({
      entries: [museum, other],
      dateKey: '2026-08-02',
      bookedConstraints: [{ dateKey: '2026-08-01', conflictingEntryIds: ['Museum'], label: 'Booked train departs 10:00' }],
    });
    expect(notConflictingOnOtherDate.admitted.map((e) => e.name)).toEqual(['Museum', 'Park']);
  });

  test('the preference-contract exclusion parser recognizes negation phrasing and is order-independent', () => {
    const forward = buildItineraryPreferenceContract({
      ...base,
      travelers: [{ traits: ['No museums'] }, { traits: ['Avoid nightlife'] }],
    });
    const reverse = buildItineraryPreferenceContract({
      ...base,
      travelers: [{ traits: ['Avoid nightlife'] }, { traits: ['No museums'] }],
    });
    expect(forward.exclusions).toEqual([
      { tag: 'culture', source: 'traveler', reason: 'Recognized traveler exclusion: no museums' },
      { tag: 'nightlife', source: 'traveler', reason: 'Recognized traveler exclusion: avoid nightlife' },
    ]);
    expect(reverse.exclusions).toEqual(forward.exclusions);
  });

  test('unrecognized negation phrasing does not become an exclusion or leak free text', () => {
    const contract = buildItineraryPreferenceContract({
      ...base,
      travelers: [{ traits: ['No home visits to 123 Private Street'] }],
    });
    expect(contract.exclusions).toEqual([]);
  });

  test('the full pod-based shortlist pipeline removes an excluded candidate from the final selection, not just its score', () => {
    const museum = make('History Museum', 1, ['culture']);
    const market = make('Food Market', 2, ['food']);
    const park = make('City Park', 3, ['outdoors']);
    const result = buildPodBasedShortlist({
      destination: 'X',
      entries: [museum, market, park],
      weights,
      limit: 3,
      exclusions: [{ tag: 'culture', source: 'traveler', reason: 'Recognized traveler exclusion: no museums' }],
    });
    expect(result.selected.map((entry) => entry.name)).not.toContain('History Museum');
    expect(result.hardRejections).toEqual([
      expect.objectContaining({ reason: 'excluded_interest', entry: museum }),
    ]);
  });
});
