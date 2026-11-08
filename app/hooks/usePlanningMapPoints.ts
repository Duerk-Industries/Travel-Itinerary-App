import { screenFetch as fetch } from '../cache/screenFetch';
import { useEffect, useState } from 'react';
import type { PlanningMapPoint } from '../../server/src/types';
export function usePlanningMapPoints({ backendUrl, tripId, dayDate, requestHeaders, enabled, refreshKey = 0 }: { backendUrl: string; tripId?: string; dayDate?: string; requestHeaders: Record<string, string>; refreshKey?: number; enabled: boolean }) {
  const [result, setResult] = useState<{ scope: string; points: PlanningMapPoint[] } | null>(null);
  const scope = JSON.stringify([backendUrl, tripId, dayDate, requestHeaders]);
  useEffect(() => {
    if (!enabled || !tripId || !dayDate) return;
    let cancelled = false; const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    void fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-map-points?dayDate=${encodeURIComponent(dayDate)}`, { headers: requestHeaders, signal: controller.signal, isCurrent: () => !cancelled, onUnavailable: () => { if (!cancelled) setResult(null); }, onCached: raw => { const data = raw as { points?: PlanningMapPoint[] }; if (!cancelled && Array.isArray(data.points)) setResult({ scope, points: data.points }); } }).then(async response => {
      if (!response.ok && [401, 402, 403, 404].includes(response.status) && !cancelled) setResult(null);
      if (response.ok) { const data = await response.json(); if (!cancelled && Array.isArray(data.points)) setResult({ scope, points: data.points }); }
    }).catch(() => undefined).finally(() => clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [scope, enabled, refreshKey]);
  return enabled && result?.scope === scope ? result.points : null;
}
