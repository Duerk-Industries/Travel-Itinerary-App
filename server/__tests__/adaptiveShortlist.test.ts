/// <reference types="jest" />
/// <reference types="node" />
// itinerary-improvements-coding-plan.md Phase 3C ("Adaptive shortlist and validation contract").
// Covers: pure trigger-decision logic (decideAdaptiveShortlistPolicy) and the end-to-end wiring
// through getAttractionPromptBlockForDestinations, including the base-8/no-op fallback and
// deterministic ordering.
import axios from 'axios';
import type { AttractionCatalogEntry } from '../src/types';
import type { InterestWeights } from '../src/services/activityTypeInterestWeights';
import {
  decideAdaptiveShortlistPolicy,
  getAttractionPromptBlockForDestinations,
} from '../src/services/attractionsCatalogService';

jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
jest.mock('../src/db', () => ({
  listAttractionCatalogEntries: jest.fn(),
  upsertAttractionCatalogEntry: jest.fn(),
  getAttractionShortlistBlob: jest.fn(),
  upsertAttractionShortlistBlob: jest.fn(),
}));
jest.mock('../src/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedDb = jest.requireMock('../src/db') as {
  listAttractionCatalogEntries: jest.Mock;
  upsertAttractionCatalogEntry: jest.Mock;
  getAttractionShortlistBlob: jest.Mock;
  upsertAttractionShortlistBlob: jest.Mock;
};
const mockedLogger = jest.requireMock('../src/logger') as { logInfo: jest.Mock; logError: jest.Mock };

const ZERO_WEIGHTS: InterestWeights = {
  outdoors: 0,
  adventure: 0,
  culture: 0,
  food: 0,
  nightlife: 0,
  relax: 0,
  photography: 0,
  authentic_local: 0,
  iconic_landmarks: 0,
};

const makeEntry = (overrides: Partial<AttractionCatalogEntry> & { name: string; rank: number }): AttractionCatalogEntry => ({
  id: `attr:mexico-city:${overrides.name.toLowerCase().replace(/\s+/g, '-')}`,
  destinationKey: 'mexico city',
  destinationDisplayName: 'Mexico City',
  activityType: 'Ticketed Attraction',
  interestTags: ['culture'],
  sourceCount: 2,
  budgetTier: 'paid',
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('decideAdaptiveShortlistPolicy (Phase 3C trigger logic)', () => {
  const baseArgs = {
    baseEntriesByDestination: { 'Mexico City': [makeEntry({ name: 'A', rank: 1, interestTags: ['culture'] })] },
    destinationCount: 1,
    weights: ZERO_WEIGHTS,
    floorItemsPerDestination: 8,
    maxItemsPerDestination: 12,
  };

  it('stays on the base floor for a short, single-destination, low-interest trip', () => {
    const decision = decideAdaptiveShortlistPolicy({ ...baseArgs, tripLengthDays: 3 });
    expect(decision.policy).toBe('base');
    expect(decision.itemsPerDestination).toBe(8);
    expect(decision.reasons).toEqual([]);
  });

  it('escalates to the adaptive cap when trip length > 7 days', () => {
    const decision = decideAdaptiveShortlistPolicy({ ...baseArgs, tripLengthDays: 14 });
    expect(decision.policy).toBe('adaptive');
    expect(decision.itemsPerDestination).toBe(12);
    expect(decision.reasons).toContain('trip_length_gt_7');
  });

  it('escalates to the adaptive cap for multiple destinations', () => {
    const decision = decideAdaptiveShortlistPolicy({
      ...baseArgs,
      tripLengthDays: 3,
      destinationCount: 2,
      baseEntriesByDestination: {
        'Mexico City': [makeEntry({ name: 'A', rank: 1 })],
        Oaxaca: [makeEntry({ name: 'B', rank: 1, destinationDisplayName: 'Oaxaca', destinationKey: 'oaxaca' })],
      },
    });
    expect(decision.policy).toBe('adaptive');
    expect(decision.reasons).toContain('multi_destination');
  });

  it('escalates to the adaptive cap for >=5 high-weight interests', () => {
    const weights: InterestWeights = {
      ...ZERO_WEIGHTS,
      outdoors: 10,
      adventure: 10,
      culture: 10,
      food: 10,
      nightlife: 10,
    };
    const decision = decideAdaptiveShortlistPolicy({ ...baseArgs, tripLengthDays: 3, weights });
    expect(decision.policy).toBe('adaptive');
    expect(decision.reasons).toContain('high_weight_interest_count');
  });

  it('escalates to the adaptive cap on a coverage-check miss', () => {
    const weights: InterestWeights = { ...ZERO_WEIGHTS, outdoors: 10 };
    const decision = decideAdaptiveShortlistPolicy({
      ...baseArgs,
      tripLengthDays: 3,
      weights,
      baseEntriesByDestination: { 'Mexico City': [makeEntry({ name: 'A', rank: 1, interestTags: ['culture'] })] },
    });
    expect(decision.policy).toBe('adaptive');
    expect(decision.reasons).toContain('coverage_miss');
  });

  it('does not escalate when coverage is already satisfied and no other trigger fires', () => {
    const weights: InterestWeights = { ...ZERO_WEIGHTS, outdoors: 10 };
    const decision = decideAdaptiveShortlistPolicy({
      ...baseArgs,
      tripLengthDays: 3,
      weights,
      baseEntriesByDestination: { 'Mexico City': [makeEntry({ name: 'A', rank: 1, interestTags: ['outdoors'] })] },
    });
    expect(decision.policy).toBe('base');
  });

  it('is a flag-safe no-op when adaptiveShortlistMax is configured at or below the floor', () => {
    const decision = decideAdaptiveShortlistPolicy({ ...baseArgs, tripLengthDays: 14, maxItemsPerDestination: 8 });
    expect(decision.policy).toBe('base');
    expect(decision.itemsPerDestination).toBe(8);
    expect(decision.reasons).toEqual([]);
  });

  it('clamps the adaptive cap to the hard ceiling of 15 regardless of config', () => {
    const decision = decideAdaptiveShortlistPolicy({ ...baseArgs, tripLengthDays: 14, maxItemsPerDestination: 999 });
    expect(decision.itemsPerDestination).toBe(15);
  });
});

describe('getAttractionPromptBlockForDestinations adaptive shortlist wiring', () => {
  const entries: AttractionCatalogEntry[] = Array.from({ length: 10 }, (_, i) =>
    makeEntry({ name: `Attraction ${i + 1}`, rank: i + 1, interestTags: i === 9 ? ['outdoors'] : ['culture'] })
  );

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedDb.listAttractionCatalogEntries.mockReset();
    mockedDb.upsertAttractionCatalogEntry.mockReset();
    mockedDb.getAttractionShortlistBlob.mockReset();
    mockedDb.upsertAttractionShortlistBlob.mockReset();
    mockedDb.listAttractionCatalogEntries.mockResolvedValue(entries);
    mockedDb.getAttractionShortlistBlob.mockResolvedValue(null);
    mockedDb.upsertAttractionShortlistBlob.mockImplementation(async (blob: unknown) => blob);
  });

  it('keeps a short single-destination trip at the 8-item default (no extra tokens spent)', async () => {
    const result = await getAttractionPromptBlockForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      dateKey: '2026-03-03',
      limitPerDestination: 10,
      weights: ZERO_WEIGHTS,
      tripLengthDays: 3,
    });
    const itemLines = (result.promptBlock.match(/^\d+\. /gm) ?? []).length;
    expect(itemLines).toBe(8);
  });

  it('reaches the adaptive cap for a 14-day trip', async () => {
    const result = await getAttractionPromptBlockForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      dateKey: '2026-03-03',
      limitPerDestination: 10,
      weights: ZERO_WEIGHTS,
      tripLengthDays: 14,
    });
    const itemLines = (result.promptBlock.match(/^\d+\. /gm) ?? []).length;
    expect(itemLines).toBe(10); // capped by catalog size (10 entries), well above the 8-item floor
  });

  it('reaches the adaptive cap for a multi-destination trip', async () => {
    mockedDb.listAttractionCatalogEntries.mockImplementation(async () => entries);
    const result = await getAttractionPromptBlockForDestinations({
      userId: 'u1',
      destinations: ['Mexico City', 'Oaxaca'],
      dateKey: '2026-03-03',
      limitPerDestination: 10,
      weights: ZERO_WEIGHTS,
      tripLengthDays: 3,
    });
    const itemLines = (result.promptBlock.match(/^\d+\. /gm) ?? []).length;
    // 2 destinations x up to 10 items each (catalog-capped, adaptive policy in effect)
    expect(itemLines).toBeGreaterThan(16);
  });

  it('reaches the adaptive cap when >=5 high-weight interests are supplied', async () => {
    const weights: InterestWeights = {
      ...ZERO_WEIGHTS,
      outdoors: 10,
      adventure: 10,
      culture: 10,
      food: 10,
      nightlife: 10,
    };
    const result = await getAttractionPromptBlockForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      dateKey: '2026-03-03',
      limitPerDestination: 10,
      weights,
      tripLengthDays: 3,
    });
    const itemLines = (result.promptBlock.match(/^\d+\. /gm) ?? []).length;
    expect(itemLines).toBe(10);
  });

  it('produces deterministic shortlist ordering given the same inputs', async () => {
    const call = () =>
      getAttractionPromptBlockForDestinations({
        userId: 'u1',
        destinations: ['Mexico City'],
        dateKey: '2026-03-03',
        limitPerDestination: 10,
        weights: ZERO_WEIGHTS,
        tripLengthDays: 14,
      });
    const first = await call();
    mockedDb.getAttractionShortlistBlob.mockResolvedValue(null); // force recompute, not a cache hit
    const second = await call();
    expect(second.promptBlock).toBe(first.promptBlock);
    expect(second.shortlistByDestination['Mexico City'].map((e) => e.name)).toEqual(
      first.shortlistByDestination['Mexico City'].map((e) => e.name)
    );
  });

  it('logs a defensive warning when called without params.weights (regression guard for real call sites)', async () => {
    mockedLogger.logError.mockClear();
    await getAttractionPromptBlockForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      dateKey: '2026-03-03',
      limitPerDestination: 10,
    });
    expect(mockedLogger.logError).toHaveBeenCalledWith(
      expect.stringContaining('called without params.weights'),
      expect.anything()
    );
  });
});
