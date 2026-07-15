import type { AttractionPod } from './geoPodClusteringService';

type CachedDay = { b: string; it: Array<[string, string, string]> };
type CachedItinerary<TDay extends CachedDay> = { dy: TDay[] };
type MustSee = { name: string; destinationName?: string };

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const generic = (value: string): boolean => /flexible|nearby|local (park|event|market)|another museum|historical site/i.test(value);

export const injectMustSeesIntoCachedFragments = <T extends CachedItinerary<TDay>, TDay extends CachedDay>(params: {
  itinerary: T;
  mustSees: MustSee[];
  podsByDestination?: Record<string, AttractionPod[]>;
  maxItemsPerDay?: number;
}): T => {
  const clone = JSON.parse(JSON.stringify(params.itinerary)) as T;
  const maxItems = Math.max(1, params.maxItemsPerDay ?? 5);
  const existing = new Set(clone.dy.flatMap((day) => day.it.map((item) => normalize(item[2]))));
  for (const mustSee of params.mustSees) {
    if (!mustSee.name.trim() || existing.has(normalize(mustSee.name))) continue;
    const destination = mustSee.destinationName ?? '';
    const pods = Object.entries(params.podsByDestination ?? {}).find(([key]) => normalize(key) === normalize(destination))?.[1] ?? [];
    const matchingPod = pods.find((pod) => pod.items.some((entry) => normalize(entry.name) === normalize(mustSee.name)));
    const podNames = new Set((matchingPod?.items ?? []).map((entry) => normalize(entry.name)));
    const candidateDays = clone.dy.filter((day) => !destination || normalize(day.b) === normalize(destination));
    const target = [...candidateDays].sort((a, b) => {
      const score = (day: CachedDay) => day.it.filter((item) => podNames.has(normalize(item[2]))).length;
      return score(b) - score(a) || a.it.length - b.it.length;
    })[0] ?? clone.dy[0];
    if (!target) continue;
    const replacement = target.it.findIndex((item) => generic(item[2]));
    if (replacement >= 0) target.it[replacement] = [target.it[replacement][0], 'A', mustSee.name];
    else if (target.it.length < maxItems) target.it.push(['D', 'A', mustSee.name]);
    else target.it[target.it.length - 1] = [target.it[target.it.length - 1][0], 'A', mustSee.name];
    existing.add(normalize(mustSee.name));
  }
  return clone;
};

