const fs = require('fs');
const path = require('path');
// MapLibre 6 uses an external ES-module worker. Metro relocates the main module,
// so its import.meta-relative worker URL must be replaced with a stable asset.
const packagePath = require.resolve('maplibre-gl/package.json', { paths: [path.join(__dirname, '..')] });
const { version } = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const directory = path.join(__dirname, '..', 'public', 'map-assets');
fs.mkdirSync(directory, { recursive: true });
fs.copyFileSync(path.join(path.dirname(packagePath), 'dist', 'maplibre-gl-worker.mjs'), path.join(directory, `maplibre-${version}-worker.mjs`));
