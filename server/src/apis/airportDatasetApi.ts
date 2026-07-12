import { reserveApiUsageOrThrow } from './usageLimiter';
import { recordProviderRequestCost } from './providerBudgeting';

export const fetchAirportDataset = async (params: {
  caller: string;
  url: string;
}): Promise<unknown> => {
  await reserveApiUsageOrThrow({ provider: 'AIRPORT_DATASET', caller: params.caller });
  await recordProviderRequestCost({ provider: 'AIRPORT_DATASET' });
  const response = await fetch(params.url);
  return response.json();
};

