#!/usr/bin/env node
/**
 * Analytics release gate (docs/implementation-plans/analytics-upgrade.md, Phase 6).
 * Checks everything about the analytics/privacy rollout that can be verified from the
 * repository, and lists the manual sign-offs still open.
 *
 *   node scripts/analytics-release-gate.mjs           automated checks; manual items as warnings
 *   node scripts/analytics-release-gate.mjs --strict  also fail while manual items in
 *                                                    sections 0–4 of the follow-ups are open
 *
 * Exit codes: 0 pass, 1 an automated check failed, 2 only manual items are open (--strict).
 * Passing this gate is necessary, not sufficient: it cannot see vendor settings, store
 * forms, signatures or device network traces.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const strict = process.argv.includes('--strict');
const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const runScript = (rel) => execFileSync(process.execPath, [path.join(root, rel), '--check'], { stdio: 'pipe' }).toString().trim();

check('Privacy notice pages match the canonical Markdown', () => runScript('scripts/build-legal-pages.mjs'));
check('Server analytics registry mirror matches packages/analytics', () => runScript('scripts/sync-analytics-registry.mjs'));

check('Collection flags default off (fail-closed seeds)', () => {
  const yaml = read('server/config/feature-flags.yaml');
  for (const flag of ['analytics_collection_enabled', 'diagnostics_user_linked_enabled', 'age_gate_enforcement']) {
    const block = new RegExp(`\\n  ${flag}:\\n    enabled: (true|false)`).exec(yaml);
    assert(block, `${flag} missing from feature-flags.yaml`);
    assert(block[1] === 'false', `${flag} must seed as enabled: false`);
  }
  const service = read('server/src/services/entitlementService.ts');
  for (const flag of ['age_gate_enforcement']) assert(service.includes(`'${flag}'`), `${flag} must be in FAIL_CLOSED_FLAGS`);
  return 'analytics, diagnostics and age-gate flags seed off';
});

check('Store privacy configuration (iOS manifest, Android AD_ID block)', () => {
  const { createExpoConfig } = require(path.join(root, 'expo.config.shared.cjs'));
  const config = createExpoConfig({ appDir: path.join(root, 'app') });
  const manifest = config.ios?.privacyManifests;
  assert(manifest, 'ios.privacyManifests is missing');
  assert(manifest.NSPrivacyTracking === false, 'NSPrivacyTracking must be false');
  const types = (manifest.NSPrivacyCollectedDataTypes ?? []).map((t) => t.NSPrivacyCollectedDataType);
  for (const required of ['NSPrivacyCollectedDataTypeProductInteraction', 'NSPrivacyCollectedDataTypeCrashData', 'NSPrivacyCollectedDataTypeDeviceID']) {
    assert(types.includes(required), `${required} must be declared`);
  }
  assert((config.android?.blockedPermissions ?? []).includes('com.google.android.gms.permission.AD_ID'), 'Android AD_ID must be blocked');
  return `${types.length} collected data types declared; AD_ID blocked`;
});

check('Privacy migrations are present', () => {
  const required = [
    '20261008_add_privacy_preferences.sql',
    '20261008_add_age_verification_source.sql',
    '20261008_add_provider_cost_ledger.sql',
    '20261009_add_privacy_rights.sql',
    '20261010_add_analytics_events.sql',
    '20261011_add_analytics_subject_timezone.sql',
    '20261012_add_trip_timezone.sql',
  ];
  const missing = required.filter((file) => !existsSync(path.join(root, 'server/migrations', file)));
  assert(!missing.length, `missing: ${missing.join(', ')}`);
  return `${required.length} migrations`;
});

check('Privacy notice carries the required disclosures', () => {
  const notice = read('docs/legal/privacy-policy.md');
  for (const phrase of ['Optional product analytics', 'off unless you', 'Global Privacy Control', 'none appointed at this time', 'Limited Use', 'age 16 or older']) {
    assert(notice.includes(phrase), `privacy notice is missing "${phrase}"`);
  }
  assert(!/under 13/.test(notice), 'privacy notice must not say "under 13"');
  return 'required phrases present';
});

check('Unauthenticated login routes are removed', () => {
  const routes = read('server/src/routes/authRoutes.ts');
  const open = ["router.post('/email'", "router.post('/oauth'"].filter((r) => routes.includes(r));
  assert(!open.length, `still present: ${open.join(', ')} (issue tokens for any email; see follow-ups §0)`);
  return 'not present';
});

// Manual follow-ups: open checkboxes in sections 0–4 block release under --strict.
const followups = read('docs/analytics-manual-followups.md');
const manual = [];
let section = '';
for (const line of followups.split('\n')) {
  const heading = /^## (\d+)\./.exec(line);
  if (heading) section = heading[1];
  const item = /^- \[ \] \*\*(.+?)\*\*/.exec(line);
  if (item && Number(section) <= 4) manual.push(`§${section} ${item[1]}`);
}

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
console.log('\nAnalytics release gate\n');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 62)} ${r.detail}`);
console.log(`\nOpen manual items (docs/analytics-manual-followups.md §0–4): ${manual.length}`);
for (const item of manual) console.log(`  [ ] ${item}`);

const failed = results.filter((r) => !r.ok).length;
if (failed) {
  console.log(`\n${failed} automated check(s) failed.`);
  process.exit(1);
}
if (strict && manual.length) {
  console.log('\nAutomated checks pass; manual items still open (--strict).');
  process.exit(2);
}
console.log('\nAutomated checks pass.');
