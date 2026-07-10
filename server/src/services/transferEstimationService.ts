import { haversineKm, type LatLon } from '../utils/geo';
import { isFeatureEnabled } from './entitlementService';

export type TransferMobilityCode = 'L' | 'M' | 'H';

export type TransferMode = 'walk' | 'transit' | 'taxi' | 'rideshare';

export interface TransferEstimate {
  mode: TransferMode;
  minutes: number;
  distanceKm: number;
  source: 'heuristic' | 'directions_api';
}

export interface TransferEstimator {
  estimate(params: { from: LatLon; to: LatLon; mobility: TransferMobilityCode }): Promise<TransferEstimate | null>;
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

export class HeuristicTransferEstimator implements TransferEstimator {
  async estimate(params: { from: LatLon; to: LatLon; mobility: TransferMobilityCode }): Promise<TransferEstimate | null> {
    const { from, to, mobility } = params;
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

    if (distanceKm <= walkCutoffKm) {
      const minutes = Math.max(1, Math.round((distanceKm / walkSpeedKmh) * 60));
      return { mode: 'walk', minutes, distanceKm, source: 'heuristic' };
    }
    if (distanceKm <= TRANSIT_CUTOFF_KM) {
      const minutes = Math.max(5, Math.round((distanceKm / 18) * 60) + 8);
      return { mode: 'transit', minutes, distanceKm, source: 'heuristic' };
    }
    if (distanceKm <= TAXI_CUTOFF_KM) {
      const minutes = Math.max(5, Math.round((distanceKm / 30) * 60));
      return { mode: 'taxi', minutes, distanceKm, source: 'heuristic' };
    }
    const minutes = Math.max(10, Math.round((distanceKm / 35) * 60));
    return { mode: 'rideshare', minutes, distanceKm, source: 'heuristic' };
  }
}

// Seam for a future real-routing implementation (Google Distance Matrix/Directions).
// Intentionally unimplemented; getTransferEstimator() falls back to the heuristic
// estimator if this throws.
export class DirectionsApiTransferEstimator implements TransferEstimator {
  async estimate(): Promise<TransferEstimate | null> {
    throw new Error('DirectionsApiTransferEstimator is not yet implemented');
  }
}

export const getTransferEstimator = async (): Promise<TransferEstimator> => {
  const useDirectionsApi = await isFeatureEnabled('attractions_transfer_directions_api');
  if (!useDirectionsApi) return new HeuristicTransferEstimator();
  try {
    return new DirectionsApiTransferEstimator();
  } catch {
    return new HeuristicTransferEstimator();
  }
};
