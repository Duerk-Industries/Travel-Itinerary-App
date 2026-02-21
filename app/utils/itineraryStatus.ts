export const ITINERARY_STATUSES = ['Needed', 'Proposed', 'Booked', 'Cancelled', 'Completed'] as const;

export type ItineraryStatus = (typeof ITINERARY_STATUSES)[number];

export const DEFAULT_NEW_ITINERARY_STATUS: ItineraryStatus = 'Needed';
export const LEGACY_ITINERARY_STATUS: ItineraryStatus = 'Booked';

export const normalizeItineraryStatus = (
  value: unknown,
  fallback: ItineraryStatus = LEGACY_ITINERARY_STATUS
): ItineraryStatus => (ITINERARY_STATUSES as readonly string[]).includes(String(value)) ? (value as ItineraryStatus) : fallback;

export const shouldRelaxRequiredFields = (status: unknown): boolean => {
  const normalized = normalizeItineraryStatus(status, DEFAULT_NEW_ITINERARY_STATUS);
  return normalized === 'Needed' || normalized === 'Cancelled';
};
