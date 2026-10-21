import { processGeocodingJob, resolveCatalogCoordinates, geocodeKey, publicCatalogQuery, claimGeocoderAdmission, lookupApprovedPublicPoi, geocodingStatus } from '../src/services/geocodingService';
import { mutateGeocodingState, getFeatureFlag, atomicIncrementApiUsageIfUnderLimit } from '../src/db';
import type { AttractionCatalogEntry, GeocodingState } from '../src/types';
jest.mock('../src/db', () => ({ getFeatureFlag: jest.fn(), mutateGeocodingState: jest.fn(), atomicIncrementApiUsageIfUnderLimit: jest.fn() }));
const entry = { id: 'tower', name: 'Eiffel Tower', destinationDisplayName: 'Paris', country: 'France', sourceUrl: 'https://en.wikipedia.org/wiki/Eiffel_Tower' } as AttractionCatalogEntry;
const policy = { revision: 'review-1', termsUrl: 'https://geocoding.example.test/terms', publicPoiInputs: true, storage: true, display: true, export: true, attribution: 'Reviewed provider attribution', positiveTtlSeconds: 30 * 86400, negativeTtlSeconds: 86400, minIntervalMs: 15000, dailyRequestLimit: 100 };
let state: GeocodingState;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  (atomicIncrementApiUsageIfUnderLimit as jest.Mock).mockResolvedValue({ allowed: true });
  state = { jobs: [], nextAllowedAt: 0 };
  (mutateGeocodingState as jest.Mock).mockImplementation(async change => { state = change(structuredClone(state)); return structuredClone(state); });
  (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: true });
  process.env.GEOCODING_POLICY_JSON = JSON.stringify(policy);
  process.env.GEOCODING_PUBLIC_POI_APPROVED = '1'; process.env.GEOCODING_SEARCH_URL = 'https://geocoding.example.test/search'; process.env.GEOCODING_USER_AGENT = 'WanderBunnies (maps@example.test)'; process.env.GEOCODING_PROVIDER_VERSION = 'self-hosted-v1';
  global.fetch = jest.fn(async () => new Response(JSON.stringify([{ lat: '48.85837', lon: '2.29448', address: { city: 'Paris' } }]), { headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; for (const key of ['GEOCODING_PUBLIC_POI_APPROVED', 'GEOCODING_SEARCH_URL', 'GEOCODING_USER_AGENT', 'GEOCODING_PROVIDER_VERSION', 'GEOCODING_POLICY_JSON']) delete process.env[key]; });
it('fails closed for missing approval, unknown flags, unreviewed input and the public OSM endpoint', async () => {
  delete process.env.GEOCODING_PUBLIC_POI_APPROVED;
  expect(await resolveCatalogCoordinates(entry)).toBeNull();
  process.env.GEOCODING_PUBLIC_POI_APPROVED = '1';
  (getFeatureFlag as jest.Mock).mockResolvedValue(null);
  expect(await resolveCatalogCoordinates(entry)).toBeNull();
  (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: true });
  expect(await resolveCatalogCoordinates({ ...entry, sourceUrl: 'https://private.example.test' })).toBeNull();
  process.env.GEOCODING_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
  expect(await processGeocodingJob()).toEqual({ processed: 0 });
  expect(global.fetch).not.toHaveBeenCalled(); expect(state.jobs).toEqual([]);
});
it('deduplicates normalized public queries, bounds backlog and caches positive results', async () => {
  await Promise.all([resolveCatalogCoordinates(entry), resolveCatalogCoordinates(entry)]);
  expect(state.jobs).toHaveLength(1);
  await processGeocodingJob();
  expect((await resolveCatalogCoordinates(entry))?.lat).toBe(48.85837);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(state.jobs[0].state).toBe('done');
  for (let n = 0; n < 155; n++) await resolveCatalogCoordinates({ ...entry, name: `Public site ${n}` });
  expect(state.jobs).toHaveLength(150);
});
it('separates language/locality/provider versions in cache keys', () => {
  const query = publicCatalogQuery(entry, 'v1')!;
  expect(geocodeKey(query)).toBe(geocodeKey({ ...query, name: '  EIFFEL   Tower ' }));
  for (const change of [{ country: 'US' }, { locality: 'Texas' }, { language: 'fr' }, { providerVersion: 'v2' }]) expect(geocodeKey(query)).not.toBe(geocodeKey({ ...query, ...change }));
});
it('admits one leased worker and keeps a 15-second gap after release', async () => {
  await resolveCatalogCoordinates(entry);
  let finish!: (response: Response) => void;
  global.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const work = processGeocodingJob();
  for (let n = 0; n < 20 && !finish; n++) await Promise.resolve();
  expect(await processGeocodingJob()).toEqual({ processed: 0 });
  finish(new Response('[]')); await work;
  expect(await claimGeocoderAdmission()).toBeNull();
  expect(state.jobs[0].result).toBeNull(); expect(state.jobs[0].expiresAt).toBeGreaterThan(Date.now());
});
it('fences stale completion after a replacement worker takes ownership', async () => {
  await resolveCatalogCoordinates(entry);
  global.fetch = jest.fn(async () => {
    state.jobs[0].leaseToken = 'replacement'; state.providerLeaseToken = 'replacement';
    return new Response('[{"lat":"1","lon":"2"}]');
  });
  await processGeocodingJob();
  expect(state.jobs[0].state).toBe('pending'); expect(state.jobs[0].leaseToken).toBe('replacement');
  expect(state.providerLeaseToken).toBe('replacement');
});
it('retains failures with backoff, then exposes a dead job after four attempts', async () => {
  await resolveCatalogCoordinates(entry); global.fetch = jest.fn(async () => new Response('unavailable', { status: 429 }));
  for (let n = 0; n < 4; n++) { state.nextAllowedAt = 0; state.jobs[0].dueAt = 0; await processGeocodingJob(); }
  expect(state.jobs[0].state).toBe('dead'); expect(state.jobs[0].attempts).toBe(4);
});
it('rejects invalid or oversized results without caching them as a successful miss', async () => {
  await resolveCatalogCoordinates(entry);
  global.fetch = jest.fn(async () => new Response('[]', { headers: { 'Content-Length': '70000' } }));
  await processGeocodingJob(); expect(state.jobs[0].state).toBe('pending');
  state.nextAllowedAt = 0; state.jobs[0].dueAt = 0;
  global.fetch = jest.fn(async () => new Response('[{"lat":"NaN","lon":"2"}]'));
  await processGeocodingJob(); expect(state.jobs[0].state).toBe('pending'); expect(state.jobs[0].result).toBeUndefined();
});

it('honors a denied global daily budget without sending provider traffic', async () => {
  await resolveCatalogCoordinates(entry);
  (atomicIncrementApiUsageIfUnderLimit as jest.Mock).mockResolvedValue({ allowed: false });
  await processGeocodingJob();
  expect(global.fetch).not.toHaveBeenCalled(); expect(state.jobs[0].state).toBe('pending');
});

it('requires explicit rights, attribution and retention approval', async () => {
  for (const invalid of [null, { ...policy, storage: false }, { ...policy, export: false }, { ...policy, attribution: '' }, { ...policy, positiveTtlSeconds: 31 * 86400 }]) {
    process.env.GEOCODING_POLICY_JSON = JSON.stringify(invalid);
    expect(await resolveCatalogCoordinates(entry)).toBeNull();
  }
  process.env.GEOCODING_POLICY_JSON = JSON.stringify(policy);
  process.env.GEOCODING_SEARCH_URL = 'https://nominatim.openstreetmap.org./search';
  expect(await processGeocodingJob()).toEqual({ processed: 0 });
  expect(global.fetch).not.toHaveBeenCalled();
});
it('retires cached data when endpoint or reviewed policy changes and uses reviewed attribution', async () => {
  await resolveCatalogCoordinates(entry); await processGeocodingJob();
  expect((await resolveCatalogCoordinates(entry))?.attribution).toBe(policy.attribution);
  process.env.GEOCODING_POLICY_JSON = JSON.stringify({ ...policy, revision: 'review-2' });
  expect(await resolveCatalogCoordinates(entry)).toBeNull();
  expect(state.jobs).toHaveLength(1); expect(state.jobs[0].state).toBe('pending');
  const previous = state.jobs[0].key;
  process.env.GEOCODING_SEARCH_URL = 'https://another.example.test/search';
  await resolveCatalogCoordinates(entry); expect(state.jobs[0].key).not.toBe(previous);
});
it('respects policy retention for hits and misses, refreshing expired entries once', async () => {
  process.env.GEOCODING_POLICY_JSON = JSON.stringify({ ...policy, positiveTtlSeconds: 60, negativeTtlSeconds: 60 });
  await resolveCatalogCoordinates(entry); await processGeocodingJob();
  const saved = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(saved + 60_001);
  await Promise.all([resolveCatalogCoordinates(entry), resolveCatalogCoordinates(entry)]);
  expect(state.jobs).toHaveLength(1); expect(state.jobs[0].state).toBe('pending');
  global.fetch = jest.fn(async () => new Response('[]'));
  await processGeocodingJob();
  expect((await resolveCatalogCoordinates(entry))).toBeNull();
  expect(state.jobs[0].result).toBeNull();
  expect(state.jobs[0].expiresAt).toBe(Date.now() + 60_000);
});
it('defers exhausted daily quota without consuming attempts or losing the job', async () => {
  await resolveCatalogCoordinates(entry);
  (atomicIncrementApiUsageIfUnderLimit as jest.Mock).mockResolvedValue({ allowed: false });
  await processGeocodingJob();
  expect(state.jobs[0]).toMatchObject({ state: 'pending', attempts: 0, lastErrorCode: 'budget' });
  expect(state.jobs[0].dueAt).toBeGreaterThan(Date.now());
  expect(state.nextAllowedAt).toBe(state.jobs[0].dueAt); expect(global.fetch).not.toHaveBeenCalled();
});
it('honors Retry-After globally and reports dead jobs without query text', async () => {
  await resolveCatalogCoordinates(entry);
  global.fetch = jest.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }));
  await processGeocodingJob();
  expect(state.nextAllowedAt).toBeGreaterThanOrEqual(Date.now() + 3599_000);
  expect(await processGeocodingJob()).toEqual({ processed: 0 });
  state.jobs[0].state = 'dead';
  const status = await geocodingStatus();
  expect(status.deadJobs[0]).toMatchObject({ attempts: 1, lastErrorCode: 'rate-limit' });
  expect(JSON.stringify(status)).not.toContain('Eiffel');
});
it('binds every provider query to its own live leased job before spending quota', async () => {
  await resolveCatalogCoordinates(entry);
  const admission = await claimGeocoderAdmission();
  state.jobs[0].leaseToken = 'owned'; state.jobs[0].leaseUntil = Date.now() + 30_000;
  await expect(lookupApprovedPublicPoi({ ...state.jobs[0].query, name: 'private address' }, admission!, 'owned')).rejects.toThrow('lease-lost');
  expect(global.fetch).not.toHaveBeenCalled(); expect(atomicIncrementApiUsageIfUnderLimit).not.toHaveBeenCalled();
});
it('reclaims abandoned jobs and refuses an old owner after lease expiry', async () => {
  await resolveCatalogCoordinates(entry);
  state.jobs[0].leaseToken = 'killed'; state.jobs[0].leaseUntil = Date.now() - 1;
  state.providerLeaseToken = 'killed'; state.providerLeaseUntil = Date.now() - 1;
  await processGeocodingJob();
  expect(state.jobs[0].state).toBe('done'); expect(state.jobs[0].leaseToken).toBeUndefined();
});
it.each(['fetch', 'body'])('enforces the hard deadline even when %s ignores abort', async stalled => {
  jest.useFakeTimers();
  try {
    await resolveCatalogCoordinates(entry);
    global.fetch = jest.fn(() => stalled === 'fetch' ? new Promise<Response>(() => undefined) : Promise.resolve({
      ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise(() => undefined), cancel: async () => undefined }) },
    } as unknown as Response));
    const work = processGeocodingJob();
    await jest.advanceTimersByTimeAsync(8000); await work;
    expect(state.jobs[0]).toMatchObject({ state: 'pending', attempts: 1, lastErrorCode: 'timeout' });
    expect(state.providerLeaseToken).toBeUndefined(); expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

it('purges expired cache entries even when external work is disabled', async () => {
  await resolveCatalogCoordinates(entry); await processGeocodingJob();
  state.jobs[0].expiresAt = Date.now() - 1;
  (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: false });
  expect(await processGeocodingJob()).toEqual({ processed: 0 });
  expect(state.jobs).toEqual([]); expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('withdraws cached results when reviewed storage approval is removed', async () => {
  await resolveCatalogCoordinates(entry); await processGeocodingJob();
  delete process.env.GEOCODING_POLICY_JSON;
  expect((await geocodingStatus()).ready).toBe(0);
  expect(state.jobs).toEqual([]);
});

it('rechecks the kill switch after awaited quota admission', async () => {
  await resolveCatalogCoordinates(entry);
  (atomicIncrementApiUsageIfUnderLimit as jest.Mock).mockImplementation(async () => {
    (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: false }); return { allowed: true };
  });
  await processGeocodingJob();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(state.jobs[0]).toMatchObject({ state: 'pending', attempts: 0, lastErrorCode: 'disabled' });
});
it('caps quota and request spacing by the reviewed provider limits', async () => {
  process.env.GEOCODING_POLICY_JSON = JSON.stringify({ ...policy, dailyRequestLimit: 3, minIntervalMs: 30_000 });
  await resolveCatalogCoordinates(entry); await processGeocodingJob();
  expect(atomicIncrementApiUsageIfUnderLimit).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
  expect(state.nextAllowedAt).toBeGreaterThanOrEqual(Date.now() + 29_000);
});
it('bounds streaming bodies even if the provider omits Content-Length', async () => {
  await resolveCatalogCoordinates(entry);
  global.fetch = jest.fn(async () => new Response('x'.repeat(70_000)));
  await processGeocodingJob();
  expect(state.jobs[0]).toMatchObject({ state: 'pending', lastErrorCode: 'invalid-response' });
  expect(state.jobs[0].result).toBeUndefined();
});
