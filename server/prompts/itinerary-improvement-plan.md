# Itinerary Generator Improvement Plan

Back to: [Prompt Assets README](README.md) · [Prompt Plan](plan.md)

This document reviews the current p0→p4 LLM itinerary pipeline and proposes concrete improvements
for relevance, geographic/timing clustering, travel-time realism (including arrival/departure legs),
cost control via caching, richer descriptions, and deeper personalization. It closes with a phased
implementation + test plan written for an LLM (or engineer) to execute directly.

## 1. Current-state assessment (grounded in code, not assumptions)

**Pipeline:** `p0_norm` → `p1_route` (bases/transfers) → `p2_days` (daily content) → `p3_validate`
(repair) → `p4_render_md` (optional), orchestrated by
[`itineraryPromptPlanService.ts`](../src/services/itineraryPromptPlanService.ts) using
`gpt-4o-mini` ([`openaiCallers.ts:8`](../src/apis/openaiCallers.ts)) — already the cheap-model choice
the plan intends. Templates are hot-editable via `itineraryInstructionService.ts` (admin-overridable
markdown, DB-backed).

**What's already good and should be preserved:**
- Attraction catalog with SerpAPI+Wikipedia discovery, DB+CSV persistence, 365-day refresh default,
  budget-tier-aware prompt blocks, and content-hash'd prompt-blob caching
  ([`attractionsCatalogService.ts`](../src/services/attractionsCatalogService.ts)).
- Real (non-fabricated) attraction descriptions via Wikipedia REST summaries, cached 60 days, plus
  heuristic duration/pre-order-ticket inference
  ([`attractionDurationEstimationService.ts`](../src/services/attractionDurationEstimationService.ts)).
- A haversine-based, mobility-aware transfer time/mode estimator for *consecutive same-day* attractions
  with known coordinates ([`transferEstimationService.ts`](../src/services/transferEstimationService.ts)),
  already used to compute per-activity start times and duration notes
  (`attachAttractionMetadata` / `mapItems` in `itineraryPromptPlanService.ts:1519-1687`).
- A real-routing seam (`DirectionsApiTransferEstimator`) already stubbed behind a feature flag
  (`attractions_transfer_directions_api`) — not implemented, but the integration point exists.
- Strong non-synthetic-fact guardrails baked into every prompt (no invented prices/hours/train numbers).

**Concrete gaps this plan targets:**
1. **Clustering is one-directional.** `p2_days` picks and orders activities with zero geo-awareness;
   the haversine transfer estimator only runs *after* the LLM has already committed to a day's lineup
   (`attachAttractionMetadata`), so it can report "47 min taxi between these two" but never feeds that
   back to re-cluster or re-order. There's no day-plan geo-cost function driving the LLM's choices.
2. **Attraction coordinates are usually empty.** The catalog schema has `lat`/`lon`/`qid`/`sitelinks`
   columns, but the discovery pipeline (SerpAPI organic results + Wikipedia search) never populates
   them — neither source returns coordinates. So the geo-clustering infrastructure that *does* exist
   has little data to work with in practice.
3. **Inter-base/city travel time is pure LLM guesswork.** `p1_route` uses a text-only distance-band
   heuristic table (`plan.md` §"Plan-only routing heuristics") that lives only in the plan doc as
   guidance for a human/orchestrator, but is never actually computed in code — the model just
   "reasons" about it. No real distance is computed even though bases with known localities could be
   geocoded once and cached.
4. **No explicit arrival/departure-day pacing rules.** `p2_days.md` rule 2 only says "transfer days:
   keep plans light" — there's no distinction between a long-haul arrival day (jet lag, immigration,
   check-in friction) and a same-country repositioning day, and no explicit last-day rule for
   packing/checkout/airport buffer.
5. **Per-traveler needs aren't reconciled.** `req.p[]` carries each group member's individual traits,
   but no prompt instructs the model to reconcile conflicting needs (e.g., one low-mobility traveler in
   an otherwise "High mobility" group). Only trip-level `tt.mob` and a single user's `ut.mob` override
   are consulted (`p0_norm.md` rule 2).
6. **No cross-user reuse of expensive stages.** Every generation re-runs all 4–5 OpenAI calls even when
   another user requested a near-identical trip (same destinations, similar dates/duration, similar
   traits). The attraction catalog is shared/cached; the route skeleton and day-content are not.
7. **Budget is a soft signal only in catalog tiering**, not something the model paces against or the
   validator checks for coherence (e.g., a "Budget" comfort trip shouldn't skew toward `premium`-tier
   attractions across the whole trip).

---

## 2. Relevance & comprehensiveness of suggestions

Before ranking attractions, build a deterministic **preference contract** used by every later stage.
Keep account defaults, trip overrides, traveler-level hard constraints, soft interests, exclusions,
must-sees, budget, pace, accessibility, food needs, ages, and group size as separate fields rather than
flattening them into one trait list. Apply this precedence in code:

`safety/accessibility and explicit exclusions > trip-specific choices > account defaults > inferred preferences`.

An explicit trip preference may override an account default, but must never override another traveler's
hard accessibility, dietary, or safety constraint. Preserve provenance (`account`, `trip`, `traveler`,
`inferred`) so the UI can explain why an item was selected and cache keys contain only dimensions that
materially affect the cached stage.

- **Reconcile group traits using a Fairness Floor.** Extend `p0_norm` to fold `req.p[].t` (per-
  traveler tags) into the normalized output. Instead of averaging preferences (which yields a
  mediocre "beige" trip), ensure every day has at least one "High Relevance" item for each traveler's
  primary interest, or rotate "Specialty Days" across the trip. Compute a `mobMin` (most restrictive
  mobility across the group) that `p2_days` must respect. **Reuse, don't reinvent:** the codebase
  already has a force-inclusion pattern for this exact shape of problem —
  `forceInjectTopAttraction`/`enforceShortlistGrounding` in `itineraryPromptPlanService.ts:1072-1191`
  deterministically guarantees top-ranked shortlist items appear even if the LLM's output drifted.
  Generalize that pattern (currently keyed only on destination) to also key on
  per-traveler primary-interest tag, rather than building a separate fairness mechanism from scratch —
  a weighted ranker score alone (§9's `FairnessRanker`) does not *guarantee* a floor, it only biases
  toward one; the floor has to be a deterministic post-hoc check-and-inject pass like the existing one.
- **Crowd Aversion bias.** Check account/trip preferences for "Off-the-beaten-path" vs "Must-sees." If
  "Avoid Crowds" is active, bias the ranker toward lower-popularity catalog entries or suggest "Early
  Bird" slots for iconic sights.
- **Must-see attraction coverage audit.** `p3_validate` currently only checks structural correctness. Add
  a check: every `req.ms[]` (must-see) item that has a catalog match should appear in `dy[]` at least
  once; log (not silently drop) any that don't fit so the orchestrator can surface it to the user rather
  than the itinerary quietly omitting a requested must-see.
- **Interest-weight coverage check.** Add a `p3_validate` pass that tallies activity tags actually used
  against `norm.w` targets (the "loose frequency" rules already defined in `plan.md`) and flags — not
  necessarily rewrites — trips where a High-weight dimension (≥36%) got zero coverage, since that's a
  relevance miss worth a repair pass rather than silent drift.
- **Seasonal/weather awareness (cheap, already-available data).** `openMeteoWeatherApi.ts` exists in the
  codebase for weather. Feed a one-line seasonal note per destination+month (e.g., "rainy season",
  "peak heat") into `p1_route`/`p2_days` context so outdoor-heavy days aren't scheduled against known
  bad-weather windows — this is real, non-fabricated climatological data (Open-Meteo climate
  normals/historical averages), not a synthetic forecast, so it doesn't violate the no-fabrication policy.

Additional relevance work:
- **Rank before generation.** Score catalog candidates deterministically using relevance, must-see,
  group-fit, season, quality, geography, feasible opening window, monetary cost, transit cost,
  duplication, and uncertainty. Hard exclusions and accessibility/timing failures are filters, not soft
  penalties. Give the LLM a small evidence-backed set instead of asking it to rescue a noisy shortlist.
- **Balance the whole trip.** Enforce coverage of major interests, iconic first-visit sights, deeper
  repeat-visit choices, local experiences, food, rest, and free/flexible backups. Penalize semantic
  duplicates even when close together.
- **Return alternatives and omission reasons.** Keep 1-2 nearby backups per day, including a lower-cost
  and indoor option where possible. Explain omitted must-sees (`closed`, `too far`, `availability
  unknown`, `accessibility conflict`, or `insufficient time`) instead of silently replacing them.

## 3. Clustering activities by distance & timing

This is the highest-leverage change and should be built in two layers:

**Layer A — give the catalog real coordinates (prerequisite).**
Add a lightweight, cached geocoding enrichment step to `attractionsCatalogService.ts`'s discovery flow:
after ranking candidates, resolve `lat`/`lon` via the free **Wikipedia GeoSearch/coordinates API**
(`action=query&prop=coordinates`) for entries that already resolved to a Wikipedia page (most of them,
since Wikipedia is already a discovery source). This is a single extra call per *newly discovered*
attraction (not per generation — respects the existing 365-day catalog refresh cache), costs nothing
(no API key), and finally populates the `lat`/`lon`/columns that already exist in the schema but sit
empty today.

**Layer B — cluster before the LLM commits, then let the LLM narrate.**
Rather than asking `gpt-4o-mini` to reason about geography in free text (unreliable and token-expensive),
compute clusters deterministically in the orchestrator:
1. **Recognize Trip Structure (Hub & Spoke vs. Linear).** Recognize if a trip is a "Home Base" trip
   (one city) or a "Road Trip." For home bases, cluster into "Neighborhood Pods." For road trips,
   optimize for "Along the Route" stops to minimize backtracking.
2. After fetching the attraction shortlist for each destination (with coordinates from Layer A), form
   density-based geographic neighborhoods and use nearest-insertion/local-search scheduling to make
   "day-sized" walkable/short-transfer pods.
3. **Buffer Scaling.** Adjust travel time buffers based on group size (`req.p.length`). A group of 2
   needs 10 mins to "gather"; a group of 8 needs 30 mins. Scale Haversine estimates by
   `1 + (GroupSize * 0.05)`.
4. **Golden Hour & Photography.** If an item is tagged `photography`, pin it to the first or last
   activity slot of the day to capture optimal lighting.
5. **Identify Pedestrian Zones.** Identify "Walkable Cores" (e.g., Centro Historico). If items are within
   800m, force a "Walking Transfer" logistics note and group them as a sub-cluster.
6. Pass these pods into `p2_days` as an ordered, labeled hint block (e.g., `POD 1 (Centro area): [names]`,
   `POD 2 (Chapultepec area): [names]`) alongside the existing ranked shortlist, and add an instruction:
   *"Prefer completing one POD before moving to another POD within the same day; do not mix items from
   distant PODs on the same day unless a transfer day requires it."*
7. Keep `attachAttractionMetadata`'s post-hoc transfer-time computation, but now use it as a **repair
   trigger** in `p3_validate`-equivalent logic: if the computed inter-item time for a day exceeds a
   threshold (e.g., 45 min total non-walk transfer for a "Relaxed" pace day), swap the offending item
   for another same-POD candidate from the shortlist rather than just reporting the time.

This keeps the expensive geographic reasoning out of LLM tokens entirely (cheap, deterministic, cached)
while still letting the model do what it's good at — narrative sequencing and preference balancing.

The final scheduler must not optimize straight-line distance alone. Its feasibility calculation includes
visit duration, verified opening/last-entry windows, timed reservations, meal/rest windows,
mobility-dependent walking speed, mode changes/parking, luggage, and an uncertainty buffer. Optimize
lexicographically: satisfy hard constraints first, minimize lateness and excess travel second, then
maximize preference relevance and minimize cost. Use geographic clustering only as a seed; k-means alone
is unsuitable because it ignores barriers, travel networks, and time windows.

Build a time-dependent travel matrix where cached routing exists and use conservative haversine/mode
estimates otherwise. Run bounded nearest-insertion, 2-opt, and adjacent-day swap passes. Cache matrix
cells and cluster results with data/algorithm version hashes. This captures most optimization value
without another LLM call or a solver dependency.

## 4. Travel time — inter-destination and arrival/departure legs

Model every trip as a door-to-door chain:

`home/starting point → departure terminal → entry hub → lodging/base(s) → exit hub → arrival terminal → home`.

Preserve booked transfers as immovable constraints. For unbooked legs, compare same-hub and open-jaw
routes using total elapsed time and total trip cost—not flight time or great-circle distance alone.

- **Geocode bases and model Door-to-Door.** Reuse Layer A's Wikipedia coordinates lookup for each
  `req.d[]` destination/base locality. Explicitly calculate the "Transfer to Terminal" (home airport)
  and "Terminal to Lodging" legs.
- **Jet Lag Awareness & Travel Fatigue.**
  - **Soft Start Mode:** If an arrival leg is >6 hours or crosses >3 timezones, Day 1 has no ticketed
    events and cap at 1 light activity; Day 2 has no activity before 10:00 AM.
  - **Fatigue Accumulator:** If cumulative travel time (inter-base + intra-day) > 6 hours in 48 hours,
    the next day must be a "Hub Day" (walking only, no vehicle transfers).
- **The "Sunday/Monday Trap" Logic.** Use climatology and a lightweight "Public Holiday/Closure" check
  to warn about Sunday closures (Europe) or Monday museum breaks. **Guardrail consistency:** this must
  stay a generic, category-level static rule table (e.g. "many European museums close Mondays") applied
  as a *logistics note*, never a per-attraction factual claim (e.g. never "Louvre is closed today") —
  the latter would need a live, verified opening-hours source and directly violates this project's
  existing "no exact opening hours" non-fabrication rule.
- **The Farewell Night cresendo.** Bias the ranker toward high-quality "Food & Drink" or "Event" items
  for the final night of the trip.
- **Compute a real Friction Score instead of a plan-only heuristic.** `plan.md` already defines
- **Compute a real Friction Score instead of a plan-only heuristic.** `plan.md` already defines
  `FrictionScore = (TransferHours × 2) + (TransfersCount × 1.5) + (BaseChanges × 2)` as "plan-only,
  don't compute it in the model." Now that real distances are available, compute this score in code for
  candidate routings and pass only the *winning* routing's rationale into the prompt — cheaper and more
  reliable than asking the LLM to self-select.
- **Arrival-day pacing.** Add an explicit `p2_days` rule: if a day contains an international/long-haul
  arrival transfer (flight with real-world great-circle distance above a threshold, e.g. >1500km, or
  crossing ≥3 timezones — timezone data is derivable from destination coordinates, no API needed), cap
  that day to at most 1 light activity plus lodging check-in, no evening item, and add a logistics note
  about likely fatigue/immigration/customs time. This is a firm rule, not the current soft "keep plans
  light."
- **Departure-day buffer.** Add a symmetric rule for the final day: no new ticketed/reservation-type
  (`R`/`A`) activities scheduled within a heuristic buffer window before an outbound transfer (e.g., the
  existing `ACTIVITY_TYPE_DURATION_MINUTES` estimate + 90 min buffer must fit before the transfer's
  known-approximate departure), and always include a logistics note for luggage/checkout timing.
- **Reuse the existing transfer-estimation seam for intra-day, not just inter-base.** Once `Layer A`
  coordinates exist broadly, `attachAttractionMetadata` already does the right thing — extend it so its
  output (walk/transit/taxi minutes) is also surfaced as a per-day logistics note (`ln[]`) rather than
  only used for start-time scheduling, so users see *why* the day is paced the way it is.

Additional travel-time requirements:
- **Generalized travel cost.** Replace the three-term friction score before production with configurable
  components for in-vehicle time, terminal access, check-in/security/immigration, connection risk,
  service frequency, baggage/seat fees, tolls/parking/car return, hotel-night impacts, and lost usable
  vacation hours. Keep time and money visible separately; combine them only with a user-configurable
  value-of-time/budget profile.
- **True origin and return.** With consent, use the account's coarse home airport/region, overridden by
  the trip's departure point. Compare ground access and parking and include immigration, baggage, missed
  ground-connection buffer, and travel home after return. Never place an exact home address in shared
  caches or LLM prompts.
- **Time zones and overnight legs.** Store instants plus IANA zones, calculate local dates at both ends,
  detect date-line/overnight travel, and distinguish elapsed duration from displayed clock time. Use
  booked local arrival/check-in times for arrival-day capacity when available.
- **Ranges and reliability.** Attach source, confidence, and an estimate range. Add buffers for
  international terminals, self-transfers/separate tickets, ferries/borders, peak traffic, reduced
  mobility, and children. Prefer a robust route over a brittle theoretical minimum.

## 5. Cost minimization while maximizing relevance (aggressive caching)

Use layered caches with request coalescing and negative caching: raw provider responses, normalized place
identities, coordinates/time zones, descriptions, attraction facts, route-matrix cells, ranked candidate
sets, route skeletons, and generic day skeletons. Batch lookups, use stale-while-revalidate for safe data,
add TTL jitter, and cap cache size. Each entry records source, retrieval/expiry times, locale, confidence,
and schema/algorithm versions. Coordinates can be long-lived; hours, prices, schedules, events, weather,
and closures need short or trip-date-aware TTLs.

- **Cache Route Skeletons and Day POD fragments.**
  - **Route Skeleton:** Key = hash of `(sorted destinations, duration bucket, pace, comfort, mobility,
    car, interaction style, entry/exit hub)`. Cache TTL: 30–90 days.
  - **Fragment Caching (Day PODs):** Cache specific "Day PODs" (e.g. "Louvre + Tuileries + Angelina")
    that provide high-quality "Balanced" pace days in Paris. Reuse these fragments across users without
    new LLM calls, injecting per-user must-sees afterward.
- **Negative Caching.** If Wikipedia GeoSearch/Summary fails for an attraction, cache that "No Data Found"
  state for 30 days to stop useless API hammering during generation.
- **Budget-Tiered Shortlisting.** The orchestrator filters the catalog *before* shortlisting for the LLM.
  If trip is "Budget," pass only 10% "Premium" splurge items; for "Luxury," filter out "Budget" items
  unless they are Must-Sees or highly iconic.
- **Skip `p3_validate` when nothing needs fixing.** Run the existing structural checks (day continuity,
  item caps, meal codes, locality drift) as pure code first (cheap, deterministic — most of `p3_validate`'s
  rules are already mechanically checkable, see `p3_validate.md`'s CHECKS list); only invoke the LLM
  validator call when a check actually fails or `cf` (confidence) would be uncertain. This alone likely
  removes 20-40% of validator calls for well-formed `p2_days` output.
- **Track and cap total generation cost per trip.** `apiLimits.ts`/`api-limits.yaml` already has a
  `budgeting` section with per-model token pricing — wire actual token usage (already returned as
  `tokenUsage` in `ItineraryPromptPlanResult`) into a running per-month cost counter and alert threshold,
  which the config already anticipates but (verify during implementation) may not be fully connected to
  itinerary generation specifically.
- **Extend attraction-catalog refresh economics to the new geocoding calls.** Layer A's successful
  coordinate lookups should use a very long TTL and be stored alongside `lat`/`lon`; retry failures with
  a bounded negative-cache TTL. Invalidate when the canonical page/place identity changes so a renamed,
  moved, or incorrectly matched attraction is not pinned forever.
- **Reconcile new prompt blocks against the existing token budget.** `plan.md`'s "Token cost
  guardrails" section sets `p2_days` at <600 tokens per 7 days; the new `{{ATTRACTION_PODS}}` and
  `{{LOGISTICS_FACTS}}` blocks (§3–4) and the "why this fits you" persona clause (§7) all add tokens to
  that same call. Define an explicit cap per new block (e.g., PODs: only the 2 pods actually eligible
  for the current day, ≤4 names each; logistics facts: ≤3 short lines) and update `plan.md`'s target
  table alongside the code change, not after — otherwise the Phase 0 token-regression test (below) will
  either be silently loosened or start failing for the wrong reason.

Additional cache safeguards:
- **Privacy boundary.** Shared keys and values must exclude names, user IDs, exact home locations,
  medical/dietary notes, free text, private must-sees, and bookings. Cache only generic facts and
  de-identified skeletons; apply private constraints afterward and keep final personalized results in a
  per-user/trip cache. Cross-user model-output reuse requires an explicit input allowlist and revalidation.
- **Canonical, versioned keys.** Prefer stable place IDs over names and include relevant local-date bucket,
  mode, mobility class, locale, prompt/model/schema/catalog/ranking/algorithm versions. Track dependencies
  so one changed booking, exclusion, must-see, or opening window invalidates only affected stages.
- **Validate every hit.** Re-run cheap hard-constraint and personalization checks. Measure hit rate,
  stale-hit rate, saved tokens/calls, latency, and post-hit repair rate; a hit that often needs repair is
  not a real cost saving.

## 6. Bounded new API usage (keep costs in check)

Only two new external calls are proposed, both free/low-volume and cache-once:
1. **Wikipedia coordinates API** (`action=query&prop=coordinates`) for attraction and destination
   geocoding — free, no key, long-lived cache per canonical entity, normally called only for newly
   discovered or identity-changed entries
   (piggybacks on the existing discovery cadence, not per-generation).
2. **(Optional, later phase) provider-neutral route matrix implementation.** Keep
   `DirectionsApiTransferEstimator` behind an internal interface. A Google adapter should use the current
   Routes API `computeRouteMatrix`, request only required response fields, and cap matrix elements because
   billing is per origin-destination element. Spend paid calls only on ambiguous/high-impact legs and the
   final candidate schedule, rate-limited through `api-limits.yaml`. Conservative haversine/mode estimates
   remain the default fallback.

No new paid discovery sources are proposed; SerpAPI usage should stay exactly as bounded as it is today.

## 7. Richer attraction/activity descriptions

- **Persona-based fit clause.** Add a "Why this fits you" sentence, generated deterministically from
  interest tags: `buildGeneratedActivityDescription` should append (not replace) a fit clause.
  *Example:* "Since you listed 'Photography', this terrace offers the best sunset view in Paris."
- **Lodging area summaries.** Apply Wikipedia-summary lookups to lodging base areas.

Further description requirements:
- Compose 2-4 concise sentences from verified structured fields: what it is, what makes it distinctive,
  expected experience/effort and duration, neighborhood pairing, accessibility caveat, booking/closure
  uncertainty, and why it fits this group. Do not ask the LLM to invent these facts.
- Cache the factual core once per attraction+locale, then append the short trip-specific fit sentence at
  render time. Retain internal provenance and show `verify before booking` for volatile claims. Test for
  repetitive boilerplate, unsupported superlatives, destination leakage, and name/description mismatch.

## 8. Personalization — account preferences + trip preferences

- **Confirm precedence is actually followed end-to-end.** `p0_norm.md` rule 2 states user overrides
  (`ut.po`, `ut.mob`) win over trip traits — verify (during implementation, via a unit test) that this
  precedence survives `sanitizeNorm` in `itineraryPromptPlanService.ts:802-840`, since sanitization
  currently reads `req.tt?.*` as the fallback but the *raw model output* as primary; if the model ignores
  the instruction, sanitization should still enforce it in code rather than trusting the LLM.
- **Use per-user `ut.i` (interests) beyond weight inference.** Today `ut.i` only feeds into `p0_norm`'s
  weight-inference step (rule 4). Extend it to also bias must-see-adjacent shortlist selection — i.e., if
  a user lists "Photography" as an interest, prefer catalog entries tagged `photography` when multiple
  shortlist candidates are otherwise equally rankable, not just adjust the trip-level weight number.
- **Respect `ut.eb`/`ut.no` (existing flags carried in the payload) explicitly in `p2_days`** — confirm
  during implementation what these currently do (they're normalized in
  `normalizePromptTraitInput`/`PromptReq.ut` but not obviously referenced by name in `p2_days.md`'s
  rules); if they represent "extra budget"/"no [something]" style overrides, they should have an explicit
  prompt rule the same way `mob`/`car`/`is` do.

## 9. Additional master-travel-agent suggestions

- **Additional master-travel-agent tips:**
  - **Golden Hour Logic:** If tagged `photography`, the LLM should bias it toward the first or last
    activity slot of the day.
  - **Market Lunch:** If a "Food Market" exists in the catalog, suggest it for the `LC` code instead of
    a generic restaurant in food-heavy destinations.
  - **Transit Selection:** If group size > 4, bias logistics notes toward "Private Van/UberXL" over
    public transit (cheaper/faster for large groups).
  - **The "Last Meal":** Suggest a high-quality "Farewell Dinner" (`DL`) for the final night.
  - **Pace-aware rest-day placement.** Lighten the day after any base change (unpacking/orientation).
  - **Shadow Planning mode.** For 5% of requests, generate using both legacy and improved pipelines.
    Use a "Judge LLM" to score them on "Transit Realism" and "Preference Alignment."

---

## 10. Phased implementation & test plan (for an LLM implementer)

Each phase should land as its own PR/commit, be independently testable, and not regress the "no synthetic
facts" guardrail. Server changes require adapter parity (`db.postgres.ts` + `db.firebase.ts` +
`db.memory.ts` inherits automatically) per this repo's CLAUDE.md conventions.

Implementation-agent rules:
1. Read `CLAUDE.md`, this document, the live p0-p4 prompts, schemas, service, DB adapters, migrations,
   feature flags, API budget config, and itinerary tests before editing. Treat live code as authoritative
   when a line-number reference in this plan has drifted.
2. At the start of each phase, write a small design note with input/output types, invariants, cache
   dependencies, privacy classification, failure fallback, and rollout/rollback flag. Prefer pure,
   exported functions and dependency injection for clocks, providers, and LLM callers.
3. Add characterization tests before changing behavior. Use recorded/synthetic provider fixtures in CI;
   no test may require paid APIs, live Wikipedia, live routing, or an OpenAI key.
4. Implement the smallest vertical slice, run focused tests, typecheck, then run the full server suite.
   Never update snapshots merely to make a failure disappear; inspect relevance, feasibility, and facts.
5. Emit structured metrics for candidate counts, rejection reasons, route minutes, schedule slack,
   cache hit/miss/stale/repair, provider calls, model calls/tokens/cost, latency, constraint failures, and
   fallback use. Roll out behind flags with a control cohort and an immediate kill switch.
6. Keep deterministic planning authoritative. The LLM may explain, summarize, or select among feasible
   candidates, but code must revalidate all model output and never let prose create a schedule fact.

Execution order: **0A → 0 → 1 → 2 → 3 → 4 → 5.** Phase 0A is listed first because the evaluation
harness and preference contract must exist *before* any optimization phase can be measured against a
baseline — Phase 0 (cleanup) can run in parallel with or immediately after 0A, but 1–5 depend on 0A's
metrics/fixtures being in place to judge "did this actually help."

### Phase 0A — Evaluation harness and preference contract (required before optimization)
- Add versioned fixtures spanning single/multi-city, open-jaw/round-trip, international date-line,
  arrival late/departure early, booked transfers, low mobility, families, large groups, conflicting
  preferences, strict budget, must-sees, closures, missing coordinates, and repeat visitors.
- Implement the normalized preference contract and precedence in code, including provenance and a
  group-aggregation policy. Hard constraints use the most restrictive applicable value; soft preferences
  use an explicit aggregation method (for example normalized average plus a fairness floor so one
  traveler is not ignored). Add conflict/assumption output for user review.
- Establish baseline metrics: must-see coverage; hard-constraint violations; weighted-interest coverage;
  duplicate rate; estimated travel minutes per activity day; schedule-window violations; arrival/departure
  feasibility; free/low-cost share for Budget trips; unsupported-fact rate; LLM calls/tokens/cost; and
  p50/p95 latency. Store golden outputs as structured assertions, not brittle full prose snapshots.
- Add property tests for date/time-zone arithmetic and clustering invariants, plus metamorphic tests:
  reordering travelers must not change results; adding a hard mobility constraint cannot increase walking;
  lowering budget cannot increase paid-item share without an explicit must-see reason.

### Phase 0 — Cleanup & baseline (low risk, do first)
- Remove or mark-superseded the three dead prompt files (§9).
- Add a token/cost logging assertion test: capture `tokenUsage` from a `ItineraryPromptPlanResult` in an
  existing test fixture and assert it's within the `plan.md` token targets (§"Token cost guardrails") —
  turns an aspirational target into a regression check.
- **Test:** existing `server/__tests__` itinerary-generation suite still passes unmodified.

### Phase 1 — Enrichment & Data Integrity (Foundation)
- Implement `WikipediaGeocodingService` in `server/src/services/`. Fetch `lat`/`lon` and
  `WikipediaSummary`.
- **Task 1.1: Wikipedia Pageview Enrichment.** Use the free Pageview API to assign a
  `popularity_score` to attractions. Use this to drive "Must-See" vs. "Hidden Gem" logic.
- **Task 1.2: Climatology & Daylight Service.** Calculate Sunrise/Sunset for the destination
  coordinates + month (standard astronomical formula, no API needed).
- **Task 1.3: Group Logistics Helper.** Implement `calculateTransferBuffer(distance, groupSize, mobility)`.
- Implement `DestinationLogisticsService`: Derive `timezoneOffset`, `isLongHaul` (Haversine from home),
  and `climatology` (Average High/Low/Rain for that month via `openMeteoWeatherApi`).
- Update `AttractionCatalog` schema: Add `popularity_score` and `primary_tag`.
- **Test:** Assert that "Paris" in July returns "Peak Summer Heat" and "7+ hour flight" flags.

### Phase 2 — The Deterministic Ranker & Clusterer
- Build `GreedyPodClustering.ts`: Group geocoded attractions into 3-item "Pods" within a 2km radius.
- **Task 2.1: Fatigue Awareness.** Implement the Friction Accumulator. Flag days that require "Rest/Hub"
  status.
- **Task 2.2: Pod-Based Shortlister.** Pre-filter the catalog into Neighborhood Pods *before* the LLM
  sees them, ensuring it only chooses from geographically viable options for each day.
- Build the `FairnessRanker`: Score items by `(UserInterestMatch * 0.5) + (GroupMustSee * 0.3) +
  (GeoProximity * 0.2)`. Apply **Fairness Floor** so each traveler is satisfied.
- Implement `ArrivalDepartureRules`: Generate a "Logistics Fact Block" (e.g., "Day 1: Heavy travel, 1
  activity max; Day 2: Soft start, no items before 10 AM").
- **Test:** Provide 20 attractions in NYC; verify "DUMBO" items and "Upper West Side" items cluster
  into separate Pods.
- **Test (robustness):** Provide a mixed set where only some attractions have `lat`/`lon` (realistic,
  since Layer A geocoding is best-effort and Wikipedia lookups fail for a nontrivial fraction of
  entries). Assert ungeocoded items are not silently dropped from the shortlist — they should fall back
  to a locality-name-only pod (no distance guarantee) rather than being excluded from `p2_days`
  entirely, since exclusion would silently reduce relevance/comprehensiveness for exactly the
  destinations with weaker Wikipedia coverage.

### Phase 3 — Prompt & Orchestration Update
- Update `p2_days` prompt: accept `{{ATTRACTION_PODS}}` and `{{LOGISTICS_FACTS}}`. Instructions for
  **Golden Hour**, **Market Lunch**, and **Large Group (>4)** transit bias.
- Update `p4_render_md`: Show "Why this fits your group" (Persona fit) and "Logistics Note" (buffers
  scaled by group size).
- Implement `StructureValidator` in code: Verify 3 meals, Jet Lag compliance, and Sunday closures.
- **Migration risk — admin-edited prompt overrides.** `itineraryInstructionService.ts` lets admins
  override any `p0`–`p4` template via the admin panel, stored in `admin_settings` and preferred over the
  default `.md` files (`listItineraryInstructionDocuments`). An admin who customized `p2_days.md` before
  this phase will keep serving their old override — silently missing `{{ATTRACTION_PODS}}` /
  `{{LOGISTICS_FACTS}}` — until someone re-saves it. Before rollout: audit stored overrides for the
  `itinerary_generation_instruction_documents` key, and either (a) have the template renderer tolerate
  missing new placeholders as a no-op (safe default) rather than leaving a literal `{{TOKEN}}` in the
  prompt, or (b) proactively re-sync/notify on any stored override missing the new tokens.
- **Test:** Generate a "Luxury" Tokyo trip. Verify 0 "Budget" items and a 90-min departure buffer.
- **Test:** Render a `p2_days` template that predates this phase (no `{{ATTRACTION_PODS}}` token
  present, simulating a stale admin override) and assert `applyTemplate` doesn't emit a literal
  unresolved `{{ATTRACTION_PODS}}` string into the prompt sent to the model.
- **UI follow-through — still open.** New fields (persona-fit clause, logistics notes, pod rationale)
  only create value if they reach the user. There is no `app/tabs/itineraries.tsx` — the actual
  rendering path for `ItineraryGeneratedActivity`/`generatedItems` is `app/tabs/overview.tsx`
  (confirmed via grep; the plan's earlier file reference was wrong). Confirm whether `overview.tsx`
  already renders `ItineraryGeneratedActivity.notes` in full (likely yes, per the existing
  duration/description append pattern) or needs a UI change to surface the new content distinctly (e.g.
  a separate "Why this fits you" line vs. the description). Per this repo's CLAUDE.md guidance, verify
  the rendered result in the running app (`expo start --web`), not just via unit tests — **this manual
  browser verification has not been done as part of Phases 1–5 and remains outstanding.**

### Phase 4 — Global Optimization (Caching)
- Implement `TripSignatureCache`: Key = hash of `(destinations, duration, pace, budget, groupMobility)`.
- Implement **Fragment Caching**: Store validated "Day POD" triplets.
- **Task 4.1: Fragment Invalidation Logic.** Ensure catalog changes ripple through the cache (e.g. if
  an attraction moves, its containing Day PODs must be invalidated).
- **Task 4.2: Shadow Planning mode.** Implement a mode where 5% of requests generate using both legacy
  and improved pipelines. Use a "Judge LLM" to score them.
- Build "Fragment Injector": Pull a cached skeleton and inject user "Must-See" items into the nearest
  Pod.
- Implement **Negative Caching**: Cache failed Wikipedia lookups for 15 days.
- **Test:** Generate same trip for two users. Verify 0 `p1_route` OpenAI calls on the second run.
- **Test (cache correctness, both directions):** (a) Same destinations/duration/traits but a
  *different* `req.ms[]` (must-see list) must still hit the route-skeleton and day-content caches — the
  cache key must exclude must-sees since they're injected post-cache via the Fragment Injector. (b) Same
  destinations but a *different* `comfort`/`pace`/`mob` value must **miss** the cache — assert the miss
  explicitly, since a silent stale-trait hit would be a correctness bug (e.g. serving a "Luxury" cached
  itinerary to a "Budget" request), not just a missed cost optimization.

### Phase 5 — Optional real routing API (only if Phase 3's heuristic proves insufficient in practice) — **implemented**
`DirectionsApiTransferEstimator` in `transferEstimationService.ts` now calls Google's Routes API
(`computeRouteMatrix`) behind the `attractions_transfer_directions_api` flag. It reuses the free
haversine heuristic to pick a travel mode first (so only one paid element is requested per pair, never
one per mode), and falls back to that same heuristic estimate — never throws, never leaves a pair
unestimated — on missing `GOOGLE_ROUTES_API_KEY`, a rate-limit/budget block
(`ApiLimitExceededError` via the shared `reserveApiUsageOrThrow` pattern), or any API/network failure.
Rate limiting is wired through `api-limits.yaml` (`providers.GOOGLE_ROUTES`, 200/day overall and per-caller
cap, matching the SERPAPI/WIKIMEDIA convention) — no `budgeting` entry, since that section is
token-cost-based (LLM-only) and doesn't apply to this per-element-priced API.
Tests: `server/__tests__/transferEstimationService.test.ts` covers a mocked successful Routes API
response (including asserting `TRANSIT` mode is requested for the mode the heuristic chose), the
missing-API-key fallback, the API-failure fallback, and the rate-limit fallback (all falling back to the
heuristic, never throwing to the caller) — matching all three cases called for below.

- Implement a provider-neutral route estimator behind the existing
  `attractions_transfer_directions_api` feature flag. Validate high-impact inter-base legs and only the
  small set of intra-day edges that could change the winning schedule; never request a full unbounded
  attraction cross-product.
- Add provider budget wiring in `api-limits.yaml` for the new provider/caller, respecting the existing
  `getApiLimitProviderConfig` rate-limit pattern.
- **Test:**
  - Unit test the estimator against a mocked Directions API response.
  - Unit test the feature-flag fallback path (flag off → heuristic estimator used, no network call).
  - Rate-limit test: assert calls beyond the configured budget are rejected/skipped, not silently
    unbounded.

### Cross-cutting acceptance criteria (verify at the end of every phase)
- No phase introduces a fabricated fact (price, exact schedule, named business) — all new data sources
  (Wikipedia coordinates, computed haversine distances, cached prior generations) are either real,
  derived, or previously-validated content.
- Full existing server test suite (`cd server && DB_PROVIDER=memory npx jest --config jest.projects.js
  --runInBand`) stays green after each phase.
- Token-usage regression check from Phase 0 still passes (no phase should *increase* average tokens per
  generation — caching phases should decrease it).
- `db.postgres.ts` and `db.firebase.ts` stay in sync for any new DB functions (per this repo's DB adapter
  convention).
- No hard accessibility, exclusion, booked-transfer, opening-window, or arrival/departure constraint
  violation in the golden set. Every estimate exposes source/confidence and every omitted must-see has a
  reason.
- Against the Phase 0A baseline, require a predeclared improvement threshold before rollout (initial
  proposal: ≥20% lower median intra-day transfer minutes with ≤2% relevance-score regression), plus no
  increase in unsupported facts or p95 cost. Tune thresholds from real baseline data rather than silently
  weakening a failing gate.
- Run offline golden-set evaluation on every PR and a shadow/A-B rollout in production. Track user saves,
  deletes/replacements, regenerations, must-see retention, manual time edits, and explicit ratings as
  outcome signals; do not optimize solely for an LLM-as-judge score.

## 11. Post-implementation verification pass

All phases (0A through 5) were independently re-verified against the live code after a separate session
extended the implementation further (Fairness Floor injection, Fatigue Accumulator wired into the main
pipeline, Farewell Night/Golden Hour polish, comfort-tier coherence, group-size transfer buffering,
`ut.eb`/`ut.no` timing-preference notes, `terminalOnly` arrival/departure handling, and the real Route
Friction Score formula from §4 — all confirmed correctly implemented and wired into
`runGenerateItineraryViaPromptPlan`, not dead code). This pass found and closed the following gaps rather
than re-litigating already-correct work:

- **Real test coverage gaps closed** (the underlying logic was correct; it just had zero test coverage):
  `terminalOnly` in `buildArrivalDepartureFacts` (a day with no booked transfer must show `maxActivities:
  0`, distinct from a "heavy" booked arrival's `1`) — added to `phase2LogisticsRules.test.ts`. The
  category-level Sunday/Monday closure *warning* path in `validateAndRepairItineraryStructure` (distinct
  from the verified-closure *removal* path, which was already tested) — added to
  `itineraryPhase3Orchestration.test.ts`. `polishItineraryFinalPass` (Farewell Night + Golden Hour),
  `mapItems`'s mobility-L accessibility note, and `buildTimingPreferenceNote` (`ut.eb`/`ut.no`) had no
  test coverage at all and weren't even exported — exported all three (pure functions, no behavior
  change) and added `itineraryPolishAndTiming.test.ts` (11 tests). `weightedInterestCoverage` and
  `estimatedTravelMinutesPerActivityDay` in `evaluateItineraryBaseline` were implemented but every
  existing test fixture happened to exercise only their `null` fallback path — added real coverage to
  `itinerary-evaluation.test.ts`, which caught that an empty-but-present `transferMinutesByDay` map
  correctly returns `0` (not `null`) since the real pipeline always passes the map.
- **Code hygiene, no behavior change:** moved a `frictionAccumulatorService` import from mid-file back to
  the top of `itineraryPromptPlanService.ts`, and replaced several `// Chapter 16 §N` code comments
  (a citation to an unrelated deployment doc, `docs/temp/Chapter_16_Test_Deployment_and_Production_
  Cutover.md`, that has nothing to do with itinerary logic) with correct references to this plan's own
  section numbers.
- **No functional bugs found.** Full server suite: 1341 tests, only the 2 known pre-existing failures
  (`captureNeverBlocks`, `ingestion.non-llm-fixtures`) plus occasional unrelated ingestion-test timeouts
  under full-suite load (confirmed to pass cleanly in isolation — a load/flakiness issue, not a
  regression). Full app suite: 788 tests, only the 1 known pre-existing failure (`aiOpsDeepLinking`).
  Both confirmed pre-existing via `git stash`/history in earlier verification passes. Typecheck clean on
  both packages throughout.

### Follow-up scheduling and home-terminal fixes

The subsequent audit closed two implementation gaps in the live pipeline:

- adjacent-day scheduling now normalizes catalog destination keys (including
  slug/case variants), preserves the moved activity's time slot, and has
  terminal/rest-day guards and cross-day regression coverage;
- generation requests carry only a coarse consented home/return airport or
  region. Bundled airport coordinates support round-trip/open-jaw comparison,
  while logistics prompts receive a routing rationale without home addresses.
