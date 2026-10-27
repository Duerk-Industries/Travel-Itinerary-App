import { buildExistingTripAiRequest, budgetRangeFromComfort } from '../utils/aiItineraryRequest';

describe('buildExistingTripAiRequest', () => {
  const trip = { id: 't1', name: 'Spring in Japan', destination: 'Japan', startDate: '2027-04-01', endDate: '2027-04-10' };

  it('plans the trip as it stands: destination, length in days and the trip id', () => {
    expect(buildExistingTripAiRequest(trip)).toMatchObject({ country: 'Japan', locations: ['Japan'], days: 10, tripId: 't1' });
  });

  it('falls back to the trip name and the stored duration', () => {
    const request = buildExistingTripAiRequest({ id: 't2', name: 'Lisbon', destination: '', startDate: null, endDate: null, durationDays: 4 });
    expect(request).toMatchObject({ country: 'Lisbon', days: 4 });
  });

  it('returns null when there is nothing to plan', () => {
    expect(buildExistingTripAiRequest({ id: 't3', name: '', destination: '' , durationDays: 4 })).toBeNull();
    expect(buildExistingTripAiRequest({ id: 't4', name: 'Rome' })).toBeNull();
  });

  it('derives the budget range from the comfort trait, with a valid min and max', () => {
    const request = buildExistingTripAiRequest(trip) as { budgetMin: number; budgetMax: number };
    expect(request.budgetMax).toBeGreaterThanOrEqual(request.budgetMin);
    expect(budgetRangeFromComfort('B').max).toBeLessThan(budgetRangeFromComfort('L').min);
  });
});
