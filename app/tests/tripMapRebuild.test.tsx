/**
 * @jest-environment jsdom
 */
import React, { act } from 'react';
import type { PlanningMapPoint } from '../../server/src/types';

// A fake MapLibre that behaves like the browser where it matters here: removing a map makes its canvas fire
// "webglcontextlost" a moment later.
const mockInstances: any[] = [];
const mockControl = { autoLoad: true, failGpu: false };
jest.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}), { virtual: true });
jest.mock('../utils/maplibreConfig.web', () => ({ configureMapLibre: jest.fn() }));
jest.mock('maplibre-gl', () => {
  class FakeMap {
    canvas = document.createElement('canvas');
    handlers: Record<string, Array<(event?: unknown) => void>> = {};
    removed = false;
    constructor() { if (mockControl.failGpu) throw new Error('WebGL2 is required to display this map'); mockInstances.push(this); if (mockControl.autoLoad) setTimeout(() => this.emit('load'), 0); }
    on(name: string, handler: (event?: unknown) => void) { (this.handlers[name] ||= []).push(handler); }
    emit(name: string, event?: unknown) { (this.handlers[name] || []).forEach((handler) => handler(event)); }
    getCanvas() { return this.canvas; }
    style: object | undefined;
    getStyle() { return this.style; }
    addControl() {} addSource() {} addLayer() {} fitBounds() {} easeTo() {} resize() {}
    getZoom() { return 13; }
    remove() { this.removed = true; setTimeout(() => this.canvas.dispatchEvent(new Event('webglcontextlost')), 0); }
  }
  class Marker { setLngLat() { return this; } addTo() { return this; } remove() {} }
  class LngLatBounds { extend() { return this; } }
  class NavigationControl {}
  return { Map: FakeMap, Marker, LngLatBounds, NavigationControl };
}, { virtual: true });

import TripMap from '../components/TripMap.web';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = jest.requireActual('react-dom/client') as { createRoot: (element: Element) => { render: (node: React.ReactNode) => void; unmount: () => void } };

const point = (id: string, lat: number, lng: number): PlanningMapPoint =>
  ({ id, kind: 'activity', title: `Stop ${id}`, lat, lng, coordinateSource: 'manual' });

const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };

// react-dom does not wire react-native's onPress, so reach it through the element's React props.
const press = async (host: HTMLElement, label: string) => {
  const textNode = [...host.querySelectorAll('*')].find((element) => element.children.length === 0 && element.textContent === label);
  const target = textNode?.parentElement as HTMLElement;
  const propsKey = Object.keys(target).find((key) => key.startsWith('__reactProps$'))!;
  await act(async () => { (target as any)[propsKey].onPress(); });
};

describe('day map when its pins change while it is open', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const render = async (points: PlanningMapPoint[]) => { await act(async () => { root.render(<TripMap points={points} />); }); await settle(); };

  beforeEach(() => {
    mockInstances.length = 0;
    mockControl.autoLoad = true;
    mockControl.failGpu = false;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

  it('shows the map once opened', async () => {
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    await settle();
    expect(mockInstances).toHaveLength(1);
    expect(host.textContent).not.toContain('Interactive map unavailable');
  });

  it('notifies its owner when Show map is pressed without offering a coordinate-fetch button', async () => {
    const onOpenChange = jest.fn();
    await act(async () => { root.render(<TripMap points={[point('a', 35.7, 139.8)]} onOpenChange={onOpenChange} />); });
    expect(onOpenChange).not.toHaveBeenCalled();
    await press(host, 'Show map');
    await settle();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(host.textContent).not.toContain('Find locations for');
    expect(host.querySelector('[data-testid="find-locations"]')).toBeNull();
    await press(host, 'Hide map');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('uses the basic map when WebGL2 cannot initialize and updates its pin on selection', async () => {
    mockControl.failGpu = true;
    await render([point('a', 35.7, 139.8), point('b', 35.71, 139.79)]);
    await press(host, 'Show map');
    await settle();
    // The fallback is plain images and buttons: no iframe (the OpenStreetMap embed needs WebGL too) and no canvas.
    const basic = () => host.querySelector('[aria-label="Basic map of day stops"]') as HTMLElement;
    expect(host.querySelector('iframe')).toBeNull();
    expect(basic().querySelectorAll('img[src^="https://tile.openstreetmap.org/"]').length).toBeGreaterThan(0);
    const pins = () => [...basic().querySelectorAll('button')] as HTMLButtonElement[];
    expect(pins()).toHaveLength(2);
    expect(pins().map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    const stop = [...host.querySelectorAll('ol button')][1] as HTMLButtonElement;
    await act(async () => { stop.click(); });
    expect(pins().map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    // Selecting a pin on the basic map selects the stop in the list too.
    await act(async () => { pins()[0].click(); });
    expect(pins().map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect([...host.querySelectorAll('ol button')].map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    mockControl.failGpu = false;
    await press(host, 'Retry map');
    await settle();
    expect(basic()).toBeNull();
    expect(host.textContent).not.toContain('Interactive map unavailable');
  });

  it('is not marked unavailable when "Find locations" adds pins and the old map is torn down and rebuilt', async () => {
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    await settle();
    expect(mockInstances).toHaveLength(1);

    // New located stops arrive: the component removes the first map and builds another. The browser reports
    // the old map's lost WebGL context a moment after removal; that must not condemn the new map.
    await render([point('a', 35.7, 139.8), point('b', 35.71, 139.79), point('c', 35.72, 139.78)]);
    await settle();
    await settle();

    expect(mockInstances).toHaveLength(2);
    expect(mockInstances[0].removed).toBe(true);
    expect(mockInstances[1].removed).toBe(false);
    expect(host.textContent).not.toContain('Interactive map unavailable');
  });

  it('ignores a single failed tile or font after the map has loaded', async () => {
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    await settle();
    const map = mockInstances[0];
    await act(async () => { map.emit('error', { error: { message: 'Failed to fetch tile' }, sourceId: 'openmaptiles', tile: {} }); });
    await act(async () => { map.emit('error', { error: { message: 'glyph range 404' } }); });
    expect(host.textContent).not.toContain('Interactive map unavailable');
  });

  it('still reports a map whose style could not load, and a map that really loses its WebGL context', async () => {
    mockControl.autoLoad = false;
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    // Before the style has loaded, a style-level error (no source, no tile) means the map cannot work.
    await act(async () => { mockInstances[0].emit('error', { error: { message: 'Failed to fetch style' } }); });
    expect(host.textContent).toContain('Interactive map unavailable');

    await act(async () => { root.unmount(); });
    root = createRoot(host);
    mockInstances.length = 0;
    mockControl.autoLoad = true;
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    await settle();
    expect(host.textContent).not.toContain('Interactive map unavailable');
    await act(async () => { mockInstances[0].canvas.dispatchEvent(new Event('webglcontextlost')); });
    expect(host.textContent).toContain('Interactive map unavailable');
  });

  it('keeps the map visible for a font error before the first render and recovers on load', async () => {
    mockControl.autoLoad = false;
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    await settle();
    const map = mockInstances[0];
    map.style = { version: 8 };
    await act(async () => { map.emit('error', { error: { message: 'glyph range 404' } }); });
    expect(host.textContent).not.toContain('Interactive map unavailable');
    await act(async () => { map.canvas.dispatchEvent(new Event('webglcontextlost')); });
    expect(host.textContent).toContain('Interactive map unavailable');
    expect((host.querySelector('[aria-label="Interactive map of day stops"]') as HTMLElement).style.display).toBe('block');
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('[aria-label="Basic map of day stops"] img')).not.toBeNull();
    await act(async () => { map.canvas.dispatchEvent(new Event('webglcontextrestored')); map.emit('load'); });
    expect(host.textContent).not.toContain('Interactive map unavailable');
  });

  it('retries a map that could not load its style', async () => {
    mockControl.autoLoad = false;
    await render([point('a', 35.7, 139.8)]);
    await press(host, 'Show map');
    await settle();
    await act(async () => { mockInstances[0].emit('error', { error: { message: 'Failed to fetch style' } }); });
    mockControl.autoLoad = true;
    await press(host, 'Retry map');
    await settle();
    expect(mockInstances).toHaveLength(2);
    expect(mockInstances[0].removed).toBe(true);
    expect(host.textContent).not.toContain('Interactive map unavailable');
  });
});
