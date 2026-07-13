import axios from 'axios';
import { haversineKm, type LatLon } from '../utils/geo';
import { isFeatureEnabled } from './entitlementService';
import { getEnvValue } from '../env';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { logError } from '../logger';

export type TransferMobilityCode = 'L' | 'M' | 'H';

export type TransferMode = 'walk' | 'transit' | 'taxi' | 'rideshare';

export interface TransferEstimate {
  mode: TransferMode;
  minutes: number;
  distanceKm: number;
  source: 'heuristic' | 'directions_api';
}

export interface TransferEstimator {
  estimate(params: {
    from: LatLon;
    to: LatLon;
    mobility: TransferMobilityCode;
    groupSize?: number;
  }): Promise<TransferEstimate | null>;
}

// Baseline (mobility 'M') walking speed and walk/transit/taxi/rideshare distance cutoffs.
const BASE_WALK_SPEED_KMH = 4.8;
const BASE_WALK_CUTOFF_KM = 1.2;
const TRANSIT_CUTOFF_KM = 6;
const TAXI_CUTOFF_KM = 15;

const MOBILITY_WALK_SPEED_KMH: Record<TransferMobilityCode, number> = {
  L: 3.2,
  M: BASE_WALK_SPEED_KMH,
  H: 5.6,
};

const MOBILITY_WALK_CUTOFF_MULTIPLIER: Record<TransferMobilityCode, number> = {
  L: 0.6,
  M: 1,
  H: 1.3,
};

const getGroupBufferMultiplier = (groupSize?: number): number => {
  const size = Math.max(1, Math.round(Number(groupSize) || 1));
  // Two travelers are the baseline used by the duration heuristics. Add 5%
  // per additional traveler so omitted/small groups do not get an arbitrary
  // penalty while a group of eight receives the intended ~30% gathering buffer.
  return 1 + Math.max(0, size - 2) * 0.05;
};

export class HeuristicTransferEstimator implements TransferEstimator {
  async estimate(params: {
    from: LatLon;
    to: LatLon;
    mobility: TransferMobilityCode;
    groupSize?: number;
  }): Promise<TransferEstimate | null> {
    const { from, to, mobility, groupSize } = params;
    if (
      !Number.isFinite(from?.lat) ||
      !Number.isFinite(from?.lon) ||
      !Number.isFinite(to?.lat) ||
      !Number.isFinite(to?.lon)
    ) {
      return null;
    }
    const distanceKm = haversineKm(from, to);
    const walkCutoffKm = BASE_WALK_CUTOFF_KM * (MOBILITY_WALK_CUTOFF_MULTIPLIER[mobility] ?? 1);
    const walkSpeedKmh = MOBILITY_WALK_SPEED_KMH[mobility] ?? BASE_WALK_SPEED_KMH;
    const groupMultiplier = getGroupBufferMultiplier(groupSize);

    if (distanceKm <= walkCutoffKm) {
      const minutes = Math.max(1, Math.round(((distanceKm / walkSpeedKmh) * 60) * groupMultiplier));
      return { mode: 'walk', minutes, distanceKm, source: 'heuristic' };
    }
    if (distanceKm <= TRANSIT_CUTOFF_KM) {
      const minutes = Math.max(5, Math.round(((distanceKm / 18) * 60 + 8) * groupMultiplier));
      return { mode: 'transit', minutes, distanceKm, source: 'heuristic' };
    }
    if (distanceKm <= TAXI_CUTOFF_KM) {
      const minutes = Math.max(5, Math.round(((distanceKm / 30) * 60) * groupMultiplier));
      return { mode: 'taxi', minutes, distanceKm, source: 'heuristic' };
    }
    const minutes = Math.max(10, Math.round(((distanceKm / 35) * 60) * groupMultiplier));
    return { mode: 'rideshare', minutes, distanceKm, source: 'heuristic' };
  }
}

const GOOGLE_ROUTES_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const GOOGLE_ROUTES_TIMEOUT_MS = 8000;

type GoogleTravelMode = 'WALK' | 'TRANSIT' | 'DRIVE';

// Google's computeRouteMatrix requires one travelMode per request (it can't return
// walk/transit/drive alternatives in a single call). Rather than pay for multiple modes per
// pair, reuse the free haversine heuristic to pick the mode first, then spend the one paid
// call confirming that mode's real duration/distance.
const chooseGoogleTravelMode = (heuristicMode: TransferMode): GoogleTravelMode => {
  if (heuristicMode === 'walk') return 'WALK';
  if (heuristicMode === 'transit') return 'TRANSIT';
  return 'DRIVE'; // taxi/rideshare have no Google Routes equivalent; DRIVE is the closest real proxy
};

const parseDurationSeconds = (raw: unknown): number | null => {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
};

// Real-routing implementation behind the `attractions_transfer_directions_api` feature flag,
// using Google's Routes API (computeRouteMatrix). Never throws to the caller and never leaves a
// pair unestimated on failure — any missing config, rate-limit block, or API error falls back to
// the (already-computed, free) heuristic estimate for that same pair.
export class DirectionsApiTransferEstimator implements TransferEstimator {
  async estimate(params: {
    from: LatLon;
    to: LatLon;
    mobility: TransferMobilityCode;
    groupSize?: number;
  }): Promise<TransferEstimate | null> {
    const { from, to, mobility, groupSize } = params ?? ({} as typeof params);

    // Mirrors HeuristicTransferEstimator's own guard, and doubles as the free mode-selection step.
    const heuristicEstimate = await new HeuristicTransferEstimator().estimate({ from, to, mobility, groupSize });
    if (!heuristicEstimate) return null;

    // Chapter 16 §6: Minimize costs by skipping paid API calls for short walking legs
    // where haversine is highly accurate.
    if (heuristicEstimate.distanceKm < 0.5 && heuristicEstimate.mode === 'walk') {
      return heuristicEstimate;
    }

    const apiKey = getEnvValue('GOOGLE_ROUTES_API_KEY');
    if (!apiKey) return heuristicEstimate;

    try {
      await reserveApiUsageOrThrow({ provider: 'GOOGLE_ROUTES', caller: 'ATTRACTION_TRANSFER_MATRIX' });
    } catch (err) {
      if (err instanceof ApiLimitExceededError) {
        logError('[transfer] Google Routes API budget/rate limit reached; using heuristic estimate for this pair', err);
        return heuristicEstimate;
      }
      throw err;
    }
    await recordProviderRequestCost({ provider: 'GOOGLE_ROUTES' });

    const travelMode = chooseGoogleTravelMode(heuristicEstimate.mode);
    try {
      const response = await axios.post(
        GOOGLE_ROUTES_MATRIX_URL,
        {
          origins: [{ waypoint: { location: { latLng: { latitude: from.lat, longitude: from.lon } } } }],
          destinations: [{ waypoint: { location: { latLng: { latitude: to.lat, longitude: to.lon } } } }],
          travelMode,
          ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
        },
        {
          timeout: GOOGLE_ROUTES_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
          },
        }
      );
      const element = Array.isArray(response.data) ? response.data[0] : null;
      const seconds = parseDurationSeconds(element?.duration);
      const distanceMeters = Number(element?.distanceMeters);
      if (element?.condition !== 'ROUTE_EXISTS' || seconds == null || !Number.isFinite(distanceMeters)) {
        return heuristicEstimate;
      }
      const groupMultiplier = getGroupBufferMultiplier(groupSize);
      return {
        mode: heuristicEstimate.mode,
        minutes: Math.max(1, Math.round((seconds / 60) * groupMultiplier)),
        distanceKm: distanceMeters / 1000,
        source: 'directions_api',
      };
    } catch (err) {
      logError('[transfer] Google Routes API call failed; using heuristic estimate for this pair', err);
      return heuristicEstimate;
    }
  }
}

export const getTransferEstimator = async (): Promise<TransferEstimator> => {
  const useDirectionsApi = await isFeatureEnabled('attractions_transfer_directions_api');
  return useDirectionsApi ? new DirectionsApiTransferEstimator() : new HeuristicTransferEstimator();
};
