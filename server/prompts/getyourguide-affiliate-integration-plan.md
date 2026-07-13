# GetYourGuide Affiliate Partner Program — Integration Suggestions

Back to: [Prompt Assets README](README.md) · [Itinerary Improvement Plan](itinerary-improvement-plan.md) ·
[Cost Estimator & Hosting Cost Admin Panel Plan](cost-estimator-admin-panel-plan.md)

This document suggests how to integrate GetYourGuide's (GYG) affiliate/partner program to surface
bookable activity suggestions alongside generated itineraries. It's grounded in this codebase's existing
patterns rather than a from-scratch design, and closes with a lightweight phased rollout suggestion. It
is **suggestions, not a locked spec** — the exact GYG integration surface (API vs. deep-links vs. widget)
should be confirmed against GetYourGuide's current partner documentation/dashboard before implementation,
since affiliate program mechanics and endpoints can change.

## 1. Why this fits well here (grounded in what already exists)

- **GetYourGuide is already a recognized *inbound* source in this app.** The ingestion pipeline already
  detects and parses forwarded GYG confirmation emails (`sourceDetection.ts:26,81,121`,
  `learnedExtractor.ts:591,674,689,718,725`, with real fixtures under `test_inputs/Activities/GetYourGuide
  - London - ...json`). This plan is the natural **outbound** counterpart: instead of only parsing a GYG
  booking *after* the user makes it elsewhere, suggest a bookable GYG activity *before* they've booked
  anything, right where the itinerary already recommends an activity.
- **The itinerary generator's core guardrail is "no fabricated facts."** Every prompt in the p0–p4
  pipeline explicitly forbids inventing prices, named businesses, or schedules
  (`server/prompts/plan.md`'s "Non-synthetic data policy"). A real, bookable GYG product with a real
  price and real availability is exactly the kind of *verified* data this pipeline is designed to prefer
  over LLM-invented specifics — this integration can *reduce* fabrication risk for activity suggestions,
  not add to it, as long as the affiliate lookup is always the source of truth for any price/name shown.
- **The infrastructure to do this cheaply and safely already exists** — this isn't a new pattern, it's
  applying an existing one to a new provider (see §3).
- **Shared Domain Utility.** To ensure consistency across the React Native app and server-side PDF/Email
  exports, the link-building logic should reside in a shared utility (e.g., `server/src/utils/gygUtils.ts`
  or a shared package) rather than being duplicated.

## 2. Integration surface — recommended approach

GetYourGuide's affiliate/partner program has offered (verify current specifics before building):

1. **Simple deep-links (affiliate/referral links)** — append a partner ID to a GYG search or activity
   URL; GYG's own tracking attributes the booking and pays commission. No API key/approval needed beyond
   joining the affiliate program (historically via a network like Partnerize, or GYG's own portal).
2. **GetYourGuide Partner API** — a richer, approval-gated API for searching activities by location and
   pulling structured data (name, price-from, rating, duration, thumbnail, booking URL) to render
   in-app, still commission-tracked through the booking URL. Requires a partner agreement/API key.
3. **Embeddable widgets** — iframe-based search/activity widgets, mainly a web-only fit; a poor match for
   a React Native app that also targets native.

**Recommendation: start with (1), evolve toward (2).**
- Phase A (deep-links only) requires no data-quality/caching work and can ship fast: take an attraction
  or generated-activity name + destination, build a GYG search-results deep link (mirroring
  `app/utils/mapLinks.ts`'s `buildMapUrl` pattern exactly), and show a "Find this on GetYourGuide" link.
  No fabricated price/rating is ever shown, since nothing is rendered beyond the link itself.
- Phase B (Partner API) adds real price/rating/thumbnail data once partner API access is approved,
  following the existing Unsplash integration pattern (§3) — cached, rate-limited, best-effort, and
  gracefully degrading back to a plain deep-link if the lookup fails or access isn't approved yet.

This mirrors how Unsplash images already degrade gracefully in this app when the API call fails — never
block itinerary generation on a third-party call succeeding.

## 3. Backend plan — mirror the Unsplash integration pattern exactly

This codebase already has a complete, proven template for "third-party partner API with a key, rate
limiting, cost recording, and caching" — `unsplashApi.ts` + `unsplashCallers.ts`. A GetYourGuide
integration should copy this shape, not invent a new one:

- **`server/src/apis/getYourGuideApi.ts`** (low-level HTTP layer, mirrors `unsplashApi.ts`):
  - `searchGetYourGuideActivities(params: { caller: string; query: string; locationHint?: { lat: number; lon: number }; timeoutMs?: number })`
  - Every call: `await reserveApiUsageOrThrow({ provider: 'GETYOURGUIDE', caller: params.caller })` then
    `await recordProviderRequestCost({ provider: 'GETYOURGUIDE' })` before the request, exactly like
    every other provider wired in Phase 1 of the cost-estimator plan.
  - Auth via partner ID / API key read through `getEnvValue('GETYOURGUIDE_API_KEY')` (or
    `GETYOURGUIDE_PARTNER_ID` if the deep-link-only phase ships first) — never `process.env` directly,
    per this repo's env-var convention (`server/src/env.ts`).
- **`server/src/apis/getYourGuideCallers.ts`** (higher-level named callers, mirrors `unsplashCallers.ts`):
  - One `SCREAMING_SNAKE` caller constant per call site (e.g.
    `GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION`, `GETYOURGUIDE_CALLER_ACTIVITY_TAB_LOOKUP`).
  - A `createTtlCache` (reusing `ttlCache.ts`, the same utility Unsplash uses) keyed by
    `caller::normalizedQuery`, TTL sourced from a new `getApiCacheSetting('getYourGuide',
    'activityLookupTtlMinutes')` entry — attraction/activity availability and pricing changes far more
    slowly than, say, weather, so a long TTL (e.g. 24h, matching `googlePlaces.detailsCacheTimeoutMinutes`)
    is appropriate and keeps this cheap.
  - Empty-query short-circuit before touching the cache or network, matching the Unsplash callers exactly.
- **`server/config/api-limits.yaml`**: add a `GETYOURGUIDE` block under `providers` (window/overall/callers,
  matching every other provider added this year) and a `GETYOURGUIDE: 0` line under `requestPricing` —
  the affiliate program is commission-based (GYG pays *this app*, not the other way around), so the
  per-request cost is genuinely $0 unless the Partner API itself has its own metered pricing tier (verify
  against current GYG terms; if it's free for approved partners, leave it at the default $0 like
  Wikimedia/SerpAPI's discovery calls).
- **Failure handling**: if the API call fails, times out, or the partner key isn't configured, fall back
  to the Phase A deep-link (never block generation, never show a broken card). Use a
  **Stale-While-Revalidate** pattern for API results to ensure UI snappiness while keeping data
  relatively current.

## 4. Data model changes

- **`Activity` (`server/src/types.ts:537-560`) has no URL field today** — `reference` is a free-text
  booking reference string, not a link. Add an optional field, e.g. `bookingUrl?: string | null` (or
  reuse the existing `linkUrl` naming already used by the car-rental detail-item shape in
  `overview.tsx:1835-1895`, for UI-layer consistency). Keep it optional and additive — no existing data
  changes shape.
- **`AttractionCatalogEntry` (`types.ts:439-464`)** already has `name`, `destinationDisplayName`, `lat`,
  `lon` — enough to build a GYG search query without any new required fields. Optionally add
  `getYourGuideActivityId?: string | null` once Phase B's Partner API lookups are cached, so a repeat
  lookup for the same catalog entry can skip the search call entirely (search once, cache the resolved ID,
  reuse it) — this is the single biggest lever for keeping Partner API costs/rate-limit usage low, since
  the attraction catalog itself is already cached for 365 days (`attractionsCatalogService.ts`).
- No new SQL migration needed for the catalog-side caching — reuse the existing `upsertAttractionCatalogEntry`
  JSONB-payload pattern (confirmed elsewhere in this repo: `popularityScore`/`primaryTag` were added the
  same way, with no migration).

## 5. Where this plugs into the itinerary pipeline

Two integration points, both **deterministic/post-processing, not inside the LLM prompt** — consistent
with itinerary-improvement-plan.md's core principle that geographic/factual grounding work should stay
out of LLM tokens and be computed in code:

1. **Itinerary generation (`itineraryPromptPlanService.ts`)**: after `mapItems` builds the generated
   `ItineraryGeneratedActivity[]` list (same point where `attachAttractionMetadata` already enriches
   activities with a real Wikipedia description and duration estimate — see
   `itineraryPromptPlanService.ts`'s `attachAttractionMetadata`/`mapItems`), add one more best-effort
   enrichment pass: for each generated activity whose `activityType` is bookable-shaped (`Tour`,
   `Ticketed Attraction`, `Reservation`, `Day Trip`, `Class`), attempt a GYG lookup and attach
   `bookingUrl` (and, once Phase B ships, a real price-from string) if found. Never invent a price if the
   lookup returns nothing — same discipline as the existing Wikipedia-description fallback.
2. **Activities tab (`app/tabs/activities.tsx`) and Overview tab (`app/tabs/overview.tsx`)**: render a
   "Find on GetYourGuide" / "Book this experience" affordance on activity rows that have a `bookingUrl`,
   reusing `overview.tsx`'s existing `openDetailLink`/`Platform.OS === 'web' ? window.open : Linking.openURL`
   pattern (`overview.tsx:1835-1842`) — no new link-opening code needed, just wiring the existing pattern
   to a new field.

## 6. Relevance — reuse existing personalization, don't rebuild it

This app already has real signal for what a traveler wants (itinerary-improvement-plan.md's weights,
interest tags, must-see list, budget tier). A GYG integration should **use these as search/filter
parameters**, not just decorate whatever the LLM already picked:

- Pass the trip's `budgetTier`/comfort code into the GYG search as a price filter (Budget → filter to
  lower price-from tiers; Luxury → allow premium-tier products), mirroring the existing budget-tier
  coherence logic (`enforceBudgetTierCoherence` in `itineraryPromptPlanService.ts`) rather than adding a
  second, inconsistent budget-filtering mechanism.
- Bias toward the traveler's high-weight interest dimensions (the same `>=36% weight` threshold already
  used for the "Fairness Floor"/interest-coverage logic) when multiple GYG search results are plausible
  matches for the same generic activity slot.
- For **must-see attractions** (`req.ms[]`), prioritize a GYG lookup even if the corresponding attraction
  doesn't otherwise reach bookable-type filtering — a must-see is exactly where a "book this now" nudge
  has the highest conversion value.

## 7. Compliance — do not skip

- **FTC/affiliate disclosure.** Any UI element that link out through an affiliate/commission link must be
  clearly labeled (e.g. "Booking link — WanderBunnies may earn a commission" near the button, and a
  one-line mention in the app's Terms/Privacy docs). This is a legal requirement in the US (FTC endorsement
  guidelines) and analogous requirements exist in the EU/UK — treat this with the same care this repo
  already gives to Stripe billing/tax compliance (`docs/stripe-premium-subscriptions-checklist.md`,
  `docs/security/key-management.md`).
- **Partner ID / API key handling.** Store via `GETYOURGUIDE_API_KEY`/`GETYOURGUIDE_PARTNER_ID` in
  `server/.env`, never in the frontend bundle — deep-links are built server-side (or via a thin server
  endpoint the app calls) so the partner ID is never exposed as a public, spoofable client-side constant
  the way a naive `app/`-side implementation might do it.
- **No dark patterns.** Don't auto-inject a booking link into every single generated activity regardless
  of relevance — that degrades trust in the itinerary and risks looking like undisclosed native
  advertising rather than a genuinely useful "book this" convenience. Gate it (see §8) and keep it
  visually distinct from the itinerary's own (non-monetized) content.

## 8. Feature flag & tier gating

- Add a flag to `server/config/feature-flags.yaml`, e.g. `getyourguide_activity_suggestions` (snake_case,
  matching `car_rentals`/`attractions_transfer_directions_api`'s existing naming convention), so it can be
  killed instantly without a deploy if GYG's program terms change or the integration misbehaves.
- Decide its tier row in `docs/tiers.md`'s entitlement table — a reasonable default is **allowed for all
  tiers** (it's a revenue-generating feature for the business, not a cost center, so gating it behind
  Premium would be counterproductive), but flag this as an explicit product decision to confirm, not an
  assumption to build on silently.

## 9. Suggested phased rollout

1. **Phase A — deep-links only (no partner approval needed to start building).** Build
   `buildGetYourGuideSearchUrl(query, destination)` mirroring `mapLinks.ts`'s `buildMapUrl` exactly (pure
   function, URL-encode, return `string | null`). Add the `bookingUrl`-style field to generated
   activities, wire the UI affordance in `overview.tsx`/`activities.tsx`, add the disclosure label, add
   the feature flag. Ship behind the flag, measure click-through.
2. **Phase B — Partner API enrichment (once partner access is approved).** Add
   `getYourGuideApi.ts`/`getYourGuideCallers.ts` per §3, wire the real price/rating/thumbnail into the
   activity card, add the `api-limits.yaml` provider block, add the catalog-level cached-ID field from
   §4. Everything degrades to Phase A's plain deep-link on any failure.
3. **Phase C — relevance-aware search (§6).** Feed budget tier, interest weights, and must-see priority
   into the GYG search query/filtering. Add **Contextual Search Hints**: if the activity is an
   `Evening` slot, append "Night" or "Dinner" to the query; if it's a `Class`, append "Workshop."
4. **Phase D — Dynamic CTAs & Conversion Optimization.** Implement high-intent buttons like
   "Get Skip-the-Line Tickets" for iconic landmarks to maximize CTR.
5. **Phase E — cost-estimator integration (optional, ties to the existing admin panel).**

Each phase should land as its own PR, follow this repo's existing test conventions (unit tests for the
pure link-builder and caller functions, an integration test for the itinerary-pipeline enrichment point
using the same mocked-axios harness `itinerary-prompt-plan.test.ts` already uses, and a component test
for the new UI affordance following `AdminTab.CostEstimate.test.tsx`'s pattern), and go through the same
"verify in the running app" step this repo's CLAUDE.md requires for UI changes.
