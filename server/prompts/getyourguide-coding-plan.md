# GetYourGuide Affiliate Integration — Phased Coding Plan for an LLM

Back to: [Prompt Assets README](README.md) · [Affiliate Integration Suggestions](getyourguide-affiliate-integration-plan.md) ·
[Deep-Link Automation Plan](getyourguide-deep-link-automation-plan.md)

This is the execution plan for implementing the two design documents. An LLM implementing it must keep
GetYourGuide optional: itinerary generation, saved itineraries, PDF/email exports, and the normal activity
UI must remain useful when configuration is missing, the app is offline, the partner is unavailable, or a
partner response is invalid.

## Non-negotiable product and engineering rules

- Phase A is a search/deep-link feature, not a product, price, availability, or “skip-the-line” promise.
- The server owns feature flags, relevance gates, partner configuration, URL construction, host allowlists,
  signed/expiring tokens, and attribution. The client consumes a descriptor and never guesses a URL.
- Affiliate economics must not change the core itinerary ranking, activity descriptions, clustering, travel
  time, or must-see coverage.
- **Master Travel Planner Nuance:** Suggestions must respect the **"Sunday/Monday Trap"** logic (itinerary-improvement-plan.md §4). Do not surface a GYG booking CTA for a category (e.g., Museum) on a day it is likely to be closed, even if the Partner API is slow or unavailable.
- Never render a GYG card, skeleton, placeholder URL, empty booking box, or error banner when the descriptor
  or partner data is unavailable. Remove only the optional affiliate affordance and leave the ordinary
  activity row intact.
- Never put account IDs, names, email addresses, exact personal dates, or raw activity text in a partner
  sub-ID. Keep affiliate clicks/commission in the separate revenue dashboard; provider calls and direct
  request costs remain in the general API admin console.
- Do not implement a guessed GYG URL format or quota. Phase 0 must verify the current partner documentation
  and record the source, version/date, approved hosts, attribution parameters, and cache restrictions.

## Target flow and boundaries

1. The itinerary pipeline deterministically selects a small set of feasible, relevant candidates.
2. The server issues an optional short-lived descriptor (`provider`, `kind`, `token`, `endpoint`, and
   `disclosureRequired: true`). It does not persist a partner URL in the itinerary.
3. The app renders an inline neutral CTA only when the descriptor is valid and the feature is enabled.
4. The app opens the server redirect. The server validates the token and redirects to the currently
   approved GYG URL, recording a consent-aware, minimal click event.
5. Optional Partner API enrichment runs asynchronously and best-effort. It can add verified product data,
   but a miss, timeout, 429, malformed response, or stale result falls back to the Phase-A descriptor or
   removes the optional CTA.

## API limits, accounting, and cost controls

### Phase A (redirect only)

- A browser navigation to GYG is not a server-side GYG API request; do not reserve a `GETYOURGUIDE`
  provider unit for the 302 itself.
- Protect the internal descriptor/redirect endpoints with the existing HTTP rate-limit pattern in
  `server/src/services/httpRateLimitService.ts` — do not invent a new limiter. Concretely:
  `reserveRequestRateLimits({ name: 'getyourguide_redirect', identities: [`user:${userId}` if
  authenticated, `ip:${clientIp}`], limit, windowMs })`, following the exact shape of the existing
  `authLoginRateLimit`/`reserveItineraryGenerationRateLimit` call sites (same file). Wire it as
  middleware that catches `HttpRateLimitExceededError`, sets the `Retry-After` header from
  `err.retryAfterSeconds`, and returns 429 — copy `authLoginRateLimit`'s exact try/catch shape rather than
  writing a new one. Source the limit/window from env vars following this service's existing
  `<NAME>_RATE_LIMIT_MAX`/`<NAME>_RATE_LIMIT_WINDOW_MS` convention (e.g.
  `GETYOURGUIDE_REDIRECT_RATE_LIMIT_MAX`, `GETYOURGUIDE_REDIRECT_RATE_LIMIT_WINDOW_MS`), with the same
  conservative starting values noted below (60/minute/IP, 300/day/account) as the fallback defaults, and
  count this usage separately from GYG provider usage (this limiter's `PROVIDER` constant is
  `HTTP_RATE_LIMIT`, distinct from `GETYOURGUIDE` in `api-limits.yaml` — do not conflate the two counters
  in admin reporting).
- Clicks, conversions, and commission are revenue telemetry, not estimated provider spend.

### Phase B (Partner API)

Before coding the API client, obtain the approved GYG quota and billing terms. Add one provider entry to
`server/config/api-limits.yaml`:

```yaml
  GETYOURGUIDE:
    window: hour
    windowHours: 1
    overall: <approved-provider-window-quota-with-headroom>
    callers:
      GETYOURGUIDE_ITINERARY_ENRICHMENT: <approved-caller-quota>
      GETYOURGUIDE_ACTIVITY_LOOKUP: <approved-caller-quota>
```

Use conservative quotas with at least 20% headroom. Every uncached API request **must** use the app's standard usage control:

1. reserve through `reserveApiUsageOrThrow({ provider: 'GETYOURGUIDE', caller })`;
2. call `recordProviderRequestCost({ provider: 'GETYOURGUIDE' })` using the same accounting path as other
   providers; and
3. record status, latency, cache state, and rate-limit denial without logging personal data.

Add `GETYOURGUIDE: 0` to `requestPricing` only after confirming the API is free. If GYG charges for access,
make the amount editable in the existing cost-estimator admin panel and add the provider to its tests. A
zero price means “no direct request charge,” not “skip usage accounting.” Do not add Google, geocoding, or
other APIs for Phase A; reuse itinerary coordinates and existing cached metadata.

## Phase 0 — partner preflight and implementation contract

LLM tasks:

- Read both GYG design documents, the existing API-limits/cost-estimator code, feature-flag loader, route
  registration, `httpRateLimitService`, TTL cache, activity types, itinerary pipeline, and UI link opener.
- Verify the current GYG partner docs/dashboard: approved domains and paths, search-link eligibility,
  partner ID/API-key requirements, sub-ID rules, redirect restrictions, quotas, price/currency/locale rules,
  image/content rights, caching limits, disclosure language, and reporting fields.
- Record those facts and their verification date in a small config/contract note. Treat unknown facts as
  blockers for production, not assumptions.
- Define configuration keys and defaults: feature flag, partner status, redirect TTL, per-itinerary CTA cap,
  per-generation API lookup cap, fresh/stale cache TTLs, internal redirect throttles, and a kill switch.

Exit criteria:

- No guessed GYG URL or quota remains in code or tests.
- Missing partner configuration disables the optional feature without affecting ordinary itinerary output.
- Product owner approves neutral CTA wording and disclosure placement.

## Phase 1 — shared domain rules and pure matching

Files/tasks:

- Add a shared, versioned eligibility contract for activity type, normalized name, destination/country,
  coordinates, date/time window, duration, party-size bucket, language, budget/comfort, mobility/accessibility,
  must-see status, already-booked state, and avoid preferences.
- Implement pure functions for name specificity, activity-type eligibility, destination disambiguation,
  feasibility against adjacent travel legs, deterministic deduplication, and the per-itinerary cap.
- Use account preferences and trip preferences as ranking/filter inputs only; never use affiliate commission
  to reorder the itinerary. Keep the core itinerary/activity description source hierarchy unchanged.
- Version the rules so later tuning does not silently rewrite historical itineraries.

Tests and exit criteria:

- Unit-test every allowlist/blocklist branch, Unicode/whitespace normalization, ambiguous destinations,
  missing coordinates, time-zone boundaries, overnight activities, transfer buffers, mobility constraints,
  must-see priority, **Sunday/Monday closure warnings**, already-booked suppression, duplicates, and cap enforcement.
- Target 100% branch coverage for these pure functions and mutation-test the highest-risk gates.
- Snapshot a representative multi-destination itinerary to prove activity order, clustering, descriptions,
  and travel times are unchanged when affiliate logic is enabled.

## Phase 2 — server descriptor and secure redirect (deep links only)

Files/tasks:

- Add a server affiliate service and route (for example `/api/affiliate/getyourguide`) that issues a signed,
  expiring, opaque descriptor/token. Keep partner configuration server-only.
- Validate authentication/ownership where required, feature flag, activity eligibility, token expiry, input
  length/control characters, and approved destination/activity fields. Never accept an arbitrary destination
  URL. Build the final GYG URL in one server-owned function and enforce a host/path allowlist.
- Add consent-aware minimal click telemetry with an opaque attribution token and documented retention.
- Register the route and ensure errors return a clean 404/204 or safe JSON state—not a GYG-looking placeholder.
- Do not call the GYG Partner API in this phase; the redirect is the only external navigation.

Tests and performance:

- Unit-test signing/expiry, canonical URL construction using approved contract fixtures, Unicode encoding,
  allowlist rejection, replay/invalid tokens, feature-off behavior, absent configuration, and privacy-safe
  telemetry.
- Integration-test authenticated/unauthenticated access, 302 behavior, 429 throttling, `Retry-After`, and
  that partner IDs/raw personal data never appear in logs.
- Keep descriptor generation under 50 ms p95 and redirect route work under 100 ms p95 excluding the final
  browser navigation. No generation request may wait on this route.

## Phase 3 — clean cross-platform UI and exports

Files/tasks:

- Add a client descriptor consumer in `app/utils/getYourGuideLinks.ts`; it may mirror pure display checks
  but must not construct partner URLs in normal online mode.
- Wire a neutral, localized, accessible CTA into `activities.tsx` and `overview.tsx`, reusing the existing
  web/native opener. Render the affiliate disclosure adjacent to the CTA and in PDF/email exports.
- **Conversion Optimization:** Show “Explore experiences on GetYourGuide ↗” for Phase A. For iconic landmarks identified in the catalog (e.g., Eiffel Tower), prefer **"Get Skip-the-Line Tickets ↗"** to maximize relevance and CTR.
- If the descriptor request is slow, offline, malformed, disabled, or unavailable, render the ordinary
  activity row immediately with no GYG placeholder, empty slot, spinner, or error banner.

Tests and exit criteria:

- Component-test qualifying/non-qualifying activities, missing descriptor, feature off, offline, malformed
  descriptor, disclosure visibility, keyboard/screen-reader labels, web new-tab behavior, and native link
  opening.
- E2E-test a trip containing mixed activity types and verify that only eligible rows show the CTA; verify
  PDF/email output has either a valid link plus disclosure or no affiliate element at all.
- Verify no layout shift or more than 100 ms p95 added time to first ordinary activity render.

## Phase 4 — itinerary integration and travel-aware candidate selection

Files/tasks:

- In `itineraryPromptPlanService.ts`, run deterministic candidate selection after activity metadata and
  travel legs are available, not inside the LLM prompt.
- Inspect only the bounded top candidates (for example two per day and a configurable itinerary cap). Use
  verified coordinates, opening/time windows when available, duration plus buffers, adjacent transfer time,
  account/trip preferences, budget, mobility, language, must-sees, and booked activities.
- Issue descriptors in parallel with a strict concurrency limit only after Phase 2 is available. Never make
  one network request per activity, and never block the route/day cache or itinerary response on a descriptor.
- Ensure the existing undefined-value cache sanitizer also covers any optional affiliate fields.

Tests and performance:

- Integration-test generation, route/day cache hits, partial failures, multiple destinations, arrival/departure
  days, impossible transfer windows, and the invariant that affiliate enrichment cannot reorder or remove
  core itinerary activities.
- Add property tests for idempotent candidate selection and deterministic output under input reordering.
- Budget no more than 1–2 seconds p95 of background enrichment and zero added critical-path latency; cancel
  work when the request is aborted.

## Phase 5 — optional Partner API enrichment

Only start after Phase 0 approval and Phase 2–4 acceptance.

Files/tasks:

- Implement `server/src/apis/getYourGuideApi.ts` with timeout, abort, bounded retries for 429/5xx, schema
  validation, safe logging, limiter reservation, cost recording, and a circuit breaker. Never retry 4xx,
  invalid credentials, or malformed responses.
- Implement named callers in `server/src/apis/getYourGuideCallers.ts`. Use normalized cache keys containing
  destination/country, activity concept, date bucket, party-size bucket, language, accessibility, and budget;
  never use raw user IDs.
- **Performance:** Use a **Stale-While-Revalidate (SWR)** pattern for API results to ensure the UI remains snappy. A stale result from the cache is better than a spinner, provided it is eventually updated.
- Cache resolved product IDs, normalized metadata, and negative/no-match results separately. Use fresh/stale
  TTLs, stale-while-revalidate, single-flight de-duplication, and a maximum result count. Do not cache
  user-specific URLs, sensitive preferences, or data beyond GYG's terms.
- Display only verified fields with currency, locale, `lastVerifiedAt`, duration, meeting point, cancellation
  notes, and accessibility information. A stale/missing field is omitted rather than replaced with a guess.
- Keep API enrichment asynchronous and best-effort. Fall back to the Phase-A descriptor; if that is also
  unavailable, remove the affiliate element and keep the ordinary activity UI.

Tests and performance:

- Mock all HTTP in CI. Test success, empty results, malformed JSON/schema, timeout, abort, 401/403, 404,
  429/Retry-After, 5xx, circuit-open, limiter denial, cost-accounting failure, cache fresh/stale/negative,
  stampede de-duplication, and provider-disabled states.
- Add contract fixtures for each approved GYG response version and a separately authorized smoke test using
  disposable credentials. Never use production affiliate credentials in CI.
- Set a provider API budget per generation and per day; fail closed when exhausted. Target cache-hit p95
  under 20 ms, stale-response p95 under 100 ms, and never add partner API latency to itinerary generation.

## Phase 6 — admin, observability, and controlled rollout

Files/tasks:

- Add `GETYOURGUIDE` to `api-limits.yaml`, `requestPricing`, cost-estimator provider metadata, admin API-limit
  display, and cost-estimator tests. Keep this separate from the affiliate revenue/commission dashboard.
- Add admin visibility for feature state, configured quota, usage by caller, cache hit/stale/negative rates,
  latency/errors/429s, click-through, suppression reasons, and partner health. Do not expose raw tokens or
  personal data.
- Add a kill switch that applies to generation, saved-itinerary rendering, exports, descriptor issuance, and
  the redirect endpoint. A disabled state must remove the optional UI cleanly without invalidating trips.
- Roll out disabled → internal testers → small cohort → broad enablement. Review a human travel-quality sample
  before each expansion and monitor broken redirects, mismatch complaints, latency, cache behavior, and
  disclosure visibility.

## LLM execution loop

At the end of each phase, the implementing LLM should:

1. inspect the diff and preserve unrelated working-tree changes;
2. run `npm run typecheck` in both `server/` and `app/`;
3. run focused tests with `server/npm run test:single -- --runInBand <suite files>` and
   `app/npm run test:single -- <suite files>`;
4. run `git diff --check`, review logs for secrets/PII, and record cache/latency/limiter evidence;
5. only then proceed to the next phase. Never enable the provider flag or call the real GYG endpoint from
  ordinary CI.

## Final definition of done

- `npm run typecheck` passes for server and app.
- Focused server suites pass for API limits, cost estimator, route security, matching, cache, and itinerary
  integration; focused app suites pass for UI and link behavior.
- Full server/app test suites pass, or documented unrelated failures are isolated and approved.
- Performance checks meet the phase budgets and no external call is on the itinerary critical path.
- Offline, missing-config, timeout, 429, malformed-response, feature-off, and provider-disabled states all
  produce a clean ordinary itinerary with no GetYourGuide placeholder, broken card, or misleading CTA.
- Documentation records the verified partner contract, quota source/date, data-retention policy, rollback
  procedure, disclosure text, and separate revenue-vs-provider-cost ownership.
