/// <reference types="jest" />
/// <reference types="node" />
import { loadBundledAirportDataset, searchBundledAirportDataset } from '../src/services/airportCatalog';

describe('bundled airport catalog fallback', () => {
  it('includes Cleveland Hopkins from the bundled dataset', () => {
    const airports = loadBundledAirportDataset();
    expect(airports.some((airport) => airport.iata_code === 'CLE')).toBe(true);
  });

  it('finds Cleveland by CLE query', () => {
    const results = searchBundledAirportDataset('CLE');
    expect(results).toContain('Cleveland (CLE)');
  });
});
