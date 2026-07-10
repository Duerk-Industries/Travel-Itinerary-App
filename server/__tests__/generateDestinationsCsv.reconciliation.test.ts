/// <reference types="jest" />
/// <reference types="node" />
import { reconcileDestinationsWithAttractions } from '../src/services/destinationCsvReconciliation';

describe('reconcileDestinationsWithAttractions', () => {
  it('backfills missing destinations from the attractions catalog', () => {
    const destinations = [
      {
        'Destination English Name': 'Rome',
        Country: 'Italy',
        'State/Provence': 'Lazio',
        'Nearest City': 'Rome',
        'Destination Official Name': 'Roma',
      },
    ];

    const attractionsCsv = [
      'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
      'attr:rome:colosseum,rome,Rome,Italy,Lazio,Colosseum,1,Ticketed Attraction,culture,https://en.wikipedia.org/wiki/Colosseum,wikidata+wikipedia,,3,paid,2026-02-28T04:14:50.571Z,1,Q1,41.89,12.49',
      'attr:florence:uffizi,florence,Florence,Italy,Tuscany,Uffizi Gallery,1,Ticketed Attraction,culture,https://en.wikipedia.org/wiki/Uffizi,wikidata+wikipedia,,3,paid,2026-02-28T04:14:50.571Z,1,Q2,43.76,11.25',
    ].join('\n');

    const result = reconcileDestinationsWithAttractions(destinations, attractionsCsv);

    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          'Destination English Name': 'Florence',
          Country: 'Italy',
          'State/Provence': 'Tuscany',
          'Nearest City': 'Florence',
          'Destination Official Name': 'Florence',
        }),
      ])
    );
    expect(result.added).toHaveLength(1);
    expect(Array.from(result.sourceOverrides.values())).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          'https://en.wikipedia.org/wiki/Uffizi',
          'https://en.wikipedia.org/wiki/Florence',
          'https://en.wikivoyage.org/wiki/Florence',
        ]),
      ])
    );
  });
});
