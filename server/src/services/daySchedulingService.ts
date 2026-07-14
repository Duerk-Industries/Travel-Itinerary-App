// itinerary-improvements-coding-plan.md Phase 2A ("Implement bounded day-sized
// scheduling: density/pod seed, nearest insertion, bounded 2-opt, and adjacent-day
// swap passes.") — this module implements both the within-day and adjacent-day
// portions:
//   1. Pod-density seeding — sequence pods (from geoPodClusteringService) so that
//      walkable clusters stay together instead of being interleaved.
//   2. Nearest-insertion ordering inside each pod, using the same haversine helper
//      geoPodClusteringService already relies on (`../utils/geo`).
//   3. A bounded 2-opt pass: a single forward sweep over adjacent pairs that swaps
//      only when it strictly reduces local tour distance. This is intentionally NOT
//      iterated to convergence, to keep the pass cheap and deterministic.
//   4. `scheduleAdjacentDaySwaps` — a bounded adjacent-day pass (see its doc comment
//      below) that relocates at most one catalog-mismatched activity per adjacent
//      day pair, per forward sweep, when the activity's real destination matches the
//      neighboring day's base instead of its own. This is intentionally NOT a full
//      cross-trip optimization: it is a single forward sweep over day pairs, bounded
//      to one move per pair, and it never touches a zero-activity or rest-hub day.
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
import { normalizeDestinationKey } from './attractionsCatalogService';

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

/** Default per-day item cap used when a caller doesn't pass one explicitly (tests, mainly). */
export const DEFAULT_ADJACENT_DAY_SWAP_MAX_ITEMS_PER_DAY = 5;

const REST_HUB_NOTE_PATTERN = /rest[\s-]?hub|rest day|fatigue/i;

/**
 * Mirrors dayFillService.ts's `isRestHubByNote` — a day is treated as a rest/hub day if any of
 * its `ln` notes match the same pattern used elsewhere in the pipeline
 * (frictionAccumulatorService / dayFillService). Reused rather than reimplemented so the two
 * modules can never disagree about what counts as a rest-hub day.
 */
const isRestHubDayByNote = (day: { ln?: readonly string[] }): boolean =>
  (day.ln ?? []).some((note) => REST_HUB_NOTE_PATTERN.test(note));

const toDateSet = (dates?: ReadonlySet<string> | readonly string[]): Set<string> =>
  dates instanceof Set ? dates : new Set(dates ?? []);

/** Minimal shape `scheduleAdjacentDaySwaps` needs from a day; matches PromptDay/FillDay's `dt`/`b`/`it`/`ln`. */
export type AdjacentSwapDay<TItem extends DaySchedulingItem> = {
  dt: string;
  b: string;
  it: TItem[];
  ln?: readonly string[];
};

export type AdjacentDaySwapOptions = {
  /** Per-day item cap; reuse whatever cap the caller already enforces (e.g. itineraryPromptPlanService's MAX_ITEMS_PER_DAY). */
  maxItemsPerDay?: number;
  /** Dates with a hard-constraint 0-activity cap (arrivalDepartureRulesService). Never touched. */
  zeroActivityDayDates?: ReadonlySet<string> | readonly string[];
};

export type AdjacentDaySwapResult = {
  /** True if at least one item was relocated across a day boundary. */
  changed: boolean;
  notes: string[];
};

/**
 * Bounded adjacent-day swap pass (itinerary-improvements-coding-plan.md Phase 2A, "adjacent-day
 * swap passes"). Runs AFTER `scheduleDayItems` has already ordered each day internally.
 *
 * For every pair of chronologically adjacent days (day i, day i+1) with genuinely different base
 * destinations, this looks for an item whose catalog `destinationKey` matches the *other* day's
 * base instead of its own — i.e. an activity that was scheduled on the wrong day of a multi-
 * destination trip. If exactly one such misplaced item is found in one direction, it is relocated
 * to the day it actually belongs to.
 *
 * Hard bounds (per the plan's "deterministic scheduling is authoritative" rule):
 *   - Single forward sweep over adjacent day pairs — never iterated to convergence.
 *   - At most ONE item moved per adjacent day-pair, per pass.
 *   - Never touches a day in `zeroActivityDayDates` (arrival/departure terminal-only days) or a
 *     day whose `ln` notes mark it as a rest-hub day — on either side of the pair.
 *   - Never moves an item whose destination matches neither day's base (only relocates when the
 *     catalog destinationKey unambiguously matches the *neighboring* day, never a guess).
 *   - Never exceeds `maxItemsPerDay` on the receiving day, and never empties the donor day (a
 *     donor day must have more than one item before losing one), so this pass can never turn a
 *     day into a brand-new zero-activity day.
 *   - Never changes the total item SET for the trip — it only moves an existing item's `it` tuple
 *     from one day's array to another; nothing is dropped, duplicated, or fabricated.
 *   - Deterministic: items are scanned in their existing array order (no sort), and when both
 *     directions have a misplaced item, the forward direction (day i -> day i+1) is preferred as a
 *     fixed, explicit tiebreak.
 *
 * Mutates the `it` arrays of the day objects passed in (same convention as `scheduleDayItems`,
 * which mutates the itinerary it's handed) and returns only the change/notes summary; the caller
 * already owns a deep-cloned itinerary by this point in the pipeline.
 */
export const scheduleAdjacentDaySwaps = <TItem extends DaySchedulingItem>(
  days: Array<AdjacentSwapDay<TItem>>,
  lookupEntry: (name: string) => AttractionCatalogEntry | null | undefined,
  options?: AdjacentDaySwapOptions
): AdjacentDaySwapResult => {
  const notes: string[] = [];
  let changed = false;

  if (days.length < 2) return { changed, notes };

  const maxItemsPerDay = options?.maxItemsPerDay ?? DEFAULT_ADJACENT_DAY_SWAP_MAX_ITEMS_PER_DAY;
  const zeroActivityDates = toDateSet(options?.zeroActivityDayDates);

  for (let i = 0; i < days.length - 1; i += 1) {
    const dayA = days[i];
    const dayB = days[i + 1];

    // Never touch a zero-activity (terminal-only) or rest-hub day on either side.
    if (zeroActivityDates.has(dayA.dt) || zeroActivityDates.has(dayB.dt)) continue;
    if (isRestHubDayByNote(dayA) || isRestHubDayByNote(dayB)) continue;

    const keyA = normalizeDestinationKey(dayA.b);
    const keyB = normalizeDestinationKey(dayB.b);
    // Same base on both sides: no cross-destination misplacement is possible.
    if (!keyA || !keyB || keyA === keyB) continue;

    // First item in day A whose catalog entry's destinationKey unambiguously matches day B's
    // base (and therefore not day A's). Original array order = deterministic scan order.
    const misplacedForward = dayA.it
      .map((item, index) => ({ item, index, entry: lookupEntry(item[2]) ?? null }))
      .find(({ entry }) => !!entry?.destinationKey && entry.destinationKey === keyB);
    const misplacedBackward = dayB.it
      .map((item, index) => ({ item, index, entry: lookupEntry(item[2]) ?? null }))
      .find(({ entry }) => !!entry?.destinationKey && entry.destinationKey === keyA);

    // Bounded to one move per pair: prefer the forward direction deterministically when both
    // directions happen to have a misplaced candidate.
    if (misplacedForward && dayA.it.length > 1 && dayB.it.length < maxItemsPerDay) {
      const [moved] = dayA.it.splice(misplacedForward.index, 1);
      dayB.it.push(['D', moved[1], moved[2]] as unknown as TItem);
      changed = true;
      notes.push(
        `Moved "${moved[2]}" from day ${dayA.dt} (${dayA.b}) to day ${dayB.dt} (${dayB.b}) — catalog destination matches the adjacent day's base.`
      );
      continue;
    }

    if (misplacedBackward && dayB.it.length > 1 && dayA.it.length < maxItemsPerDay) {
      const [moved] = dayB.it.splice(misplacedBackward.index, 1);
      dayA.it.push(['D', moved[1], moved[2]] as unknown as TItem);
      changed = true;
      notes.push(
        `Moved "${moved[2]}" from day ${dayB.dt} (${dayB.b}) to day ${dayA.dt} (${dayA.b}) — catalog destination matches the adjacent day's base.`
      );
    }
  }

  return { changed, notes };
};
