/// <reference types="jest" />
/// <reference types="node" />
import {
  buildPrepopulateManifest,
  runItineraryCachePrepopulateJob,
  MAX_LOCATIONS_PER_RUN,
  MAX_BLOCKS_PER_LOCATION,
  type PrepopulateAuthorOutput,
  type PrepopulateLocationInput,
} from '../src/services/itineraryCachePrepopulateService';
import * as db from '../src/db';
import * as entitlementService from '../src/services/entitlementService';

jest.mock('../src/db');
jest.mock('../src/services/entitlementService', () => ({
  ...jest.requireActual('../src/services/entitlementService'),
  isFeatureEnabled: jest.fn(),
}));
jest.mock('../src/apis/usageLimiter', () => ({
  ...jest.requireActual('../src/apis/usageLimiter'),
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
}));
jest.mock('../src/apis/providerBudgeting', () => ({
  recordProviderRequestCost: jest.fn(async () => undefined),
}));

const mockedIsFeatureEnabled = entitlementService.isFeatureEnabled as jest.MockedFunction<typeof entitlementService.isFeatureEnabled>;

const location = (overrides: Partial<PrepopulateLocationInput> = {}): PrepopulateLocationInput => ({
  locationId: 'loc_lisbon',
  name: 'Lisbon',
  locationType: 'city',
  countryCode: 'PT',
  timezone: 'Europe/Lisbon',
  ...overrides,
});

describe('buildPrepopulateManifest', () => {
  it('ranks by demand weight descending, breaking ties by locationId', () => {
    const result = buildPrepopulateManifest([
      location({ locationId: 'loc_b', demandWeight: 5 }),
      location({ locationId: 'loc_a', demandWeight: 5 }),
      location({ locationId: 'loc_c', demandWeight: 10 }),
    ]);
    expect(result.map((l) => l.locationId)).toEqual(['loc_c', 'loc_a', 'loc_b']);
  });

  it('dedupes by locationId, keeping the last entry', () => {
    const result = buildPrepopulateManifest([
      location({ locationId: 'loc_x', name: 'First' }),
      location({ locationId: 'loc_x', name: 'Second' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Second');
  });

  it('caps to MAX_LOCATIONS_PER_RUN regardless of how many candidates are supplied', () => {
    const many = Array.from({ length: 20 }, (_, i) => location({ locationId: `loc_${i}`, demandWeight: i }));
    const result = buildPrepopulateManifest(many);
    expect(result).toHaveLength(MAX_LOCATIONS_PER_RUN);
  });

  it('never exceeds MAX_LOCATIONS_PER_RUN even if a larger maxLocations is requested', () => {
    const many = Array.from({ length: 20 }, (_, i) => location({ locationId: `loc_${i}` }));
    const result = buildPrepopulateManifest(many, 1000);
    expect(result.length).toBeLessThanOrEqual(MAX_LOCATIONS_PER_RUN);
  });

  it('drops entries with an empty locationId', () => {
    const result = buildPrepopulateManifest([location({ locationId: '' }), location({ locationId: 'loc_ok' })]);
    expect(result.map((l) => l.locationId)).toEqual(['loc_ok']);
  });
});

describe('runItineraryCachePrepopulateJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is fail-closed: returns enabled:false and does nothing when the feature flag is off', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(false);
    const result = await runItineraryCachePrepopulateJob({ locations: [location()] });
    expect(result).toEqual({ enabled: false, releaseId: null, results: [] });
    expect(db.upsertItineraryCacheBlock).not.toHaveBeenCalled();
  });

  it('refuses to run without an ACTIVE_CORPUS_RELEASE_ID admin setting', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(true);
    (db.getAdminSetting as jest.Mock).mockResolvedValue(null);
    const result = await runItineraryCachePrepopulateJob({ locations: [location()] });
    expect(result.enabled).toBe(true);
    expect(result.releaseId).toBeNull();
    expect(result.results).toEqual([]);
  });

  const validProfile = (locationId: string) => ({
    location_id: locationId,
    name: 'Lisbon',
    location_type: 'city',
    country_code: 'PT',
    timezone: 'Europe/Lisbon',
    zones: [{ zone_id: 'z_a', name: 'Alfama', name_local: null, centroid: null, traversal: 'walk', terrain_note: null, adjacency: [] }],
    season_windows: [],
    default_day_template_id: null,
  });

  const validBlock = (locationId: string, blockId: string) => ({
    block_id: blockId,
    location_id: locationId,
    zone_id: 'z_a',
    role: 'anchor',
    category: 'museum',
    title: 'A Museum',
    name_local: null,
    name_script: null,
    copy: { teaser: 't', body: 'b', insider_tip: 'i', etiquette: null, priority_signal: 'dont_skip' },
    timing: { optimal_arrival: null, hard_deadline: null, time_box: null, after_dark_value: false },
    cost_band: { currency: 'EUR', low: 0, high: 10, note: null },
    duration_minutes: { typical: 90, min: 60, max: 120 },
    energy_cost: 2,
    interest_weights: { outdoors: 1, adventure: 1, culture: 9, food: 1, nightlife: 1, relaxing: 1, photography: 3, authentic_local: 5, iconic_landmarks: 6 },
    source: 'curated', // deliberately wrong — the job must override this
    last_verified: '2020-01-01', // deliberately wrong — the job must override this
  });

  it('authors a location and forces draft provenance (source/last_verified) regardless of what the author returned', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(true);
    (db.getAdminSetting as jest.Mock).mockResolvedValue({ key: 'ACTIVE_CORPUS_RELEASE_ID', value: 'release-1' });
    (db.upsertItineraryCacheLocationProfile as jest.Mock).mockResolvedValue(undefined);
    (db.upsertItineraryCacheBlock as jest.Mock).mockResolvedValue(undefined);

    const author = jest.fn(async (): Promise<PrepopulateAuthorOutput> => ({
      profile: validProfile('loc_lisbon'),
      blocks: [validBlock('loc_lisbon', 'blk_museum')],
      promptTokens: 100,
      completionTokens: 200,
      provider: 'fake',
      model: 'fake-model',
    }));

    const result = await runItineraryCachePrepopulateJob({ locations: [location()], author });

    expect(result.enabled).toBe(true);
    expect(result.releaseId).toBe('release-1');
    expect(result.results).toEqual([
      { locationId: 'loc_lisbon', status: 'authored', blocksAuthored: 1, blocksRejected: 0, profileAuthored: true },
    ]);
    expect(db.upsertItineraryCacheLocationProfile).toHaveBeenCalledWith(expect.objectContaining({ location_id: 'loc_lisbon' }), 'release-1');
    const persistedBlock = (db.upsertItineraryCacheBlock as jest.Mock).mock.calls[0][0];
    expect(persistedBlock.source).toBe('llm_draft');
    expect(persistedBlock.last_verified).toBeNull();
  });

  it('rejects a schema-invalid block without failing the whole location, and reports the count', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(true);
    (db.getAdminSetting as jest.Mock).mockResolvedValue({ key: 'ACTIVE_CORPUS_RELEASE_ID', value: 'release-1' });
    (db.upsertItineraryCacheLocationProfile as jest.Mock).mockResolvedValue(undefined);
    (db.upsertItineraryCacheBlock as jest.Mock).mockResolvedValue(undefined);

    const author = jest.fn(async (): Promise<PrepopulateAuthorOutput> => ({
      profile: validProfile('loc_lisbon'),
      blocks: [validBlock('loc_lisbon', 'blk_ok'), { block_id: 'blk_bad', missingEverythingElse: true }],
      promptTokens: 0,
      completionTokens: 0,
      provider: 'fake',
      model: 'fake-model',
    }));

    const result = await runItineraryCachePrepopulateJob({ locations: [location()], author });
    expect(result.results[0]).toMatchObject({ blocksAuthored: 1, blocksRejected: 1, status: 'authored' });
  });

  it('never persists more than maxBlocksPerLocation blocks for one location', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(true);
    (db.getAdminSetting as jest.Mock).mockResolvedValue({ key: 'ACTIVE_CORPUS_RELEASE_ID', value: 'release-1' });
    (db.upsertItineraryCacheLocationProfile as jest.Mock).mockResolvedValue(undefined);
    (db.upsertItineraryCacheBlock as jest.Mock).mockResolvedValue(undefined);

    const tooManyBlocks = Array.from({ length: 20 }, (_, i) => validBlock('loc_lisbon', `blk_${i}`));
    const author = jest.fn(async (): Promise<PrepopulateAuthorOutput> => ({
      profile: validProfile('loc_lisbon'),
      blocks: tooManyBlocks,
      promptTokens: 0,
      completionTokens: 0,
      provider: 'fake',
      model: 'fake-model',
    }));

    const result = await runItineraryCachePrepopulateJob({ locations: [location()], author, maxBlocksPerLocation: 3 });
    expect(result.results[0].blocksAuthored).toBeLessThanOrEqual(3);
    expect((db.upsertItineraryCacheBlock as jest.Mock).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('never exceeds the hard MAX_BLOCKS_PER_LOCATION cap even if a larger maxBlocksPerLocation is requested', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(true);
    (db.getAdminSetting as jest.Mock).mockResolvedValue({ key: 'ACTIVE_CORPUS_RELEASE_ID', value: 'release-1' });
    (db.upsertItineraryCacheLocationProfile as jest.Mock).mockResolvedValue(undefined);
    (db.upsertItineraryCacheBlock as jest.Mock).mockResolvedValue(undefined);

    const tooManyBlocks = Array.from({ length: 40 }, (_, i) => validBlock('loc_lisbon', `blk_${i}`));
    const author = jest.fn(async (): Promise<PrepopulateAuthorOutput> => ({
      profile: validProfile('loc_lisbon'),
      blocks: tooManyBlocks,
      promptTokens: 0,
      completionTokens: 0,
      provider: 'fake',
      model: 'fake-model',
    }));

    const result = await runItineraryCachePrepopulateJob({ locations: [location()], author, maxBlocksPerLocation: 1000 });
    expect(result.results[0].blocksAuthored).toBeLessThanOrEqual(MAX_BLOCKS_PER_LOCATION);
  });

  it('isolates a per-location author failure instead of failing the whole run', async () => {
    mockedIsFeatureEnabled.mockResolvedValue(true);
    (db.getAdminSetting as jest.Mock).mockResolvedValue({ key: 'ACTIVE_CORPUS_RELEASE_ID', value: 'release-1' });
    (db.upsertItineraryCacheLocationProfile as jest.Mock).mockResolvedValue(undefined);
    (db.upsertItineraryCacheBlock as jest.Mock).mockResolvedValue(undefined);

    const author = jest.fn()
      .mockRejectedValueOnce(new Error('provider exploded'))
      .mockResolvedValueOnce({
        profile: validProfile('loc_porto'),
        blocks: [validBlock('loc_porto', 'blk_ok')],
        promptTokens: 0,
        completionTokens: 0,
        provider: 'fake',
        model: 'fake-model',
      });

    const result = await runItineraryCachePrepopulateJob({
      locations: [location({ locationId: 'loc_lisbon' }), location({ locationId: 'loc_porto', name: 'Porto' })],
      author,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.find((r) => r.locationId === 'loc_lisbon')).toMatchObject({ status: 'error', error: 'provider exploded' });
    expect(result.results.find((r) => r.locationId === 'loc_porto')).toMatchObject({ status: 'authored', blocksAuthored: 1 });
  });
});
