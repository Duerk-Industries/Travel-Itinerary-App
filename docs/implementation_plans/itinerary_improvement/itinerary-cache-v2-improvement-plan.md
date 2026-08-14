# Itinerary Cache v2 — Improvement & Hardening Plan

This document extends and hardens the `itinerary-cache-schema.md` design with concrete implementation details for performance, cost-efficiency, and maintainability.

## 1. Performance & Caching Architecture

### 1.1 Tiered Cache Strategy
Implement a two-tier caching hierarchy to minimize DB overhead and latency.

- **L0 (Local LRU)**: In-process memory using `lru-cache`.
  - Capacity: 512 entries or 32 MiB.
  - TTL: 5 minutes.
  - Key: Hash of the canonical compatibility projection.
- **L1 (Durable Shared)**: Firestore (or Postgres) using the `itinerary_binding_plan_cache` schema.
  - Key: Opaque SHA-256 digest of the canonical projection.

### 1.2 Mean Vector Optimization
The global corpus mean vector is required for every mean-centered cosine calculation.
- **Implementation**: Pre-compute the mean vector during server startup and cache it in a singleton.
- **Refresh**: Re-compute automatically when a new `CorpusRelease` is promoted.
- **Benefit**: Reduces O(N) dimension sum to O(1) during selection, ensuring sub-millisecond selector performance.

### 1.3 JIT Compression
- **Policy**: Payloads > 8 KiB are compressed using `zlib.brotli` (or Gzip if Brotli is unavailable) before write.
- **Metadata**: Store a `compression: "br" | "none"` flag in the DB row.
- **Benefit**: Reduces storage cost and L1-to-App egress by up to 70% for large 31-day itineraries.

---

## 2. Cost Tracking & Minimization

### 2.1 Avoided Cost Metric
Track the economic ROI of the cache by recording the "Avoided Inference Tokens."
- **Calculation**: `Avoided_USD = (Baseline_Gen_Tokens * Price) - (Binding_Gen_Tokens * Price) - Cache_Ops_Cost`.
- **Reporting**: Roll up into the standard cost tracking system under a new `itinerary_cache_roi` provider.

### 2.2 ROI-Gated Writes
To prevent "Cache Pollution" (caching low-value, single-use keys), implement a repetition threshold.
- **Threshold**: Only write to L1 after the same canonical key has been requested **3 times** within 24 hours (tracked via a lightweight `itinerary_cache_demand` counter).
- **Exemption**: Prepopulated "Head" destinations (Top 20) skip the repetition check.

### 2.3 Token Budget Enforcement
Integrate with `usageLimiter.ts` to strictly enforce a `max_output_tokens: 300` limit for all Tier 1 binding calls.

---

## 3. Maintainability & Developer Experience

### 3.1 Unified Schema (Zod → JSON Schema)
Ensure TypeScript and the Python `corpus_tools.py` always share the same source of truth.
- **Action**: Define `ActivityBlock`, `LocationProfile`, and `DayTemplate` using Zod in `server/src/schemas/itineraryCacheSchemas.ts`.
- **Sync**: Add a build script `npm run sync-corpus-schemas` that exports these to `docs/implementation_plans/itinerary_improvement/schemas/*.json`.

### 3.2 Corpus Release Manifest
Every release must be immutable.
- **Format**: A signed JSON manifest containing the hash of every block and profile in the release.
- **Rollback**: To rollback, simply update the `ACTIVE_CORPUS_RELEASE_ID` pointer in `AdminSettings`.

---

## 4. Quality & Verification

### 4.1 "Gold Standard" Eval Set
Create a versioned JSON set of 50 diverse trip requests (e.g., "3 days in Lisbon, mobility limited, budget: tight").
- **CI Gate**: Every change to the selector logic must pass the `itinerary-eval-suite`, asserting:
  - 100% hard-constraint adherence (no hills for strollers).
  - >80% preference match (interest signature coverage).
  - <200ms latency for Tier 0/Tier 1 (deterministic).

### 4.2 Property-Based Testing
Use `fast-check` to assert invariants:
- "A block marked `closed_days: ['Monday']` is never selected for a Monday."
- "The total energy cost of a day never exceeds the template budget."

---

## 5. Security & Privacy

### 5.1 Private Overlay Isolation
- **Rule**: No private data (Account IDs, specific dates, traveler names) may ever enter the `buildCanonicalKey` function.
- **Validation**: Add a middleware check that throws if the canonical projection contains any field not on the allowlist.

### 5.2 Content Escaping
Treat all `copy.body` and `copy.insider_tip` as untrusted. The renderer must use a strict HTML escape (or Markdown safe-render) to prevent XSS from poisoned corpus entries.

---

## 6. Standard Limits (api-limits.yaml)

Add the following to the existing architecture:

```yaml
ITINERARY_CACHE:
  window: day
  windowHours: 24
  overall: 100000
  callers:
    BINDING_READ: 50000
    BINDING_WRITE: 5000
    CORPUS_PROMOTION: 100
    CAPACITY_GAUGE_RECONCILE: 1
  capacity:
    retained_kib: 524288 # 512 MiB platform ceiling
```

---

## 7. Feature Flags (feature-flags.yaml)

```yaml
flags:
  itinerary_block_cache: false             # Master
  itinerary_block_cache_reads: false       # Tier 0 enablement
  itinerary_block_cache_writes: false      # Write-through enablement
  itinerary_corpus_authoring: false        # Async authoring workers
  itinerary_cache_prepopulation: false     # Demand-driven batch planning
```
