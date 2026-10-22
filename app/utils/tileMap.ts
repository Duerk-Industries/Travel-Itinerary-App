/**
 * Plain "slippy map" geometry (the Web Mercator tile scheme every web map uses), for a map drawn as ordinary images
 * with no WebGL. Used as the fallback when the interactive map cannot start.
 */
export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 16;

export type MapPoint = { lat: number; lng: number };
export type MapView = {
  zoom: number;
  width: number;
  height: number;
  /** World pixel position of the view's top-left corner. */
  left: number;
  top: number;
};
export type PlacedTile = { key: string; url: string; left: number; top: number };

/** A latitude/longitude as a pixel position on the whole-world map at `zoom`. */
export const worldPixel = (point: MapPoint, zoom: number): { x: number; y: number } => {
  const scale = TILE_SIZE * 2 ** zoom;
  // Web Mercator cannot show the poles; clamp the sine so the log stays finite.
  const sine = Math.min(Math.max(Math.sin((point.lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
};

/** The tile that contains a point at `zoom`. */
export const tileForPoint = (point: MapPoint, zoom: number): { x: number; y: number } => {
  const { x, y } = worldPixel(point, zoom);
  return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
};

export const tileUrl = (zoom: number, x: number, y: number): string => {
  const count = 2 ** zoom;
  // The map repeats sideways; wrap x so a view across the date line still gets real tiles.
  return `https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`;
};

/**
 * The most zoomed-in view that keeps every point inside the frame with `padding` pixels to spare, centered on the
 * points. One point (or points too close to tell apart) gets the closest zoom.
 */
export const fitView = (points: MapPoint[], width: number, height: number, padding = 48): MapView => {
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  let zoom = MIN_ZOOM;
  for (let candidate = MAX_ZOOM; candidate >= MIN_ZOOM; candidate -= 1) {
    const pixels = points.map((point) => worldPixel(point, candidate));
    const spanX = Math.max(...pixels.map((p) => p.x)) - Math.min(...pixels.map((p) => p.x));
    const spanY = Math.max(...pixels.map((p) => p.y)) - Math.min(...pixels.map((p) => p.y));
    if (spanX <= usableWidth && spanY <= usableHeight) { zoom = candidate; break; }
  }
  const pixels = points.map((point) => worldPixel(point, zoom));
  const centerX = (Math.max(...pixels.map((p) => p.x)) + Math.min(...pixels.map((p) => p.x))) / 2;
  const centerY = (Math.max(...pixels.map((p) => p.y)) + Math.min(...pixels.map((p) => p.y))) / 2;
  return { zoom, width, height, left: centerX - width / 2, top: centerY - height / 2 };
};

/** Where a point lands inside the frame. */
export const placeInView = (point: MapPoint, view: MapView): { x: number; y: number } => {
  const { x, y } = worldPixel(point, view.zoom);
  return { x: x - view.left, y: y - view.top };
};

/** Every tile needed to cover the frame, each with its position inside the frame. */
export const tilesForView = (view: MapView): PlacedTile[] => {
  const count = 2 ** view.zoom;
  const first = { x: Math.floor(view.left / TILE_SIZE), y: Math.floor(view.top / TILE_SIZE) };
  const last = { x: Math.floor((view.left + view.width) / TILE_SIZE), y: Math.floor((view.top + view.height) / TILE_SIZE) };
  const tiles: PlacedTile[] = [];
  for (let tileY = first.y; tileY <= last.y; tileY += 1) {
    if (tileY < 0 || tileY >= count) continue;
    for (let tileX = first.x; tileX <= last.x; tileX += 1) {
      tiles.push({ key: `${view.zoom}/${tileX}/${tileY}`, url: tileUrl(view.zoom, tileX, tileY), left: tileX * TILE_SIZE - view.left, top: tileY * TILE_SIZE - view.top });
    }
  }
  return tiles;
};
