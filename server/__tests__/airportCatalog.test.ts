/// <reference types="jest" />
/// <reference types="node" />
import { loadBundledAirportDataset, mergeAirportSearchResults, searchBundledAirportDataset } from '../src/services/airportCatalog';

describe('bundled airport catalog fallback', () => {
  it('includes Cleveland Hopkins from the bundled dataset', () => {
    const airports = loadBundledAirportDataset();
    expect(airports.some((airport) => airport.iata_code === 'CLE')).toBe(true);
  });

  it('finds Cleveland by CLE query', () => {
    const results = searchBundledAirportDataset('CLE');
    expect(results).toContain('Cleveland (CLE)');
  });

  it('merges bundled matches even when the primary catalog is already full', () => {
    const primaryResults = Array.from({ length: 25 }, (_, index) => `Primary ${index}`);
    const results = mergeAirportSearchResults(primaryResults, 'CLE');
    expect(results).toHaveLength(25);
    expect(results).toContain('Cleveland (CLE)');
  });
});
