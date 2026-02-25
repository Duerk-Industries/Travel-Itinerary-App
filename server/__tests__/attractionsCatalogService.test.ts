import {
  buildAttractionShortlistPromptBlock,
  inferBudgetTier,
  inferActivityType,
  inferInterestTags,
  parseAttractionCatalogCsv,
  stringifyAttractionCatalogCsv,
} from '../src/services/attractionsCatalogService';

describe('attractions catalog helpers', () => {
  it('classifies activity type from attraction text', () => {
    expect(inferActivityType('Museo Nacional de Antropologia')).toBe('Ticketed Attraction');
    expect(inferActivityType('Xochimilco canal tour')).toBe('Tour');
    expect(inferActivityType('Day of the Dead festival')).toBe('Event');
  });

  it('assigns interest tags from keywords', () => {
    const tags = inferInterestTags('Cooking class in Roma Norte');
    expect(tags).toContain('classes');
    expect(tags).toContain('food');
  });

  it('assigns budget tiers from attraction text and type', () => {
    expect(inferBudgetTier('Chapultepec Park walk', '', 'Open Access')).toBe('free');
    expect(inferBudgetTier('Private luxury food tour', '', 'Tour')).toBe('premium');
    expect(inferBudgetTier('Museo Nacional de Antropologia', '', 'Ticketed Attraction')).toBe('paid');
  });

  it('round-trips catalog CSV rows', () => {
    const rows = [
      {
        id: 'attr:mexico-city:museo-nacional',
        destinationKey: 'mexico city',
        destinationDisplayName: 'Mexico City',
        name: 'Museo Nacional de Antropologia',
        rank: 1,
        activityType: 'Ticketed Attraction' as const,
        interestTags: ['culture'] as const,
        sourceUrl: 'https://example.com',
        sourceLabel: 'serpapi',
        snippet: 'Top museum',
        sourceCount: 2,
        budgetTier: 'paid' as const,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const csv = stringifyAttractionCatalogCsv(rows as any);
    const parsed = parseAttractionCatalogCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Museo Nacional de Antropologia');
    expect(parsed[0].activityType).toBe('Ticketed Attraction');
    expect(parsed[0].interestTags).toEqual(['culture']);
    expect(parsed[0].sourceCount).toBe(2);
    expect(parsed[0].budgetTier).toBe('paid');
  });

  it('builds compact prompt block from shortlisted attractions', () => {
    const block = buildAttractionShortlistPromptBlock({
      'Mexico City': [
        {
          id: 'attr:1',
          destinationKey: 'mexico city',
          destinationDisplayName: 'Mexico City',
          name: 'Museo Nacional de Antropologia',
          rank: 1,
          activityType: 'Ticketed Attraction',
          interestTags: ['culture'],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(block).toContain('Destination: Mexico City');
    expect(block).toContain('Museo Nacional de Antropologia');
  });
});
