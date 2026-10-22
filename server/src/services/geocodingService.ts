import { createHash, randomUUID } from 'crypto';
import { getFeatureFlag, mutateGeocodingState, atomicIncrementApiUsageIfUnderLimit } from '../db';
import { getGeocodingPolicy as config } from './geocodingPolicy';
import type { AttractionCatalogEntry, GeocodeJob, GeocodeQuery, GeocodeResult } from '../types';

const normalize = (text: string): string => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const geocodeKey = (query: GeocodeQuery): string => createHash('sha256').update(JSON.stringify([query.name, query.locality, query.country, query.language, query.providerVersion].map(normalize))).digest('hex');
export const geocodingEnabled = async (): Promise<boolean> => Boolean(config()) && (await getFeatureFlag('planning_geocoding'))?.enabled === true;
export const publicCatalogQuery = (entry: AttractionCatalogEntry, providerVersion: string): GeocodeQuery | null => {
  try {
    const source = new URL(entry.sourceUrl || '');
    if (source.protocol !== 'https:' || !/(^|\.)(wikipedia\.org|wikidata\.org|wikivoyage\.org|openstreetmap\.org)$/.test(source.hostname)) return null;
    if (!entry.name || entry.name.length > 160 || !entry.destinationDisplayName || entry.destinationDisplayName.length > 160) return null;
    return { name: entry.name, locality: entry.destinationDisplayName, country: (entry.country || '').slice(0, 80), language: 'en', providerVersion };
  } catch { return null; }
};
/** Catalog reuse comes first. Shared cache is public-POI-only; no address hashes or private input. */
export async function resolveCatalogCoordinates(entry: AttractionCatalogEntry): Promise<GeocodeResult | null> {
  const settings = config();
  if (!settings || !await geocodingEnabled()) return null;
  const query = publicCatalogQuery(entry, settings.version); if (!query) return null;
  const key = geocodeKey(query); const now = Date.now();
  const state = await mutateGeocodingState(state => {
    state.jobs = state.jobs.filter(job => job.query.providerVersion === settings.version && (!job.expiresAt || job.expiresAt > now));
    if (!state.jobs.some(job => job.key === key) && state.jobs.length >= 150) {
      const completed = state.jobs.filter(job => job.state !== 'pending').sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0))[0];
      if (completed) state.jobs = state.jobs.filter(job => job.key !== completed.key);
    }
    if (!state.jobs.some(job => job.key === key) && state.jobs.length < 150) state.jobs.push({ key, query, state: 'pending', attempts: 0, dueAt: now });
    return state;
  });
  return state.jobs.find(job => job.key === key && job.state === 'done')?.result ?? null;
}
type FailureCode = NonNullable<GeocodeJob['lastErrorCode']>;
class LookupFailure extends Error {
  constructor(readonly code: FailureCode, readonly retryAt?: number) { super(code); }
}
const LEASE_MS = 30_000;
const nextUtcDay = (): number => { const now = new Date(Date.now()); return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1); };
const retryAfter = (value: string | null): number => {
  const seconds = value !== null && /^\d+$/.test(value.trim()) ? Math.min(86400, Number(value)) * 1000 : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(value || '') - Date.now();
  return Date.now() + Math.max(15_000, Math.min(86400_000, Number.isFinite(delay) ? delay : 60_000));
};
/** Shared by map enrichment and merchant lookup. Admission is durable across
 * instances. Endpoint-side controls are still needed for a suspended process. */
export async function claimGeocoderAdmission(): Promise<string | null> {
  const settings = config(); if (!settings || !await geocodingEnabled()) return null;
  const token = randomUUID(); const now = Date.now();
  const state = await mutateGeocodingState(state => {
    if (state.nextAllowedAt > now || (state.providerLeaseUntil || 0) > now) return state;
    state.providerLeaseToken = token; state.providerLeaseUntil = now + LEASE_MS;
    state.nextAllowedAt = now + settings.policy.minIntervalMs; return state;
  });
  return state.providerLeaseToken === token ? token : null;
}
export async function releaseGeocoderAdmission(token: string): Promise<void> {
  await mutateGeocodingState(state => {
    if (state.providerLeaseToken === token) {
      delete state.providerLeaseToken; delete state.providerLeaseUntil;
      state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + (config()?.policy.minIntervalMs ?? 15_000));
    }
    return state;
  });
}
export async function lookupApprovedPublicPoi(query: GeocodeQuery, admission: string, jobToken: string): Promise<GeocodeResult | null> {
  const settings = config();
  if (!settings || !await geocodingEnabled() || query.providerVersion !== settings.version) throw new LookupFailure('disabled');
  const key = geocodeKey(query);
  const assertOwnership = async () => {
    let owned = false; let leaseUntil = 0;
    await mutateGeocodingState(state => {
      const job = state.jobs.find(j => j.key === key && j.leaseToken === jobToken && j.state === 'pending');
      owned = Boolean(state.providerLeaseToken === admission && (state.providerLeaseUntil || 0) > Date.now()
        && job && geocodeKey(job.query) === key && (job.leaseUntil || 0) > Date.now());
      if (owned && job) { leaseUntil = Date.now() + LEASE_MS; state.providerLeaseUntil = leaseUntil; job.leaseUntil = leaseUntil; }
      return state;
    });
    if (!owned || leaseUntil <= Date.now()) throw new LookupFailure('lease-lost');
  };
  await assertOwnership();
  const quota = settings.dailyLimit > 0 && await atomicIncrementApiUsageIfUnderLimit({ provider: 'GEOCODING', caller: 'PUBLIC_POI_LOOKUP', scope: 'caller', windowKey: new Date(Date.now()).toISOString().slice(0, 10), limit: settings.dailyLimit });
  if (!quota || !quota.allowed) throw new LookupFailure('budget', nextUtcDay());
  // Database/quota awaits can outlive both a lease and a configuration change.
  if (config()?.version !== settings.version || !await geocodingEnabled()) throw new LookupFailure('disabled');
  await assertOwnership();
  if (config()?.version !== settings.version) throw new LookupFailure('disabled');
  const url = new URL(settings.endpoint);
  url.searchParams.set('q', [query.name, query.locality, query.country].filter(Boolean).join(', '));
  url.searchParams.set('format', 'jsonv2'); url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1'); url.searchParams.set('accept-language', query.language);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new LookupFailure('timeout')); }, 8_000);
  });
  const request = async (): Promise<GeocodeResult | null> => {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': settings.identity } });
    if (response.status === 429 || response.status === 503) {
      throw new LookupFailure('rate-limit', retryAfter(response.headers.get('retry-after')));
    }
    if (!response.ok) throw new LookupFailure('provider');
    if (Number(response.headers.get('content-length') || 0) > 65_536 || !response.body) throw new LookupFailure('invalid-response');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength; if (size > 65_536) throw new LookupFailure('invalid-response');
        chunks.push(next.value);
      }
    } finally { void reader.cancel().catch(() => undefined); }
    let rows: unknown;
    try { rows = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LookupFailure('invalid-response'); }
    if (!Array.isArray(rows)) throw new LookupFailure('invalid-response');
    if (!rows.length) return null;
    const row = rows[0] as { lat?: string | number; lon?: string | number; category?: unknown; type?: unknown; address?: { city?: unknown; town?: unknown } };
    const lat = Number(row?.lat); const lng = Number(row?.lon);
    if (!row || !['string', 'number'].includes(typeof row.lat) || !['string', 'number'].includes(typeof row.lon) || row.lat == null || row.lon == null || String(row.lat).trim() === '' || String(row.lon).trim() === ''
      || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new LookupFailure('invalid-response');
    const city = row.address?.city || row.address?.town;
    return { lat, lng, geoCity: typeof city === 'string' ? city.slice(0, 160) : null, quality: 'approximate',
      providerCategory: typeof row.category === 'string' ? row.category.slice(0, 80) : '',
      providerType: typeof row.type === 'string' ? row.type.slice(0, 80) : '',
      provider: settings.version, attribution: settings.policy.attribution };
  };
  try { return await Promise.race([request(), deadline]); }
  catch (error) { throw error instanceof LookupFailure ? error : new LookupFailure('provider'); }
  finally { controller.abort(); if (timeout !== undefined) clearTimeout(timeout); }
}
/** Run even with external work disabled so expired/withdrawn cached results
 * do not persist indefinitely simply because a kill switch was used. */
const maintainGeocodingState = async (settings: ReturnType<typeof config>) => mutateGeocodingState(state => {
  state.jobs = state.jobs.filter(job => (!job.expiresAt || job.expiresAt > Date.now())
    && (job.state !== 'done' || (settings && job.query.providerVersion === settings.version)));
  return state;
});

export async function processGeocodingJob(): Promise<{ processed: number }> {
  const settings = config();
  await maintainGeocodingState(settings);
  if (!settings || !await geocodingEnabled()) return { processed: 0 };
  const admission = await claimGeocoderAdmission(); if (!admission) return { processed: 0 };
  const token = randomUUID(); const now = Date.now();
  try {
    const state = await mutateGeocodingState(state => {
      state.jobs = state.jobs.filter(j => j.query.providerVersion === settings.version && (!j.expiresAt || j.expiresAt > now));
      const candidate = state.jobs.filter(j => j.state === 'pending' && j.dueAt <= now && (j.leaseUntil || 0) <= now)
        .sort((a, b) => a.dueAt - b.dueAt || a.key.localeCompare(b.key))[0];
      if (candidate) { candidate.leaseToken = token; candidate.leaseUntil = now + LEASE_MS; }
      return state;
    });
    const job = state.jobs.find(j => j.leaseToken === token); if (!job) return { processed: 0 };
    let result: GeocodeResult | null = null; let failure: LookupFailure | undefined;
    try { result = await lookupApprovedPublicPoi(job.query, admission, token); }
    catch (error) { failure = error instanceof LookupFailure ? error : new LookupFailure('provider'); }
    await mutateGeocodingState(state => {
      const current = state.jobs.find(j => j.key === job.key);
      if (!current || current.leaseToken !== token || (current.leaseUntil || 0) <= Date.now()
        || state.providerLeaseToken !== admission || (state.providerLeaseUntil || 0) <= Date.now()) return state;
      delete current.leaseToken; delete current.leaseUntil;
      if (failure) {
        current.lastErrorCode = failure.code;
        if (failure.code === 'budget' || failure.code === 'disabled' || failure.code === 'lease-lost') {
          current.dueAt = failure.retryAt ?? Date.now() + 60_000;
        } else {
          current.attempts += 1;
          current.state = current.attempts >= 4 ? 'dead' : 'pending';
          current.dueAt = Math.max(failure.retryAt ?? 0, Date.now() + 60_000 * 2 ** current.attempts);
          if (current.state === 'dead') current.expiresAt = Date.now() + 86400_000;
        }
        if (failure.code === 'rate-limit' || failure.code === 'budget') state.nextAllowedAt = Math.max(state.nextAllowedAt, current.dueAt);
      } else if (config()?.version === settings.version) {
        current.attempts += 1; delete current.lastErrorCode;
        current.state = 'done'; current.result = result;
        current.expiresAt = Date.now() + (result ? settings.policy.positiveTtlSeconds : settings.policy.negativeTtlSeconds) * 1000;
      }
      return state;
    });
    return { processed: 1 };
  } finally { await releaseGeocoderAdmission(admission); }
}

export async function geocodingStatus() {
  const enabled = await geocodingEnabled();
  const state = await maintainGeocodingState(config());
  return { enabled, pending: state.jobs.filter(j => j.state === 'pending').length,
    ready: state.jobs.filter(j => j.state === 'done' && (j.expiresAt || 0) > Date.now()).length,
    dead: state.jobs.filter(j => j.state === 'dead').length, nextAllowedAt: state.nextAllowedAt,
    deadJobs: state.jobs.filter(j => j.state === 'dead').map(j => ({ key: j.key, attempts: j.attempts, lastErrorCode: j.lastErrorCode ?? null })) };
}
