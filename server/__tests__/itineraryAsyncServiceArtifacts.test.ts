/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import * as db from '../src/db';

jest.mock('../src/db');

import { __testing } from '../src/services/itineraryAsyncService';
import type { ItineraryPromptPlanResult } from '../src/services/itineraryPromptPlanService';

const mockedDb = db as jest.Mocked<typeof db>;

const buildFakeResult = (): ItineraryPromptPlanResult =>
  ({
    promptRequest: {} as any,
    normalized: {} as any,
    route: {} as any,
    itinerary: {
      dy: [{ d: 1, dt: '2026-09-12', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: '', ln: [], cf: 'M' }],
    } as any,
    planMarkdown: '',
    details: [],
    generatedItems: {
      transfers: [],
      lodgings: [],
      activities: [
        {
          status: 'Proposed',
          activityType: 'Sights & Landmarks',
          date: '2026-09-12',
          name: 'Freedom Trail',
          startLocation: 'Boston',
          startTime: '09:00',
          duration: '2h',
          cost: '',
          freeCancelBy: '',
          bookedOn: '',
          reference: '',
          notes: 'A walking trail through historic Boston.',
        },
      ],
      carRentals: [],
    },
    profile: {} as any,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }) as unknown as ItineraryPromptPlanResult;

describe('writeLocalGenerationArtifacts', () => {
  const jobId = 'test-job-write-artifacts-12345';
  const outputDir = path.resolve(__dirname, '../logs/ai-replay/live', jobId);

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('writes input/output/markdown files named after the trip fetched from the DB', async () => {
    mockedDb.getTripById.mockResolvedValue({
      id: 't1',
      groupId: 'g1',
      name: 'Boston and New York',
      createdAt: new Date().toISOString(),
    } as any);

    const input = {
      userId: 'u1',
      tripId: 't1',
      destinationSummary: 'Boston, New York City',
      locations: ['Boston', 'New York City'],
      days: 7,
      budgetMin: 1000,
      budgetMax: 3000,
      groupTraits: [],
    } as any;
    const generationInput = {
      destinations: ['Boston', 'New York City'],
      mustSeeAttractions: [],
      days: 7,
      budgetMin: 1000,
      budgetMax: 3000,
      departureAirport: undefined,
      tripStyle: undefined,
      promptTraits: {},
      tripStartDate: null,
      tripEndDate: null,
    };

    await __testing.writeLocalGenerationArtifacts(jobId, input, generationInput, buildFakeResult());

    expect(fs.existsSync(path.join(outputDir, 'Boston-and-New-York-input.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'output.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'output.md'))).toBe(true);

    const inputCapture = JSON.parse(fs.readFileSync(path.join(outputDir, 'Boston-and-New-York-input.json'), 'utf8'));
    expect(inputCapture.tripName).toBe('Boston and New York');
    expect(inputCapture.destinations).toEqual(['Boston', 'New York City']);

    const markdown = fs.readFileSync(path.join(outputDir, 'output.md'), 'utf8');
    expect(markdown).toContain('# Boston and New York');
    expect(markdown).toContain('Freedom Trail');
  });

  it('falls back to the destination summary when the trip lookup fails', async () => {
    mockedDb.getTripById.mockRejectedValue(new Error('not found'));

    const input = {
      userId: 'u1',
      tripId: 'missing-trip',
      destinationSummary: 'Fallback Destination',
      locations: [],
      days: 1,
      budgetMin: 0,
      budgetMax: 100,
      groupTraits: [],
    } as any;
    const generationInput = {
      destinations: ['Fallback Destination'],
      mustSeeAttractions: [],
      days: 1,
      budgetMin: 0,
      budgetMax: 100,
      promptTraits: {},
      tripStartDate: null,
      tripEndDate: null,
    };

    await __testing.writeLocalGenerationArtifacts(jobId, input, generationInput, buildFakeResult());

    expect(fs.existsSync(path.join(outputDir, 'Fallback-Destination-input.json'))).toBe(true);
  });
});
