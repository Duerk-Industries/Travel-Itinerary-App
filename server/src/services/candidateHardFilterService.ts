import type { AttractionCatalogEntry } from '../types';
import { entryInterests } from './fairnessRankerService';
import type { MobilityCode, PreferenceExclusion } from './itineraryPreferenceContract';

/**
 * Phase 2A hard-filter stage ("Rank and cluster before p2" —
 * `server/prompts/itinerary-improvements-coding-plan.md`). Runs BEFORE scoring
 * (`rankAttractionsForGroup` / `buildPodBasedShortlist`) and removes candidates outright rather
 * than down-scoring them, per the plan's non-negotiable rule: "do not hide a hard rejection as a
 * low score." Rejection reasons are retained (not silently dropped) for future metrics/UI
 * explanation work (Phase 3B).
 *
 * Scope note: this module only implements the *admission gate* ahead of scoring. It does not
 * perform day-level scheduling, ordering, or travel-logistics feasibility (nearest-insertion,
 * 2-opt, arrival/departure rules) — that is handled elsewhere in Phase 2A/2B.
 *
 * Data-availability note: of the four hard-filter sources named in the plan, only the exclusion-
 * tag filter is backed by real, currently-available data end to end. The other three are wired as
 * typed, structurally-present no-ops (they never reject a candidate) because the upstream data
 * they would need does not exist yet in this codebase:
 *   - Accessibility: `AttractionCatalogEntry` (server/src/types.ts) has no accessibility/step-free
 *     field. `attractionsCatalogService.ts` does not source or store one either.
 *   - Booked/timed constraints: `ItineraryPromptPlanServiceInput` (itineraryPromptPlanService.ts)
 *     does not pass booked transfers/activities into the shortlist stage at all, so there is
 *     nothing to conflict-check against at candidate-admission time.
 *   - Verified closures: the attractions catalog carries no opening-hours/closure-date field.
 * Fabricating any of these from unrelated fields (e.g. inferring accessibility from activityType)
 * would violate the plan's non-synthetic-data policy, so they are left as documented gaps.
 */

export type HardRejectionReason =
  | 'excluded_interest'
  | 'accessibility_unverified'
  | 'booked_time_conflict'
  | 'verified_closure';

export type HardRejection = { entry: AttractionCatalogEntry; reason: HardRejectionReason; detail: string };

export type HardFilterResult = {
  admitted: AttractionCatalogEntry[];
  rejected: HardRejection[];
};

/** A booked/timed constraint that would make a candidate infeasible for a given day. Not
 *  currently populated anywhere in the pipeline — see module-level data-availability note. */
export type BookedTimedConstraint = {
  dateKey: string;
  /** Attraction catalog ids that are known-infeasible for `dateKey` (e.g. overlap a booked,
   *  fixed-time transfer or activity). */
  conflictingEntryIds: string[];
  label: string;
};

/** A verified closure window for a specific date. Not currently populated — see module note. */
export type VerifiedClosure = { entryId: string; dateKey: string; detail: string };

const matchesExclusion = (entry: AttractionCatalogEntry, exclusions: PreferenceExclusion[]): PreferenceExclusion | null => {
  if (!exclusions.length) return null;
  const tags = entryInterests(entry);
  return exclusions.find((exclusion) => tags.has(exclusion.tag)) ?? null;
};

/**
 * Rejects candidates that fail a hard constraint before any relevance/must-see/geo scoring runs.
 * Deterministic and traveler-order-independent: `exclusions` is expected to already be
 * deduplicated/sorted by `buildItineraryPreferenceContract`, and this function performs no
 * traveler-order-dependent iteration of its own.
 */
export const applyHardFilters = (params: {
  entries: AttractionCatalogEntry[];
  exclusions?: PreferenceExclusion[];
  mobility?: MobilityCode;
  dateKey?: string;
  bookedConstraints?: BookedTimedConstraint[];
  verifiedClosures?: VerifiedClosure[];
}): HardFilterResult => {
  const exclusions = params.exclusions ?? [];
  const bookedConstraints = params.bookedConstraints ?? [];
  const verifiedClosures = params.verifiedClosures ?? [];
  const conflictingEntryIds = new Set(
    params.dateKey
      ? bookedConstraints.filter((constraint) => constraint.dateKey === params.dateKey).flatMap((constraint) => constraint.conflictingEntryIds)
      : []
  );
  const closedEntryIds = new Set(
    params.dateKey ? verifiedClosures.filter((closure) => closure.dateKey === params.dateKey).map((closure) => closure.entryId) : []
  );

  const admitted: AttractionCatalogEntry[] = [];
  const rejected: HardRejection[] = [];

  for (const entry of params.entries) {
    const exclusionMatch = matchesExclusion(entry, exclusions);
    if (exclusionMatch) {
      rejected.push({ entry, reason: 'excluded_interest', detail: exclusionMatch.reason });
      continue;
    }
    // Accessibility: structurally wired, currently always a no-op — see module note. Left as an
    // explicit branch (rather than omitted) so it is trivial to complete once the catalog carries
    // an accessibility field, without having to re-thread the call site again.
    if (params.mobility === 'L') {
      // No accessibility field exists on AttractionCatalogEntry yet; nothing to check.
    }
    if (conflictingEntryIds.has(entry.id)) {
      rejected.push({ entry, reason: 'booked_time_conflict', detail: bookedConstraints.find((c) => c.conflictingEntryIds.includes(entry.id))?.label ?? 'Conflicts with a booked, fixed-time item.' });
      continue;
    }
    if (closedEntryIds.has(entry.id)) {
      rejected.push({ entry, reason: 'verified_closure', detail: verifiedClosures.find((c) => c.entryId === entry.id)?.detail ?? 'Verified closed on this date.' });
      continue;
    }
    admitted.push(entry);
  }

  return { admitted, rejected };
};
