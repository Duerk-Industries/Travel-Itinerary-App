# Itinerary Generation: Comprehensiveness Improvements

This document combines two independent reviews of the p0–p4 itinerary generation pipeline
(`server/src/services/itineraryPromptPlanService.ts`, prompts in `server/prompts/prompts/`) into one
prioritized plan, corrects a couple of factual assumptions against the current code, and adds a
proposal for a command-line "gold" reference itinerary generator to test against.

Related docs: [Itinerary Generator Improvement Plan](itinerary-improvement-plan.md),
[Plan](plan.md).

## 1. Current limitations (verified against code)

### A. The "terseness trap" (token limit)
`p2_days` (day expansion) is a single call for the *entire* trip, capped at
`max(1100, min(3500, duration*280))` completion tokens
(`itineraryPromptPlanService.ts:2376`). For a 3-day trip this is generous; for a 14-day trip the
per-day share of that budget shrinks well below the plan's own target of "~600 tokens per 7 days"
(`plan.md:189-196`), so the model compresses to one-line descriptions and drops logistics notes to
avoid truncating invalid JSON. Longer trips are the most starved, and there is no chunking —
confirmed no loop over day-ranges in `itineraryPromptPlanService.ts`.

### B. "Shortlist blindness" (scope limit) — partially already mitigated
The catalog can hold up to `limitPerDestination` (default 20, clamped 1–50,
`api-limits.yaml:280`) candidate attractions per destination, but only
`shortlistPromptItemsPerDestination` (default 8, clamped 1–20, `api-limits.yaml:281`) are actually
injected into the p2 prompt (`attractionsCatalogService.ts:1164-1173`). **Correction to the "flat
Top-20" framing**: the truncation to that final count is *not* purely "first N" — when trip-level
interest weights are supplied, `getAttractionPromptBlockForDestinations` already calls
`buildPodBasedShortlist({ weights, ... })` (`attractionsCatalogService.ts:1202-1211`) before the
final truncation, and each catalog entry already carries an `interestTags: InterestTag[]` field
(populated from a stored `primary_tag` plus regex-based inference,
`attractionsCatalogService.ts:896`) that this weighting can use. The gap isn't "no interest
signal exists" — it's that (a) the *effective menu size* is only 8, and (b) if `params.weights`
is ever omitted upstream, it silently falls back to raw catalog order. Both are worth fixing, but
the fix is smaller than building tag-weighting from scratch.

### C. The "reasoning floor" (model limit)
All of p0–p4 run on `gpt-4o-mini` at `temperature: 0.2` (`openaiCallers.ts:127`,
`getActiveAiProvider('itinerary_generation')`). This is intentionally cheap, but has less
"spatial reasoning" headroom for jointly satisfying 5 interest weights, geographic pod
constraints, and arrival/departure buffers at once. `OPENAI_SUPPORTED_MODELS` already includes
`gpt-4o` and `gpt-4.1`/`gpt-4.1-mini` (`openaiProvider.ts:8`), and per-feature model overrides are
already wired via `FEATURE_MODEL_ENV_KEYS`/`aiProviderConfigService.ts` — so trying a stronger
model for specific stages (or for one-off gold generation, see §3) requires **config only, no new
code**.

### D. p3 repairs some content, but coverage is not guaranteed
`itineraryPromptPlanService.ts` and `itineraryStructureValidator.ts` enforce hard caps (≤5
items/day, ≤2 logistics notes, arrival/departure-day limits) and already inject some grounded
must-sees, replace generic activities, and enforce interest fairness. They do not guarantee a
useful primary activity on every eligible day, perform a full opening-hours/route optimization,
or re-prompt when a day remains thin. The remaining gap is bounded, constraint-aware fill—not a
blanket increase in daily item count.

### E. Single-shot JSON parsing, no retry
Each stage (`runJsonStage`, `itineraryPromptPlanService.ts:2012-2087`) makes exactly one OpenAI
call; a parse failure falls back silently to an empty/mechanical value with no retry. (The
`MAX_PROVIDER_RETRIES = 4` in `providerBudgeting.ts` only covers transient network/provider
errors, not malformed JSON.)

## 2. Recommendations, ranked by cost-effectiveness

### 1. Raise the effective shortlist size adaptively and close the weighting gap (near-zero cost)
- Keep the default `shortlistPromptItemsPerDestination` at 8 for short, simple trips, and raise it
  to ~12–15 only for long, multi-destination, or low-coverage trips. This config/orchestration
  change adds input tokens only where they buy additional variety (input tokens are cheaper than
  completion tokens).
- Audit callers of `getAttractionPromptBlockForDestinations` to confirm `params.weights` is always
  passed from the live p2 orchestration path (not just in tests) — if it's ever omitted, the
  interest-weighting in `buildPodBasedShortlist` silently degrades to raw catalog order.
- Optional stretch: guarantee minimum representation per dominant interest tag (e.g., if
  "photography" weight ≥ 30%, ensure at least N of the final shortlist carry that
  `interestTags` value) rather than relying solely on the pod-based scorer.

### 2. Move factual descriptions out of the LLM and into post-processing (cost *reduction*)
`attractionsCatalogService.ts` already fetches and caches `wikipediaSummary` /
`wikipediaTitle` / `wikipediaPageId` per attraction (lines ~73-75, 646-648, 687-689). The live
pipeline now attaches cached descriptions to `p4_render_md`'s `activityContext`; complete and
protect that contract so:
- p2 outputs only an attraction reference (id/name) + a short 1-sentence "why it fits this
  traveler" (existing anti-hallucination structure already supports this).
- A post-processing step (before or during p4 render) looks up the cached Wikipedia summary and
  GYG deep link (see `getyourguide-deep-link-automation-plan.md`) and stitches them into
  `activityContext`, instead of asking the model to re-write attraction history from memory.
- This both **saves completion tokens** (the expensive kind) and **improves factual accuracy**,
  since descriptions come from verified cached data instead of model recall. This is the one
  recommendation that both improves quality and reduces cost — do it early.

### 3. Chunked day generation for long or difficult trips (small cost increase, largest quality gain)
Split `p2_days` into blocks (e.g., 3-day windows) sharing the same `p1_route` skeleton, each
getting its own `max_tokens` allowance rather than one shrinking pool for the whole trip. Start
with trips of eight or more days, then lower the threshold only if the token/quality metrics show
starvation on shorter multi-destination requests.
- **State Transfer:** Subsequent chunk calls **must** include a list of `used_attraction_ids`
  from previous chunks to prevent duplicates and maintain narrative continuity.
- This directly targets §1.A. Expect modestly higher prompt-token cost from repeated shared context
  (route skeleton, traits, shortlist) across chunks.
- Needs orchestration changes in `itineraryPromptPlanService.ts` (loop over day-ranges, merge
  results before p3), not just config.

### 4. Bounded "fill" repair (cost-optimized)
Extend `itineraryStructureValidator.ts` so that when a day has fewer than ~2 items after p2:
- **Step A (Deterministic Fill):** First, try to inject the next-best item from the current
  day's geographic POD directly via code (0 token cost).
- **Step B (Targeted Re-prompt):** Only if Step A fails to find a viable candidate, perform a
  single targeted re-prompt (reusing the same shortlist).
- This ensures days are never "thin" while scaling cost with actual p2 failures.

### 5. One retry on JSON parse failure before falling back
Cheap insurance in `runJsonStage`: retry once with backoff before returning `fallbackValue`.
Parse failures are the uncommon case, so the added cost is negligible.

### 7. Strategic Nuance: Climatology-Preference Alignment (Master Agent Logic)
The orchestrator should perform a pre-generation check between the destination's climatology
(Average high/low/rain for that month) and the user's weighted interests.
- If a traveler has a high `outdoors` weight but the month is "Rainy Season" or "Extreme Cold",
  p0 should explicitly add an assumption: "Outdoor activities may be limited by seasonal weather;
  providing indoor alternatives where possible."
- This prevents the "Hiking in December" failure mode that pure LLM generation often hits.

### Not recommended as a first step
Switching the default model for all stages to `gpt-4o`/`gpt-4.1`. It's config-only to try, but
it's the most expensive lever per the cost estimator (`cost-estimator-admin-panel-plan.md`) and
should be evaluated only after §1–§4 are measured — those close most of the "thin trip" and
"narrow menu" gaps at near-zero marginal cost.

## 3. Gold reference itinerary (CLI-only, for testing)

Goal: produce a high-effort, high-token "gold" itinerary for a given test trip spec, to diff
generated itineraries against for regression/quality testing — without touching production cost or
latency.

### Where it lives
Extend the existing non-mocked CLI harness, `server/scripts/replay-itinerary-generation.ts`
(it already invokes the real pipeline service, not a mock — see its own note that it "calls a
shared service also used by the live generation path"). Add a `--gold` flag rather than a new
script, so the gold path stays provably aligned with the real p0–p4 stage functions and doesn't
drift into a separate reimplementation.

### How "gold" generation should differ from production
All differences are opt-in overrides threaded through the existing stage functions — no new
prompt files needed for p0/p1/p3/p4, only parameter overrides:

1. **Stronger model.** Override via the existing `FEATURE_MODEL_ENV_KEYS` mechanism
   (`aiProviderConfigService.ts`) to run `gpt-4o` (or `gpt-4.1`) instead of `gpt-4o-mini`, for all
   stages, for this run only. No code change required — set the env var when invoking the script.
2. **Full shortlist, not the 8-item production menu.** Pass `shortlistPromptItemsPerDestination`
   at or near its max (20) for the gold run, so the reference itinerary draws from the full
   curated catalog rather than the cost-constrained production subset.
3. **Chunked day generation regardless of trip length**, using the §2.3 chunking approach (or, until
   that lands, a temporary CLI-only loop that calls `p2_days` per 3-day block and merges results) —
   so the gold itinerary is never subject to the terseness trap, even for long trips.
4. **Higher `max_tokens` per stage** (e.g., double each stage's production cap) so the model has
   room to be as descriptive as the prompts allow.
5. **Bypass all caching** (`writeItineraryPlanCache`/`readItineraryPlanCache` calls skipped, or a
   `noCache: true` flag threaded through) — a gold run must always be a fresh generation, never a
   reused fragment, since its purpose is to represent current best-case output.
6. **Wikipedia/GYG enrichment applied** per §2.2, so gold output reflects the target
   post-processing pipeline, not raw LLM prose.

Everything else — schemas, validators, non-synthetic-data policy, routing heuristics — stays
identical to production, since the goal is a *ceiling* on quality within the same contract, not a
different itinerary format that can't be diffed against real output.

### What the CLI does with it
- Write the gold itinerary JSON + rendered markdown to a fixture file (e.g.
  `server/__fixtures__/gold/<trip-spec-id>.json`), alongside the trip spec used to generate it.
- **Durable Quality Tracking:** Propose a `gold_comparison_results` DB table. The CLI should upload
  its comparison metrics (coverage %, item count delta) so the **Executive Dashboard** can
  report on the "Production vs. Gold Quality Gap" over time.
- Provide a companion `--compare <trip-spec-id>` mode that runs the *production* pipeline...
  - **Structural**: item count per day, presence of logistics notes, base/hub changes — reuse
    `itineraryStructureValidator.ts`'s existing checks so the diff logic isn't duplicated.
  - **Coverage**: what fraction of gold-itinerary attraction IDs also appear in the production
    itinerary (a cheap, deterministic proxy for "did the narrow shortlist/short trip lose
    content" — no extra LLM call needed).
  - **Optional, explicitly gated**: an LLM-as-judge relevance/comprehensiveness score comparing
    the two itineraries side-by-side, only run when an explicit `--judge` flag is passed, since
    this adds another paid API call and should never run by default in CI.
- This stays a **command-line-only** tool for now (per the ask) — no server route, no admin UI,
  no scheduled job. It should never run automatically in production or be reachable via the API;
  gate it purely behind the script invocation so gold-tier cost is never incurred by a real user
  request.

### Cost note
A gold run intentionally costs meaningfully more per trip (stronger model, larger token caps,
full shortlist, no cache) — that's the point, since it's a one-off reference generated by a
developer running the script, not a production code path. Keep it out of any CI job that runs on
every PR; run it on-demand or on a slow nightly schedule against a small fixed set of
representative trip specs.

## 4. Verified answer: what currently limits itinerary quality

The itinerary is limited by tokens, but increasing the token ceiling alone is not the
most cost-effective fix. There are four separate ceilings:

| Area | Current constraint | What it limits |
| --- | --- | --- |
| Completion budget | p0 700, p1 1,200, p2 `max(1,100, min(3,500, days × 280))`, p3 1,400, and p4 900 tokens | Detail, logistics explanations, and the ability to return valid JSON. The maximum across all stages is about 7,700 completion tokens, but typical usage is lower and must be measured from stage captures. |
| Input/context budget | p2 receives the route, preferences, logistics facts, pods, and the selected attraction shortlist in one request | Long trips and multi-destination trips spend context on repeated scaffolding, leaving less room for useful activity detail. A context-window limit can therefore affect quality even when `max_tokens` is not reached. |
| Candidate and structure limits | Up to 20 catalog entries are retained, normally 8 are placed in the p2 prompt, pods are clustered at roughly 2 km with at most 3 entries per pod, and the validator allows at most 5 items per day | Scope and variety. A good attraction that is not in the prompt cannot be selected. The five-item ceiling is intentional; the goal is not to fill every day with more stops. |
| Model and data quality | The normal path uses the low-cost itinerary model, a single JSON attempt per stage, cached catalog/route/day data, and structural validation rather than factual verification | Accuracy and efficacy. The model can satisfy the schema while choosing a weak fit, stale hours, or an implausible sequence. A missing `userId` also means no personalized attraction shortlist is available. |

The pipeline already does useful deterministic work after generation: it grounds activities to
the shortlist, injects required/must-see items, adds transfer notes, attaches cached duration
and description metadata, and renders an `activityContext` for p4. Therefore, the highest-value
improvements are better measurement, candidate coverage, and targeted repair—not globally
doubling every token budget. Cached descriptions are already passed into `activityContext`; the
remaining work is to make that enrichment complete and prevent the renderer from replacing
verified facts with invented prose.

### How to interpret the limits

- **Accuracy** is primarily limited by source freshness, missing coordinates/opening-hour data,
  model reasoning, and the fact that p3 checks shape and grounding rather than truth. More output
  tokens do not make an incorrect source correct.
- **Scope/comprehensiveness** is primarily limited by the eight-item per-destination prompt
  shortlist, the catalog confidence filters, the five-item daily structure, and the one-shot p2
  request for long trips. These are coverage limits before they are token limits.
- **Efficacy** (a trip that is practical and enjoyable) depends on geographic clustering,
  opening-hour and travel-time feasibility, arrival/departure buffers, preference weights, and
  useful descriptions. Extra narrative tokens can make an itinerary longer without making it
  more usable.

## 5. Most cost-effective improvement order

Implement the following in order. Each item either has zero provider cost or is gated so that
additional calls occur only when the existing result is inadequate.

### 5.1 Measure before spending (zero API cost)

Add a per-generation quality record from the existing stage captures and token accounting:

- prompt and completion tokens, latency, cache hit/miss, model, and provider for p0–p4;
- empty/parse-failure/repair counts and whether a fallback was used;
- shortlist size and preference-tag coverage (requested high-weight interests represented);
- items per day, unique attractions, must-see recall, days with no primary activity, and transfer
  conflicts; and
- estimated cost per itinerary and p50/p95 latency.

Use these metrics to identify whether a trip was token-truncated, candidate-starved, data-starved,
or merely poorly ranked. Do not raise a limit when the metric shows a catalog or routing problem.
Keep raw prompts/responses behind the existing gated capture flag and redact personal data.

### 5.2 Improve information density without another LLM call

- Keep compact prompt fields (name, tags, coordinates, duration, booking/weather flags) in p2,
  but enrich the final activity card from cached Wikipedia/catalog summaries, source URLs,
  duration, price band, accessibility, and a concise “why this fits” explanation.
- Prefer verified metadata for hours, travel duration, and ticket requirements; tell p4 to
  paraphrase those fields and never invent a fact that is absent from `activityContext`.
- Cache normalized descriptions by attraction ID and locale, with a version/freshness stamp and
  negative-cache failures. Reuse them across users; only preference-dependent “why it fits” text
  should vary by traveler.

This makes the itinerary more descriptive and accurate while spending no additional generation
tokens and avoiding a paid enrichment request per activity.

Use a cache hierarchy for intermediate results: shared catalog/description records, destination
pair route and transfer matrices (with a date/traffic bucket), destination-month weather facts,
versioned normalized preference contracts, compact shortlist blobs, and finally user-scoped route
or day fragments. Include every quality-affecting input in each cache signature (locale, traveler
weights, dates, accessibility/budget constraints, catalog version, and model/prompt version).
Serve stale-but-labeled data while refreshing asynchronously, and negative-cache unavailable
lookups briefly. This avoids repeated paid/API calls without allowing a generic cached itinerary
to override a traveler's current preferences.

### 5.3 Use an adaptive shortlist, not a permanently larger one

Keep the default eight-item menu for short, simple trips. Increase it to 12 (at most 15) only when
one of these is true: the trip is longer than seven days, has multiple destinations, has five or
more high-weight interests, or the first shortlist fails a coverage threshold. Select by weighted
interest pods, geographic spread, confidence, and diversity; always pass the normalized weights.
Cache the resulting compact prompt blob by destination, locale, catalog version, and shortlist
policy. This buys scope only where it is needed and avoids paying larger input tokens for every
request.

### 5.4 Add deterministic fill and one targeted repair

Before calling an LLM again, fill an under-populated day from the already cached, grounded
shortlist while respecting opening hours, travel time, rest rules, and the five-item cap. If the
result is still empty, malformed, or missing a required high-weight interest, make one repair call
with a small, focused prompt containing only the affected days and missing constraints. Retry only
on those conditions—not on every generation—then fall back to the deterministic itinerary. This
is much cheaper than a second full p0–p4 run and improves reliability of JSON as well as coverage.

### 5.5 Chunk only long or difficult p2 requests

For trips of eight or more days (or a multi-destination trip whose p2 prompt exceeds a measured
input-token threshold), generate two- or three-day windows. Pass the route, traveler contract,
and a compact set of already-used attraction IDs to each window; merge once, then run the existing
p3 grounding/repair stage. Keep short trips on the current single call. Chunking adds some input
tokens, but it prevents the per-day completion budget from collapsing and is cheaper than
globally increasing p2 to its maximum.

### 5.6 Spend model/API budget selectively

Use the existing per-feature model override only for high-risk cases: long trips, many
destinations, low shortlist coverage, or a failed repair. Keep the inexpensive model for p0/p1/p3
and use a stronger model only for the affected p2 window when metrics justify it. Do not add a
new external API solely to generate descriptions. If routing or weather data is missing, call the
existing provider once, cache the normalized result, and reuse it; use a deterministic distance
fallback when the provider is unavailable. All new calls must be registered with the API limiter,
cost estimator, cache policy, and admin dashboard before enabling them.

### 5.7 Preserve a clean offline fallback

If OpenAI, routing, catalog, or web enrichment is unavailable, return the grounded deterministic
itinerary with cached descriptions and explicit “estimated” travel labels. Never show provider
placeholders, empty GetYourGuide cards, or raw error text. A failed p4 render should continue to
use the existing markdown renderer/fallback rather than trigger another expensive full generation.

## 6. Implementation and test plan

1. **Instrumentation:** add stage-level metrics and a cost/quality event; write unit tests for
   token aggregation, cache-key dimensions, redaction, and threshold decisions.
2. **Grounded descriptions:** test metadata precedence, stale/negative cache behavior, locale
   fallback, and p4 output with missing provider data.
3. **Adaptive shortlist:** create fixtures for one-day, 7-day, 14-day, and multi-destination trips;
   assert weighted-interest recall, geographic diversity, deterministic ordering, and no increase
   in calls when the default eight-item menu is sufficient.
4. **Fill/repair:** test malformed JSON, empty output, missing must-see, duplicate attractions,
   opening-hour conflicts, and provider timeouts. Assert at most one targeted retry and a valid
   deterministic fallback.
5. **Chunking:** golden-test a long itinerary for stable day numbering, no duplicate attraction
   IDs, preserved destination transitions, arrival/departure buffers, and a single p3 validation.
6. **Regression/quality gate:** maintain a small fixture set (short city break, long trip,
   multi-city, outdoor seasonal trip, accessibility/budget-constrained trip). Track coverage,
   feasibility, unsupported-fact rate, parse/repair rate, token cost, and p95 latency. Require no
   regression in must-see recall or transfer conflicts before changing production defaults.

The recommended first release is instrumentation plus grounded cached descriptions, followed by
adaptive shortlists and deterministic repair. These changes improve comprehensiveness at near-zero
marginal API cost; selective chunking and stronger-model escalation should be enabled only after
the measurements show they are needed.
