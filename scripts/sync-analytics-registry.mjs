#!/usr/bin/env node
/**
 * Copies the canonical analytics registry (packages/analytics/src/registry.ts) to its
 * server mirror (server/src/analytics/registry.ts). The server deploy uploads server/
 * alone, so it cannot import the workspace package (same constraint as
 * server/src/socket/messaging.ts).
 *
 *   node scripts/sync-analytics-registry.mjs          write the mirror
 *   node scripts/sync-analytics-registry.mjs --check  exit 1 if the mirror is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'packages/analytics/src/registry.ts');
const MIRROR = path.join(root, 'server/src/analytics/registry.ts');
const HEADER = '// GENERATED mirror of packages/analytics/src/registry.ts by scripts/sync-analytics-registry.mjs. Do not edit.\n';

const normalize = (text) => text.replace(/\r\n/g, '\n');
const expected = HEADER + normalize(readFileSync(SOURCE, 'utf8'));

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = normalize(readFileSync(MIRROR, 'utf8'));
  } catch {
    // missing mirror counts as stale
  }
  if (current !== expected) {
    console.error('server/src/analytics/registry.ts is out of date. Edit packages/analytics/src/registry.ts, then run: npm run sync:analytics-registry');
    process.exit(1);
  }
  console.log('Analytics registry mirror is up to date.');
} else {
  mkdirSync(path.dirname(MIRROR), { recursive: true });
  writeFileSync(MIRROR, expected);
  console.log('Wrote server/src/analytics/registry.ts');
}
