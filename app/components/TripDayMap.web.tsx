import React, { useEffect, useState } from 'react';
import TripMap from './TripMap';
import type { TripMapPoint } from '../utils/googleMaps';
export default function TripDayMap({ points, testID, tripId, backendUrl, requestHeaders }: { points: TripMapPoint[]; backendUrl: string; requestHeaders: Record<string, string>; testID?: string; tripId?: string; dayDate?: string }) {
  const [enabled, setEnabled] = useState(false);
  const auth = JSON.stringify(requestHeaders);
  useEffect(() => {
    let cancelled = false; setEnabled(false);
    if (tripId) void fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers: requestHeaders }).then(async response => {
      if (response.ok) { const data = await response.json(); if (!cancelled) setEnabled(data.map === true); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [tripId, backendUrl, auth]);
  if (!enabled) return null;
  return <TripMap points={points.map((point, index) => ({ ...point, id: point.id || `${point.kind}-${index}`, title: point.title || point.address || point.kind }))} testID={testID} />;
}
