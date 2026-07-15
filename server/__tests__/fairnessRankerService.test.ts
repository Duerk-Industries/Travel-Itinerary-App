import { rankAttractionsForGroup, selectWithFairnessFloor } from '../src/services/fairnessRankerService';
import type { AttractionCatalogEntry, InterestTag } from '../src/types';

const weights = { outdoors: 10, adventure: 5, culture: 50, food: 10, nightlife: 5, relax: 5, photography: 5, authentic_local: 5, iconic_landmarks: 5 };
const make = (name: string, rank: number, tags: InterestTag[]): AttractionCatalogEntry => ({ id: name, destinationKey: 'x', destinationDisplayName: 'X', name, rank, activityType: 'Open Access', interestTags: tags, updatedAt: '2026-01-01T00:00:00Z' });

describe('Phase 2 fairness ranker', () => {
  test('uses the documented weighted score and prioritizes must-sees', () => {
    const ranked = rankAttractionsForGroup({ entries: [make('Museum', 1, ['culture']), make('Food Market', 2, ['food'])], weights, mustSeeNames: ['Food Market'] });
    expect(ranked[0].entry.name).toBe('Food Market');
    expect(ranked[0].score).toBeCloseTo(ranked[0].interestMatch * 0.5 + 0.3 + ranked[0].geoProximity * 0.2);
  });

  test('fairness floor represents each traveler when a matching candidate exists', () => {
    const ranked = rankAttractionsForGroup({ entries: [make('Museum', 1, ['culture']), make('Gallery', 2, ['culture']), make('Food Market', 3, ['food'])], weights });
    const selected = selectWithFairnessFloor({ ranked, limit: 2, travelers: [
      { travelerId: 'a', interests: ['culture'] }, { travelerId: 'b', interests: ['food'] },
    ] });
    expect(selected.map((candidate) => candidate.entry.name)).toEqual(expect.arrayContaining(['Museum', 'Food Market']));
  });
});

