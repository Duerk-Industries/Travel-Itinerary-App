import {
  buildGetYourGuideItineraryCandidates,
  enrichGetYourGuideDescriptors,
  enrichGetYourGuidePartnerActivities,
  selectGetYourGuideItineraryCandidates,
} from '../src/services/getYourGuideItineraryEnrichmentService';

jest.mock('../src/db', () => ({ getFeatureFlag: jest.fn() }));
jest.mock('../src/apis/getYourGuideCallers', () => ({
  GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION: 'GETYOURGUIDE_ITINERARY_ACTIVITY_SUGGESTION',
  getGetYourGuideActivitySuggestions: jest.fn(),
}));

const activity = (overrides: Record<string, unknown> = {}) => ({
  status: 'Proposed' as const,
  activityType: 'Tour' as const,
  date: '2026-09-01',
  name: 'Louvre Museum Guided Tour',
  startLocation: 'Paris',
  startTime: '10:00',
  duration: '2 hours',
  cost: '',
  freeCancelBy: '',
  bookedOn: '',
  reference: '',
  notes: '',
  ...overrides,
});
const mockedPartnerLookup = jest.requireMock('../src/apis/getYourGuideCallers').getGetYourGuideActivitySuggestions as jest.Mock;

describe('GetYourGuide Phase 4 itinerary enrichment', () => {
  it('builds candidates from verified catalog metadata and adjacent transfer legs', () => {
    const candidates = buildGetYourGuideItineraryCandidates({
      activities: [activity()],
      destinations: ['Paris, France'],
      catalogEntries: [{
        id: 'louvre', destinationKey: 'paris', destinationDisplayName: 'Paris', country: 'France',
        name: 'Louvre Museum Guided Tour', rank: 1, activityType: 'Tour', interestTags: ['culture'],
        budgetTier: 'paid', lat: 48.86, lon: 2.33, updatedAt: '2026-08-01T00:00:00.000Z',
      } as any],
      durationMetadataByName: new Map([['louvre museum guided tour', {
        estimatedDurationMinutes: 150,
      } as any]]),
      transferNotesByDay: new Map([[0, [{ fromName: 'Hotel', toName: 'Louvre Museum Guided Tour', minutes: 25 }]]]),
      mustSeeNames: ['Louvre Museum'],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      durationMinutes: 150,
      previousTravelMinutes: 25,
      mustSee: true,
      budgetTier: 'paid',
    }));
    expect(candidates[0].destination).toEqual(expect.objectContaining({ city: 'Paris', country: 'France', coordinates: { lat: 48.86, lon: 2.33 } }));
  });

  it('selects deterministically under input reordering with per-day and itinerary caps', () => {
    const candidates = [
      { id: 'a', name: 'Paris Museum Guided Tour', activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France' }, mustSee: true },
      { id: 'b', name: 'Paris Food Tasting Tour', activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France' } },
      { id: 'c', name: 'Paris River Cruise Tour', activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France' } },
      { id: 'd', name: 'Rome Colosseum Guided Tour', activityType: 'Tour', date: '2026-09-02', destination: { destination: 'Rome, Italy' }, mustSee: true },
    ] as any[];
    const context = { requireDisambiguatedDestination: true } as const;
    const first = selectGetYourGuideItineraryCandidates(candidates, context, { maxPerDay: 2, maxPerItinerary: 3 });
    const second = selectGetYourGuideItineraryCandidates([...candidates].reverse(), context, { maxPerDay: 2, maxPerItinerary: 3 });
    expect(first.selected.map((item) => item.id)).toEqual(second.selected.map((item) => item.id));
    expect(first.selected).toHaveLength(3);
    expect(first.selected.filter((item) => item.date === '2026-09-01')).toHaveLength(2);
    expect(first.selected.some((item) => item.name.includes('River'))).toBe(false);
  });

  it('honors budget and impossible transfer-window constraints before issuing descriptors', () => {
    const result = selectGetYourGuideItineraryCandidates([
      {
        id: 'premium', name: 'Paris Museum Guided Tour', activityType: 'Tour', date: '2026-09-01',
        destination: { destination: 'Paris, France' }, budgetTier: 'premium',
      },
      {
        id: 'tight-window', name: 'Paris River Cruise Tour', activityType: 'Tour', date: '2026-09-01',
        destination: { destination: 'Paris, France' }, durationMinutes: 180, availableMinutes: 120,
        previousTravelMinutes: 20, nextTravelMinutes: 20, bufferMinutes: 20,
      },
    ] as any, { comfort: 'Budget', requireDisambiguatedDestination: true });
    expect(result.selected).toHaveLength(0);
    expect(result.rejected.find((entry) => entry.candidate.id === 'premium')?.reasons).toContain('budget_incompatible');
    expect(result.rejected.find((entry) => entry.candidate.id === 'tight-window')?.reasons).toContain('travel_window_infeasible');
  });

  it('uses bounded concurrency and tolerates partial descriptor failures', async () => {
    let active = 0;
    let peak = 0;
    const issueDescriptor = jest.fn(async (candidate: any) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (candidate.id === 'fail') throw new Error('unavailable');
      return { provider: 'getyourguide', kind: 'activity', token: `g1.${candidate.id}.tag.body`, disclosureRequired: true, expiresAt: '2099-01-01T00:00:00.000Z', rulesVersion: 'v1' } as any;
    });
    const candidates = ['a', 'b', 'fail', 'd'].map((id) => ({
      id, name: `${id} Museum Guided Tour`, activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France' },
    })) as any[];
    const result = await enrichGetYourGuideDescriptors({ candidates, concurrency: 2, issueDescriptor });
    expect(peak).toBeLessThanOrEqual(2);
    expect(Object.keys(result.descriptors)).toEqual(['a', 'b', 'd']);
    expect(result.candidates.map((item) => item.id)).toEqual(['a', 'b', 'fail', 'd']);
  });

  it('stops workers when the enrichment signal is aborted', async () => {
    const controller = new AbortController();
    const issueDescriptor = jest.fn(async () => {
      controller.abort();
      return null;
    });
    await enrichGetYourGuideDescriptors({
      candidates: [{ id: 'a', name: 'Paris Museum Guided Tour', activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France' } }] as any,
      issueDescriptor,
      signal: controller.signal,
    });
    expect(issueDescriptor).toHaveBeenCalledTimes(1);
  });

  it('runs optional partner lookups asynchronously without changing candidate order', async () => {
    mockedPartnerLookup.mockReset();
    mockedPartnerLookup.mockImplementation(async (params: any) => ({
      products: [{ productId: params.query, name: params.query, lastVerifiedAt: 'now' }],
      negative: false,
      fetchedAt: 'now',
      stale: false,
    }));
    const candidates = [
      { id: 'a', name: 'Paris Museum Guided Tour', activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France', city: 'Paris', country: 'France' } },
      { id: 'b', name: 'Paris River Cruise Tour', activityType: 'Tour', date: '2026-09-01', destination: { destination: 'Paris, France' } },
    ] as any[];
    const result = await enrichGetYourGuidePartnerActivities({ candidates, currency: 'USD', language: 'en', scopeKey: 'scope', concurrency: 2 });
    expect(Object.keys(result.productsByCandidateId)).toEqual(['a', 'b']);
    expect(mockedPartnerLookup).toHaveBeenCalledTimes(2);
    expect(mockedPartnerLookup.mock.calls[0][0]).toEqual(expect.objectContaining({ currency: 'USD', language: 'en', scopeKey: 'scope' }));
  });
});
