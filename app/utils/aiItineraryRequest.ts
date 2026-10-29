import { computeDurationFromRange } from './tripDates';
import { extractPromptTraitsFromTraits, normalizePromptTraits } from './promptTraits';

export const budgetRangeFromComfort = (comfort: 'B' | 'M' | 'L'): { min: number; max: number } => {
  if (comfort === 'B') return { min: 500, max: 1500 };
  if (comfort === 'L') return { min: 4000, max: 8000 };
  return { min: 1500, max: 4000 };
};

type TripLike = {
  id: string;
  name?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | string | null;
};

/**
 * The body for POST /api/itinerary/async when generating for a trip that already exists (the
 * create-trip wizard builds its own, from choices made there). Uses the traveler's saved prompt
 * traits for pace and comfort. Returns null when the trip has no destination or length to plan.
 */
export const buildExistingTripAiRequest = (
  trip: TripLike,
  traits: Parameters<typeof extractPromptTraitsFromTraits>[0] = []
): Record<string, unknown> | null => {
  const destination = String(trip.destination ?? '').trim() || String(trip.name ?? '').trim();
  const days = computeDurationFromRange(trip.startDate, trip.endDate) ?? (Number(trip.durationDays) > 0 ? Number(trip.durationDays) : null);
  if (!destination || !days) return null;
  const prompt = normalizePromptTraits(extractPromptTraitsFromTraits(traits).profile);
  const budget = budgetRangeFromComfort(prompt.tt.c);
  return {
    country: destination,
    locations: [destination],
    mustSeeAttractions: [],
    days,
    budgetMin: budget.min,
    budgetMax: budget.max,
    tripId: trip.id,
    tt: prompt.tt,
    ut: prompt.ut,
  };
};
