import { ITINERARY_STATUSES, normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';

it('places Needs Booking between Proposed and Booked and preserves it on normalization', () => {
  expect(ITINERARY_STATUSES.slice(0, 4)).toEqual(['Needed', 'Proposed', 'Needs Booking', 'Booked']);
  expect(normalizeItineraryStatus('Needs Booking')).toBe('Needs Booking');
  expect(shouldRelaxRequiredFields('Needs Booking')).toBe(false);
});
