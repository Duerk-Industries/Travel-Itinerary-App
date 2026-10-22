import type { PlanningMapPoint } from '../../server/src/types';
import { isLocatedMapPoint } from './planningMapGeometry';

export type LocateTarget = { kind: 'lodging' | 'activity' | 'car_rental'; itemId: string; which?: 'pickup' | 'dropoff'; title: string };
export type LocateSummary = { located: number; notFound: number; failed: number; stoppedForLimit: boolean; attempted: number };

/** Stops with no coordinates that can be looked up from their saved address. Flights are placed by airport code, not looked up. */
export const locateTargets = (points: PlanningMapPoint[]): LocateTarget[] =>
  points.flatMap((point): LocateTarget[] => {
    if (isLocatedMapPoint(point)) return [];
    if (point.kind === 'lodging' || point.kind === 'activity') return [{ kind: point.kind, itemId: point.id, title: point.title }];
    if (point.kind === 'car_rental') {
      const [itemId, leg] = point.id.split(':');
      return itemId && (leg === 'pickup' || leg === 'dropoff') ? [{ kind: 'car_rental', itemId, which: leg, title: point.title }] : [];
    }
    return [];
  });

/** Looks the targets up one at a time; stops early when the daily or per-person limit is reached. */
export const locateStops = async (params: {
  backendUrl: string; tripId: string; headers: Record<string, string>; targets: LocateTarget[];
  fetchImpl?: typeof fetch;
}): Promise<LocateSummary> => {
  const send = params.fetchImpl ?? fetch;
  const summary: LocateSummary = { located: 0, notFound: 0, failed: 0, stoppedForLimit: false, attempted: 0 };
  for (const target of params.targets) {
    summary.attempted += 1;
    try {
      const response = await send(`${params.backendUrl}/api/trips/${encodeURIComponent(params.tripId)}/locate-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...params.headers },
        body: JSON.stringify({ kind: target.kind, itemId: target.itemId, ...(target.which ? { which: target.which } : {}) }),
      });
      if (response.status === 429) { summary.stoppedForLimit = true; break; }
      const data = await response.json().catch(() => ({})) as { status?: string };
      if (!response.ok) { summary.failed += 1; continue; }
      if (data.status === 'located' || data.status === 'already_located') summary.located += 1;
      else if (data.status === 'quota') { summary.stoppedForLimit = true; break; }
      else if (data.status === 'not_found' || data.status === 'no_address') summary.notFound += 1;
      else summary.failed += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
};

/** Plain-language result for the notice under the button. */
export const describeLocateSummary = (summary: LocateSummary): string => {
  const parts: string[] = [];
  if (summary.located) parts.push(`Placed ${summary.located} stop${summary.located === 1 ? '' : 's'} on the map.`);
  if (summary.notFound) parts.push(`${summary.notFound} couldn't be found. Check ${summary.notFound === 1 ? 'its' : 'their'} address.`);
  if (summary.failed) parts.push(`${summary.failed} couldn't be looked up right now. Try again later.`);
  if (summary.stoppedForLimit) parts.push('The lookup limit was reached. Try again later.');
  return parts.join(' ') || 'Nothing to look up.';
};
