import { usePlanningMapPoints } from '../hooks/usePlanningMapPoints';
import { describeLocateSummary, locateStops, locateTargets } from '../utils/locateStops';
import React, { useEffect, useState } from 'react';
import TripMap from './TripMap';
import type { TripMapPoint } from '../utils/googleMaps';
export default function TripDayMap({ points, testID, tripId, backendUrl, requestHeaders, dayDate }: { points: TripMapPoint[]; backendUrl: string; requestHeaders: Record<string, string>; testID?: string; tripId?: string; dayDate?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [canLocate, setCanLocate] = useState(false);
  const [locateProvider, setLocateProvider] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const auth = JSON.stringify(requestHeaders);
  useEffect(() => {
    let cancelled = false; setEnabled(false); setCanLocate(false); setLocateProvider(null);
    if (tripId) void fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers: requestHeaders }).then(async response => {
      if (response.ok) { const data = await response.json(); if (!cancelled) { setEnabled(data.map === true); setCanLocate(data.locate === true); setLocateProvider(typeof data.locateProvider === 'string' ? data.locateProvider : null); } }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [tripId, backendUrl, auth]);
  const serverPoints = usePlanningMapPoints({ backendUrl, tripId, dayDate, requestHeaders, enabled, refreshKey });
  if (!enabled) return null;
  const shown = serverPoints ?? points.map((point, index) => ({ ...point, id: point.id || `${point.kind}-${index}`, title: point.title || point.address || point.kind }));
  // Only stops the server knows about can be looked up, so wait for its list before offering the action.
  const targets = canLocate && serverPoints && tripId ? locateTargets(serverPoints) : [];
  const findLocations = async (): Promise<string> => {
    const summary = await locateStops({ backendUrl, tripId: tripId as string, headers: requestHeaders, targets });
    setRefreshKey(value => value + 1);
    return describeLocateSummary(summary);
  };
  return <TripMap points={shown} testID={testID} onFindLocations={targets.length ? findLocations : undefined} findLocationsCount={targets.length} findLocationsProvider={locateProvider} />;
}
