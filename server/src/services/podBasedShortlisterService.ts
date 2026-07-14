import type { AttractionCatalogEntry } from '../types';
import type { InterestWeights } from './activityTypeInterestWeights';
import { clusterAttractionsIntoPods, type AttractionPod } from './geoPodClusteringService';
import { rankAttractionsForGroup, selectWithFairnessFloor, type TravelerInterest } from './fairnessRankerService';
import { applyHardFilters, type BookedTimedConstraint, type HardRejection, type VerifiedClosure } from './candidateHardFilterService';
import type { MobilityCode, PreferenceExclusion } from './itineraryPreferenceContract';
import type { LatLon } from '../utils/geo';

export const buildPodBasedShortlist = (params: {
  destination: string;
  entries: AttractionCatalogEntry[];
  weights: InterestWeights;
  travelers?: TravelerInterest[];
  mustSeeNames?: string[];
  anchor?: LatLon | null;
  limit?: number;
  radiusKm?: number;
  /** Phase 2A hard-filter inputs, applied before scoring. See candidateHardFilterService.ts. */
  exclusions?: PreferenceExclusion[];
  mobility?: MobilityCode;
  dateKey?: string;
  bookedConstraints?: BookedTimedConstraint[];
  verifiedClosures?: VerifiedClosure[];
}): { selected: AttractionCatalogEntry[]; pods: AttractionPod[]; hardRejections: HardRejection[] } => {
  const { admitted, rejected } = applyHardFilters({
    entries: params.entries,
    exclusions: params.exclusions,
    mobility: params.mobility,
    dateKey: params.dateKey,
    bookedConstraints: params.bookedConstraints,
    verifiedClosures: params.verifiedClosures,
  });
  const ranked = rankAttractionsForGroup({ entries: admitted, weights: params.weights, mustSeeNames: params.mustSeeNames, anchor: params.anchor });
  const selectedRanked = selectWithFairnessFloor({ ranked, travelers: params.travelers ?? [], limit: params.limit ?? admitted.length });
  const selected = selectedRanked.map(({ entry }) => entry);
  return { selected, pods: clusterAttractionsIntoPods({ destination: params.destination, entries: selected, radiusKm: params.radiusKm, maxItemsPerPod: 3 }), hardRejections: rejected };
};

export const renderAttractionPods = (pods: AttractionPod[]): string => pods.length
  ? pods.map((pod) => `${pod.id} (${pod.kind}${pod.distanceGuaranteed ? `, radius ${pod.radiusKm}km` : ', no distance guarantee'}): ${pod.items.map((entry) => entry.name).join(' | ')}`).join('\n')
  : 'none';

