export const ITINERARY_STATUSES = ['Needed', 'Proposed', 'Booked', 'Cancelled', 'Completed'] as const;

export type ItineraryStatus = (typeof ITINERARY_STATUSES)[number];

export const LEGACY_ITINERARY_STATUS: ItineraryStatus = 'Booked';

export const normalizeItineraryStatus = (
  value: unknown,
  fallback: ItineraryStatus = LEGACY_ITINERARY_STATUS
): ItineraryStatus => (ITINERARY_STATUSES as readonly string[]).includes(String(value)) ? (value as ItineraryStatus) : fallback;

export const shouldRelaxRequiredFields = (status: unknown): boolean => {
  const normalized = normalizeItineraryStatus(status);
  return normalized === 'Needed' || normalized === 'Cancelled';
};
