import { ITINERARY_STATUSES, normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';

it('places Needs Booking between Proposed and Booked and preserves it on normalization', () => {
  expect(ITINERARY_STATUSES.slice(0, 3)).toEqual(['Proposed', 'Needs Booking', 'Booked']);
  expect(normalizeItineraryStatus('Needs Booking')).toBe('Needs Booking');
  expect(shouldRelaxRequiredFields('Needs Booking')).toBe(false);
});

it('maps saved Needed items to Proposed and retains relaxed fields', () => {
  expect(normalizeItineraryStatus('Needed')).toBe('Proposed');
  expect(shouldRelaxRequiredFields('Needed')).toBe(true);
  expect(shouldRelaxRequiredFields('Proposed')).toBe(true);
  expect(ITINERARY_STATUSES).not.toContain('Needed');
});
