import { getDbAdapter } from '../db.providers';
import { countryCodeFromPlace } from '../utils/countryFromPlace';
import { countryCurrencies } from '../utils/countryCurrencies';

export const currencyForDestination = (destination?: string | null): string => {
  const country = countryCodeFromPlace(destination);
  return country ? countryCurrencies[country.toUpperCase()] ?? 'USD' : 'USD';
};

export const defaultTripCurrency = async (userId: string, locationIds?: string[], destination?: string | null): Promise<string> => {
  const locations = locationIds?.length ? await getDbAdapter().getLocationsByIds(userId, locationIds.slice(0, 1)) : [];
  const first = locations[0];
  return currencyForDestination(first ? `${first.name}, ${first.address ?? ''}` : destination);
};
