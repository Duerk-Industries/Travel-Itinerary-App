/// <reference types="jest" />
/// <reference types="node" />
import {
  estimateAttractionDurationMinutes,
  inferRequiresPreOrderTickets,
  formatMinutesAsDuration,
  getOrCreateAttractionDurationMetadata,
  getAttractionDurationMetadataBatch,
} from '../src/services/attractionDurationEstimationService';

jest.mock('../src/db', () => ({
  getAttractionDurationMetadata: jest.fn(),
  upsertAttractionDurationMetadata: jest.fn(),
}));

const mockedDb = jest.requireMock('../src/db') as {
  getAttractionDurationMetadata: jest.Mock;
  upsertAttractionDurationMetadata: jest.Mock;
};

describe('attraction duration heuristics', () => {
  it('estimates duration by activity type', () => {
    expect(estimateAttractionDurationMinutes('Generic Landmark', 'Sights & Landmarks')).toBe(45);
    expect(estimateAttractionDurationMinutes('Some Tour', 'Tour')).toBe(180);
  });

  it('overrides duration for museum-like names regardless of activity type', () => {
    expect(estimateAttractionDurationMinutes('American Museum of Natural History', 'Ticketed Attraction')).toBe(150);
    expect(estimateAttractionDurationMinutes('Central Park', 'Outdoor Activity')).toBe(90);
    expect(estimateAttractionDurationMinutes('Observation Deck Tower', 'Sights & Landmarks')).toBe(45);
  });

  it('formats minutes as human duration strings', () => {
    expect(formatMinutesAsDuration(45)).toBe('45m');
    expect(formatMinutesAsDuration(120)).toBe('2h');
    expect(formatMinutesAsDuration(150)).toBe('2.5h');
  });

  it('infers pre-order ticket requirement from name and activity type', () => {
    expect(inferRequiresPreOrderTickets('American Museum of Natural History', 'Ticketed Attraction')).toBe(true);
    expect(inferRequiresPreOrderTickets('Central Park', 'Outdoor Activity')).toBe(false);
    expect(inferRequiresPreOrderTickets('Sunset Walking Tour', 'Tour')).toBe(true);
  });
});

describe('attraction duration metadata caching', () => {
  beforeEach(() => {
    mockedDb.getAttractionDurationMetadata.mockReset();
    mockedDb.upsertAttractionDurationMetadata.mockReset();
  });

  it('computes and persists metadata on cache miss', async () => {
    mockedDb.getAttractionDurationMetadata.mockResolvedValue(null);
    mockedDb.upsertAttractionDurationMetadata.mockImplementation(async (entry) => ({ ...entry, id: 'attr-dur:test' }));

    const result = await getOrCreateAttractionDurationMetadata({
      userId: 'user-1',
      destinationKey: 'new york',
      destinationDisplayName: 'New York',
      name: 'American Museum of Natural History',
      activityType: 'Ticketed Attraction',
    });

    expect(mockedDb.upsertAttractionDurationMetadata).toHaveBeenCalledTimes(1);
    expect(result.estimatedDurationMinutes).toBe(150);
    expect(result.requiresPreOrderTickets).toBe(true);
    expect(result.durationSource).toBe('heuristic');
  });

  it('returns the cached entry without recomputing when fresh', async () => {
    mockedDb.getAttractionDurationMetadata.mockResolvedValue({
      id: 'attr-dur:test',
      destinationKey: 'new york',
      destinationDisplayName: 'New York',
      name: 'American Museum of Natural History',
      activityType: 'Ticketed Attraction',
      estimatedDurationMinutes: 150,
      durationSource: 'heuristic',
      requiresPreOrderTickets: true,
      preOrderNotes: null,
      updatedAt: new Date().toISOString(),
    });

    const result = await getOrCreateAttractionDurationMetadata({
      userId: 'user-1',
      destinationKey: 'new york',
      destinationDisplayName: 'New York',
      name: 'American Museum of Natural History',
      activityType: 'Ticketed Attraction',
    });

    expect(mockedDb.upsertAttractionDurationMetadata).not.toHaveBeenCalled();
    expect(result.estimatedDurationMinutes).toBe(150);
  });

  it('recomputes when the cached entry is stale', async () => {
    const staleDate = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
    mockedDb.getAttractionDurationMetadata.mockResolvedValue({
      id: 'attr-dur:test',
      destinationKey: 'new york',
      destinationDisplayName: 'New York',
      name: 'American Museum of Natural History',
      activityType: 'Ticketed Attraction',
      estimatedDurationMinutes: 150,
      durationSource: 'heuristic',
      requiresPreOrderTickets: true,
      preOrderNotes: null,
      updatedAt: staleDate,
    });
    mockedDb.upsertAttractionDurationMetadata.mockImplementation(async (entry) => ({ ...entry, id: 'attr-dur:test' }));

    await getOrCreateAttractionDurationMetadata({
      userId: 'user-1',
      destinationKey: 'new york',
      destinationDisplayName: 'New York',
      name: 'American Museum of Natural History',
      activityType: 'Ticketed Attraction',
    });

    expect(mockedDb.upsertAttractionDurationMetadata).toHaveBeenCalledTimes(1);
  });

  it('dedupes duplicate names within a batch', async () => {
    mockedDb.getAttractionDurationMetadata.mockResolvedValue(null);
    mockedDb.upsertAttractionDurationMetadata.mockImplementation(async (entry) => ({ ...entry, id: 'attr-dur:test' }));

    const result = await getAttractionDurationMetadataBatch({
      userId: 'user-1',
      destinationKey: 'new york',
      destinationDisplayName: 'New York',
      entries: [
        { name: 'American Museum of Natural History', activityType: 'Ticketed Attraction' },
        { name: 'american museum of natural history', activityType: 'Ticketed Attraction' },
        { name: 'Central Park', activityType: 'Outdoor Activity' },
      ],
    });

    expect(mockedDb.upsertAttractionDurationMetadata).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(2);
  });
});
