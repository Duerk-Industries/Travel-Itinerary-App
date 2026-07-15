/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import { getDestinationIdentityKey } from '../src/services/destinationCsvReconciliation';
import { applyMillionPlusCoverage, fetchMillionPlusCitySeeds } from '../src/services/destinationLargeCityCoverage';
import { ApiLimitExceededError } from '../src/apis/usageLimiter';

jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => ({
  ...jest.requireActual('../src/apis/usageLimiter'),
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedReserve = jest.requireMock('../src/apis/usageLimiter').reserveApiUsageOrThrow as jest.Mock;

describe('generate destinations csv large-city coverage', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    mockedReserve.mockReset();
    mockedReserve.mockImplementation(async () => undefined);
  });

  it('adds all 1M+ cities beyond quota and carries multiple source URLs for them', async () => {
    mockedAxios.post.mockImplementation(async (url) => {
      if (url === 'https://countriesnow.space/api/v0.1/countries/population/cities/filter') {
        return {
          data: {
            data: [
              {
                city: 'Alpha City',
                populationCounts: [{ year: '2024', value: '1800000', sex: 'Both Sexes' }],
              },
              {
                city: 'Beta City',
                populationCounts: [{ year: '2024', value: '1200000', sex: 'Both Sexes' }],
              },
            ],
          },
        } as any;
      }

      if (url === 'https://countriesnow.space/api/v0.1/countries/cities') {
        return { data: { data: [] } } as any;
      }

      throw new Error(`Unexpected POST ${url}`);
    });

    mockedAxios.get.mockImplementation(async (url) => {
      if (url === 'https://documentation-resources.huwise.com/api/records/1.0/search/') {
        return {
          data: {
            records: [
              {
                recordid: 'alpha-record',
                fields: { name: 'Alpha City', population: 1750000 },
              },
              {
                recordid: 'beta-record',
                fields: { name: 'Beta City', population: 1180000 },
              },
            ],
          },
        } as any;
      }

      throw new Error(`Unexpected GET ${url}`);
    });

    const country = {
      name: 'Freedonia',
      officialName: 'Republic of Freedonia',
      iso2: 'FD',
      iso3: 'FDO',
      capital: ['Freedon City'],
      areaKm2: 1000,
      population: 5000000,
    };

    const millionPlusSeeds = await fetchMillionPlusCitySeeds(country, [country.name, country.officialName]);
    const finalSeeds = applyMillionPlusCoverage([{ name: 'Alpha City', city: 'Alpha City', state: '' }], millionPlusSeeds);

    const destinationNames = finalSeeds.map((row) => row.name);
    expect(destinationNames).toEqual(expect.arrayContaining(['Alpha City', 'Beta City']));
    expect(destinationNames).toHaveLength(2);

    const sourceOverrides = new Map(
      finalSeeds.map((seed) => [
        getDestinationIdentityKey('Freedonia', seed.name),
        [
          `https://en.wikipedia.org/wiki/${encodeURIComponent(seed.name.replace(/\s+/g, '_'))}`,
          `https://en.wikivoyage.org/wiki/${encodeURIComponent(seed.name.replace(/\s+/g, '_'))}`,
          ...(seed.sourceUrls ?? []),
        ],
      ])
    );

    expect(sourceOverrides.get(getDestinationIdentityKey('Freedonia', 'Alpha City'))).toEqual(
      expect.arrayContaining([
        'https://en.wikipedia.org/wiki/Alpha_City',
        'https://en.wikivoyage.org/wiki/Alpha_City',
        'https://countriesnow.space/api/v0.1/countries/population/cities/filter',
        'https://documentation-resources.huwise.com/api/datasets/1.0/doc-geonames-cities-5000/records/alpha-record',
      ])
    );
    expect(sourceOverrides.get(getDestinationIdentityKey('Freedonia', 'Beta City'))).toEqual(
      expect.arrayContaining([
        'https://en.wikipedia.org/wiki/Beta_City',
        'https://en.wikivoyage.org/wiki/Beta_City',
        'https://countriesnow.space/api/v0.1/countries/population/cities/filter',
        'https://documentation-resources.huwise.com/api/datasets/1.0/doc-geonames-cities-5000/records/beta-record',
      ])
    );

    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'COUNTRY_NOW', caller: 'DESTINATION_LARGE_CITY_COVERAGE' });
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'GEONAMES', caller: 'DESTINATION_LARGE_CITY_COVERAGE' });
  });

  it('fails fast without retrying or calling the network once the CountryNow rate limit is reached', async () => {
    mockedReserve.mockImplementation(async ({ provider }: { provider: string; caller: string }) => {
      if (provider === 'COUNTRY_NOW') {
        throw new ApiLimitExceededError({ provider: 'COUNTRY_NOW', caller: 'DESTINATION_LARGE_CITY_COVERAGE', scope: 'overall', limit: 300, used: 300 });
      }
    });

    // Uses a country/iso2 not seen in the earlier test so the module-level seed caches
    // (keyed by country name / iso2) can't return a stale cached result instead of exercising
    // the reservation path.
    const seeds = await fetchMillionPlusCitySeeds(
      { name: 'Ruritania', officialName: 'Kingdom of Ruritania', iso2: 'RU2', iso3: 'RUR', capital: ['Strelsau'], areaKm2: 1000, population: 5000000 },
      ['Ruritania']
    );

    // The existing broad catch-and-cache-empty behavior absorbs the rate-limit error the same way
    // it absorbs any other provider failure, so callers see an empty (not crashed) result.
    expect(seeds).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('fails fast without retrying or calling the network once the GeoNames rate limit is reached', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [] } } as any);
    mockedReserve.mockImplementation(async ({ provider }: { provider: string; caller: string }) => {
      if (provider === 'GEONAMES') {
        throw new ApiLimitExceededError({ provider: 'GEONAMES', caller: 'DESTINATION_LARGE_CITY_COVERAGE', scope: 'overall', limit: 300, used: 300 });
      }
    });

    const seeds = await fetchMillionPlusCitySeeds(
      { name: 'Elbonia', officialName: 'Republic of Elbonia', iso2: 'EL2', iso3: 'ELB', capital: ['Elbon City'], areaKm2: 1000, population: 5000000 },
      ['Elbonia']
    );

    expect(seeds).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
