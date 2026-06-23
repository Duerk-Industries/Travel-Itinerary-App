/// <reference types="jest" />
/// <reference types="node" />
import { dedupeAttractionsCatalogLines } from '../src/services/attractionsCatalogDedup';

describe('generate curated attractions final dedupe', () => {
  it('removes duplicate attraction rows per destination and reranks survivors', () => {
    const lines = [
      'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
      'attr:rome:colosseum-a,rome,Rome,Italy,Lazio,Colosseum,1,Ticketed Attraction,culture,https://example/a,wiki,,2,paid,2026-03-01T00:00:00.000Z,10,Q42,41.89,12.49',
      'attr:rome:colosseum-b,rome,Rome,Italy,Lazio,Colosseum,3,Ticketed Attraction,culture,https://example/b,wiki,,4,paid,2026-03-02T00:00:00.000Z,20,Q42,41.89,12.49',
      'attr:rome:trevi,rome,Rome,Italy,Lazio,Trevi Fountain,4,Sights & Landmarks,culture,https://example/c,wiki,,2,free,2026-03-01T00:00:00.000Z,9,Q43,41.90,12.48',
      'attr:paris:louvre-a,paris,Paris,France,Ile-de-France,Louvre Museum,5,Ticketed Attraction,culture,https://example/d,wiki,,2,paid,2026-03-01T00:00:00.000Z,15,,48.86,2.33',
      'attr:paris:louvre-b,paris,Paris,France,Ile-de-France,Louvre Museum,2,Ticketed Attraction,culture,https://example/e,wiki,,3,paid,2026-03-03T00:00:00.000Z,16,,48.86,2.33',
    ];

    const deduped = dedupeAttractionsCatalogLines(lines);

    expect(deduped).toHaveLength(4);
    expect(deduped.filter((line) => line.includes(',Rome,') && /Colosseum/.test(line))).toHaveLength(1);
    expect(deduped.filter((line) => line.includes(',Paris,') && /Louvre Museum/.test(line))).toHaveLength(1);

    const romeRows = deduped.filter((line) => line.includes(',Rome,'));
    expect(romeRows[0]).toContain(',Colosseum,1,');
    expect(romeRows[0]).toContain(',4,paid,2026-03-02T00:00:00.000Z,20,Q42,');
    expect(romeRows[1]).toContain(',Trevi Fountain,2,');

    const parisRows = deduped.filter((line) => line.includes(',Paris,'));
    expect(parisRows[0]).toContain(',Louvre Museum,1,');
    expect(parisRows[0]).toContain(',3,paid,2026-03-03T00:00:00.000Z,16,,');
  });
});
