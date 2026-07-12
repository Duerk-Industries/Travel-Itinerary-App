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

