import { reserveApiUsageOrThrow } from './usageLimiter';

export const fetchAirportDataset = async (params: {
  caller: string;
  url: string;
}): Promise<unknown> => {
  await reserveApiUsageOrThrow({ provider: 'AIRPORT_DATASET', caller: params.caller });
  const response = await fetch(params.url);
  return response.json();
};

