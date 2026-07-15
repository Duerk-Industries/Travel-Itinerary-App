# Itinerary Phase 4 design

Shared caches contain only normalized, generic route and validated day structures. Keys exclude user IDs,
names, free text, must-sees, home locations, and reservations. Must-sees are injected after cache reads.

Route keys depend on destination order, duration, pace, comfort/budget, mobility, car style, interaction
style, dates, schema version, and p1 prompt fingerprint. Day keys additionally depend on normalized
weights, catalog coordinates/ranks, and p2/p3 prompt fingerprints. Catalog or prompt changes therefore
invalidate entries without bulk deletion.

Cache failures are fail-open. Expired, corrupt, or dependency-mismatched values are misses. Route TTL is
60 days; validated day fragments use 30 days. Day payloads retain three-day fragments for future partial
reuse, but Phase 4 only performs whole-entry reads to avoid mixing incompatible date sequences.

Shadow assignment is deterministic from the trip seed and defaults to 5%. Actual duplicate generation
requires an injected judge and remains opt-in so shadow work cannot silently double production cost.

## Phase 3 integration

Validated day-cache dependencies include the active p2/p3 templates, rendered attraction pods, rendered
arrival/departure logistics facts, route hash, catalog fingerprint, and structure-validator version.
Phase 3 mechanical repair runs both before p3 and after every cache read, so an old or malformed fragment
cannot bypass current meal, density, recovery, departure, or evidenced-closure rules. A shadow judge can
now compare the pre-Phase-3 candidate with the pod/logistics/validator result through the existing injected
judge interface; enabling a paid judge remains an explicit operational choice subject to API limits.
