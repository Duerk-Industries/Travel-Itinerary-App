import { useAutomaticMapLocations } from '../hooks/useAutomaticMapLocations';
import React, { useEffect, useState } from 'react';
import TripMap from './TripMap';
import type { TripMapPoint } from '../utils/googleMaps';
export default function TripDayMap({ points, testID, tripId, backendUrl, requestHeaders, dayDate }: { points: TripMapPoint[]; backendUrl: string; requestHeaders: Record<string, string>; testID?: string; tripId?: string; dayDate?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [canLocate, setCanLocate] = useState(false);
  const [open, setOpen] = useState(false);
  const auth = JSON.stringify(requestHeaders);
  useEffect(() => {
    let cancelled = false; setEnabled(false); setCanLocate(false); setOpen(false);
    if (tripId) void fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers: requestHeaders }).then(async response => {
      if (response.ok) { const data = await response.json(); if (!cancelled) { setEnabled(data.map === true); setCanLocate(data.locate === true); } }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [tripId, backendUrl, auth]);
  const locations = useAutomaticMapLocations({ points, backendUrl, tripId, dayDate, requestHeaders, enabled, canLocate, open });
  if (!enabled) return null;
  return <TripMap key={JSON.stringify([tripId, dayDate])} points={locations.points} testID={testID} onOpenChange={setOpen} locating={locations.locating} locationNotice={locations.notice} />;
}
