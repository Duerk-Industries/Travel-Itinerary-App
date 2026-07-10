/// <reference types="jest" />
/// <reference types="node" />
import { renderSimplifiedItineraryMarkdown } from '../src/services/itineraryMarkdownRenderer';
import type { ItineraryPromptPlanResult } from '../src/services/itineraryPromptPlanService';

const buildFakeResult = (): ItineraryPromptPlanResult =>
  ({
    promptRequest: {} as any,
    normalized: {} as any,
    route: {} as any,
    itinerary: {
      dy: [
        { d: 1, dt: '2026-09-12', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: '', ln: [], cf: 'M' },
        { d: 2, dt: '2026-09-13', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: '', ln: [], cf: 'M' },
        { d: 3, dt: '2026-09-14', b: 'New York City', it: [], me: ['BQ', 'LC', 'DL'], sl: '', ln: [], cf: 'M' },
      ],
    } as any,
    planMarkdown: '',
    details: [],
    generatedItems: {
      transfers: [
        {
          status: 'Needed',
          transferType: 'Train',
          departureDate: '2026-09-14',
          arrivalDate: '2026-09-14',
          departureLocation: 'Boston',
          arrivalLocation: 'New York City',
          departureTime: '09:00',
          arrivalTime: '11:00',
          carrier: '',
          flightNumber: '',
          bookingReference: '',
        },
      ],
      lodgings: [
        {
          status: 'Needed',
          name: "Lodging at 'Boston'",
          checkInDate: '2026-09-12',
          checkOutDate: '2026-09-14',
          rooms: '1',
          totalCost: '',
          costPerNight: '',
          address: 'Boston',
        },
      ],
      activities: [
        {
          status: 'Proposed',
          activityType: 'Sights & Landmarks',
          date: '2026-09-13',
          name: 'Freedom Trail',
          startLocation: 'Boston',
          startTime: '09:00',
          duration: '2h',
          cost: '',
          freeCancelBy: '',
          bookedOn: '',
          reference: '',
          notes: 'A walking trail through historic Boston sites.',
        },
        {
          status: 'Proposed',
          activityType: 'Outdoor Activity',
          date: '2026-09-14',
          name: 'Central Park',
          startLocation: 'New York City',
          startTime: '13:00',
          duration: '2h',
          cost: '',
          freeCancelBy: '',
          bookedOn: '',
          reference: '',
          notes: 'A large park in Manhattan.',
        },
      ],
      carRentals: [],
    },
    profile: {} as any,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }) as unknown as ItineraryPromptPlanResult;

describe('renderSimplifiedItineraryMarkdown', () => {
  it('emits one heading per day in order', () => {
    const markdown = renderSimplifiedItineraryMarkdown(buildFakeResult(), 'Boston and New York');
    const headingIndexes = ['Day 1', 'Day 2', 'Day 3'].map((label) => markdown.indexOf(label));
    expect(headingIndexes.every((index) => index >= 0)).toBe(true);
    expect(headingIndexes[0]).toBeLessThan(headingIndexes[1]);
    expect(headingIndexes[1]).toBeLessThan(headingIndexes[2]);
  });

  it('places each event under the day heading matching its date', () => {
    const markdown = renderSimplifiedItineraryMarkdown(buildFakeResult(), 'Boston and New York');
    const dayTwoHeadingIndex = markdown.indexOf('## Day 2');
    const dayThreeHeadingIndex = markdown.indexOf('## Day 3');
    const freedomTrailIndex = markdown.indexOf('Freedom Trail');
    const centralParkIndex = markdown.indexOf('Central Park');
    const checkoutIndex = markdown.indexOf('Lodging check-out');
    const transferIndex = markdown.indexOf('Transfer: Train');

    expect(freedomTrailIndex).toBeGreaterThan(dayTwoHeadingIndex);
    expect(freedomTrailIndex).toBeLessThan(dayThreeHeadingIndex);
    expect(centralParkIndex).toBeGreaterThan(dayThreeHeadingIndex);
    expect(checkoutIndex).toBeGreaterThan(dayThreeHeadingIndex);
    expect(transferIndex).toBeGreaterThan(dayThreeHeadingIndex);
  });

  it('includes the trip name as the top-level heading', () => {
    const markdown = renderSimplifiedItineraryMarkdown(buildFakeResult(), 'Boston and New York');
    expect(markdown.startsWith('# Boston and New York')).toBe(true);
  });
});
