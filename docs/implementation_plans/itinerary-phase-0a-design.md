# Itinerary Phase 0A design

## Scope

Phase 0A adds a deterministic preference contract and an offline evaluation harness. It does not add
geocoding, clustering, routing APIs, caches, or change the persisted itinerary schema.

## Inputs and outputs

- Inputs: structured trip traits (`tt`), requesting-account overrides (`ut`), traveler trait labels,
  budget range, trip style, and must-sees already supplied to `generateItineraryViaPromptPlan`.
- Output: a versioned `NormalizedPreferenceContract` containing effective values, provenance, normalized
  interest weights, traveler interests, conflicts, assumptions, and privacy classification.
- Evaluation output: structured baseline metrics computed from generated itinerary data without judging
  prose style.

## Invariants

- Explicit requesting-account pace overrides trip pace.
- Effective mobility is the most restrictive recognized value across trip, account, and travelers.
- Traveler order never changes the contract.
- Interest weights are non-negative integers summing to 100.
- Unknown free-form traits cannot create hard accessibility, dietary, or safety constraints.
- No names, user IDs, free-form traits, or must-sees are copied into shared-cache-safe material.

## Aggregation

Hard mobility constraints use the most restrictive recognized value. Soft interests start with trip
weights; each recognized traveler interest contributes one equal vote. A fairness floor ensures every
interest explicitly expressed by a traveler remains non-zero after normalization. Conflicts are retained
for user review rather than silently resolved.

## Privacy and cache dependencies

The contract is private trip data. A separate `sharedCacheDimensions` projection contains only coarse,
allowlisted planning dimensions. Phase 0A does not persist or share either object.

## Failure and rollout

Unknown labels are retained only as assumptions and otherwise ignored. The generation service falls back
to existing normalized traits if contract construction ever fails. Wiring is controlled by
`ITINERARY_PREFERENCE_CONTRACT_ENABLED` (default on); setting it false restores legacy normalization.

