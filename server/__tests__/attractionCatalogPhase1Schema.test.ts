import { parseAttractionCatalogCsv, stringifyAttractionCatalogCsv, classifyAttractionPopularity } from '../src/services/attractionsCatalogService';
import type { AttractionCatalogEntry } from '../src/types';

describe('Phase 1 attraction catalog fields', () => {
  test('round-trips enrichment fields through the CSV mirror', () => {
    const entry: AttractionCatalogEntry = {
      id: 'attr:louvre', destinationKey: 'paris', destinationDisplayName: 'Paris', name: 'Louvre Museum',
      rank: 1, activityType: 'Ticketed Attraction', interestTags: ['culture'], budgetTier: 'paid',
      lat: 48.8606, lon: 2.3376, popularityScore: 92, primaryTag: 'culture',
      wikipediaTitle: 'Louvre Museum', wikipediaPageId: 19675, updatedAt: '2026-07-12T00:00:00.000Z',
      wikipediaSummary: 'The Louvre is a national art museum in Paris.',
    };
    expect(parseAttractionCatalogCsv(stringifyAttractionCatalogCsv([entry]))[0]).toMatchObject({
      popularityScore: 92, primaryTag: 'culture', wikipediaTitle: 'Louvre Museum', wikipediaPageId: 19675,
      wikipediaSummary: 'The Louvre is a national art museum in Paris.',
    });
  });

  test('classifies popularity without representing unknown scores as hidden gems', () => {
    expect(classifyAttractionPopularity(90)).toBe('must-see');
    expect(classifyAttractionPopularity(60)).toBe('popular');
    expect(classifyAttractionPopularity(30)).toBe('hidden-gem');
    expect(classifyAttractionPopularity(null)).toBe('unknown');
  });
});
