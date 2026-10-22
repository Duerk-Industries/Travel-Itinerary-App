import { configureMapLibre } from '../utils/maplibreConfig.web';
import { isLocatedMapPoint } from '../utils/planningMapGeometry';
import { travelEstimate } from '../../packages/domain/src/planningTravelEstimates';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../theme/ThemeContext';
import { linkTextColor } from '../theme/theme';
import type { Map as LibreMap } from 'maplibre-gl';
import type { TripMapProps } from './TripMap.types';
import type { PlanningMapPoint } from '../../server/src/types';
import 'maplibre-gl/dist/maplibre-gl.css';
import BasicTripMap from './BasicTripMap.web';

const COLORS = { flight: '#4285F4', lodging: '#FB8C00', activity: '#34A853', car_rental: '#9C27B0' };
const located = isLocatedMapPoint;
// The stop list is plain HTML, so it has to ask for the app's font; the browser default is a serif.
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Every transfer (flight, train, bus, ferry) is drawn as one kind, so name it for what it is.
const KIND_LABEL: Record<string, string> = { flight: 'transfer', lodging: 'lodging', activity: 'activity', car_rental: 'car rental' };

export default function TripMap({ points, selectedId, onSelect, testID, onFindLocations, findLocationsCount = 0, findLocationsProvider }: TripMapProps) {
  const theme = useAppTheme();
  const { colors } = theme;
  const host = useRef<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const map = useRef<LibreMap | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [findNotice, setFindNotice] = useState<string | null>(null);
  const findLocations = async () => {
    if (!onFindLocations || finding) return;
    setFinding(true); setFindNotice(null);
    try { setFindNotice(await onFindLocations()); } catch { setFindNotice("Couldn't look up locations right now. Try again later."); } finally { setFinding(false); }
  };
  const selected = selectedId ?? selection;
  const { width } = useWindowDimensions();
  const resolved = useMemo(() => points.filter(located).slice(0, 100), [points]);
  const key = JSON.stringify(resolved);
  const chooseRef = useRef((id: string) => { setSelection(id); onSelect?.(id); });
  chooseRef.current = (id: string) => { setSelection(id); onSelect?.(id); };
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!viewport.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { rootMargin: '200px' });
    observer.observe(viewport.current); return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (!open || !visible || !host.current || !resolved.length) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setFailed(false);
    void import('maplibre-gl').then(lib => {
      if (cancelled || !host.current) return;
      configureMapLibre(lib);
      const instance = new lib.Map({
        container: host.current, style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [resolved[0].lng!, resolved[0].lat!], zoom: 13, cooperativeGestures: true,
        attributionControl: { compact: false },
      });
      map.current = instance;
      const markers: import('maplibre-gl').Marker[] = [];
      let resize: ResizeObserver | undefined;
      // Removing a map makes the browser fire "webglcontextlost" on its canvas a moment later. That must never mark the
      // map that replaced it (or a map that is going away) as broken, so the listener is guarded and detached on dispose.
      const lost = (event: Event) => { event.preventDefault(); if (!cancelled) setFailed(true); };
      const restored = () => { if (!cancelled) setFailed(false); };
      const canvas = instance.getCanvas();
      dispose = () => {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
        resize?.disconnect(); markers.forEach(marker => marker.remove()); instance.remove(); if (map.current === instance) map.current = null;
      };
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
      let loaded = false;
      instance.on('load', () => {
        loaded = true;
        if (!cancelled) setFailed(false);
        if (cancelled || resolved.length < 2) return;
        instance.addSource('visit-order', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: resolved.map(point => [point.lng!, point.lat!]) } } });
        instance.addLayer({ id: 'visit-order', type: 'line', source: 'visit-order', paint: { 'line-color': '#475569', 'line-width': 3, 'line-dasharray': [2, 2] } });
      });
      instance.on('error', (event) => {
        const detail = event as { error?: { message?: string }; sourceId?: string; tile?: unknown };
        console.warn('[map] error', detail?.error?.message ?? event);
        // A single failed tile, glyph or sprite request is routine; only a map that could not load its style is unusable.
        // Fonts and sprites can fail before the first complete render too. Once the style
        // JSON exists, those errors must not hide an otherwise usable map.
        if (!cancelled && !loaded && !instance.getStyle() && !detail?.sourceId && !detail?.tile) setFailed(true);
      });
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', restored);
      if (typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(() => instance.resize()); resize.observe(host.current); }
    }).catch((error) => { console.warn('[map] could not start', error); dispose?.(); dispose = undefined; if (!cancelled) setFailed(true); });
    return () => { cancelled = true; dispose?.(); };
  }, [open, visible, key, retryKey]);
  useEffect(() => {
    const point = resolved.find(candidate => candidate.id === selected);
    if (point && map.current) map.current.easeTo({ center: [point.lng!, point.lat!], zoom: Math.max(map.current.getZoom(), 13), duration: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }, [selected, key]);
  return <View testID={testID} style={{ gap: 8 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}><Text tone="link">{open ? 'Hide map' : 'Show map'}</Text></TouchableOpacity>
    {open && <>
      {failed && <>
        <Text accessibilityRole="alert">Interactive map unavailable — showing a basic map instead.</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => setRetryKey(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text tone="link">Retry map</Text></TouchableOpacity>
      </>}
      {!resolved.length && <Text>No coordinates yet. Your stops are listed below.</Text>}
      {onFindLocations && findLocationsCount > 0 && <View style={{ gap: 4 }}>
        <TouchableOpacity testID="find-locations" accessibilityRole="button" disabled={finding} accessibilityState={{ disabled: finding, busy: finding }} onPress={() => void findLocations()} style={{ minHeight: 44, justifyContent: 'center', opacity: finding ? 0.6 : 1 }}>
          <Text tone="link">{finding ? 'Finding locations…' : `Find locations for ${findLocationsCount} stop${findLocationsCount === 1 ? '' : 's'}`}</Text>
        </TouchableOpacity>
        <Text tone="muted">{`This sends each stop's saved address to ${findLocationsProvider || 'our location provider'} to place it on the map.`}</Text>
      </View>}
      {findNotice && <Text accessibilityRole="alert" accessibilityLiveRegion="polite">{findNotice}</Text>}
      <div ref={viewport} style={{ display: 'flex', flexDirection: width >= 1024 ? 'row' : 'column-reverse', gap: 16 }}>
        <ol aria-label="Day stops" style={{ flex: 1, margin: 0, padding: '0 0 0 24px', color: colors.text, fontFamily: FONT_STACK, fontSize: 14, lineHeight: 1.4, maxHeight: width >= 1024 ? 400 : undefined, overflowY: 'auto' }}>
          {points.map((point, index) => <li key={point.id}><button ref={node => { rowRefs.current[point.id] = node; }} type="button" aria-pressed={selected === point.id}
            onClick={() => chooseRef.current(point.id)} style={{ minHeight: 44, width: '100%', textAlign: 'left', color: colors.text, font: 'inherit', background: selected === point.id ? colors.surfaceMuted : 'transparent', border: selected === point.id ? `1px solid ${colors.border}` : '1px solid transparent', borderRadius: 6, cursor: 'pointer', padding: 8 }}>
            {point.label || String(index + 1)} · {point.title} · {KIND_LABEL[point.kind] ?? point.kind.replace('_', ' ')}{!located(point) ? ' · Not on the map yet' : ''}
            {located(point) && index > 0 && located(points[index - 1]) && <span style={{ display: 'block', color: colors.textMuted }}>{travelEstimate(points[index - 1], point)}</span>}
          </button></li>)}
        </ol>
        {failed && <BasicTripMap points={resolved} selectedId={selected} />}
        <div ref={host} aria-label="Interactive map of day stops" style={{ flex: failed ? 0 : 2, minHeight: failed ? 0 : 360, height: failed ? 0 : 400, display: !resolved.length ? 'none' : 'block', borderRadius: 12, overflow: 'hidden' }} />
      </div>
      {[...new Set(points.map(point => point.coordinateAttribution).filter((value): value is string => Boolean(value)))].map(value => <Text key={value}>{value}</Text>)}
      <Text>Straight-line estimates, not directions. Roads, barriers, traffic and accessibility can change travel time. Letters show visit order. Blue: transfer · Orange: lodging · Green: activity · Purple: car rental.</Text>
      {[...new Map(points.flatMap(point => point.coordinateCreditLinks ?? []).map(link => [link.url, link])).values()].map(link =>
        <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" style={{ minHeight: 24, color: linkTextColor(theme) }}>{link.label}</a>)}
      <Text tone="muted">© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</Text>
    </>}
  </View>;
}
