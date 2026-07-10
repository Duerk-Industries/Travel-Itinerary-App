/// <reference types="jest" />
/// <reference types="node" />
import {
  getAttractionTarget,
  isLikelySyntheticAttractionName,
  passAttractionQualityGates,
  validateAttractionsCsv,
} from '../src/services/curatedGenerationHeuristics';

describe('curated attractions generator heuristics', () => {
  it('flags synthetic-looking attraction names', () => {
    expect(isLikelySyntheticAttractionName('Attraction 42')).toBe(true);
    expect(isLikelySyntheticAttractionName('Administrative Zone 9')).toBe(true);
    expect(isLikelySyntheticAttractionName('Louvre Museum')).toBe(false);
  });

  it('rejects candidates that do not meet source and quality gates', () => {
    const destinationContext = { qid: 'Q90', wikipediaTitle: 'Paris', coordinates: { lat: 48.8566, lon: 2.3522 } };
    const valid = passAttractionQualityGates(
      {
        name: 'Eiffel Tower',
        snippet: '',
        url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
        distanceMeters: 0,
        sitelinks: 140,
        qid: 'Q243',
        coordinates: { lat: 48.8584, lon: 2.2945 },
      } as any,
      destinationContext as any
    );
    const invalid = passAttractionQualityGates(
      {
        name: 'Attraction 15',
        snippet: '',
        url: 'https://www.wikidata.org/wiki/Q123',
        distanceMeters: 0,
        sitelinks: 1,
        qid: 'Q123',
      } as any,
      destinationContext as any
    );

    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });

  it('scales attraction targets up for globally popular destinations', () => {
    const ctx = {
      metricsByCountry: new Map([
        ['france', { iso3: 'FRA', areaKm2: 551695, population: 68000000 }],
        ['laos', { iso3: 'LAO', areaKm2: 236800, population: 7600000 }],
      ]),
      tourismByIso3: new Map([
        ['FRA', 90000000],
        ['LAO', 1200000],
      ]),
      maxArea: 9833520,
      maxPopulation: 1410000000,
      maxTourism: 90000000,
    };

    const parisTarget = getAttractionTarget(
      {
        'Destination English Name': 'Paris',
        Country: 'France',
        'State/Provence': 'Ile-de-France',
        'Nearest City': 'Paris',
        'Destination Official Name': 'Paris',
      } as any,
      ctx as any,
      24_000_000
    );
    const smallTarget = getAttractionTarget(
      {
        'Destination English Name': 'Luang Prabang',
        Country: 'Laos',
        'State/Provence': '',
        'Nearest City': 'Luang Prabang',
        'Destination Official Name': 'Luang Prabang',
      } as any,
      ctx as any,
      300_000
    );

    expect(parisTarget).toBeGreaterThan(40);
    expect(parisTarget).toBeGreaterThan(smallTarget);
  });

  it('fails verification when source_count is below 2', () => {
    const csv = [
      'id,destination_key,destination_display_name,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at',
      'attr:test:one,test,Test City,Example Place,1,Sights & Landmarks,culture,https://en.wikipedia.org/wiki/Example,wikidata+wikipedia,,1,paid,2026-01-01T00:00:00.000Z',
    ].join('\n');
    expect(() => validateAttractionsCsv(csv)).toThrow(/source_count/i);
  });
});
