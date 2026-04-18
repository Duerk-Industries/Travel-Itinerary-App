const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetsToCopy = ['data'];

for (const asset of assetsToCopy) {
  const source = path.join(rootDir, asset);
  const destination = path.join(distDir, asset);
  if (!fs.existsSync(source)) {
    continue;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
  process.stdout.write(`Copied ${asset} -> ${path.relative(rootDir, destination)}\n`);
}
