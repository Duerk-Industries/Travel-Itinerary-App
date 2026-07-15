import { buildPodBasedShortlist, renderAttractionPods } from '../src/services/podBasedShortlisterService';
import type { AttractionCatalogEntry, InterestTag } from '../src/types';

const weights = { outdoors: 10, adventure: 5, culture: 45, food: 10, nightlife: 5, relax: 5, photography: 5, authentic_local: 10, iconic_landmarks: 5 };
const make = (name: string, rank: number, tags: InterestTag[], lat?: number, lon?: number): AttractionCatalogEntry => ({ id: name, destinationKey: 'x', destinationDisplayName: 'X', name, rank, activityType: 'Open Access', interestTags: tags, lat: lat ?? null, lon: lon ?? null, updatedAt: '2026-01-01T00:00:00Z' });

describe('Phase 2 pod-based shortlister', () => {
  test('applies fairness before clustering and retains selected ungeocoded items', () => {
    const result = buildPodBasedShortlist({
      destination: 'X', weights, limit: 3, mustSeeNames: ['Unlocated Food Market'],
      travelers: [{ travelerId: 'a', interests: ['Museums'] }, { travelerId: 'b', interests: ['Foodie'] }],
      entries: [
        make('Museum', 1, ['culture'], 40, -74), make('Gallery', 2, ['culture'], 40.001, -74),
        make('Unlocated Food Market', 3, ['food']), make('Park', 4, ['outdoors'], 40.1, -74),
      ],
    });
    expect(result.selected.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Museum', 'Unlocated Food Market']));
    expect(result.pods.some((pod) => pod.kind === 'locality-only' && pod.items.some((item) => item.name === 'Unlocated Food Market'))).toBe(true);
    expect(renderAttractionPods(result.pods)).toContain('no distance guarantee');
  });
});
