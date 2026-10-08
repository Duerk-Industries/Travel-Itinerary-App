import { getApiCacheSetting } from '../config/apiLimits';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { logError, logInfo } from '../logger';
import { getDbAdapter } from '../db.providers';

export interface LodgingLocation {
  placeId: string;
  name: string;
  address?: string | null;
  phoneNumber?: string | null;
  ianaTimezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export const ensureLodgingLocation = async (placeId: string, name: string, address?: string): Promise<LodgingLocation> => {
  const adapter = getDbAdapter();
  // Placeholder for adapter method. I'll need to add this to the adapter interface.
  const existing = await (adapter as any).getLodgingLocation(placeId);
  if (existing && existing.ianaTimezone) return existing;

  logInfo(`[lodging-location] resolving facts for placeId=${placeId} name=${name}`);

  // No Places/Time Zone lookup exists yet, so coordinates and zone stay unknown (null) rather
  // than fake values: 'UTC' at 0,0 looked valid and would misclassify trip phases. Older rows
  // holding exactly that placeholder are ignored by tripTimezoneService.
  const location: LodgingLocation = {
    placeId,
    name,
    address: address || null,
    ianaTimezone: null,
    latitude: null,
    longitude: null,
  };

  await (adapter as any).upsertLodgingLocation(location);
  return location;
};
