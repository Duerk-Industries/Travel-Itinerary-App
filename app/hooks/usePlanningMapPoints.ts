import { useEffect, useState } from 'react';
import type { PlanningMapPoint } from '../../server/src/types';
export function usePlanningMapPoints({ backendUrl, tripId, dayDate, requestHeaders, enabled }: { backendUrl: string; tripId?: string; dayDate?: string; requestHeaders: Record<string, string>; enabled: boolean }) {
  const [result, setResult] = useState<{ scope: string; points: PlanningMapPoint[] } | null>(null);
  const scope = JSON.stringify([backendUrl, tripId, dayDate, requestHeaders]);
  useEffect(() => {
    if (!enabled || !tripId || !dayDate) return;
    let cancelled = false; const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    void fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-map-points?dayDate=${encodeURIComponent(dayDate)}`, { headers: requestHeaders, cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.ok) { const data = await response.json(); if (!cancelled && Array.isArray(data.points)) setResult({ scope, points: data.points }); }
    }).catch(() => undefined).finally(() => clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [scope, enabled]);
  return enabled && result?.scope === scope ? result.points : null;
}
