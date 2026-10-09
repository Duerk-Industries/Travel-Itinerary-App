#!/usr/bin/env node
/**
 * Analytics staging smoke test (docs/implementation-plans/analytics-upgrade.md, Phase 6).
 * Exercises consent → ingest → report → erase against a deployed environment, using a
 * DEDICATED TEST ACCOUNT that is in the rollout cohort (e.g. an internal canary account).
 *
 *   BASE_URL=https://staging.example USER_TOKEN=... ADMIN_TOKEN=... \
 *     node scripts/analytics-smoke.mjs --confirm
 *
 * It opts the test account in, sends two synthetic events, checks the admin report and
 * rollout endpoints, then deletes the account's analytics data and verifies the erasure.
 * Never point it at a real person's account: the final step erases their analytics data.
 */
const { BASE_URL, USER_TOKEN, ADMIN_TOKEN } = process.env;
if (!process.argv.includes('--confirm') || !BASE_URL || !USER_TOKEN || !ADMIN_TOKEN) {
  console.error('Usage: BASE_URL=… USER_TOKEN=<dedicated test account> ADMIN_TOKEN=… node scripts/analytics-smoke.mjs --confirm');
  process.exit(64);
}

const zone = 'America/New_York';
const steps = [];
const call = async (method, path, token, body) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Device-Timezone': zone },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
};
const step = async (name, fn) => {
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail });
  } catch (err) {
    steps.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    throw err;
  }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const run = async () => {
  let status;
  await step('Rollout and flags readable by admin', async () => {
    const r = await call('GET', '/api/admin/analytics/rollout', ADMIN_TOKEN);
    expect(r.status === 200, `HTTP ${r.status}`);
    return JSON.stringify(r.json.product_analytics);
  });
  await step('Test account is offered product analytics', async () => {
    const r = await call('GET', '/api/account/privacy-preferences', USER_TOKEN);
    expect(r.status === 200, `HTTP ${r.status}`);
    status = r.json;
    expect(status.productCollectionEnabled, 'productCollectionEnabled is false: flag off or account outside the rollout cohort');
    return `revision ${status.revision}, consented=${status.productAnalyticsAllowed}`;
  });
  await step('Opt in (if needed)', async () => {
    if (status.productAnalyticsAllowed) return 'already opted in';
    const r = await call('PATCH', '/api/account/privacy-preferences', USER_TOKEN, { revision: status.revision, productAnalytics: true, platform: 'web' });
    expect(r.status === 200 && r.json.productAnalyticsAllowed, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
    return 'opted in';
  });
  await step('Ingest accepts synthetic events', async () => {
    const id = `smoke_${Date.now().toString(36)}`;
    const base = { schema_version: 1, occurred_at: new Date().toISOString(), session_id: `${id}_session`, platform: 'web', app_version: 'smoke', device_timezone: zone };
    const r = await call('POST', '/api/analytics/events', USER_TOKEN, { events: [
      { ...base, event_id: `${id}_s`, event_name: 'session_started', properties: { resumed: false } },
      { ...base, event_id: `${id}_v`, event_name: 'feature_viewed', properties: { feature: 'home', entry_point: 'other' } },
    ] });
    expect(r.status === 200 && r.json.accepted === 2, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
    return 'accepted 2';
  });
  await step('Admin report and reliability respond', async () => {
    const report = await call('GET', '/api/admin/analytics/report?days=7', ADMIN_TOKEN);
    expect(report.status === 200 && report.json.meta?.metricVersion, `report HTTP ${report.status}`);
    const reliability = await call('GET', '/api/admin/analytics/reliability?days=7', ADMIN_TOKEN);
    expect(reliability.status === 200, `reliability HTTP ${reliability.status}`);
    return `${report.json.meta.eventsScanned} events scanned (report cached up to 10 min)`;
  });
  await step('Delete analytics data erases the test events', async () => {
    const r = await call('DELETE', '/api/account/analytics-data', USER_TOKEN);
    expect([200, 202].includes(r.status), `HTTP ${r.status}`);
    const stepState = r.json.steps?.product_analytics_events;
    expect(stepState?.status === 'done' && stepState.affected >= 2, `erasure step: ${JSON.stringify(stepState)}`);
    return `job ${r.json.id} ${r.json.status}`;
  });
  await step('Export shows no remaining analytics events', async () => {
    const r = await call('GET', '/api/account/export', USER_TOKEN);
    expect(r.status === 200, `HTTP ${r.status}`);
    const events = r.json.analytics?.productAnalytics?.events ?? [];
    expect(events.length === 0, `${events.length} events still exported`);
    return 'none';
  });
};

run()
  .catch(() => undefined)
  .finally(() => {
    for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}: ${s.detail}`);
    process.exit(steps.every((s) => s.ok) && steps.length === 7 ? 0 : 1);
  });
