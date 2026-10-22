import React from 'react';
import type { PlanningMapPoint } from '../../server/src/types';

// OSM's raster embed uses a DOM map, so it also works when WebGL2 initialization fails.
export default function BasicTripMap({ points, selectedId }: { points: PlanningMapPoint[]; selectedId: string | null }) {
  const selected = points.find(point => point.id === selectedId) ?? points[0];
  if (!selected) return null;
  const lngs = points.map(point => point.lng!);
  const lats = points.map(point => point.lat!);
  const west = Math.min(...lngs), east = Math.max(...lngs);
  const south = Math.min(...lats), north = Math.max(...lats);
  const dx = Math.max((east - west) * 0.15, 0.005);
  const dy = Math.max((north - south) * 0.15, 0.005);
  const bounds = [Math.max(-180, west - dx), Math.max(-85, south - dy), Math.min(180, east + dx), Math.min(85, north + dy)];
  const query = new URLSearchParams({ bbox: bounds.join(','), layer: 'mapnik', marker: `${selected.lat},${selected.lng}` });
  return <div style={{ flex: 2, minWidth: 0 }}>
    <p style={{ marginTop: 0 }}>Basic map · Pin: {selected.title}. Select a stop to move the pin.</p>
    <iframe title="Basic map of day stops" src={`https://www.openstreetmap.org/export/embed.html?${query}`} loading="lazy" style={{ width: '100%', height: 400, border: 0, borderRadius: 12 }} />
  </div>;
}
