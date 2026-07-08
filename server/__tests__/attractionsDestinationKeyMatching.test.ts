/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../src/db', () => ({
  listAttractionCatalogEntries: jest.fn(),
  upsertAttractionCatalogEntry: jest.fn(),
  getAttractionShortlistBlob: jest.fn(),
  upsertAttractionShortlistBlob: jest.fn(),
}));

import {
  normalizeDestinationKey,
  syncAttractionsCatalogFromCsvToDbOnStartup,
} from '../src/services/attractionsCatalogService';

const mockedDb = jest.requireMock('../src/db') as {
  upsertAttractionCatalogEntry: jest.Mock;
};

describe('attractions destination key matching', () => {
  describe('normalizeDestinationKey', () => {
    it('folds hyphenated slugs and typed names to the same key', () => {
      expect(normalizeDestinationKey('new-york-city')).toBe('new york city');
      expect(normalizeDestinationKey('New York City')).toBe('new york city');
      expect(normalizeDestinationKey('new-york-city')).toBe(normalizeDestinationKey('New York City'));
    });

    it('leaves single-word destinations unchanged', () => {
      expect(normalizeDestinationKey('Boston')).toBe('boston');
      expect(normalizeDestinationKey('boston')).toBe('boston');
    });

    it('handles other multi-word / hyphenated cities consistently', () => {
      expect(normalizeDestinationKey('los-angeles')).toBe(normalizeDestinationKey('Los Angeles'));
      expect(normalizeDestinationKey('the-bronx')).toBe(normalizeDestinationKey('The Bronx'));
    });
  });

  describe('syncAttractionsCatalogFromCsvToDbOnStartup', () => {
    let tmpDir = '';
    let previousCsvPath: string | undefined;
    let previousRunLocal: string | undefined;

    beforeEach(() => {
      mockedDb.upsertAttractionCatalogEntry.mockReset();
      mockedDb.upsertAttractionCatalogEntry.mockResolvedValue(null);
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-seed-'));
      previousCsvPath = process.env.ATTRACTIONS_CSV_LOCAL_PATH;
      previousRunLocal = process.env.RUN_LOCAL;
      // Force local-file CSV read (isLocalEnv) so the seed doesn't try Firebase Storage.
      process.env.RUN_LOCAL = '1';
    });

    afterEach(() => {
      if (previousCsvPath === undefined) delete process.env.ATTRACTIONS_CSV_LOCAL_PATH;
      else process.env.ATTRACTIONS_CSV_LOCAL_PATH = previousCsvPath;
      if (previousRunLocal === undefined) delete process.env.RUN_LOCAL;
      else process.env.RUN_LOCAL = previousRunLocal;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('canonicalizes hyphenated CSV destination keys to the space-form on seed', async () => {
      const attractionsPath = path.join(tmpDir, 'attractions_catalog.csv');
      fs.writeFileSync(
        attractionsPath,
        [
          'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
          'attr:new-york-city:statue-of-liberty,new-york-city,New York City,United States,New York,Statue of Liberty,1,Sights & Landmarks,culture,https://example/sol,wiki,Icon,3,paid,2026-03-01T00:00:00.000Z,72,Q9202,40.6892,-74.0445',
          'attr:boston:fenway-park,boston,Boston,United States,Massachusetts,Fenway Park,6,Outdoor Activity,outdoors,https://example/fp,wiki,Ballpark,3,free,2026-03-01T00:00:00.000Z,29,Q49136,42.3467,-71.0972',
        ].join('\n'),
        'utf8'
      );
      process.env.ATTRACTIONS_CSV_LOCAL_PATH = attractionsPath;

      await syncAttractionsCatalogFromCsvToDbOnStartup();

      const upserted = mockedDb.upsertAttractionCatalogEntry.mock.calls.map((call) => call[0]);
      const nyc = upserted.find((row: any) => row.name === 'Statue of Liberty');
      const boston = upserted.find((row: any) => row.name === 'Fenway Park');

      // Stored key now matches what a lookup for "New York City" -> "new york city" produces.
      expect(nyc.destinationKey).toBe('new york city');
      // The stable slug id is preserved regardless of the normalized key.
      expect(nyc.id).toBe('attr:new-york-city:statue-of-liberty');
      // Single-word destinations are unaffected.
      expect(boston.destinationKey).toBe('boston');
    });
  });
});
