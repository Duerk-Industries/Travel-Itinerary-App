import { z } from 'zod';

/**
 * Shared confidence vocabulary for every operational/factual claim the itinerary annotation
 * layer surfaces — evidence, contingencies, actions, route fragile-connections, road-trip
 * travel-leg estimates, and cached ActivityBlock operating schedules.
 *
 * Before this, three near-identical enums had drifted independently across schemas in this
 * subsystem (`verified | provisional | unknown` for evidence/annotation fields,
 * `verified | estimated | unknown` for route fragile connections, and
 * `verified | estimated | low` for road-trip travel legs), which meant the same underlying claim
 * — "we don't have a source for this yet" — was three different unrelated string literals
 * depending on which schema happened to touch it. See
 * docs/implementation_plans/itinerary-narrative-depth-and-validation.md's fact-freshness
 * recommendation for the intended five states:
 *
 *   verified            - supported by a current authoritative source
 *   historical_pattern  - happened in previous years but the specific future occurrence is not
 *                         yet announced (e.g. "this venue usually holds an event in this
 *                         window," before the year's exact dates are public)
 *   estimated           - derived from routing, climatology, or another computed model, not a
 *                         named source
 *   needs_confirmation  - cannot yet be verified (an unconfirmed catalog/curated entry, an LLM
 *                         draft, or simply the absence of any evidence at all)
 *   user_supplied       - taken from an existing traveler booking/reservation
 *
 * `historical_pattern` and `user_supplied` are not produced anywhere in this codebase yet — there
 * is no event-recurrence detector and no booking-import pipeline to populate them — but they're
 * part of the shared vocabulary now so a future data source can slot in without forking the enum
 * again. Every prior use of `provisional`, the bare `unknown`, and `low` collapses onto
 * `needs_confirmation`: all three previously meant the same thing ("not yet confirmed"), just
 * spelled differently depending on which schema was being written.
 */
export const ItineraryConfidenceSchema = z.enum([
  'verified',
  'historical_pattern',
  'estimated',
  'needs_confirmation',
  'user_supplied',
]);

export type ItineraryConfidence = z.infer<typeof ItineraryConfidenceSchema>;

// Least to most trustworthy. `historical_pattern` ranks above a bare `estimated` (it's grounded
// in something that actually happened before, not just a computed model) and below
// `user_supplied` (the traveler's own confirmed data, though not necessarily checked against a
// live authoritative source the way `verified` is).
export const ITINERARY_CONFIDENCE_RANK: Record<ItineraryConfidence, number> = {
  needs_confirmation: 0,
  estimated: 1,
  historical_pattern: 2,
  user_supplied: 3,
  verified: 4,
};
