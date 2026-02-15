import { fetchAirportDataset } from './airportDatasetApi';

const AIRPORT_DATASET_CALLER_DAILY_REFRESH = 'DAILY_REFRESH';

export const downloadAirportDatasetForDailyRefresh = async (): Promise<any[]> => {
  const data = await fetchAirportDataset({
    caller: AIRPORT_DATASET_CALLER_DAILY_REFRESH,
    url: 'https://raw.githubusercontent.com/algolia/datasets/master/airports/airports.json',
  });
  return Array.isArray(data) ? data : [];
};

