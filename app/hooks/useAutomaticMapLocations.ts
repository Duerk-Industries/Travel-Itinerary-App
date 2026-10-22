import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanningMapPoint } from '../../server/src/types';
import type { TripMapPoint } from '../utils/googleMaps';
import { describeLocateSummary, locateStops, locateTargets } from '../utils/locateStops';
import { isLocatedMapPoint } from '../utils/planningMapGeometry';
import { usePlanningMapPoints } from './usePlanningMapPoints';

/** Successful lookups are saved by locate-item; local copies update an open map immediately. */
export function useAutomaticMapLocations(params: {
  points: TripMapPoint[]; backendUrl: string; tripId?: string; dayDate?: string;
  requestHeaders: Record<string, string>; enabled: boolean; canLocate: boolean; open: boolean;
}) {
  const { points, backendUrl, tripId, dayDate, requestHeaders, enabled, canLocate, open } = params;
  const [refreshKey, setRefreshKey] = useState(0);
  const serverPoints = usePlanningMapPoints({ backendUrl, tripId, dayDate, requestHeaders, enabled, refreshKey });
  const scope = JSON.stringify([backendUrl, tripId, dayDate, requestHeaders]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const attempted = useRef(new Set<string>());
  // Retry unresolved addresses on a later Show map, never in a render/refetch loop.
  useEffect(() => { if (!open) attempted.current.clear(); }, [open]);
  const [cached, setCached] = useState<Record<string, Partial<PlanningMapPoint>>>({});
  const [pending, setPending] = useState<Record<string, number>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const base: PlanningMapPoint[] = useMemo(() => serverPoints ?? points.map((point, index) => ({
    ...point, id: point.id || `${point.kind}-${index}`, title: point.title || point.address || point.kind,
  })), [serverPoints, points]);
  const cacheKey = (point: PlanningMapPoint) => JSON.stringify([scope, point.kind, point.id, point.address]);
  const shown = base.map(point => isLocatedMapPoint(point) ? point : { ...point, ...cached[cacheKey(point)] });
  // Synthetic fallback IDs are display-only, never IDs sent to locate-item.
  const identifiable = serverPoints ? shown : shown.filter(point => points.some(input => input.id === point.id));
  const targetKey = JSON.stringify([locateTargets(identifiable), identifiable.map(point => point.address)]);
  useEffect(() => {
    if (!enabled || !open || !canLocate || !tripId || (pending[scope] ?? 0) > 0) return;
    const targets = locateTargets(identifiable).filter(target => {
      const point = identifiable.find(item => item.id === (target.which ? `${target.itemId}:${target.which}` : target.itemId));
      const key = point ? cacheKey(point) : '';
      if (!key || attempted.current.has(key)) return false;
      attempted.current.add(key);
      return true;
    });
    if (!targets.length) return;
    setPending(value => ({ ...value, [scope]: (value[scope] ?? 0) + 1 }));
    const active = () => mounted.current && currentScope.current === scope;
    void locateStops({ backendUrl, tripId, headers: requestHeaders, targets, onLocated: (target, result) => {
      if (!active()) return;
      const point = identifiable.find(item => item.id === (target.which ? `${target.itemId}:${target.which}` : target.itemId));
      if (point) setCached(value => ({ ...value, [cacheKey(point)]: {
        lat: result.lat, lng: result.lng, coordinateSource: result.coordinateSource ?? 'geocoder',
        coordinateAttribution: result.attribution, coordinateCreditLinks: result.creditLinks,
      } }));
    } }).then(summary => {
      if (active()) { setNotices(value => ({ ...value, [scope]: describeLocateSummary(summary) })); setRefreshKey(value => value + 1); }
    }).catch(() => {
      if (active()) setNotices(value => ({ ...value, [scope]: "Couldn't look up locations right now. Try again later." }));
    }).finally(() => {
      if (mounted.current) setPending(value => ({ ...value, [scope]: Math.max(0, (value[scope] ?? 1) - 1) }));
    });
  }, [enabled, open, canLocate, scope, targetKey, pending[scope]]);
  return { points: shown, locating: (pending[scope] ?? 0) > 0, notice: notices[scope] };
}
