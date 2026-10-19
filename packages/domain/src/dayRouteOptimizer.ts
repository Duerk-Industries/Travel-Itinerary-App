// Deterministic, dependency-free day-route helpers. No network, no randomness: the same stops always
// produce the same suggestion, so a preview can be trusted and tested. Distances are straight-line
// (great-circle) estimates, not road or walking routes, and say nothing about opening hours.

export type LatLng = { lat: number; lng: number };

export type RouteStop = {
  id: string;
  lat?: number | null;
  lng?: number | null;
  /** A booking tied to a time (or a stop the user pinned). It keeps its place in the day. */
  fixed?: boolean;
};

export const MAX_OPTIMIZE_STOPS = 12;

const EARTH_RADIUS_KM = 6371;

const isCoordinate = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

const locatedPoint = (stop: RouteStop): LatLng | null =>
  isCoordinate(stop.lat, stop.lng) ? { lat: stop.lat as number, lng: stop.lng as number } : null;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

export const haversineKm = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Straight-line length of the stops in the given order. Stops without coordinates are skipped. */
export const routeLengthKm = (stops: readonly RouteStop[], anchor?: LatLng | null): number => {
  const points: LatLng[] = [];
  if (anchor) points.push(anchor);
  for (const stop of stops) {
    const point = locatedPoint(stop);
    if (point) points.push(point);
  }
  if (anchor) points.push(anchor);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineKm(points[i - 1]!, points[i]!);
  return total;
};

export type OptimizeReason = 'too_few' | 'too_many' | 'nothing_to_move' | 'already_best';

export type OptimizeResult = {
  /** Suggested order of every stop id passed in. Equal to the input order when nothing improves. */
  order: string[];
  beforeKm: number;
  afterKm: number;
  changed: boolean;
  /** Stops that stayed where they were: booked/pinned, or with no usable coordinates. */
  keptInPlace: string[];
  /** Why nothing was changed, when `changed` is false. */
  reason?: OptimizeReason;
};

const EPSILON_KM = 1e-6;
const MAX_TWO_OPT_PASSES = 50;

/**
 * Reorders the flexible stops of one day to shorten the straight-line route.
 *  - Stops that are `fixed`, or have no coordinates, keep their exact slot.
 *  - With an `anchor` (e.g. the lodging) the route starts and ends there.
 *  - Nearest-neighbour builds a first order, then 2-opt improves it. For the supported size
 *    (<= MAX_OPTIMIZE_STOPS) this runs in microseconds.
 * It never returns an order that is longer than the one it was given.
 */
export const optimizeDayOrder = (stops: readonly RouteStop[], anchor?: LatLng | null): OptimizeResult => {
  const original = stops.map((stop) => stop.id);
  const beforeKm = routeLengthKm(stops, anchor);
  const unchanged = (reason: OptimizeReason, keptInPlace: string[] = []): OptimizeResult =>
    ({ order: original, beforeKm, afterKm: beforeKm, changed: false, keptInPlace, reason });

  if (stops.length < 2) return unchanged('too_few');
  if (stops.length > MAX_OPTIMIZE_STOPS) return unchanged('too_many');

  const slots: number[] = [];
  const keptInPlace: string[] = [];
  stops.forEach((stop, index) => {
    if (!stop.fixed && locatedPoint(stop)) slots.push(index);
    else keptInPlace.push(stop.id);
  });
  if (slots.length < 2) return unchanged('nothing_to_move', keptInPlace);

  const flexible = slots.map((index) => stops[index]!);
  const costOf = (assignment: readonly RouteStop[]): number => {
    const sequence = stops.map((stop) => stop);
    slots.forEach((slot, i) => { sequence[slot] = assignment[i]!; });
    return routeLengthKm(sequence, anchor);
  };

  // Nearest neighbour over the slots, measured from whatever is already placed before each slot.
  const remaining = [...flexible];
  const assignment: RouteStop[] = [];
  // `placed` starts with only the kept-in-place stops; flexible slots fill in as we go.
  const placed: Array<RouteStop | undefined> = stops.map((stop, index) => (slots.includes(index) ? undefined : stop));
  for (const slot of slots) {
    let reference: LatLng | null = anchor ?? null;
    for (let i = slot - 1; i >= 0; i -= 1) {
      const point = placed[i] ? locatedPoint(placed[i] as RouteStop) : null;
      if (point) { reference = point; break; }
    }
    let bestIndex = 0;
    if (reference) {
      let bestDistance = Infinity;
      remaining.forEach((candidate, i) => {
        const distance = haversineKm(reference as LatLng, locatedPoint(candidate) as LatLng);
        const tied = Math.abs(distance - bestDistance) <= 1e-9;
        if (distance < bestDistance - 1e-9 || (tied && candidate.id < remaining[bestIndex]!.id)) {
          bestDistance = distance;
          bestIndex = i;
        }
      });
    }
    const chosen = remaining.splice(bestIndex, 1)[0]!;
    assignment.push(chosen);
    placed[slot] = chosen;
  }

  // 2-opt: reverse any run of flexible assignments that shortens the whole route.
  let best = assignment;
  let bestCost = costOf(best);
  for (let pass = 0; pass < MAX_TWO_OPT_PASSES; pass += 1) {
    let improved = false;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let j = i + 1; j < best.length; j += 1) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const cost = costOf(candidate);
        if (cost < bestCost - EPSILON_KM) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // Never make the user's own order worse.
  const originalAssignment = slots.map((slot) => stops[slot]!);
  const originalCost = costOf(originalAssignment);
  if (bestCost >= originalCost - EPSILON_KM) return unchanged('already_best', keptInPlace);

  const order = [...original];
  slots.forEach((slot, i) => { order[slot] = best[i]!.id; });
  return { order, beforeKm, afterKm: bestCost, changed: true, keptInPlace };
};

/** Moves one id a single step; returns the same array contents when it is already at the edge. */
export const moveStop = (order: readonly string[], id: string, delta: -1 | 1): string[] => {
  const index = order.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};
