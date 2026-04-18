import { fetchAirportDataset } from './airportDatasetApi';
import { AIRPORT_DATASET_URL } from '../services/airportCatalog';

const AIRPORT_DATASET_CALLER_DAILY_REFRESH = 'DAILY_REFRESH';

export const downloadAirportDatasetForDailyRefresh = async (): Promise<any[]> => {
  const data = await fetchAirportDataset({
    caller: AIRPORT_DATASET_CALLER_DAILY_REFRESH,
    url: AIRPORT_DATASET_URL,
  });
  return Array.isArray(data) ? data : [];
};

