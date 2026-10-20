import { travelEstimate } from '../../packages/domain/src/planningTravelEstimates';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { Map as LibreMap } from 'maplibre-gl';
import type { TripMapProps } from './TripMap.types';
import type { PlanningMapPoint } from '../../server/src/types';
import 'maplibre-gl/dist/maplibre-gl.css';

const COLORS = { flight: '#4285F4', lodging: '#FB8C00', activity: '#34A853', car_rental: '#9C27B0' };
const located = (point: PlanningMapPoint): boolean => typeof point.lat === 'number' && typeof point.lng === 'number'
  && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
  && ['catalog', 'airport', 'manual'].includes(point.coordinateSource || '');

export default function TripMap({ points, selectedId, onSelect, testID }: TripMapProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<LibreMap | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const selected = selectedId ?? selection;
  const { width } = useWindowDimensions();
  const resolved = useMemo(() => points.filter(located).slice(0, 100), [points]);
  const key = JSON.stringify(resolved);
  const chooseRef = useRef((id: string) => { setSelection(id); onSelect?.(id); });
  chooseRef.current = (id: string) => { setSelection(id); onSelect?.(id); };
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { rootMargin: '200px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (!open || !visible || !host.current || !resolved.length) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setFailed(false);
    void import('maplibre-gl').then(lib => {
      if (cancelled || !host.current) return;
      const instance = new lib.Map({
        container: host.current, style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [resolved[0].lng!, resolved[0].lat!], zoom: 13, cooperativeGestures: true,
        attributionControl: { compact: false },
      });
      map.current = instance;
      const markers: import('maplibre-gl').Marker[] = [];
      let resize: ResizeObserver | undefined;
      dispose = () => { resize?.disconnect(); markers.forEach(marker => marker.remove()); instance.remove(); if (map.current === instance) map.current = null; };
      instance.addControl(new lib.NavigationControl(), 'top-right');
      resolved.forEach((point, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = point.label || String(points.findIndex(candidate => candidate.id === point.id) + 1);
        button.setAttribute('aria-label', `${index + 1}. ${point.title}`);
        Object.assign(button.style, { background: COLORS[point.kind], color: 'white', border: '2px solid white', borderRadius: '50%', width: '44px', height: '44px', cursor: 'pointer', fontWeight: 'bold' });
        button.onclick = () => { chooseRef.current(point.id); rowRefs.current[point.id]?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); };
        markers.push(new lib.Marker({ element: button }).setLngLat([point.lng!, point.lat!]).addTo(instance));
      });
      if (resolved.length > 1) instance.fitBounds(resolved.reduce((bounds, point) => bounds.extend([point.lng!, point.lat!]), new lib.LngLatBounds()), { padding: 60, maxZoom: 15, duration: 0 });
      instance.on('load', () => {
        if (cancelled || resolved.length < 2) return;
        instance.addSource('visit-order', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: resolved.map(point => [point.lng!, point.lat!]) } } });
        instance.addLayer({ id: 'visit-order', type: 'line', source: 'visit-order', paint: { 'line-color': '#475569', 'line-width': 3, 'line-dasharray': [2, 2] } });
      });
      instance.on('error', () => { if (!cancelled) setFailed(true); });
      const lost = () => setFailed(true);
      instance.getCanvas().addEventListener('webglcontextlost', lost);
      if (typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(() => instance.resize()); resize.observe(host.current); }
    }).catch(() => { dispose?.(); dispose = undefined; if (!cancelled) setFailed(true); });
    return () => { cancelled = true; dispose?.(); };
  }, [open, visible, key]);
  useEffect(() => {
    const point = resolved.find(candidate => candidate.id === selected);
    if (point && map.current) map.current.easeTo({ center: [point.lng!, point.lat!], zoom: Math.max(map.current.getZoom(), 13), duration: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }, [selected, key]);
  return <View testID={testID} style={{ gap: 8 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}><Text>{open ? 'Hide map' : 'Show map'}</Text></TouchableOpacity>
    {open && <>
      {failed && <Text accessibilityRole="alert">Map unavailable — your itinerary is still below.</Text>}
      {!resolved.length && <Text>No coordinates yet. Your stops are listed below.</Text>}
      <div style={{ display: 'flex', flexDirection: width >= 1024 ? 'row' : 'column-reverse', gap: 16 }}>
        <ol aria-label="Day stops" style={{ flex: 1, margin: 0, padding: '0 0 0 24px', maxHeight: width >= 1024 ? 400 : undefined, overflowY: 'auto' }}>
          {points.map((point, index) => <li key={point.id}><button ref={node => { rowRefs.current[point.id] = node; }} type="button" aria-pressed={selected === point.id}
            onClick={() => chooseRef.current(point.id)} style={{ minHeight: 44, width: '100%', textAlign: 'left', background: selected === point.id ? '#e0f2fe' : 'transparent', border: 'none', cursor: 'pointer', padding: 8 }}>
            {point.label || String(index + 1)} · {point.title} · {point.kind.replace('_', ' ')}{!located(point) ? ' · Not on the map yet' : ''}
            {located(point) && index > 0 && located(points[index - 1]) && <span style={{ display: 'block' }}>{travelEstimate(points[index - 1], point)}</span>}
          </button></li>)}
        </ol>
        <div ref={host} aria-label="Interactive map of day stops" style={{ flex: 2, minHeight: 360, height: 400, display: failed || !resolved.length ? 'none' : 'block', borderRadius: 12, overflow: 'hidden' }} />
      </div>
      <Text>Straight-line estimates, not directions. Roads, barriers, traffic and accessibility can change travel time. Letters show visit order. Blue: flight · Orange: lodging · Green: activity · Purple: car rental.</Text>
      <Text>© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</Text>
    </>}
  </View>;
}
