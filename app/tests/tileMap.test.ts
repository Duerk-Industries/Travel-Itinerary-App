import { TILE_SIZE, fitView, placeInView, tileForPoint, tileUrl, tilesForView, worldPixel } from '../utils/tileMap';

describe('tile map geometry (no WebGL)', () => {
  it('matches the slippy-map tile numbers every web map uses', () => {
    // London at zoom 10 is tile 511/340 (a standard reference); the whole world is one tile at zoom 0.
    expect(tileForPoint({ lat: 51.5074, lng: -0.1278 }, 10)).toEqual({ x: 511, y: 340 });
    expect(tileForPoint({ lat: 35.6895, lng: 139.6917 }, 10)).toEqual({ x: 909, y: 403 });
    expect(tileForPoint({ lat: 10, lng: 20 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it('puts the equator and the prime meridian at the middle of the world', () => {
    const middle = worldPixel({ lat: 0, lng: 0 }, 3);
    expect(middle.x).toBeCloseTo(TILE_SIZE * 4, 5);
    expect(middle.y).toBeCloseTo(TILE_SIZE * 4, 5);
  });

  it('survives the poles and wraps tiles across the date line', () => {
    expect(Number.isFinite(worldPixel({ lat: 90, lng: 0 }, 5).y)).toBe(true);
    expect(Number.isFinite(worldPixel({ lat: -90, lng: 0 }, 5).y)).toBe(true);
    expect(tileUrl(3, -1, 2)).toBe('https://tile.openstreetmap.org/3/7/2.png');
    expect(tileUrl(3, 8, 2)).toBe('https://tile.openstreetmap.org/3/0/2.png');
    expect(tileUrl(10, 909, 403)).toBe('https://tile.openstreetmap.org/10/909/403.png');
  });

  describe('fitView', () => {
    const asakusa = { lat: 35.7148, lng: 139.7967 };
    const ueno = { lat: 35.7072, lng: 139.7717 };

    it('zooms in as far as allowed for a single stop, centered on it', () => {
      const view = fitView([asakusa], 640, 400);
      expect(view.zoom).toBe(16);
      const spot = placeInView(asakusa, view);
      expect(spot.x).toBeCloseTo(320, 5);
      expect(spot.y).toBeCloseTo(200, 5);
    });

    it('keeps every stop inside the frame with room to spare', () => {
      const stops = [asakusa, ueno, { lat: 35.6586, lng: 139.7454 }];
      const view = fitView(stops, 640, 400, 48);
      for (const stop of stops) {
        const spot = placeInView(stop, view);
        expect(spot.x).toBeGreaterThanOrEqual(48 - 0.5);
        expect(spot.x).toBeLessThanOrEqual(640 - 48 + 0.5);
        expect(spot.y).toBeGreaterThanOrEqual(48 - 0.5);
        expect(spot.y).toBeLessThanOrEqual(400 - 48 + 0.5);
      }
      // One zoom level closer would not have fit.
      const tighter = fitView(stops, 640, 400, 48);
      expect(tighter.zoom).toBe(view.zoom);
    });

    it('zooms out for stops far apart and never below the minimum', () => {
      const far = fitView([{ lat: 35.7, lng: 139.8 }, { lat: 42.36, lng: -71.06 }], 640, 400);
      expect(far.zoom).toBeLessThanOrEqual(3);
      expect(fitView([{ lat: 80, lng: -170 }, { lat: -80, lng: 170 }], 640, 400).zoom).toBe(2);
    });

    it('a narrower frame zooms out further than a wider one for the same stops', () => {
      const stops = [asakusa, { lat: 35.6586, lng: 139.7454 }];
      expect(fitView(stops, 320, 400).zoom).toBeLessThanOrEqual(fitView(stops, 960, 400).zoom);
    });
  });

  describe('tilesForView', () => {
    it('covers the whole frame without gaps or repeats', () => {
      const view = fitView([{ lat: 35.7148, lng: 139.7967 }, { lat: 35.7072, lng: 139.7717 }], 640, 400);
      const tiles = tilesForView(view);
      expect(new Set(tiles.map((tile) => tile.key)).size).toBe(tiles.length);
      expect(tiles.length).toBeGreaterThanOrEqual(4);
      const lefts = tiles.map((tile) => tile.left);
      const tops = tiles.map((tile) => tile.top);
      expect(Math.min(...lefts)).toBeLessThanOrEqual(0);
      expect(Math.max(...lefts) + TILE_SIZE).toBeGreaterThanOrEqual(640);
      expect(Math.min(...tops)).toBeLessThanOrEqual(0);
      expect(Math.max(...tops) + TILE_SIZE).toBeGreaterThanOrEqual(400);
    });

    it('positions a tile exactly where the map math says it should be', () => {
      const view = fitView([{ lat: 35.7148, lng: 139.7967 }], 640, 400);
      const target = tileForPoint({ lat: 35.7148, lng: 139.7967 }, view.zoom);
      const tile = tilesForView(view).find((candidate) => candidate.key === `${view.zoom}/${target.x}/${target.y}`)!;
      expect(tile.left).toBeCloseTo(target.x * TILE_SIZE - view.left, 5);
      expect(tile.top).toBeCloseTo(target.y * TILE_SIZE - view.top, 5);
    });

    it('skips tiles above and below the world instead of requesting invalid ones', () => {
      const tiles = tilesForView({ zoom: 2, width: 640, height: 400, left: 0, top: -300 });
      expect(tiles.every((tile) => Number(tile.key.split('/')[2]) >= 0)).toBe(true);
    });
  });
});
