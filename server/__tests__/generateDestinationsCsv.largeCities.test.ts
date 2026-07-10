/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import { getDestinationIdentityKey } from '../src/services/destinationCsvReconciliation';
import { applyMillionPlusCoverage, fetchMillionPlusCitySeeds } from '../src/services/destinationLargeCityCoverage';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('generate destinations csv large-city coverage', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
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
  });
});
