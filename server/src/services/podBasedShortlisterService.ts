import type { AttractionCatalogEntry } from '../types';
import type { InterestWeights } from './activityTypeInterestWeights';
import { clusterAttractionsIntoPods, type AttractionPod } from './geoPodClusteringService';
import { rankAttractionsForGroup, selectWithFairnessFloor, type TravelerInterest } from './fairnessRankerService';
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
}): { selected: AttractionCatalogEntry[]; pods: AttractionPod[] } => {
  const ranked = rankAttractionsForGroup({ entries: params.entries, weights: params.weights, mustSeeNames: params.mustSeeNames, anchor: params.anchor });
  const selectedRanked = selectWithFairnessFloor({ ranked, travelers: params.travelers ?? [], limit: params.limit ?? params.entries.length });
  const selected = selectedRanked.map(({ entry }) => entry);
  return { selected, pods: clusterAttractionsIntoPods({ destination: params.destination, entries: selected, radiusKm: params.radiusKm, maxItemsPerPod: 3 }) };
};

export const renderAttractionPods = (pods: AttractionPod[]): string => pods.length
  ? pods.map((pod) => `${pod.id} (${pod.kind}${pod.distanceGuaranteed ? `, radius ${pod.radiusKm}km` : ', no distance guarantee'}): ${pod.items.map((entry) => entry.name).join(' | ')}`).join('\n')
  : 'none';

