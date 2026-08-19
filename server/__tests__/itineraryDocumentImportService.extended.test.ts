import {
  extractItineraryDocumentCandidates,
  importItineraryDocumentIntoTrip,
  isDuplicateItineraryCandidate,
  __clearExtractionCache,
  segmentItineraryDocumentDays,
  type ItineraryDocumentCandidate,
} from '../src/services/itineraryDocumentImportService';
import * as db from '../src/db';
import * as aiProviderConfigService from '../src/services/aiProviderConfigService';
import * as aiProviderRegistry from '../src/ai/registry/aiProviderRegistry';

jest.mock('../src/db');
jest.mock('../src/services/aiProviderConfigService');
jest.mock('../src/ai/registry/aiProviderRegistry');
jest.mock('../src/apis/providerBudgeting', () => ({
  estimateAiCostMicros: jest.fn(() => 1000),
}));

const mockedDb = db as jest.Mocked<typeof db>;
const mockedAiConfig = aiProviderConfigService as jest.Mocked<typeof aiProviderConfigService>;
const mockedAiRegistry = aiProviderRegistry as jest.Mocked<typeof aiProviderRegistry>;

describe('itineraryDocumentImportService extended', () => {
  describe('segmentItineraryDocumentDays', () => {
    test('segments Romania-style dated prose days', () => {
      const sections = segmentItineraryDocumentDays({
        documentText: 'Sat 9/5 — Arrive Bucharest\nWalk Calea Victoriei.\n\nSun 9/6 — Bucharest\nPalace of Parliament and Village Museum.\n\nPractical notes\nCarry cash.\n\nHikes at a glance\nSun 9/6 Village trail 3 mi',
        tripStartDate: '2026-09-05',
        tripEndDate: '2026-09-19',
      });
      expect(sections).toHaveLength(2);
      expect(sections.map((section) => section.date)).toEqual(['2026-09-05', '2026-09-06']);
      expect(sections.map((section) => section.day)).toEqual([1, 2]);
    });

    test('segments Japan-style schedule rows', () => {
      const sections = segmentItineraryDocumentDays({
        documentText: 'Nov 10 Tue Tokyo — Ueno  Arrive. Ameyoko arcade.\nNov 11 Wed Tokyo — Ueno  Senso-ji, Nakamise, Imperial Palace East Gardens.\nLODGING\nNov 10–11 Ueno',
        tripStartDate: '2026-11-10',
        tripEndDate: '2026-12-08',
      });
      expect(sections).toHaveLength(2);
      expect(sections[1]).toEqual(expect.objectContaining({ day: 2, date: '2026-11-11' }));
    });
  });

  describe('isDuplicateItineraryCandidate', () => {
    const existing = { flights: [], lodgings: [], activities: [], carRentals: [] };

    test('matches flight with ±1 day and overlapping location', () => {
      const candidate: ItineraryDocumentCandidate = {
        type: 'flight',
        departureDate: '2026-09-10',
        departureLocation: 'JFK',
        arrivalLocation: 'CDG',
      };
      const match = { departureDate: '2026-09-11', departureAirportCode: 'JFK Airport', id: 'f1' };
      expect(isDuplicateItineraryCandidate(candidate, { ...existing, flights: [match as any] })).toBe(true);
    });

    test('matches hotel with overlapping dates and shared name token', () => {
      const candidate: ItineraryDocumentCandidate = {
        type: 'hotel',
        name: 'Grand Hyatt Tokyo',
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-15',
      };
      const match = { name: 'Tokyo Hyatt', check_in_date: '2026-09-12', check_out_date: '2026-09-16', id: 'l1' };
      expect(isDuplicateItineraryCandidate(candidate, { ...existing, lodgings: [match as any] })).toBe(true);
    });

    test('matches activity with same date and name substring', () => {
      const candidate: ItineraryDocumentCandidate = {
        type: 'tour_activity',
        name: 'Louvre Private Tour',
        activityDate: '2026-09-12',
      };
      const match = { name: 'Louvre', date: '2026-09-12', id: 'a1' };
      expect(isDuplicateItineraryCandidate(candidate, { ...existing, activities: [match as any] })).toBe(true);
    });

    test('matches car rental with same date and vendor overlap', () => {
      const candidate: ItineraryDocumentCandidate = {
        type: 'car_rental',
        pickupDate: '2026-09-15',
        providerVendor: 'Hertz',
      };
      const match = { vendor: 'Hertz Global', pickupDate: '2026-09-15', id: 'c1' };
      expect(isDuplicateItineraryCandidate(candidate, { ...existing, carRentals: [match as any] })).toBe(true);
    });
  });

  describe('extractItineraryDocumentCandidates', () => {
    beforeEach(() => {
      jest.resetAllMocks();
      __clearExtractionCache();
      mockedAiConfig.getActiveAiProvider.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
      mockedAiConfig.getConfiguredProviderApiKey.mockReturnValue('test-key');
    });

    test('throws error if document text is too long', async () => {
      await expect(extractItineraryDocumentCandidates({
        documentText: 'a'.repeat(60001),
        userId: 'u1',
      })).rejects.toThrow('exceeds the 60000-character limit');
    });

    test('parses mixed candidates and unassigned notes', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [
                { type: 'flight', name: 'Flight 1', departureDate: '2026-09-10', departureLocation: 'JFK', arrivalLocation: 'CDG' },
                { type: 'hotel', name: 'Hotel 1', checkInDate: '2026-09-10', checkOutDate: '2026-09-12' },
              ],
              unassignedNotes: 'Some useful tips about Japan.',
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };

      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await extractItineraryDocumentCandidates({
        documentText: 'Short document',
        userId: 'u1',
      });

      expect(result.candidates).toHaveLength(2);
      expect(result.unassignedNotes).toBe('Some useful tips about Japan.');
      expect(result.usage.promptTokens).toBe(100);
    });

    test('handles unassignedNotes as an array of strings', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [],
              unassignedNotes: ['Tip 1', 'Tip 2'],
            }),
          },
        }],
      };

      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await extractItineraryDocumentCandidates({
        documentText: 'Short document',
        userId: 'u1',
      });

      expect(result.unassignedNotes).toBe('Tip 1\n\nTip 2');
    });

    test('throws error if AI response is empty', async () => {
      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue({ choices: [] }),
      } as any);

      await expect(extractItineraryDocumentCandidates({
        documentText: 'Short document',
        userId: 'u1',
      })).rejects.toThrow('returned an empty response');
    });

    test('throws error if AI response is invalid JSON', async () => {
      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'invalid json' } }] }),
      } as any);

      await expect(extractItineraryDocumentCandidates({
        documentText: 'Short document',
        userId: 'u1',
      })).rejects.toThrow('returned invalid JSON');
    });
  });

  describe('importItineraryDocumentIntoTrip', () => {
    const mockTrip = { id: 't1', name: 'Japan Trip', destination: 'Japan', startDate: '2026-09-01', endDate: '2026-09-30', notes: 'Old notes' };

    beforeEach(() => {
      jest.resetAllMocks();
      __clearExtractionCache();
      mockedDb.ensureUserInTrip.mockResolvedValue({ id: 'm1', groupId: 'g1' } as any);
      mockedDb.getTripById.mockResolvedValue(mockTrip as any);
      mockedDb.listFlights.mockResolvedValue([]);
      mockedDb.listLodgings.mockResolvedValue([]);
      mockedDb.listActivities.mockResolvedValue([]);
      mockedDb.listCarRentals.mockResolvedValue([]);
      mockedDb.listItineraries.mockResolvedValue([]);
      mockedAiConfig.getActiveAiProvider.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
      mockedAiConfig.getConfiguredProviderApiKey.mockReturnValue('test-key');
    });

    test('real run inserts items and appends notes', async () => {
      const mockExtraction = {
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [
                { type: 'tour_activity', name: 'Louvre', activityDate: '2026-09-12' },
              ],
              unassignedNotes: 'Pack sunscreen.',
            }),
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };

      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue(mockExtraction),
      } as any);

      mockedDb.insertActivity.mockResolvedValue({ id: 'a1' } as any);

      const result = await importItineraryDocumentIntoTrip({
        tripId: 't1',
        userId: 'u1',
        documentText: 'Source text',
        sourceFilename: 'trip.md',
        dryRun: false,
      });

      expect(result.added).toHaveLength(1);
      expect(mockedDb.insertActivity).toHaveBeenCalled();
      expect(mockedDb.updateTripDetails).toHaveBeenCalledWith('u1', 't1', expect.objectContaining({
        notes: expect.stringContaining('Pack sunscreen.'),
      }));
    });

    test('runs a dedicated activity pass over detected day sections and merges its results', async () => {
      const chatCompletion = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ candidates: [], unassignedNotes: 'Bring a passport.', dayNotes: [] }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({
            activities: [
              { name: 'Palace of Parliament', day: 1, date: '2026-09-05', activityType: 'Ticketed Attraction', sourceExcerpt: 'Palace of Parliament' },
              { name: 'Village Museum', day: 2, date: '2026-09-06', activityType: 'Sights & Landmarks', sourceExcerpt: 'Village Museum' },
            ],
            dayNotes: [{ day: 2, date: '2026-09-06', title: 'Booking', body: 'Bring a passport for security.' }],
          }) } }],
          usage: { prompt_tokens: 30, completion_tokens: 20 },
        });
      mockedAiRegistry.resolveProvider.mockResolvedValue({ id: 'openai', supportedModels: ['gpt-4o'], chatCompletion } as any);

      const result = await extractItineraryDocumentCandidates({
        documentText: 'Sat 9/5 — Arrive Bucharest\nPalace of Parliament.\nSun 9/6 — Bucharest\nVillage Museum.',
        userId: 'u1',
        tripStartDate: '2026-09-05',
        tripEndDate: '2026-09-19',
      });

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.candidates.map((candidate) => candidate.name)).toEqual(['Palace of Parliament', 'Village Museum']);
      expect(result.dayNotes).toEqual([expect.objectContaining({ day: 2, body: 'Bring a passport for security.' })]);
      expect(result.unassignedNotes).toBe('Bring a passport.');
      expect(result.usage.promptTokens).toBe(50);
    });

    test('uses the trip start date for day-number activities and writes uncertain day content as a note', async () => {
      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({
            candidates: [{ type: 'tour_activity', name: 'Fushimi Inari hike', day: 3 }],
            dayNotes: [{ day: 3, title: 'Evening option', body: 'Consider Gion after dinner.', sourceExcerpt: 'Evening: Gion if energy allows' }],
            unassignedNotes: '',
          }) } }],
        }),
      } as any);
      mockedDb.insertActivity.mockResolvedValue({ id: 'activity-1' } as any);
      mockedDb.createItineraryRecord.mockResolvedValue({ id: 'itinerary-1', tripId: 't1' } as any);
      mockedDb.addItineraryDetail.mockResolvedValue({ id: 'note-1', itineraryId: 'itinerary-1', day: 3, activity: 'Evening option', kind: 'note', noteBody: 'Consider Gion after dinner.' } as any);

      const result = await importItineraryDocumentIntoTrip({
        tripId: 't1', userId: 'u1', documentText: 'Day 3 itinerary', sourceFilename: 'trip.md', dryRun: false,
      });

      expect(mockedDb.insertActivity).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-03', name: 'Fushimi Inari hike', status: 'Proposed' }));
      expect(mockedDb.addItineraryDetail).toHaveBeenCalledWith('u1', 'itinerary-1', expect.objectContaining({ day: 3, kind: 'note', noteBody: 'Consider Gion after dinner.' }));
      expect(result.added.map((item) => item.type)).toEqual(['tour_activity', 'day_note']);
    });

    test('skips duplicates during import', async () => {
      const mockExtraction = {
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [
                { type: 'tour_activity', name: 'Louvre', activityDate: '2026-09-12' },
              ],
              unassignedNotes: '',
            }),
          },
        }],
      };

      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue(mockExtraction),
      } as any);

      mockedDb.listActivities.mockResolvedValue([{ name: 'Louvre', date: '2026-09-12', id: 'existing1' }] as any);

      const result = await importItineraryDocumentIntoTrip({
        tripId: 't1',
        userId: 'u1',
        documentText: 'Source text',
        sourceFilename: 'trip.md',
        dryRun: false,
      });

      expect(result.added).toHaveLength(0);
      expect(result.skippedDuplicates).toHaveLength(1);
      expect(result.skippedDuplicates[0].matchedExistingId).toBe('existing1');
    });

    test('skips unparseable candidates (missing fields)', async () => {
      const mockExtraction = {
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [
                { type: 'tour_activity', name: '', activityDate: '2026-09-12' }, // missing name
                { type: 'hotel', name: 'Hotel', checkInDate: '2026-09-10' }, // missing checkOutDate
              ],
              unassignedNotes: '',
            }),
          },
        }],
      };

      mockedAiRegistry.resolveProvider.mockResolvedValue({
        id: 'openai',
        supportedModels: ['gpt-4o'],
        chatCompletion: jest.fn().mockResolvedValue(mockExtraction),
      } as any);

      const result = await importItineraryDocumentIntoTrip({
        tripId: 't1',
        userId: 'u1',
        documentText: 'Source text',
        sourceFilename: 'trip.md',
        dryRun: false,
      });

      expect(result.added).toHaveLength(0);
      expect(result.skippedUnparseable).toHaveLength(2);
    });

    test('throws error if user not in trip', async () => {
      mockedDb.ensureUserInTrip.mockResolvedValue(null);

      await expect(importItineraryDocumentIntoTrip({
        tripId: 't1',
        userId: 'u1',
        documentText: 'text',
        sourceFilename: 'f.txt',
        dryRun: true,
      })).rejects.toThrow('Not authorized');
    });

    test('throws error if trip not found', async () => {
      mockedDb.getTripById.mockResolvedValue(null);

      await expect(importItineraryDocumentIntoTrip({
        tripId: 't1',
        userId: 'u1',
        documentText: 'text',
        sourceFilename: 'f.txt',
        dryRun: true,
      })).rejects.toThrow('Trip not found');
    });
  });
});
