# Itinerary Comprehensiveness — Phased Coding Plan for an LLM

This plan implements every recommendation in
[Itinerary Generator Improvement Plan](itinerary-improvement-plan.md) (§2–§10), together with the
current cost-focused follow-up recommendations in
[Itinerary Generation: Comprehensiveness Improvements](itinerary-improvements.md) (§2 and §5), plus
the CLI-only gold reference generator (§3) and the regression/quality gate (§6), in dependency
order. It follows the same phase/definition-of-done structure as
[getyourguide-coding-plan.md](getyourguide-coding-plan.md).

Each phase is independently shippable and independently revertible (config/flag-gated). **Do not
enable an optimization before the Phase 0A baseline and Phase 1 instrumentation exist** — the
evaluation harness establishes what “better” means and instrumentation is the prerequisite for
judging whether every later phase actually helped, per `itinerary-improvements.md` §5's own ordering
rule ("measure before spending").

## Non-negotiable rules

- Every new DB table/column must be implemented in `db.postgres.ts` **and** `db.memory.ts` (memory
  adapter spreads postgres, so new functions are usually free) and, if used outside tests, in
  `db.firebase.ts` too, per `CLAUDE.md`.
- Any external API call—including free Wikipedia/Wikimedia, Pageview, Open-Meteo, and paid routing—
  must be registered in `api-limits.yaml`, pass through the shared limiter, and record provider
  usage/cost before it ships. Free does not mean unbounded: the limiter protects quotas, retries,
  latency, and upstream goodwill. There must be no ad hoc `fetch` calls, per `CLAUDE.md` and the
  CountryNow/GeoNames gap fixed earlier in this project's history.
- No stage may silently degrade output without a metric recording *why* (token-capped,
  candidate-starved, provider-timeout, parse-failure) — Phase 1 exists precisely so every later
  phase has something to measure against.
- **Pipeline Versioning:** Increment `PIPELINE_VERSION` in `itineraryPromptPlanService.ts` when
  logic changes (clustering, chunking, escalation) to ensure metrics comparison integrity.
- Preserve the non-synthetic-data policy (`plan.md`): nothing added in these phases may let the
  model fabricate facts. Enrichment phases (2) *reduce* fabrication risk by substituting cached
  verified data; they must not introduce a new path for the model to invent content.
- All new config knobs (shortlist size thresholds, chunk-size threshold, model-escalation
  triggers) live in `api-limits.yaml`, following the existing `itineraryPlan`/`attractions`
  section conventions — never hardcode thresholds in service code.
- Every phase must keep `server/scripts/replay-itinerary-generation.ts` runnable end-to-end
  against `DB_PROVIDER=memory` so a developer can sanity-check behavior without live OpenAI/API
  keys where feasible (mock provider responses in that path already exist — extend, don't bypass).
- Log new stage-level events via `logInfo`/`logError` (`server/src/logger.ts`) — never
  `console.log`.
- Deterministic scheduling is authoritative. The LLM may select or explain only from feasible
  candidates supplied by code; post-processing must re-check hard constraints, time windows,
  mobility, booked transfers, and cache provenance before anything reaches the UI.
- Shared caches must contain only de-identified, reusable facts or skeletons. Never put exact home
  addresses, names, emails, medical/dietary notes, bookings, or private free-text preferences in a
  cross-user key/value. Personalized constraints are applied after a shared hit and final plans
  remain user/trip scoped.

## Current state (baseline, confirmed against code)

- p2 is one call for the whole trip, `max_tokens = max(1100, min(3500, duration*280))`
  (`itineraryPromptPlanService.ts:2376`).
- Shortlist injected into p2 defaults to 8 items/destination
  (`api-limits.yaml:281`, `attractionsCatalogService.ts:1164-1173`), weighted via
  `buildPodBasedShortlist` when `weights` is passed.
- `activityContext` enrichment from cached Wikipedia data is partially wired into p4 already (per
  the latest edit to `itinerary-improvements.md` §2.2) — Phase 2 below audits and completes this
  rather than building it from scratch.
- p3 (`itineraryStructureValidator.ts`) already grounds to shortlist, injects must-sees, enforces
  interest fairness and the 5-item/day cap, but has no fill-on-thin-day behavior and no re-prompt
  path.
- `runJsonStage` (`itineraryPromptPlanService.ts:2012-2087`) makes exactly one call per stage, no
  retry on parse failure.
- Day/route caching is trip-signature-scoped (`buildTripSignature`,
  `itineraryPlanCacheService.ts:44-52`), not a cross-user reusable fragment cache.

---

## Requirements coverage audit (must be resolved before implementation)

The original requirements plan is broader than the later token/comprehensiveness review. The
following items were missing or under-specified in the previous coding plan and are now mandatory:

| Requirements area | Previous coverage | Required implementation destination |
| --- | --- | --- |
| Phase 0A evaluation harness and preference contract | Missing as a named phase | Add versioned fixtures, provenance-aware precedence, group aggregation/fairness, baseline metrics, property tests, and metamorphic tests before optimization. |
| Coordinate/data foundation | Description enrichment only | Add cached Wikipedia coordinate/pageview enrichment, destination geocoding, popularity/primary-tag fields, daylight and climatology facts, and partial-coordinate fallback. |
| Deterministic ranker and geographic scheduling | Adaptive shortlist only | Add ranked candidate scoring, hub-and-spoke/linear trip recognition, pods, walkable cores, route-aware nearest insertion, bounded 2-opt/day swaps, and a time-dependent matrix. |
| Door-to-door travel | Mostly absent | Model origin/return, terminal access, lodging, inter-base legs, open-jaw comparison, time zones/overnight dates, fatigue, ranges/confidence, and generalized time/money friction. |
| Prompt/admin/UI follow-through | Prompt calls only | Add pod/logistics placeholders, stale-admin-override handling, p2/p4 prompt rules, overview UI fields, and browser verification. |
| Caching economics and privacy | Some cache TTL guidance | Add request coalescing, stale-while-revalidate, TTL jitter/capacity limits, dependency invalidation, privacy-safe keys, hit validation, and hit/repair savings metrics. |
| Personalization and travel-agent polish | Distributed or implicit | Enforce `ut.po`/`ut.mob` precedence in code, use `ut.i`, document `ut.eb`/`ut.no`, and test golden hour, market lunch, large-group transport, farewell night, and post-transfer rest. |
| API and admin accounting | Routing path covered; free APIs not explicit | Register every provider/caller—including free APIs—in limiter, cost estimator, admin view, retry policy, and tests. |

The implementation order below is therefore the authoritative mapping. The existing later phases
(targeted repair, chunking, selective escalation, fallback hardening, gold CLI, and quality gates)
remain useful extensions, but they must not be treated as substitutes for the missing core phases.

### Corrected phase mapping

1. **0A:** evaluation harness and preference contract.
2. **0:** cleanup and baseline token/cost assertions.
3. **1:** data integrity, enrichment, and instrumentation.
4. **2:** deterministic ranker, clustering, feasibility scheduler, and travel logistics.
5. **3:** prompt/orchestration/admin-override/UI integration.
6. **4:** layered caching, fragment reuse, invalidation, budget accounting, and shadow evaluation.
7. **5:** optional real routing verification and bounded API rollout.
8. **6–9:** the existing targeted repair, long-trip chunking, selective escalation, degraded
   fallback, gold CLI, and permanent regression-gate extensions.

Every corrected phase must have a flag, a rollback path, adapter parity where persistence is used,
focused tests, typecheck evidence, and a measured before/after comparison. Do not mark a phase
complete merely because its helper exists; prove that the helper is called by the live generation
path and that its output reaches the rendered itinerary.

## Phase 0A — Evaluation harness and preference contract

**Goal:** establish the baseline and enforce preference semantics before changing ranking or
generation behavior. This phase is required before optimization because later cost/quality claims
must be compared with deterministic, structured assertions rather than prose snapshots.

- Add versioned fixtures for single-city, multi-city, open-jaw and round-trip travel; late arrival,
  early departure, booked transfers, date-line/overnight legs, low mobility, families, large groups,
  conflicting preferences, strict budgets, must-sees, closures, missing coordinates, and repeat
  visitors.
- Implement a normalized preference contract with separate account, trip, traveler, inferred,
  hard-constraint, soft-interest, exclusion, must-see, budget, pace, accessibility, dietary, age,
  and group-size fields. Enforce precedence in code:
  `safety/accessibility/exclusions > trip choices > account defaults > inferred preferences`.
  Preserve provenance and emit conflicts/assumptions for user review.
- Aggregate travelers deterministically: hard constraints use the most restrictive applicable value;
  soft interests use an explicit aggregation plus a fairness floor. Reordering travelers must not
  change the result. Compute `mobMin` and ensure it is consumed by ranking, scheduling, and prompts.
- Establish baseline metrics before enabling improvements: must-see coverage, hard-constraint
  violations, weighted-interest coverage, duplicate rate, transfer minutes/day, schedule-window
  violations, arrival/departure feasibility, budget/free-item share, unsupported-fact rate, calls,
  tokens, estimated cost, and p50/p95 latency.

**Tests:** property-test timezone/date arithmetic and clustering invariants; add metamorphic tests
that traveler reordering is invariant, a stricter mobility constraint cannot increase walking, and
lowering budget cannot increase paid-item share except for an explicit must-see. Store structured
assertions and tolerances, not full markdown snapshots.

**Definition of done:** every fixture runs through the existing pipeline with deterministic provider
fixtures, baseline metrics are persisted or exported, and the normalized contract is used by p0–p4
without relying on model prose for precedence.

## Phase 0 — Cleanup, baseline, and metrics contract

**Goal:** remove obsolete prompt assets and lock down a shared `ItineraryGenerationMetrics` shape before any behavior changes, so
every later phase writes to the same record instead of inventing its own logging.

- Read the current state of `itineraryPromptPlanService.ts`, `itineraryStructureValidator.ts`,
  `attractionsCatalogService.ts`, `itineraryPlanCacheService.ts`, and `api-limits.yaml` end to end
  (they may have drifted further since this plan was written — verify line numbers before editing).
- Define `ItineraryGenerationMetrics` in `server/src/types.ts` (or a new
  `server/src/services/itineraryMetrics.ts` if it doesn't belong in the shared types file):
  per-stage prompt/completion tokens, latency, cache hit/miss, model/provider, empty/parse-failure
  flag, fallback-used flag, shortlist size actually used, requested-vs-represented interest tags,
  items/day array, unique attraction count, must-see recall, days-with-no-primary-activity count,
  transfer-conflict count, estimated cost (reuse `estimateAiCostMicros`/`estimateRequestCostMicros`
  from `providerBudgeting.ts` — don't reimplement pricing).
- Add a feature flag / env toggle (`ITINERARY_METRICS_CAPTURE`, via `getEnvFlag()`) gating whether
  raw prompts/responses are persisted (they must be redacted of personal data when captured — trip
  destinations/dates are fine, traveler names/emails are not).
- Remove or mark superseded dead prompt files only after verifying no runtime import references them.
- Add a token/cost assertion to an existing itinerary fixture. Treat `plan.md` guardrails as a
  monitored target, not an excuse to fail valid JSON solely because a descriptive field is longer;
  record the reason when a target is exceeded.

**Tests:** unit test the metrics struct's serialization and redaction function only — no
behavioral test yet, since nothing calls it. **Definition of done:** type/module compiles, has a
migration if persisted, no runtime behavior changed.

---

## Phase 1 — Data integrity, enrichment, and instrumentation

**Goal:** make the catalog and destination facts usable for deterministic planning while ensuring
every p0–p4 call populates `ItineraryGenerationMetrics` and persists one row per generation.

### 1A. Coordinate and destination enrichment

- Implement a provider-neutral `WikipediaGeocodingService` for coordinates and summaries. Use the
  existing Wikimedia limiter/caller and cache by canonical page/place identity and locale. Add
  Pageview enrichment only if the popularity signal is useful; it must be bounded, negative-cached,
  and registered in the limiter/admin cost view even though it is free.
- Enrich newly discovered attractions and destination/base localities, not every generation. Store
  `lat`, `lon`, canonical identity, timezone, source, confidence, retrieval time, and algorithm/data
  versions. Invalidate coordinates when the canonical identity changes.
- Add `popularity_score` and `primary_tag` only with a migration plus Postgres/Firebase/memory parity.
  If coordinates are missing, retain the candidate in a locality-name-only pod with an explicit
  `distanceUnknown` flag; never silently drop it.
- Add a pure daylight/climatology service (sunrise/sunset and destination-month seasonal note) and
  use the existing Open-Meteo integration for climate normals. Cache by destination/month/source
  version; do not present a climatology normal as a date-specific forecast.
- Add `calculateTransferBuffer(distance, groupSize, mobility)` and a destination-logistics helper
  that derives long-haul/timezone facts from coarse origin/destination data without placing exact
  home addresses in prompts or shared caches.

**Tests:** mocked Wikipedia/Pageview/Open-Meteo responses, limiter/cost-accounting assertions,
cache hit/negative-cache/identity-change tests, partial-coordinate retention, Paris-in-July
seasonal fixture, timezone/date-line/overnight arithmetic, and group-size/mobility buffer cases.

- Add a `itinerary_generation_metrics` table (new migration alongside `db.postgres.ts`, mirrored in
  `db.memory.ts`/`db.firebase.ts`) — or reuse `api_cost_counters`-style monthly rollup if per-call
  granularity isn't needed for the dashboard; per-call rows are useful for quality diagnosis and
  rollout analysis, while Phase 8's gold-vs-prod compare remains local-fixture based. Prefer per-call
  with a retention/cleanup job (reuse whatever pattern
  `api_cost_counters` already uses for retention, per `CLAUDE.md`'s "retains full monthly history"
  note — don't invent a new retention policy from scratch).
- Wrap each `runJsonStage` call site in `itineraryPromptPlanService.ts` to record: tokens (from the
  OpenAI response usage field), latency (wrap with `Date.now()` deltas already likely present near
  the provider-budgeting calls), cache hit/miss (the day/route cache already returns a hit/miss
  signal — thread it through instead of re-deriving it).
- Compute derived metrics (items/day, unique attractions, must-see recall, thin-day count) once at
  the end of the pipeline, after p3, from the final structure — don't duplicate this logic across
  stages.
- **Performance:** metrics capture must be O(days) at most and must not add a synchronous DB write
  on the request's critical path if it can be avoided. In Cloud Run/serverless environments,
  ensure the metrics write is awaited or handled by a reliable background task runner to
  prevent data loss upon process suspension.
- **Cost:** instrumentation has zero API cost; enrichment uses only bounded free/low-volume calls,
  with long-lived caching and negative caching so it is not paid or repeated per itinerary.
- **API accounting:** each enrichment caller has an `api-limits.yaml` entry, per-caller cap,
  retry/backoff policy, admin-console visibility, and cost-estimator coverage. Free calls still
  consume quota counters; no enrichment may bypass the shared limiter.

**Tests:**
- Unit: token aggregation across stages sums correctly; cache-key dimensions match
  `buildTripSignature`'s inputs; redaction strips PII fields; a forced parse-failure produces the
  correct fallback flag.
- Integration (`server/__tests__/`, `DB_PROVIDER=memory`): run a full mocked p0–p4 pipeline and
  assert exactly one metrics row is written with plausible values.
- Confirm metrics writing never blocks/fails the itinerary response even if the metrics DB call
  throws (inject a failing mock and assert the itinerary still returns).

**Definition of done:** every real and replay-script generation produces one metrics row; a manual
query can answer "was this trip token-capped, candidate-starved, or fine?" for any recent
generation.

---

## Phase 2 — Deterministic ranker, clusterer, and grounded descriptions

**Goal:** choose feasible, relevant candidates and geographically coherent day seeds in code, then
complete the `activityContext` contract so p4 renders cached Wikipedia/catalog facts instead of
LLM-recalled prose.

### 2A. Rank and cluster before p2

- Implement a pure ranker with hard filters first (exclusions, accessibility, booked/timed
  constraints, impossible windows), followed by relevance, must-see, traveler fairness, season,
  source confidence, popularity/crowd preference, geography, monetary cost, transit cost,
  uncertainty, and semantic-duplicate penalties. Keep score components and rejection reasons for
  metrics and UI explanations; do not hide a hard rejection as a low score.
- Apply budget-tier filtering before the LLM shortlist: budget trips should contain mostly free/low-
  cost choices with a small explicit splurge allowance; luxury trips may prefer premium choices but
  must retain a must-see/high-relevance exception. Test that budget constraints affect both ranking
  and the rendered cost explanation, not just a prompt adjective.
- Recognize hub-and-spoke versus linear/road-trip structure. Build neighborhood/along-route pods
  from geocoded candidates; keep an explicit locality-only fallback for ungeocoded items.
- Implement bounded day-sized scheduling: density/pod seed, nearest insertion, bounded 2-opt, and
  adjacent-day swap passes. Optimize lexicographically—hard feasibility, lateness/slack, excess
  travel, relevance, then monetary cost—rather than straight-line distance alone. Include visit
  duration, verified opening/last-entry windows, reservations, meals/rest, mobility walking speed,
  parking/mode changes, luggage, and uncertainty buffers.
- Identify walkable cores (≤800 m) and annotate walking transfers. Scale transfer buffers by group
  size/mobility. Pin photography-tagged candidates to a morning/evening slot only when the day is
  otherwise feasible; never let golden-hour polish violate a hard window.
- Build a bounded, time-dependent travel matrix. Reuse cached route cells where available and use
  conservative haversine/mode estimates otherwise. Version matrix and cluster keys by data,
  algorithm, mode, mobility, local-date/traffic bucket, and schema versions.
- Pass ordered labeled pods and logistics facts to p2 as hints; p2 may narrate and choose among
  them but p3 must revalidate. Feed computed transfer totals back as a repair trigger: replace an
  offending item with a same-pod candidate when a configurable relaxed-day threshold is exceeded.
- Retain one or two feasible nearby backups per day, including a lower-cost and indoor option when
  available. Record deterministic omission reasons (`closed`, `too far`, `availability unknown`,
  accessibility conflict, insufficient time, or no verified match) so p4/UI can explain omissions
  instead of silently substituting unrelated content.

### 2B. Travel logistics and feasibility

- Represent the complete chain `origin → departure terminal → entry hub → lodging/bases → exit hub
  → arrival terminal → return home`. Compare round-trip and open-jaw options using elapsed time,
  monetary cost, terminal access, connection risk, baggage/seat fees, parking/tolls, hotel-night
  impact, service frequency, and lost vacation hours; keep time and money visible separately.
- Use consented coarse home region/airport or the trip departure point only. Never put an exact home
  address in shared cache keys or LLM prompts. Preserve booked transfers as immovable constraints.
- Store instants plus IANA zones, local dates, overnight/date-line crossings, and elapsed duration.
  Use booked local arrival/check-in times when available. Add source, confidence, estimate ranges,
  and buffers for international terminals, ferries/borders, self-transfers, peak traffic, children,
  and reduced mobility.
- Add explicit arrival/departure rules: long-haul/three-time-zone arrivals allow at most one light
  activity and no evening item; the following day starts no earlier than 10:00; departure days
  reserve checkout/luggage/terminal buffers and prohibit new ticketed activities inside the
  configured safety window. Apply the fatigue accumulator and schedule a walking-only hub/rest day
  after excessive travel or a base change.

**Tests:** 20-attraction NYC pod separation (DUMBO vs Upper West Side), partial-coordinate retention,
walkable-core notes, deterministic ordering, no hard-window violations, route-matrix cache reuse,
hub/linear schedule fixtures, open-jaw selection, timezone/date-line arithmetic, fatigue/arrival/
departure rules, and generalized friction-score component calculations.

### 2C. Grounded descriptions and information density

- Audit the current `activityContext` wiring end to end (the doc notes this is "partially" done —
  find exactly which fields are populated vs. still LLM-authored).
- Ensure p2's contract stays: attraction reference (id/name) + a short "why it fits" line only —
  confirm `p2_days.md` doesn't ask for full descriptions; if it does, tighten the prompt.
- Build/complete the enrichment step that looks up `wikipediaSummary`, duration, price band,
  accessibility flags, and (once available) the GYG deep link, keyed by attraction ID + locale.
- Add a **cache hierarchy** exactly as scoped in §5.2: normalized descriptions cached by attraction
  ID + locale with a version/freshness stamp, negative-caching for lookups that failed (short TTL,
  so a transient Wikipedia outage doesn't get permanently cached as "no data"). Reuse whatever
  cache-table/TTL pattern `attractionsCatalogService.ts` already uses (`refreshDays`,
  `promptBlobRefreshDays` in `api-limits.yaml`) rather than inventing a new caching mechanism.
- **Maintainability:** Add a manual cache-invalidation trigger (e.g., in `attractionsCatalogService.ts`)
  to allow operators to bust the `activityContext` cache for a specific attraction or destination
  without a code deploy.
- Update `p4_render_md.md`'s system prompt to explicitly forbid replacing a populated
  `activityContext` fact with invented prose (the doc's §1 already flags this as the key risk).
- **Performance:** enrichment lookups must be batched (one query for all attraction IDs in a trip,
  not N+1 per activity).
- **Cost:** this phase should *reduce* completion tokens (p2/p4 write less prose) — track this via
  Phase 1's metrics before/after to confirm the intended savings materialize.
- **Usability:** verify in a manual web run that rendered activity cards show real Wikipedia-backed
  text, not truncated JSON or "undefined".

**Tests:**
- Unit: metadata precedence (verified field wins over any LLM-authored text if both are present),
  stale-but-labeled serving, negative-cache expiry, locale fallback (e.g., no `fr` summary falls
  back to `en` with a flag, not silently blank).
- Integration: p4 output for an attraction with full cached data vs. one with none (must degrade to
  the existing generic-but-honest fallback, not a placeholder or blank card).
- Regression: confirm no existing itinerary-rendering test currently asserting on old LLM-prose
  behavior breaks silently — update fixtures deliberately, don't let them bit-rot.

**Definition of done:** `activityContext` is fully sourced from cached verified data wherever
available; completion-token metrics show a measurable drop; no UI shows a raw provider placeholder
or empty card when enrichment data is missing (ties into Phase 7's fallback rules).

---

## Phase 3 — Prompt, orchestration, personalization, and UI integration

**Goal:** deliver the deterministic facts and preference decisions to p0–p4 and the user-facing
overview, while raising shortlist size only for trips that need it.

### 3A. Prompt and admin-override compatibility

- Update p2 to accept `{{ATTRACTION_PODS}}`, `{{LOGISTICS_FACTS}}`, seasonal notes, fatigue state,
  and compact preference provenance. Instruct it to complete a pod before changing neighborhoods,
  avoid distant mixing, respect arrival/departure limits, and use golden-hour, market-lunch,
  large-group transport, farewell-night, and rest-after-transfer guidance only when feasible.
- Update p4 to render “Why this fits your group,” source/confidence-aware descriptions, transfer
  logistics, estimate labels, alternatives, and omission reasons. Verified metadata wins over model
  prose; no unsupported superlatives, exact hours, prices, named businesses, or invented schedules.
- Make `applyTemplate` treat missing new placeholders as empty safe defaults. Audit stored
  `itinerary_generation_instruction_documents` overrides before rollout, report stale overrides to
  admins, and provide a re-sync/preview path. Never send literal unresolved `{{TOKEN}}` text to a
  model. Test an old admin p2 override and an override that omits only one optional block.
- Enforce account/trip/traveler precedence in code after model output (`sanitizeNorm`), not only in
  p0 instructions. Use `ut.i` to bias tie-breaking and must-see-adjacent candidates; explicitly
  document and test the meaning of `ut.eb` and `ut.no` in p2.

### 3B. UI follow-through

- Trace the actual rendering path in `app/tabs/overview.tsx` for `ItineraryGeneratedActivity` /
  `generatedItems` (do not assume an `itineraries.tsx` file exists). Add distinct, accessible UI
  treatment for fit rationale, logistics/estimated labels, walking/mobility caveats, alternatives,
  and omitted must-see explanations without exposing internal provider names or raw errors.
- Verify long descriptions wrap correctly, missing metadata remains honest and non-blank, and
  stale/degraded results are visibly labeled. Run a browser smoke check with `expo start --web`;
  unit tests alone are insufficient for this phase.

### 3C. Adaptive shortlist and validation contract

- Add config-driven thresholds to `api-limits.yaml` under the `attractions` section:
  `shortlistPromptItemsPerDestination` stays 8 as the floor; add
  `adaptiveShortlistMax` (12, hard ceiling 15) and the trigger conditions (trip length > 7 days,
  multiple destinations, ≥5 high-weight interests, or a first-pass coverage-threshold miss).
- Implement the coverage check: after building the base 8-item shortlist, compute whether the
  traveler's top interest weights are represented (reuse `interestTags` already on each catalog
  entry) — if under-represented, rebuild with the higher cap.
- Audit every call site of `getAttractionPromptBlockForDestinations` (the doc explicitly flags this
  as unverified) — add a lint-level assertion or a runtime warning log if `params.weights` is ever
  undefined from a real (non-test) call path, since that's a silent quality regression today.
- Cache the resulting compact prompt blob keyed by destination + locale + catalog version +
  shortlist policy (base-8 vs adaptive-N), so repeated requests with the same policy don't
  rebuild/re-score the shortlist.
- **Cost:** only pay the larger input-token cost when the trigger conditions are true — validate
  via Phase 1 metrics that the *average* shortlist size across real traffic barely moves, since
  most trips should stay at 8.
- Extend the deterministic validator with must-see coverage/omission reasons, high-weight interest
  coverage flags, required meal-slot/code checks (including the three-meal contract where requested),
  item-cap checks, arrival/departure/jet-lag rules, category-level
  Sunday/Monday closure warnings, and budget-tier coherence. A warning must be surfaced as a
  repair candidate or user-facing assumption; it must not silently disappear.
- Cap new prompt blocks to preserve token guardrails (for example, only eligible pods for the
  current day, no more than four names per pod, and at most three short logistics lines). Update
  `plan.md`'s token table in the same change and record block truncation as a metric.

**Tests:**
- Fixtures: 1-day, 7-day, 14-day, and multi-destination trips. Assert: short/simple trips stay at
  the 8-item default (no extra tokens spent); long/multi-destination/high-interest-count trips
  reach the adaptive cap; weighted-interest recall improves versus the fixed-8 baseline; shortlist
  ordering is deterministic given the same inputs (no flaky test from non-deterministic sort).
- Regression test asserting `params.weights` is passed at every real orchestration call site (fail
  the build if a new call site omits it without an explicit opt-out).

**Definition of done:** shortlist size adapts per the documented trigger rules, average shortlist
size in production metrics stays near 8, and weighted-interest coverage measurably improves on the
long/multi-destination fixture set.

---

## Phase 4 — Cache economics, fragment reuse, and targeted repair

### 4A. Layered cache and budget policy

Implement layered caches with request coalescing and negative caching for raw provider responses,
canonical identities, coordinates/time zones, descriptions/facts, route-matrix cells, ranked
candidate sets, route skeletons, and validated day pods. Use stale-while-revalidate only for safe
facts, TTL jitter to avoid refresh storms, bounded capacity/eviction, and short negative TTLs.
Every entry records source, retrieval/expiry, locale, confidence, and data/schema/algorithm versions.

- Shared route skeleton keys may include sorted destinations, duration bucket, pace, comfort,
  mobility class, car, interaction style, and entry/exit hub; private must-sees and bookings remain
  outside shared keys and are injected afterward. User/trip-specific hard constraints require a
  private cache or a validated post-hit projection.
- Cache route-matrix cells and cluster results independently so one changed attraction or booking
  invalidates only affected days. Maintain dependency edges from catalog identity/version to pods,
  route fragments, and rendered context. Add operator invalidation by attraction/destination and
  algorithm version.
- Validate every cache hit with cheap hard-constraint, preference, destination, and freshness checks.
  Track hit, stale-hit, coalesced-request, saved-call/token, post-hit-repair, and invalidation
  rates. A cache hit that frequently repairs is not counted as a successful saving.
- Run the mechanical p3 checks first (continuity, item caps, meal codes, locality drift, timing,
  destination, and hard constraints). Skip the LLM p3 call when the result is already valid; invoke
  it only for an actual unresolved violation or uncertain confidence, and record the skipped-call
  reason and savings.
- Wire actual itinerary token usage into the existing monthly cost counter and alert thresholds.
  Add per-generation and per-user budget caps with a graceful deterministic fallback when a cap is
  reached; do not silently bypass the limiter. Shadow planning must be opt-in/percentage-gated,
  sample control and improved outputs, and keep judge calls separately rate/cost-limited.

**Tests:** same-trip cross-user route hit with different must-sees, misses for comfort/pace/mobility
changes, coalesced concurrent misses producing one provider call, stale-while-revalidate behavior,
negative-cache expiry, dependency invalidation, privacy-key assertions, cost-counter updates, and
budget-cap fallback.

### 4B. Deterministic fill + one targeted repair (§5.4)

**Goal:** thin days get filled from already-fetched data before any new LLM call, and at most one
small repair call happens only when deterministic fill can't resolve it.

- In `itineraryStructureValidator.ts` (or a new `dayFillService.ts`), add a
  deterministic fill step: for any day under ~2 items:
  - **Priority 1 (Must-See Recovery):** Pull unused `req.ms[]` items for the same destination
    that were missed by the LLM.
  - **Priority 2 (POD Proximity):** Pull the next-best unused shortlist item from the same
    geographic pod.
  - Respect opening hours, travel time, rest-day rules, and the existing 5-item cap. Zero token cost.
- Only if deterministic fill can't find a viable candidate...
- Enforce a hard cap of one repair attempt per generation; on failure, fall back to the
  deterministic (possibly still-thin) itinerary rather than looping.
- **Performance:** deterministic fill must run in the same request as p3 (no extra round trip);
  the optional repair call adds at most one additional OpenAI round trip, only when needed.
- **Cost:** track via Phase 1 metrics what fraction of generations actually need the repair call —
  this becomes the ongoing cost signal for this phase.

**Tests:**
- Malformed JSON, empty p2 output, missing must-see, duplicate attraction across days, opening-hour
  conflict, provider timeout during the repair call — each must resolve to either a successfully
  filled day or a valid deterministic fallback, never a thrown error surfaced to the user.
- Assert the repair call fires at most once per generation even when multiple days are thin
  (batch them into the single repair prompt, don't loop per-day).

**Definition of done:** thin-day rate (from Phase 1 metrics) drops without a proportional rise in
OpenAI call volume; no generation can loop indefinitely on repair.

---

## Phase 5 — Optional real routing API and long-trip chunking

### 5A. Bounded routing provider (verify existing implementation before changing it)

The requirements plan marks the Google Routes seam as implemented. Do not reimplement it or add a
second routing client. Verify `DirectionsApiTransferEstimator` is provider-neutral, feature-flagged,
and requests only high-impact inter-base or schedule-changing edges—not an attraction cross-product.
Confirm `GOOGLE_ROUTES` has overall and per-caller limiter caps, admin-console visibility, cost
estimator accounting, requested-field minimization, timeout/retry budgets, and heuristic fallback
for missing keys, quota blocks, network errors, and malformed responses. Free haversine estimates
remain the default when the feature flag is off.

**Tests:** successful mocked response, feature-off no-network path, missing-key/network/rate-limit
fallbacks, per-element cap enforcement, inter-base priority selection, route-matrix cache reuse,
and source/confidence/range propagation into logistics notes. Run the existing
`transferEstimationService.test.ts` before modifying implementation.

### 5B. Long-trip chunking (§5.5, §2.3)

**Goal:** trips ≥8 days (or whose p2 input-token size crosses a measured threshold) get generated
in 2–3 day windows instead of one shrinking-budget call.

- Add the chunking loop to `itineraryPromptPlanService.ts`: split days into windows, share the same
  `p1_route` skeleton and traveler contract across windows, give each window its own
  `max_tokens` allowance (recompute per-chunk size explicitly).
- **State transfer between chunks is mandatory:**
  - `used_attraction_ids`: to prevent duplicates.
  - `narrative_continuity_context`: A 1-sentence summary of the previous chunk's "emotional state"
    (e.g., "The group ended Day 3 feeling energized and ready for the mountains").
- Merge chunk outputs into one day array before handing off...
- Only trigger chunking for trips meeting the length/multi-destination/token-threshold criteria;
  short trips keep the current single call (verify via Phase 1 metrics that short-trip token usage
  is genuinely fine before excluding them).
- **Cost:** chunking increases prompt-token cost (repeated shared context per chunk) — quantify
  this via Phase 1 metrics on the fixture set and confirm it's smaller than the quality gain from
  eliminating terseness.
- **Caching:** chunk-level results should still be cacheable under the existing trip-signature
  cache (`buildTripSignature`) — cache per full merged day-set, not per chunk, to avoid cache-key
  explosion; `buildDayFragments`'s existing chunk-by-3 storage format may already fit this.

**Tests:**
- Golden test on a 14-day, 3-destination fixture: stable day numbering, no duplicate attraction IDs
  across chunks, preserved destination transitions at hub-change boundaries, correct
  arrival/departure buffers, exactly one p3 validation pass over the merged result (not one per
  chunk).
- Confirm a short (≤7 day) single-destination trip is untouched — same call count, same cache
  behavior as before this phase.
- Token-budget regression test: assert per-day completion-token share no longer shrinks below the
  documented ~600/7-days target for a 14-day trip.

**Definition of done:** long-trip descriptive density (items/day, non-truncated logistics notes)
matches short-trip density in Phase 1 metrics; no duplicate attractions across chunk boundaries in
the fixture suite; short trips show zero behavior change.

---

## Phase 6 — Selective model/API escalation (§5.6)

**Goal:** spend a stronger model or an extra provider call only where metrics justify it — never as
a blanket default.

- Add escalation triggers (config-driven, `api-limits.yaml`): long trip, many destinations, low
  shortlist coverage (from Phase 3's coverage check), or a Phase 4 repair failure.
- When triggered, use the existing `FEATURE_MODEL_ENV_KEYS`/per-feature override mechanism
  (`aiProviderConfigService.ts`) to run *only the affected p2 chunk* on a stronger model
  (`gpt-4o`/`gpt-4.1`) — p0/p1/p3 stay on the cheap model always.
- If routing/weather data is genuinely missing (not just uncached), call the existing provider
  once, cache the normalized result under the same cache-hierarchy rules as Phase 2, and apply a
  deterministic distance/climate fallback if the provider is unavailable. **Do not add a new
  external API** for this — reuse whatever provider integration already exists per
  `server/src/apis/`.
- Any new or newly-triggered provider call must be registered with `reserveApiUsageOrThrow`,
  `recordProviderRequestCost`, the cost estimator (`costEstimatorService.ts`), and surfaced in the
  admin Cost Estimator tab before this phase ships — per `CLAUDE.md` and the project's own prior
  CountryNow/GeoNames gap-closure precedent.
- **Cost:** this is the most expensive phase per generation it triggers on — gate it behind Phase 1
  metrics showing the trigger conditions are both rare and correlated with real quality loss before
  enabling in production; ship behind a feature flag defaulting to off, flip on for a % rollout.

**Tests:**
- Unit: trigger-condition logic (long trip, low coverage, repair failure) fires/doesn't fire
  correctly on fixtures.
- Integration: escalated call uses the stronger model only for the flagged chunk, confirmed via a
  mock provider call assertion (not a live API call in tests).
- Cost-estimator test: the new/escalated call path is reflected in projected-cost calculations
  (extends existing `AdminTab.CostEstimate` test coverage).

**Definition of done:** escalation fires only on flagged trips in the fixture suite; cost estimator
and admin dashboard reflect the new spend category; feature flag allows instant rollback to
mini-only.

---

## Phase 7 — Clean offline/degraded fallback (§5.7)

**Goal:** any provider outage (OpenAI, routing, catalog, web enrichment) degrades to a grounded,
honest itinerary — never a placeholder, blank card, or raw error.

- Audit every new code path introduced in Phases 2–6 for a failure branch: enrichment lookup
  failure → generic-but-honest description (already partly required by Phase 2); routing/weather
  provider failure → deterministic distance/climate fallback (Phase 6); chunk call failure →
  deterministic fill only, no infinite retry; repair-call failure → deterministic fallback (Phase
  4 already specifies this — verify it holds after Phases 5/6 are layered on top). A p4 render
  failure must fall back to the existing markdown renderer/fallback rendering path, not trigger a
  second full generation attempt.
- **Usability:** If a specific chunk in a chunked generation (Phase 5) fails, re-render the
  trip immediately with best-effort deterministic fill for the missing days. **Never show
  a partial "Error: Day 4-6" card to the user.**
- Explicitly test the "everything is down" case: OpenAI unreachable entirely — confirm the existing
  deterministic/grounded fallback (whatever mechanism currently backs p2 failure) still produces a
  usable itinerary end to end, and the UI shows no GetYourGuide-style placeholder or raw error text
  (mirrors the fallback requirement already established for the GYG integration plan).

**Tests:**
- Simulate each provider being down independently and all-down simultaneously; assert a valid
  itinerary is always returned and no fallback text mentions an internal error code or shows an
  empty enrichment card.
- Confirm degraded-mode itineraries are labeled as estimated (per §5.7's "explicit 'estimated'
  travel labels") so users aren't misled into thinking degraded output is fully verified.

**Definition of done:** full outage simulation across every dependent provider still returns a
usable, clearly-labeled itinerary; no UI placeholder/error leakage anywhere in the pipeline.

---

## Phase 8 — Gold reference CLI generator (§3)

**Goal:** a `--gold` flag on `server/scripts/replay-itinerary-generation.ts` that produces a
high-effort reference itinerary for a given trip spec, plus a `--compare` mode — CLI-only, per the
original ask; no server route, no admin UI, no scheduled job in this phase.

- Implement the six gold-mode overrides exactly as scoped in §3: stronger model (env override, no
  new code), full shortlist (~20), forced chunking (Phase 5's chunker regardless of trip length),
  doubled `max_tokens` per stage, all caching bypassed (`noCache: true` threaded through
  `writeItineraryPlanCache`/`readItineraryPlanCache` call sites from Phase 1–5's work), and Phase
  2's enrichment applied.
- Write fixture output to `server/__fixtures__/gold/<trip-spec-id>.json` alongside the trip spec.
- Implement `--compare <trip-spec-id>`: run the *unmodified* production pipeline for the same spec,
  diff against the stored gold fixture using:
  - structural checks reused from `itineraryStructureValidator.ts` (no duplicated diff logic),
  - coverage (fraction of gold attraction IDs present in production output) — deterministic, no
    extra LLM call,
  - an explicitly-gated `--judge` mode (separate flag) for an LLM-scored relevance/comprehensiveness
    comparison — never runs by default, never in CI.
- **Deferred, not in this phase:** the doc's later edit proposes a `gold_comparison_results` DB
  table feeding an "Executive Dashboard." This conflicts with the original "CLI-only for now"
  scope and should **not** be built in this phase — keep gold-run output as local fixture files
  only. Revisit the DB/dashboard version as a separate follow-on plan once the CLI tool has proven
  useful in practice, and only with explicit sign-off, since it turns a zero-cost dev tool into a
  persisted, potentially cost-incurring feature.
- **Cost/maintenance:** gold runs are intentionally expensive per-trip — document in the script's
  `--help` output that this must never run in a per-PR CI job; keep it to on-demand or a slow
  nightly job over the fixed fixture set from Phase 9.

**Tests:**
- Script-level test (can run against `DB_PROVIDER=memory` with a mocked stronger-model provider
  response) confirming `--gold` actually applies all six overrides (assert on the request params
  sent to the mocked provider, not just that the script exits 0).
- `--compare` output format test against a hand-built gold fixture + a hand-built production
  fixture with a known coverage gap, asserting the reported percentage matches.

**Definition of done:** `--gold` and `--compare` work end-to-end against the in-memory DB with
mocked providers; running them never touches production cache or cost-estimator counters; the
`--judge` path is opt-in only.

---

## Phase 9 — Regression/quality gate and rollout (§6.6)

**Goal:** a small, permanent fixture set that every phase above must not regress, plus the staged
rollout order.

- Build the fixture set: short city break, long (14+ day) trip, multi-city trip, outdoor/seasonal
  trip (exercises the climatology-alignment note in §2's "Strategic Nuance" item), and an
  accessibility/budget-constrained trip.
- For each fixture, track over time (via Phase 1's metrics table): coverage, feasibility
  (opening-hour/travel-time conflicts), unsupported-fact rate, parse/repair rate, token cost, p95
  latency.
- Include arrival/departure feasibility, timezone/date-line correctness, budget/free-item share,
  unknown-coordinate retention, cache hit/stale/repair savings, source/confidence completeness,
  and hard-constraint violations in the quality gate.
- Enforce coverage on changed modules, not only aggregate project coverage: exercise success,
  timeout, quota, malformed-data, stale-cache, partial-coordinate, privacy, and fallback branches;
  require branch coverage for pure ranker/scheduler/cache-key functions and do not lower or inflate
  the global threshold to hide untested paths.
- Wire this into CI as a scheduled (not per-PR) job — mocked-provider runs can be per-PR; anything
  hitting real OpenAI stays nightly/on-demand, consistent with Phase 8's cost note.
- Gate production-default changes (e.g., flipping the adaptive-shortlist or chunking thresholds)
  behind this fixture suite showing no regression in must-see recall or transfer conflicts, per the
  doc's explicit requirement.
- Require a predeclared improvement threshold before rollout: initially target at least 20% lower
  median intra-day transfer minutes with no more than 2% relevance regression, no increase in
  unsupported facts, and no increase in p95 cost. Tune only from measured baseline data; never
  weaken a failing gate silently.
- Treat user outcomes—saves, replacements/deletes, regenerations, must-see retention, manual time
  edits, and explicit ratings—as additional signals. Do not optimize only for an LLM judge.

**Rollout order** (authoritative corrected phase mapping):
1. Phase 0A/0 (fixtures, preference contract, cleanup, and baseline) — ship first.
2. Phase 1 (data enrichment plus instrumentation) — ship before optimization.
3. Phase 2 (deterministic ranker/clusterer, travel feasibility, and grounded descriptions) —
   near-zero generation cost when cached.
4. Phase 3 (prompts, admin overrides, UI, adaptive shortlist, and validator contract).
5. Phase 4 (cache economics and bounded fill/repair) — validate savings before widening reuse.
6. Phase 5 (routing verification and long-trip chunking) — measured cost increase only where needed.
7. Phase 6 (selective model escalation) — only after 1–5 are measured and shipped; the most
   expensive lever, enabled last and behind a rollout percentage.
8. Phase 7 (fallback hardening) runs in parallel with 2–6, since every phase adds a new failure
   mode that needs a fallback branch.
9. Phase 8 (gold CLI) can be built any time after Phase 2 (needs enrichment to be representative)
   and Phase 5 (needs chunking to avoid the terseness trap in gold output) — it is a dev tool, not
   gated by production rollout.
10. Phase 9's fixture suite should exist by Phase 0A at the latest, so Phases 1 onward are already
   measured against it.

**Definition of done:** fixture suite runs on a schedule, dashboards/logs show the metrics listed
above trending in the right direction after each phase ships, and no phase's production flag was
flipped to 100% without a clean fixture-suite run backing it.

---

## LLM execution loop

For each phase above:
1. Re-read the actual current state of every file the phase touches — line numbers in this plan
   and in `itinerary-improvements.md` were correct at time of writing but the codebase has already
   drifted once during this project; verify before editing.
2. Implement behind a config flag/threshold default that preserves current production behavior
   until explicitly enabled (per Phase 9's rollout order).
3. Add/extend tests per the phase's test list; run the full server suite
   (`DB_PROVIDER=memory npx jest --config jest.projects.js --runInBand`) and `npx tsc --noEmit`
   before considering the phase done.
4. Update `itinerary-improvements.md` and this plan if implementation reveals the original scoping
   was wrong (e.g., a line-number reference drifted, or a proposed cache key needs an extra
   dimension) — keep docs and code in sync rather than letting the doc rot, per this project's
   established pattern of periodic "verify doc against code" passes.
5. Report metrics deltas (from Phase 1 onward) in the PR description so the next phase's "measure
   before spending" gate has real data to act on.

## Final definition of done

- Phases 0A–9 are shipped or explicitly deferred with a documented reason; each shipped phase has
  a flag/rollback path, passing unit/integration tests, adapter parity, and no server typecheck
  errors.
- Metrics show, versus the Phase 0A baseline: improved must-see and weighted-interest coverage,
  fewer hard travel/constraint violations and thin days, lower or bounded completion-token spend,
  stable average shortlist size, reduced feasible transfer minutes, bounded repair-call rate,
  long-trip density matching short-trip density, and rare/justified model-escalation triggers.
- Phase 7's full-outage simulation passes with no placeholder/error leakage.
- Phase 8's `--gold`/`--compare` tooling runs entirely offline-safe (mocked) in CI and is
  documented as never running in a per-PR job.
- Phase 9's fixture suite is the standing regression gate for any future itinerary-pipeline change,
  not just this plan's phases.

## Implementation status (2026-07-14)

The phased work is implemented on the `Itinerary-Rework` branch and remains
rollback-safe through feature flags and `api-limits.yaml` values. The final
pass added per-generation de-identified metrics persistence with Postgres,
Firebase, and memory-adapter parity; long-trip chunking and clean validation
short-circuiting; selective escalation; degraded rendering; gold fixture
output; and a scheduled mocked quality-gate workflow.

Focused regression coverage for the new services passes, and server typecheck
passes. Escalation remains disabled by default (`escalationEnabled: 0`) and
gold `--judge` is an explicit reserved hook. The existing capture contract
continues to propagate an early p0–p3 provider failure, while p4/render and
chunk/repair failures use grounded deterministic fallbacks. An all-provider
outage mode can therefore be enabled later behind a separate flag without
changing the default error semantics.

The scheduling/logistics audit also closed two previously incomplete seams:

- adjacent-day swaps now normalize catalog destination keys, preserve the
  moved activity's time slot (with an evening-cap guard), avoid terminal/rest
  days, and are covered by live-path scheduling tests;
- route requests carry a consented coarse home/return airport or region,
  compare round-trip versus open-jaw home-terminal legs, and inject only a
  non-PII routing note into logistics prompts. Airport coordinates come from
  the bundled dataset; exact home addresses are not accepted or cached.
