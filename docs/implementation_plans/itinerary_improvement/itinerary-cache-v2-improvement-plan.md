# Itinerary Cache v2 — Improvement & Hardening Plan (superseded)

**This document is superseded by `itinerary-cache-schema.md`, sections 16–24, and is kept only for history.**
Do not implement from this file.

This was an earlier, shorter hardening pass over the original design. Everything it proposed is now covered
in more depth, and more accurately against the real codebase, in the canonical document:

| This document's section | Superseded by |
|---|---|
| 1. Performance & Caching Architecture | §6 (cache key/retrieval, tiered topology, freshness states) |
| 2. Cost Tracking & Minimization | §17.3–17.4 (runtime cost tracking, estimator coverage), §9 (cost inversion risk) |
| 3. Maintainability & Developer Experience | §21 (maintainability and ownership) |
| 4. Quality & Verification | §23 (test and evaluation plan) |
| 5. Security & Privacy | §20 (security, privacy, licensing, data lifecycle) |
| 6. Standard Limits (api-limits.yaml) | §17.1–17.2 (admission path, provider/caller inventory) |
| 7. Feature Flags (feature-flags.yaml) | §18 (feature flags and configuration) |

Three specific claims in this document were checked against the current codebase while consolidating and
turned out to be inaccurate — noted here so they aren't carried forward by mistake:

- §1.1 named `lru-cache` as the L0 implementation. It is not a dependency of this repo, and there is no
  existing bounded/evicting cache in `server/src` to model it on. See the canonical doc's §6 note on this.
- §6's YAML sample invented a `capacity:` sub-key under a provider entry (`retained_kib: 524288`). The real
  `server/config/api-limits.yaml` schema has no such key on any provider today — a retained-byte gauge is new
  work requiring new primitives (`reserveCapacityOrThrow` / `commitCapacityReservation` /
  `releaseCapacityReservation`), not an existing config shape to populate. See the canonical doc's §17.1.
- §7's YAML sample nested flags under a top-level `flags:` map (`flags:\n  itinerary_block_cache: false`).
  The real file's schema is flat, one top-level key per flag, each an `{ enabled, description }` object (see
  any existing entry, e.g. `itinerary_reactions`). See the canonical doc's §18 for the corrected shape.

If you're looking for the current design, implementation touchpoints, rollout plan, or definition of done,
read `itinerary-cache-schema.md`.
