# GetYourGuide Affiliate Partner Program — Integration Suggestions

Back to: [Prompt Assets README](README.md) · [Itinerary Improvement Plan](itinerary-improvement-plan.md) ·
[Cost Estimator & Hosting Cost Admin Panel Plan](cost-estimator-admin-panel-plan.md)

This document suggests how to integrate GetYourGuide's (GYG) affiliate/partner program to surface
bookable activity suggestions alongside generated itineraries. It's grounded in this codebase's existing
patterns rather than a from-scratch design, and closes with a lightweight phased rollout suggestion. It
is **suggestions, not a locked spec** — the exact GYG integration surface (API vs. deep-links vs. widget)
should be confirmed against GetYourGuide's current partner documentation/dashboard before implementation,
since affiliate program mechanics and endpoints can change.

Phase 0 verification is recorded in the [GetYourGuide Phase 0 Partner Contract](../../docs/getyourguide-phase-0-contract.md).
The public API guide currently documents a 130-calls/minute default with a five-minute block after exhaustion,
but the account-specific quota and written content/caching terms take precedence.

## 0. Senior-review decisions to carry through both GYG plans

The companion deep-link plan is intentionally narrow, but it should follow these stronger boundaries:

- **Use a server-owned redirect as the canonical link.** The app may render a short-lived link token, but
  `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID`, partner-format changes, allowlisted hosts, and click attribution stay on the
  server. This avoids shipping two independent link builders and allows an immediate kill switch. A
  client-side build can remain an offline/export fallback only when explicitly enabled.
- **Never imply a product was found when Phase A only performs a search.** The CTA should say “Explore
  experiences” or “Find tickets”; “Skip-the-line” is allowed only when verified product metadata says so.
- **Treat relevance as a travel-planning decision, not a category check.** Match destination, date/time
  window, duration, mobility/accessibility, party size, language, budget, and the account/trip interests.
  Suppress a link when the activity would create an infeasible transfer or duplicate an existing booking.
- **Separate affiliate revenue from provider billing.** GYG clicks, bookings, and commission belong in an
  affiliate/revenue dashboard. Partner API calls still go through the general API limiter and cost
  estimator (normally $0 direct cost), with cache hits, misses, and rate-limit outcomes visible in admin.
- **Make every external dependency best-effort.** Itinerary generation, PDF/email export, and itinerary
  reads must succeed without GYG. Cache normalized search inputs and negative results aggressively, and
  never retry a failed request per activity without a bounded budget.

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
- **Shared Domain Contract.** To ensure consistency across the React Native app and server-side PDF/email
  exports, share the activity-eligibility types and pure normalization rules (for example in a small shared
  package). Keep partner URL construction, signing, and redirect policy server-only rather than duplicating
  them in `app/`.

## 2. Integration surface — recommended approach

GetYourGuide's affiliate/partner program has offered (verify current specifics before building):

1. **Simple deep-links (affiliate/referral links)** — send the traveler to a GYG search or activity URL
   through the approved affiliate format. Do not assume that a partner ID, network, or parameter names are
   public or stable; confirm the current approval, domain, disclosure, and sub-ID requirements first.
2. **GetYourGuide Partner API** — a richer, approval-gated API for searching activities by location and
   pulling structured data (name, price-from, rating, duration, thumbnail, booking URL) to render
   in-app, still commission-tracked through the booking URL. Requires a partner agreement/API key.
3. **Embeddable widgets** — iframe-based search/activity widgets, mainly a web-only fit; a poor match for
   a React Native app that also targets native.

**Recommendation: start with (1), evolve toward (2).**
- Phase A (deep-links only) requires no partner API lookup, but it still needs link validation, attribution,
  disclosure, and quality controls. Take an attraction or generated-activity name plus a disambiguated
  destination, create a server-owned redirect, and show an “Explore experiences” link. No fabricated
  price/rating/availability is ever shown.
- Phase B (Partner API) adds real price/rating/thumbnail data once partner API access is approved,
  following the existing Unsplash integration pattern (§3) — cached, rate-limited, best-effort, and
  gracefully degrading back to a plain deep-link if the lookup fails or access isn't approved yet.

This mirrors how Unsplash images already degrade gracefully in this app when the API call fails — never
block itinerary generation on a third-party call succeeding.

## 3. Backend plan — mirror the Unsplash integration pattern exactly

This codebase already has a complete, proven template for "third-party partner API with a key, rate
limiting, cost recording, and caching" — `unsplashApi.ts` + `unsplashCallers.ts`. A GetYourGuide
integration should copy this shape, not invent a new one:

- **Canonical Phase-A link endpoint**: add a server route such as
  `GET /api/affiliate/getyourguide` that accepts a validated activity/destination token and returns a
  `302` to a URL built from the server-side partner configuration. Allowlist the final GYG host, reject
  oversized/control-character input, use an opaque non-PII click reference, and record a minimal click
  event. Do not accept an arbitrary destination URL and do not log the partner ID or raw personal data.
  This endpoint is also the single place to change link parameters when GYG changes its format.

- **`server/src/apis/getYourGuideApi.ts`** (low-level HTTP layer, mirrors `unsplashApi.ts`):
  - `searchGetYourGuideActivities(params: { caller: string; query: string; locationHint?: { lat: number; lon: number }; timeoutMs?: number })`
  - Every call reserves before the request and records the request in the general API usage/cost
    framework, exactly like every other provider. A $0 request price must still appear in the admin
    estimator so volume and rate-limit consumption are visible.
  - Auth via partner ID / API key read through `getEnvValue(...)` — never `process.env` directly, per this
    repo's env-var convention (`server/src/env.ts`). Keep the API key server-only. A public affiliate ID may
    exist in an explicitly documented client fallback, but the server redirect remains canonical and can
    revoke it instantly.
- **`server/src/apis/getYourGuideCallers.ts`** (higher-level named callers, mirrors `unsplashCallers.ts`):
  - One `SCREAMING_SNAKE` caller constant per call site (e.g.
    `GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION`, `GETYOURGUIDE_CALLER_ACTIVITY_TAB_LOOKUP`).
  - A `createTtlCache` (reusing `ttlCache.ts`, the same utility Unsplash uses) keyed by a versioned,
    normalized request: destination/country, activity concept, date window, party-size bucket, language,
    accessibility needs, and budget tier. Do not key by raw user ID. Use a short fresh TTL for availability
    and a longer stale TTL for discovery metadata (for example 15 minutes/24 hours) only when written GYG
    permission allows persistence. Otherwise use request-lifetime single-flight de-duplication only; do not
    scrape or persist API output.
  - Cache resolved product IDs, normalized search results, and negative/no-match results separately only
    after written GYG permission is recorded. The public API guide warns against scraping to cache output;
    without permission, use request-lifetime de-duplication only and never persist GYG content, URLs, or
    sensitive traveler data.
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
  booking reference string, not a link. Prefer an ephemeral `affiliateLink?: { provider: 'getyourguide';
  url: string; kind: 'search' | 'product'; disclosureRequired: true } | null` (or a shared `linkUrl`
  presentation field) on generated responses rather than persisting a partner URL. This keeps rotated
  attribution/configuration from leaving stale links in saved itineraries. Keep it optional and additive;
  PDF/email renderers should generate it at render time when possible.
- **`AttractionCatalogEntry` (`types.ts:439-464`)** already has `name`, `destinationDisplayName`, `lat`,
  `lon` — enough to build a GYG search query without any new required fields. Optionally add
  `getYourGuideActivityId?: string | null` once Phase B's Partner API lookups are cached, so a repeat
  lookup for the same catalog entry can skip the search call entirely (search once, cache the resolved ID,
  reuse it) — this is the single biggest lever for keeping Partner API costs/rate-limit usage low, since
  the attraction catalog itself is already cached for 365 days (`attractionsCatalogService.ts`).
- No new SQL migration needed for the catalog-side caching — reuse the existing `upsertAttractionCatalogEntry`
  JSONB-payload pattern (confirmed elsewhere in this repo: `popularityScore`/`primaryTag` were added the
  same way, with no migration).
- If Phase B stores a product match, include `provider`, `productId`, `matchedAt`, `expiresAt`, and a
  compact match-reason/confidence—not a user ID, raw query, or price without its currency and timestamp.

## 5. Where this plugs into the itinerary pipeline

Two integration points, both **deterministic/post-processing, not inside the LLM prompt** — consistent
with itinerary-improvement-plan.md's core principle that geographic/factual grounding work should stay
out of LLM tokens and be computed in code:

1. **Itinerary generation (`itineraryPromptPlanService.ts`)**: after `mapItems` builds the generated
   `ItineraryGeneratedActivity[]` list (same point where `attachAttractionMetadata` already enriches
   activities with a real Wikipedia description and duration estimate — see
   `itineraryPromptPlanService.ts`'s `attachAttractionMetadata`/`mapItems`), add one more best-effort
   enrichment pass. First rank candidates using the activity's verified coordinates, day/time window,
   duration, travel legs, account preferences, trip preferences, and must-see status. Only inspect the
   top bounded set (for example two per day) and attach an ephemeral `affiliateLink`; do not make one
   network lookup per activity. In Phase B, attach a real product only when destination, date, duration,
   accessibility, and cancellation/meeting-point constraints pass. Never invent a price if the lookup
   returns nothing, and always retain currency and `lastVerifiedAt` with displayed prices.
2. **Activities tab (`app/tabs/activities.tsx`) and Overview tab (`app/tabs/overview.tsx`)**: render a
   "Explore experiences" affordance on activity rows that have an `affiliateLink`,
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
- Apply a hard feasibility gate before ranking: the product's meeting point must be reachable from the
  previous/next activity within the itinerary's transfer budget, and its duration plus buffer must fit the
  day's available window. Respect mobility constraints, child/age constraints when known, language, and
  the traveler's stated “avoid” preferences. A high conversion score must never override an infeasible day.
- Add deterministic deduplication: one provider link per canonical activity/product per day, no links for
  already-booked activities, and a capped number of affiliate CTAs per itinerary. Keep the non-monetized
  recommendation ranking independent so affiliate economics cannot reorder the itinerary.

## 7. Compliance — do not skip

- **FTC/affiliate disclosure.** Any UI element that link out through an affiliate/commission link must be
  clearly labeled (e.g. "Booking link — WanderBunnies may earn a commission" near the button, and a
  one-line mention in the app's Terms/Privacy docs). This is a legal requirement in the US (FTC endorsement
  guidelines) and analogous requirements exist in the EU/UK — treat this with the same care this repo
  already gives to Stripe billing/tax compliance (`docs/stripe-premium-subscriptions-checklist.md`,
  `docs/security/key-management.md`).
- **Partner ID / API key handling.** Store the existing
  `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID` and any API key in `server/.env`, read through the validated env
  helper, and never put the API key in the frontend bundle. Deep-links are built by the server endpoint;
  an optional offline client fallback must be explicitly disabled in normal online mode.
- **No dark patterns.** Don't auto-inject a booking link into every single generated activity regardless
  of relevance — that degrades trust in the itinerary and risks looking like undisclosed native
  advertising rather than a genuinely useful "book this" convenience. Gate it (see §8) and keep it
  visually distinct from the itinerary's own (non-monetized) content.
- **Link safety and privacy.** The redirect must use an allowlist, prevent open redirects, avoid putting
  names, email addresses, exact dates, or account IDs in sub-IDs, and honor the app's analytics consent.
  Use an opaque, rotating attribution token with a documented retention period.
- **Content and localization rights.** Follow GYG's rules for displaying names, ratings, images, logos,
  cached availability, and translations. Preserve the source locale/currency and show the retrieval time;
  do not hotlink or retain thumbnails beyond the partner's permitted cache window.

## 8. Feature flag & tier gating

- Add a flag to `server/config/feature-flags.yaml`, e.g. `getyourguide_activity_suggestions` (snake_case,
  matching `car_rentals`/`attractions_transfer_directions_api`'s existing naming convention), so it can be
  killed instantly without a deploy if GYG's program terms change or the integration misbehaves.
- Decide its tier row in `docs/tiers.md`'s entitlement table — a reasonable default is **allowed for all
  tiers** (it's a revenue-generating feature for the business, not a cost center, so gating it behind
  Premium would be counterproductive), but flag this as an explicit product decision to confirm, not an
  assumption to build on silently.
- Add separate controls for `maxAffiliateLinksPerItinerary`, `maxPartnerApiLookupsPerGeneration`,
  `getYourGuideFreshTtlMinutes`, and `getYourGuideStaleTtlHours`. Keep these in server configuration so
  an incident response does not require a mobile rebuild. The flag must be evaluated on generation,
  saved-itinerary rendering, exports, and the redirect endpoint.

## 9. Observability and acceptance gates

Track, by destination and app version, candidate count, links shown, suppression reason, redirect success,
cache hit/stale/negative-hit rates, partner API latency/errors/rate-limit denials, and traveler feedback.
Keep affiliate clicks/conversions and commissions in the separate revenue dashboard; keep provider request
counts and estimated direct costs in the general API admin console. Do not use commission as a relevance
signal. Before broad enablement, require: no broken redirects, no undisclosed affiliate UI, no measurable
increase in itinerary-generation failures, bounded added latency, and an agreed quality sample reviewed by
a travel-planning owner.

## 10. Suggested phased rollout

1. **Phase 0 — partner and policy preflight.** Confirm the current GYG link format, approved domains,
   redirect rules, sub-ID semantics, API quotas, caching restrictions, localization, disclosure wording,
   and whether search links are commission-eligible. Record the answer and a version/date in the plan;
   block production rollout if any required term is unknown.
2. **Phase A — safe deep links.** Implement the server redirect, host allowlist, opaque click reference,
   feature flag, disclosure, bounded candidate selection, and deterministic relevance/feasibility gates.
   Keep the link ephemeral for generated responses and exports. Instrument link impressions/clicks and
   no-link reasons without changing itinerary ranking.
3. **Phase B — API enrichment (only after partner approval).** Add the low-level API/caller modules,
   limiter/admin/cost-estimator entries, schema validation, fresh/stale caches, negative caching,
   single-flight de-duplication, and a circuit breaker. Display only verified product fields with currency,
   timestamp, cancellation/meeting-point notes, and a generic fallback when data is stale or missing.
4. **Phase C — travel-aware matching.** Use account and trip preferences, date/time windows, party size,
   accessibility, budget, language, coordinates, and transfer feasibility to rank matches. Add contextual
   hints only when they are supported by structured activity data; never let affiliate ranking alter the
   core itinerary.
5. **Phase D — measured optimization.** Test CTA wording and placement only after relevance and disclosure
   pass acceptance. Gate experiments, cap exposure, and monitor click-through, downstream booking rate,
   mismatch/complaint rate, cache hit rate, API error/rate-limit rate, and incremental generation latency.
6. **Phase E — operations and decommission path.** Add admin controls for the flag, quotas, cache TTLs,
   and partner status; document data retention and a one-command rollback that removes links without
   invalidating itineraries.

Each phase should land as its own PR, follow this repo's existing test conventions, and pass a running-app
check for UI changes. In addition to unit tests for pure matching/link functions and the existing mocked-
axios itinerary integration test, add redirect security tests (invalid host, malformed/oversized input,
flag off), cache tests (fresh/stale/negative/single-flight), schema-contract fixtures for GYG responses,
and an end-to-end test that verifies disclosure, native/web opening, and graceful behavior when the server
or partner is unavailable. CI must never call the real affiliate endpoint; run a separately authorized
smoke test with a disposable partner configuration.
