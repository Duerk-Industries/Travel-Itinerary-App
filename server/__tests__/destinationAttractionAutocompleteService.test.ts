import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearDestinationAttractionAutocompleteCache,
  searchDestinationLocationOptions,
  searchAttractionOptionsForSelectedLocations,
} from '../src/services/destinationAttractionAutocompleteService';

describe('destination attraction autocomplete filtering', () => {
  let tmpDir = '';
  let previousDestinationsPath: string | undefined;
  let previousAttractionsPath: string | undefined;

  beforeEach(() => {
    clearDestinationAttractionAutocompleteCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-autocomplete-'));
    previousDestinationsPath = process.env.DESTINATIONS_CSV_LOCAL_PATH;
    previousAttractionsPath = process.env.ATTRACTIONS_CSV_LOCAL_PATH;
  });

  afterEach(() => {
    clearDestinationAttractionAutocompleteCache();
    if (previousDestinationsPath === undefined) delete process.env.DESTINATIONS_CSV_LOCAL_PATH;
    else process.env.DESTINATIONS_CSV_LOCAL_PATH = previousDestinationsPath;
    if (previousAttractionsPath === undefined) delete process.env.ATTRACTIONS_CSV_LOCAL_PATH;
    else process.env.ATTRACTIONS_CSV_LOCAL_PATH = previousAttractionsPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes attractions for all destinations under an explicitly selected country', async () => {
    const destinationsPath = path.join(tmpDir, 'destinations.csv');
    const attractionsPath = path.join(tmpDir, 'attractions_catalog.csv');
    fs.writeFileSync(
      destinationsPath,
      [
        'Destination English Name,Country,State/Provence,Nearest City,Destination Official Name,Attractions Updated',
        'Paris,France,Ile-de-France,Paris,Paris,2026-03-01',
        'Nice,France,Provence-Alpes-Cote d Azur,Nice,Nice,2026-03-01',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      attractionsPath,
      [
        'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
        'attr:paris:louvre,paris,Paris,France,Ile-de-France,Louvre Museum,1,Ticketed Attraction,culture,https://example/louvre,wiki,Top museum,2,paid,2026-03-01T00:00:00.000Z,10,Q1,48.8606,2.3376',
        'attr:nice:matisse,nice,Nice,France,Provence-Alpes-Cote d Azur,Matisse Museum,1,Ticketed Attraction,culture,https://example/matisse,wiki,Art museum,2,paid,2026-03-01T00:00:00.000Z,10,Q2,43.7198,7.2763',
      ].join('\n'),
      'utf8'
    );
    process.env.DESTINATIONS_CSV_LOCAL_PATH = destinationsPath;
    process.env.ATTRACTIONS_CSV_LOCAL_PATH = attractionsPath;

    const results = await searchAttractionOptionsForSelectedLocations({
      query: 'museum',
      selectedLocationNames: ['France'],
      selectedLocationIds: ['country:33'],
      limit: 10,
    });
    const names = results.map((item) => item.name);
    expect(names).toContain('Louvre Museum');
    expect(names).toContain('Matisse Museum');
  });

  it('limits attractions to destinations under an explicitly selected state/province', async () => {
    const destinationsPath = path.join(tmpDir, 'destinations.csv');
    const attractionsPath = path.join(tmpDir, 'attractions_catalog.csv');
    fs.writeFileSync(
      destinationsPath,
      [
        'Destination English Name,Country,State/Provence,Nearest City,Destination Official Name,Attractions Updated',
        'Paris,France,Ile-de-France,Paris,Paris,2026-03-01',
        'Nice,France,Provence-Alpes-Cote d Azur,Nice,Nice,2026-03-01',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      attractionsPath,
      [
        'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
        'attr:paris:louvre,paris,Paris,France,Ile-de-France,Louvre Museum,1,Ticketed Attraction,culture,https://example/louvre,wiki,Top museum,2,paid,2026-03-01T00:00:00.000Z,10,Q1,48.8606,2.3376',
        'attr:nice:matisse,nice,Nice,France,Provence-Alpes-Cote d Azur,Matisse Museum,1,Ticketed Attraction,culture,https://example/matisse,wiki,Art museum,2,paid,2026-03-01T00:00:00.000Z,10,Q2,43.7198,7.2763',
      ].join('\n'),
      'utf8'
    );
    process.env.DESTINATIONS_CSV_LOCAL_PATH = destinationsPath;
    process.env.ATTRACTIONS_CSV_LOCAL_PATH = attractionsPath;

    const results = await searchAttractionOptionsForSelectedLocations({
      query: 'museum',
      selectedLocationNames: ['Ile-de-France'],
      selectedLocationIds: ['state:11'],
      limit: 10,
    });
    const names = results.map((item) => item.name);
    expect(names).toContain('Louvre Museum');
    expect(names).not.toContain('Matisse Museum');
  });

  it('does not read the attractions CSV when serving destination-only autocomplete', async () => {
    const destinationsPath = path.join(tmpDir, 'destinations.csv');
    const attractionsPath = path.join(tmpDir, 'attractions_catalog.csv');
    fs.writeFileSync(
      destinationsPath,
      [
        'Destination English Name,Country,State/Provence,Nearest City,Destination Official Name,Attractions Updated',
        'Chicago,United States,Illinois,Chicago,Chicago,2026-03-01',
        'Chiclayo,Peru,Lambayeque,Chiclayo,Chiclayo,2026-03-01',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      attractionsPath,
      [
        'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
        'attr:chicago:bean,chicago,Chicago,United States,Illinois,Cloud Gate,1,Open Access,landmark,https://example/bean,wiki,Iconic sculpture,2,free,2026-03-01T00:00:00.000Z,10,Q1,41.8826,-87.6233',
      ].join('\n'),
      'utf8'
    );
    process.env.DESTINATIONS_CSV_LOCAL_PATH = destinationsPath;
    process.env.ATTRACTIONS_CSV_LOCAL_PATH = attractionsPath;

    const readSpy = jest.spyOn(fs, 'readFileSync');

    const results = await searchDestinationLocationOptions('chic', 10);

    expect(results.map((item) => item.name)).toContain('Chicago');
    expect(
      readSpy.mock.calls.some((call) => String(call[0]).includes('attractions_catalog.csv'))
    ).toBe(false);

    readSpy.mockRestore();
  });
});
