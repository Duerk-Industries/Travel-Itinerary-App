import {
  buildAirportLabel,
  isInternationalAirportName,
  normalizeAirportDataset,
} from '../src/services/airportCatalog';

describe('airportCatalog', () => {
  it('normalizes airport records and flags international airports', () => {
    const airports = normalizeAirportDataset([
      {
        iata_code: 'bos',
        name: 'Boston Logan International Airport',
        city: 'Boston',
        country: 'United States',
        _geoloc: { lat: 42.3656, lng: -71.0096 },
      },
      {
        iata_code: 'bad',
        name: '',
      },
    ]);

    expect(airports).toEqual([
      {
        iata_code: 'BOS',
        name: 'Boston Logan International Airport',
        city: 'Boston',
        country: 'United States',
        lat: 42.3656,
        lng: -71.0096,
        label: 'Boston (BOS)',
        is_international: true,
        source_url: expect.stringContaining('airports.json'),
      },
    ]);
  });

  it('builds manual-flight labels from city and code', () => {
    expect(buildAirportLabel({ iata_code: 'lhr', city: 'London', name: 'Heathrow' })).toBe('London (LHR)');
  });

  it('recognizes common international naming variants', () => {
    expect(isInternationalAirportName('Aeroporto Internacional de Sao Paulo')).toBe(true);
    expect(isInternationalAirportName('Chicago Midway Airport')).toBe(false);
  });
});
