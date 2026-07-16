# Itinerary Phase 2 design

Phase 2 adds deterministic ranking and scheduling inputs. It does not yet alter the p2/p4 templates;
Phase 3 will inject the pod and logistics fact blocks.

## Invariants

- Every candidate occurs in exactly one pod.
- Geocoded pods contain at most three items and stay within the configured radius from their seed.
- Ungeocoded candidates are retained in locality-only fallback pods.
- Ranking is stable under input reordering.
- The fairness floor reserves a relevant candidate for each expressed traveler interest when one exists.
- Arrival/departure facts are derived from supplied transfer facts; unknown times are labeled unknown.

## Scoring

`score = interestMatch × 0.5 + mustSee × 0.3 + geoProximity × 0.2`.

All components are normalized to `[0,1]`. Stable rank/name ordering breaks ties. The ranker does not
invent opening hours, prices, or travel times.

## Failure and rollout

Missing coordinates use an explicit `locality-only` pod. If all coordinates are missing, relevance is
preserved but no distance guarantee is claimed. These pure functions require no APIs or persistence and
can be disabled at orchestration time until Phase 3 prompt wiring is enabled.

