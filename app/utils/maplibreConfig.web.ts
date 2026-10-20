import type * as MapLibre from 'maplibre-gl';
const version = require('maplibre-gl/package.json').version as string;
export function configureMapLibre(lib: typeof MapLibre): void {
  lib.setWorkerUrl(`${window.location.origin}/map-assets/maplibre-${version}-worker.mjs`);
  lib.setWorkerCount(1);
}
