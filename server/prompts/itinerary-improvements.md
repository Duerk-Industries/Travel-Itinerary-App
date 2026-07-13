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

### D. p3 can only trim, never add
`itineraryStructureValidator.ts` enforces hard caps (≤5 items/day, ≤2 logistics notes,
arrival/departure-day limits) but has no path to *add* content. If p2 under-fills a day, nothing
downstream fills the gap — repair is one-directional.

### E. Single-shot JSON parsing, no retry
Each stage (`runJsonStage`, `itineraryPromptPlanService.ts:2012-2087`) makes exactly one OpenAI
call; a parse failure falls back silently to an empty/mechanical value with no retry. (The
`MAX_PROVIDER_RETRIES = 4` in `providerBudgeting.ts` only covers transient network/provider
errors, not malformed JSON.)

## 2. Recommendations, ranked by cost-effectiveness

### 1. Raise the effective shortlist size and close the weighting gap (near-zero cost)
- Bump `shortlistPromptItemsPerDestination` from 8 to ~12–15 in `api-limits.yaml`. Config-only
  change; adds a few hundred input tokens (input tokens are far cheaper than completion tokens),
  directly increases variety.
- Audit callers of `getAttractionPromptBlockForDestinations` to confirm `params.weights` is always
  passed from the live p2 orchestration path (not just in tests) — if it's ever omitted, the
  interest-weighting in `buildPodBasedShortlist` silently degrades to raw catalog order.
- Optional stretch: guarantee minimum representation per dominant interest tag (e.g., if
  "photography" weight ≥ 30%, ensure at least N of the final shortlist carry that
  `interestTags` value) rather than relying solely on the pod-based scorer.

### 2. Move factual descriptions out of the LLM and into post-processing (cost *reduction*)
`attractionsCatalogService.ts` already fetches and caches `wikipediaSummary` /
`wikipediaTitle` / `wikipediaPageId` per attraction (lines ~73-75, 646-648, 687-689) — this data
exists today but is not piped into `p4_render_md`'s `activityContext` field. Change the contract so:
- p2 outputs only an attraction reference (id/name) + a short 1-sentence "why it fits this
  traveler" (existing anti-hallucination structure already supports this).
- A post-processing step (before or during p4 render) looks up the cached Wikipedia summary and
  GYG deep link (see `getyourguide-deep-link-automation-plan.md`) and stitches them into
  `activityContext`, instead of asking the model to re-write attraction history from memory.
- This both **saves completion tokens** (the expensive kind) and **improves factual accuracy**,
  since descriptions come from verified cached data instead of model recall. This is the one
  recommendation that both improves quality and reduces cost — do it early.

### 3. Chunked day generation for trips beyond ~4 days (small cost increase, largest quality gain)
Split `p2_days` into blocks (e.g., 3-day windows) sharing the same `p1_route` skeleton, each
getting its own `max_tokens` allowance rather than one shrinking pool for the whole trip. This
directly targets §1.A. Expect modestly higher prompt-token cost from repeated shared context
(route skeleton, traits, shortlist) across chunks, offset by point 4 below. Needs orchestration
changes in `itineraryPromptPlanService.ts` (loop over day-ranges, merge results before p3), not
just config.

### 4. Bounded "fill" repair in p3 (small, targeted cost increase)
Extend `itineraryStructureValidator.ts`/p3 so that when a day has fewer than ~2 items after p2, a
single targeted re-prompt (reusing the same shortlist) fills it, instead of leaving thin days
uncorrected. Cost scales with how often gaps actually occur, not universally.

### 5. One retry on JSON parse failure before falling back
Cheap insurance in `runJsonStage`: retry once with backoff before returning `fallbackValue`.
Parse failures are the uncommon case, so the added cost is negligible.

### 6. Cross-trip reusable day fragments (bigger lift — do after 1-5 land)
Today's day cache (`writeItineraryPlanCache(... stage: 'day' ...)`,
`itineraryPromptPlanService.ts:2408`) is keyed by a full **trip signature**
(`buildTripSignature` — destinations, duration, pace, comfort, mobility, car, budget band, dates,
weights, hubs; `itineraryPlanCacheService.ts:44-52`), and `buildDayFragments` just chunks a
generated day array into groups of 3 for storage — it does **not** currently provide cross-user
reuse of a generic "great photography day in Rome" fragment; each trip only reuses its own past
generations. Building a true reusable-fragment cache (keyed by destination + dominant interest tag
+ pace, independent of the full trip signature) is a larger change than it initially looks, but
would let you justify using `gpt-4o` for first-time fragment generation, knowing the cost
amortizes across many users. Scope this as a follow-on once §2's cache-key model is validated, not
a first step.

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
  `server/__fixtures__/gold/<trip-spec-id>.json`), alongside the trip spec used to generate it, so
  runs are reproducible and reviewable in PRs.
- Provide a companion `--compare <trip-spec-id>` mode that runs the *production* pipeline
  (unmodified config) for the same trip spec and reports a structural + coverage diff against the
  stored gold fixture:
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
