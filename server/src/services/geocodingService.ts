import { createHash, randomUUID } from 'crypto';
import { getFeatureFlag, mutateGeocodingState, atomicIncrementApiUsageIfUnderLimit } from '../db';
import { getEnvValue, getEnvFlag } from '../env';
import type { AttractionCatalogEntry, GeocodeJob, GeocodeQuery, GeocodeResult } from '../types';

const normalize = (text: string): string => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const geocodeKey = (query: GeocodeQuery): string => createHash('sha256').update(JSON.stringify([query.name, query.locality, query.country, query.language, query.providerVersion].map(normalize))).digest('hex');
const config = () => {
  const endpoint = getEnvValue('GEOCODING_SEARCH_URL');
  const identity = getEnvValue('GEOCODING_USER_AGENT');
  const version = getEnvValue('GEOCODING_PROVIDER_VERSION');
  if (!getEnvFlag('GEOCODING_PUBLIC_POI_APPROVED') || !endpoint || !identity || !version) return null;
  try {
    const url = new URL(endpoint);
    // Public OSM is deliberately excluded: recurring distributed work is not an approved use.
    if (url.protocol !== 'https:' || /(^|\.)openstreetmap\.org$/i.test(url.hostname) || url.username || url.password || url.search || url.hash) return null;
    return { endpoint, identity, version };
  } catch { return null; }
};
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
/** Shared by geocoding and merchant lookup. One in-flight request across all instances. */
export async function claimGeocoderAdmission(): Promise<string | null> {
  const token = randomUUID(); const now = Date.now();
  const state = await mutateGeocodingState(state => {
    if (state.nextAllowedAt > now || (state.providerLeaseUntil || 0) > now) return state;
    state.providerLeaseToken = token; state.providerLeaseUntil = now + 30_000;
    state.nextAllowedAt = now + 15_000; return state;
  });
  return state.providerLeaseToken === token ? token : null;
}
export async function releaseGeocoderAdmission(token: string): Promise<void> {
  await mutateGeocodingState(state => {
    if (state.providerLeaseToken === token) { delete state.providerLeaseToken; delete state.providerLeaseUntil; state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + 15_000); }
    return state;
  });
}
export async function lookupApprovedPublicPoi(query: GeocodeQuery, admission: string, jobToken: string): Promise<GeocodeResult | null> {
  const settings = config(); if (!settings || !await geocodingEnabled() || query.providerVersion !== settings.version) throw new Error('Provider disabled');
  const url = new URL(settings.endpoint); url.searchParams.set('q', [query.name, query.locality, query.country].filter(Boolean).join(', '));
  url.searchParams.set('format', 'jsonv2'); url.searchParams.set('limit', '1'); url.searchParams.set('addressdetails', '1'); url.searchParams.set('accept-language', query.language);
  const configuredLimit = Number(getEnvValue('GEOCODING_MAX_DAILY_REQUESTS', { defaultValue: '100' }));
  const limit = Number.isFinite(configuredLimit) ? Math.max(0, Math.min(1000, Math.floor(configuredLimit))) : 0;
  const quota = limit > 0 && await atomicIncrementApiUsageIfUnderLimit({ provider: 'GEOCODING', caller: 'PUBLIC_POI_LOOKUP', scope: 'caller', windowKey: new Date().toISOString().slice(0, 10), limit });
  if (!quota || !quota.allowed) throw new Error('Daily geocoding budget exhausted');
  const ownership = await mutateGeocodingState(state => {
    const job = state.jobs.find(j => j.leaseToken === jobToken);
    if (state.providerLeaseToken === admission && (state.providerLeaseUntil || 0) > Date.now() && job && (job.leaseUntil || 0) > Date.now()) {
      state.providerLeaseUntil = Date.now() + 30_000; job.leaseUntil = state.providerLeaseUntil;
    }
    return state;
  });
  if (ownership.providerLeaseToken !== admission || (ownership.providerLeaseUntil || 0) <= Date.now() || !ownership.jobs.some(j => j.leaseToken === jobToken && (j.leaseUntil || 0) > Date.now())) throw new Error('Lease lost');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': settings.identity } });
    if (!response.ok) throw new Error('Geocoder unavailable');
    if (Number(response.headers.get('content-length') || 0) > 65_536) throw new Error('Response too large');
    if (!response.body) throw new Error('Missing body');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65_536) throw new Error('Response too large'); chunks.push(next.value); } }
    finally { await reader.cancel(); }
    const rows: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(rows)) throw new Error('Invalid provider response');
    if (!rows.length) return null;
    const row = rows[0] as { lat?: string; lon?: string; category?: string; type?: string; address?: { city?: string; town?: string } };
    const lat = Number(row.lat); const lng = Number(row.lon);
    if (row.lat == null || row.lon == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid coordinates');
    return { lat, lng, geoCity: (row.address?.city || row.address?.town || '').slice(0, 160) || null, quality: 'approximate', providerCategory: String(row.category || '').slice(0, 80), providerType: String(row.type || '').slice(0, 80), provider: settings.version, attribution: '© OpenStreetMap contributors (ODbL)' };
  } finally { clearTimeout(timeout); }
}
export async function processGeocodingJob(): Promise<{ processed: number }> {
  if (!await geocodingEnabled()) return { processed: 0 };
  const admission = await claimGeocoderAdmission(); if (!admission) return { processed: 0 };
  const token = randomUUID(); const now = Date.now(); let job: GeocodeJob | undefined;
  try {
    const state = await mutateGeocodingState(state => {
      const candidate = state.jobs.find(j => j.state === 'pending' && j.dueAt <= now && (j.leaseUntil || 0) <= now);
      if (candidate) { candidate.leaseToken = token; candidate.leaseUntil = now + 30_000; }
      return state;
    });
    job = state.jobs.find(j => j.leaseToken === token); if (!job) return { processed: 0 };
    let result: GeocodeResult | null = null; let failed = false;
    try { result = await lookupApprovedPublicPoi(job.query, admission, token); } catch { failed = true; }
    const key = job.key;
    await mutateGeocodingState(state => {
      const current = state.jobs.find(j => j.key === key);
      if (!current || current.leaseToken !== token || (current.leaseUntil || 0) <= Date.now() || state.providerLeaseToken !== admission) return state;
      delete current.leaseToken; delete current.leaseUntil;
      current.attempts += 1;
      if (failed) { current.state = current.attempts >= 4 ? 'dead' : 'pending'; current.dueAt = Date.now() + 60_000 * 2 ** current.attempts; if (current.state === 'dead') current.expiresAt = Date.now() + 86400_000; }
      else { current.state = 'done'; current.result = result; current.expiresAt = Date.now() + (result ? 30 : 1) * 86400_000; }
      return state;
    });
    return { processed: 1 };
  } finally { await releaseGeocoderAdmission(admission); }
}

export async function geocodingStatus(): Promise<{ enabled: boolean; pending: number; ready: number; dead: number }> {
  const enabled = await geocodingEnabled();
  const state = await mutateGeocodingState(state => state);
  return { enabled, pending: state.jobs.filter(j => j.state === 'pending').length, ready: state.jobs.filter(j => j.state === 'done').length, dead: state.jobs.filter(j => j.state === 'dead').length };
}
