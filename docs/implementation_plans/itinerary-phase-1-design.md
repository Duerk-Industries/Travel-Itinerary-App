# Itinerary Phase 1 design

Phase 1 enriches attraction and destination facts without changing itinerary selection. Provider calls
are best-effort, coalesced, cached, and injectable in tests. Catalog enrichment is persisted in the
existing `locations.payload` JSON and CSV mirror, so no relational table migration is required.

Invariants:

- Provider failure never blocks itinerary generation.
- Coordinates require a canonical Wikipedia page match and finite geographic bounds.
- Pageviews are a ranking signal, never presented as visitor counts or quality facts.
- Climatology is historical aggregate context, not a forecast.
- Approximate timezone offsets and flight durations are labeled estimates.
- Existing enriched catalog facts are reused; negative results have a shorter cache life.

Rollout is additive. Discovery remains controlled by `ITINERARY_ATTRACTIONS_DISCOVERY_ENABLED`; Phase 1
does not add a new paid provider. Disabling discovery or encountering provider limits preserves current
catalog behavior.

