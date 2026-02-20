const fs = require('fs');
const path = require('path');

const ROOT = process.env.FIREBASE_EXPORT_ROOT
  ? path.resolve(process.env.FIREBASE_EXPORT_ROOT)
  : path.resolve(__dirname, '..');
const EXPORT_PREFIX = 'firebase-export-';
const TARGET_DIR = process.env.FIREBASE_DATA_DIR
  ? path.resolve(process.env.FIREBASE_DATA_DIR)
  : path.join(ROOT, '.firebase-data');

const isExportDir = (entry) => entry.isDirectory() && entry.name.startsWith(EXPORT_PREFIX);

const listExportDirs = (root) =>
  fs
    .readdirSync(root, { withFileTypes: true })
    .filter(isExportDir)
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(root, entry.name),
      mtimeMs: fs.statSync(path.join(root, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

const copyDir = (src, dest) => {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
};

const main = () => {
  if (!fs.existsSync(ROOT)) {
    console.error(`Root not found: ${ROOT}`);
    process.exitCode = 1;
    return;
  }
  const exportsList = listExportDirs(ROOT);
  if (!exportsList.length) {
    console.log('No firebase-export-* directories found. Skipping import copy.');
    return;
  }
  const newest = exportsList[0];
  copyDir(newest.fullPath, TARGET_DIR);
  console.log(`Copied ${newest.name} -> ${path.relative(ROOT, TARGET_DIR)}`);
};

main();
