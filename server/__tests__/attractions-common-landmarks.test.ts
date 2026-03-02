import fs from 'fs';
import path from 'path';
import { parseAttractionCatalogCsv } from '../src/services/attractionsCatalogService';

describe('attractions catalog common landmark coverage', () => {
  it('contains major landmarks for key destinations', () => {
    const filePath = path.resolve(__dirname, '../data/attractions_catalog.csv');
    const rows = parseAttractionCatalogCsv(fs.readFileSync(filePath, 'utf8'));

    const hasAttraction = (destination: string, pattern: RegExp): boolean =>
      rows.some(
        (row) =>
          row.destinationDisplayName === destination &&
          pattern.test(String(row.name ?? ''))
      );

    expect(hasAttraction('Rome', /Colosseum/i)).toBe(true);
    expect(hasAttraction('Rome', /Trevi Fountain/i)).toBe(true);
    expect(hasAttraction('Paris', /Eiffel Tower/i)).toBe(true);
    expect(hasAttraction('Paris', /Louvre/i)).toBe(true);
    expect(hasAttraction('New York City', /Statue of Liberty/i)).toBe(true);
    expect(hasAttraction('New York City', /Central Park/i)).toBe(true);
  });
});

