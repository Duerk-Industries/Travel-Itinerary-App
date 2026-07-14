// itinerary-improvements-coding-plan.md Phase 2A ("Implement bounded day-sized
// scheduling: density/pod seed, nearest insertion, bounded 2-opt, and adjacent-day
// swap passes.") — this module implements the WITHIN-DAY portion only:
//   1. Pod-density seeding — sequence pods (from geoPodClusteringService) so that
//      walkable clusters stay together instead of being interleaved.
//   2. Nearest-insertion ordering inside each pod, using the same haversine helper
//      geoPodClusteringService already relies on (`../utils/geo`).
//   3. A bounded 2-opt pass: a single forward sweep over adjacent pairs that swaps
//      only when it strictly reduces local tour distance. This is intentionally NOT
//      iterated to convergence, to keep the pass cheap and deterministic.
//
// Cross-day / adjacent-day swaps are explicitly OUT OF SCOPE for this module (see
// plan's "adjacent-day swap" as a separate, later concern) and are not attempted here.
//
// This is pure, zero-LLM-cost, deterministic code: no Math.random, no unstable sort
// (all comparators have explicit tiebreakers), same input always produces same output.
//
// Per the plan's non-negotiable rules, this pass never re-ranks by relevance and never
// drops or fabricates items — it only reorders the entities already selected upstream
// (p2/p3/grounding/must-see/budget passes). Optimization order is lexicographic:
//   (1) hard feasibility — untouched here; this pass never changes the item set, so it
//       cannot introduce a feasibility violation that wasn't already present upstream.
//   (2) excess travel / backtracking — minimized via pod density + nearest insertion +
//       bounded 2-opt.
//   (3) existing relevance ordering — preserved as the tiebreaker (pods and in-pod ties
//       are ordered by each item's ORIGINAL index, never re-scored).

import type { AttractionCatalogEntry } from '../types';
import { haversineKm, type LatLon } from '../utils/geo';
import { clusterAttractionsIntoPods } from './geoPodClusteringService';

/** Structurally matches a day's `it` tuple: [timeSlotCode, activityTypeCode, name]. */
export type DaySchedulingItem = readonly [string, string, string];

export const DEFAULT_DAY_SCHEDULING_POD_RADIUS_KM = 2;
export const DEFAULT_DAY_SCHEDULING_MAX_POD_ITEMS = 5;

export type DaySchedulingOptions = {
  radiusKm?: number;
  maxItemsPerPod?: number;
};

export type ScheduleDayResult<TItem extends DaySchedulingItem> = {
  items: TItem[];
  changed: boolean;
  notes: string[];
};

type ResolvedItem<TItem extends DaySchedulingItem> = {
  item: TItem;
  index: number;
  entry: AttractionCatalogEntry | null;
};

const hasCoordinates = (entry: AttractionCatalogEntry | null): entry is AttractionCatalogEntry =>
  !!entry &&
  entry.lat != null &&
  entry.lon != null &&
  Number.isFinite(Number(entry.lat)) &&
  Number.isFinite(Number(entry.lon));

const pointOf = (entry: AttractionCatalogEntry): LatLon => ({ lat: Number(entry.lat), lon: Number(entry.lon) });

/**
 * Bounded, deterministic within-day ordering pass. Reorders `items` so that
 * geographically clustered activities ("pods") stay contiguous and the walk
 * between consecutive activities doesn't obviously backtrack, without changing
 * which activities are scheduled or their time-slot rhythm (morning/day/evening
 * codes stay pinned to position 0..n-1; only the entity filling each slot moves).
 *
 * `lookupEntry` resolves an item's display name to its catalog entry (for lat/lon
 * and pod clustering); items that don't resolve, or lack coordinates, are treated
 * as "distance unknown" and kept after the geographically-grounded items in their
 * original relative order — never dropped, never reordered against each other.
 */
export const scheduleDayItems = <TItem extends DaySchedulingItem>(
  destination: string,
  items: TItem[],
  lookupEntry: (name: string) => AttractionCatalogEntry | null | undefined,
  options?: DaySchedulingOptions
): ScheduleDayResult<TItem> => {
  const notes: string[] = [];

  // Nothing meaningful to reorder with 0-2 items.
  if (items.length < 3) {
    return { items: [...items], changed: false, notes };
  }

  const resolved: ResolvedItem<TItem>[] = items.map((item, index) => ({
    item,
    index,
    entry: lookupEntry(item[2]) ?? null,
  }));
  const located = resolved.filter((r) => hasCoordinates(r.entry));
  const unlocated = resolved.filter((r) => !hasCoordinates(r.entry));

  if (located.length < 2) {
    return { items: [...items], changed: false, notes };
  }

  // 1. Pod-density seeding — cluster the geo-resolvable items into walkable pods
  //    using the same clustering logic used elsewhere in the pipeline.
  const pods = clusterAttractionsIntoPods({
    destination,
    entries: located.map((r) => r.entry as AttractionCatalogEntry),
    radiusKm: options?.radiusKm ?? DEFAULT_DAY_SCHEDULING_POD_RADIUS_KM,
    maxItemsPerPod: options?.maxItemsPerPod ?? DEFAULT_DAY_SCHEDULING_MAX_POD_ITEMS,
  });

  const byEntryId = new Map(located.map((r) => [(r.entry as AttractionCatalogEntry).id, r]));

  // Order pods by the earliest original index among their members. This keeps the
  // upstream relevance ordering as the tiebreaker instead of introducing a new score.
  const podEarliestIndex = (pod: (typeof pods)[number]): number =>
    pod.items.reduce((min, e) => Math.min(min, byEntryId.get(e.id)?.index ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  const orderedPods = [...pods].sort((a, b) => podEarliestIndex(a) - podEarliestIndex(b));

  // 2. Nearest-insertion within each pod, starting from the pod's earliest-original-index item.
  const locatedOrder: ResolvedItem<TItem>[] = [];
  for (const pod of orderedPods) {
    const members = pod.items
      .map((e) => byEntryId.get(e.id))
      .filter((r): r is ResolvedItem<TItem> => !!r);
    if (!members.length) continue;

    const remaining = new Map(members.map((m) => [(m.entry as AttractionCatalogEntry).id, m]));
    let current = [...members].sort((a, b) => a.index - b.index)[0];
    remaining.delete((current.entry as AttractionCatalogEntry).id);
    locatedOrder.push(current);

    while (remaining.size) {
      const currentPoint = pointOf(current.entry as AttractionCatalogEntry);
      const ranked = Array.from(remaining.values())
        .map((r) => ({ r, distance: haversineKm(currentPoint, pointOf(r.entry as AttractionCatalogEntry)) }))
        .sort((a, b) => a.distance - b.distance || a.r.index - b.r.index);
      const next = ranked[0].r;
      remaining.delete((next.entry as AttractionCatalogEntry).id);
      locatedOrder.push(next);
      current = next;
    }
  }

  // 3. Bounded 2-opt — a single forward pass over adjacent pairs (NOT iterated to
  //    convergence). Swaps position i and i+1 only when doing so strictly reduces the
  //    local tour distance across the 4-point neighborhood, catching the obvious
  //    "pod A -> pod B -> pod A" backtracking case cheaply and deterministically.
  const points = locatedOrder.map((r) => pointOf(r.entry as AttractionCatalogEntry));
  for (let i = 0; i < locatedOrder.length - 1; i += 1) {
    const prev = i > 0 ? points[i - 1] : null;
    const a = points[i];
    const b = points[i + 1];
    const next = i + 2 < points.length ? points[i + 2] : null;
    const currentCost = (prev ? haversineKm(prev, a) : 0) + haversineKm(a, b) + (next ? haversineKm(b, next) : 0);
    const swappedCost = (prev ? haversineKm(prev, b) : 0) + haversineKm(b, a) + (next ? haversineKm(a, next) : 0);
    if (swappedCost < currentCost - 1e-9) {
      [locatedOrder[i], locatedOrder[i + 1]] = [locatedOrder[i + 1], locatedOrder[i]];
      [points[i], points[i + 1]] = [points[i + 1], points[i]];
    }
  }

  // 4. Recombine: geo-grounded items in their optimized order, then distance-unknown
  //    items in their original relative order (their placement is never guessed).
  const newEntityOrder: TItem[] = [
    ...locatedOrder.map((r) => r.item),
    ...[...unlocated].sort((a, b) => a.index - b.index).map((r) => r.item),
  ];

  // Re-pin the original time-slot codes to the new positions (position 0 keeps
  // whatever code was originally first, etc.) so the day's morning/day/evening
  // rhythm survives; only the entity occupying each slot changes.
  const originalCodes = items.map((item) => item[0]);
  const finalItems = newEntityOrder.map(
    (item, index) => [originalCodes[index], item[1], item[2]] as unknown as TItem
  );

  const changed = finalItems.some((item, index) => item[1] !== items[index][1] || item[2] !== items[index][2]);
  if (changed) {
    notes.push(
      `Reordered ${locatedOrder.length} geo-grounded activit${locatedOrder.length === 1 ? 'y' : 'ies'} across ${orderedPods.length} pod${orderedPods.length === 1 ? '' : 's'} to reduce backtracking.`
    );
  }

  return { items: finalItems, changed, notes };
};
