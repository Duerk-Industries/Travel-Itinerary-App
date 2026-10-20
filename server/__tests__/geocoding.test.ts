import { processGeocodingJob, resolveCatalogCoordinates, geocodeKey, publicCatalogQuery, claimGeocoderAdmission } from '../src/services/geocodingService';
import { mutateGeocodingState, getFeatureFlag, atomicIncrementApiUsageIfUnderLimit } from '../src/db';
import type { AttractionCatalogEntry, GeocodingState } from '../src/types';
jest.mock('../src/db', () => ({ getFeatureFlag: jest.fn(), mutateGeocodingState: jest.fn(), atomicIncrementApiUsageIfUnderLimit: jest.fn() }));
const entry = { id: 'tower', name: 'Eiffel Tower', destinationDisplayName: 'Paris', country: 'France', sourceUrl: 'https://en.wikipedia.org/wiki/Eiffel_Tower' } as AttractionCatalogEntry;
let state: GeocodingState;
const originalFetch = global.fetch;
beforeEach(() => {
  (atomicIncrementApiUsageIfUnderLimit as jest.Mock).mockResolvedValue({ allowed: true });
  state = { jobs: [], nextAllowedAt: 0 };
  (mutateGeocodingState as jest.Mock).mockImplementation(async change => { state = change(structuredClone(state)); return structuredClone(state); });
  (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: true });
  process.env.GEOCODING_PUBLIC_POI_APPROVED = '1'; process.env.GEOCODING_SEARCH_URL = 'https://geocoding.example.test/search'; process.env.GEOCODING_USER_AGENT = 'WanderBunnies (maps@example.test)'; process.env.GEOCODING_PROVIDER_VERSION = 'self-hosted-v1';
  global.fetch = jest.fn(async () => new Response(JSON.stringify([{ lat: '48.85837', lon: '2.29448', address: { city: 'Paris' } }]), { headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; for (const key of ['GEOCODING_PUBLIC_POI_APPROVED', 'GEOCODING_SEARCH_URL', 'GEOCODING_USER_AGENT', 'GEOCODING_PROVIDER_VERSION']) delete process.env[key]; });
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
it('admits one physical worker and keeps a 15-second gap after release', async () => {
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
