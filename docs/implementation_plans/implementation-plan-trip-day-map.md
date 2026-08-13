# Trip Day Map — Implementation Record

**Status:** Implemented, behind `trip_day_map` feature flag (default off — no API key
configured yet). Not yet enabled in any environment.
**Last updated:** 2026-08-12
**Authors:** assistant, in collaboration with @tristanduerk
**Supersedes:** §5.1 of `implementation-plan-wanderlog-competitive-analysis.md`, which
proposed a `react-native-maps` + Google Maps JS interactive map. That approach was not
built — see §1 for why.

---

## 1. What shipped, and why it differs from the original proposal

The competitive-analysis doc's Phase 1 proposal was an interactive, pannable/zoomable
map using `react-native-maps` (native) + a Google Maps JS renderer (web). Before writing
any code, reading the actual codebase surfaced a better option:

- `server/src/routes/staticMapRoutes.ts` already existed — a cached, rate-limited,
  cost-tracked, authenticated proxy in front of Google's **Static Maps API**, used today
  for a single-address preview in `LodgingDetailsDialog.tsx`.
- Google Places API calls are disabled **app-wide, deliberately, across three separate
  commits** ("Shut off Google places for now," etc.) — almost certainly a past cost or
  reliability decision. Building a map that depends on re-enabling Places/Geocoding
  would have quietly reversed that.

Given that, the interactive-map approach was rejected in favor of extending the
existing static-map proxy to accept multiple labeled points instead of one. This
choice was confirmed with the user before implementation (not assumed):

| | Interactive map (rejected) | Static map (built) |
|---|---|---|
| New native dependency | `react-native-maps`, needs an EAS rebuild | None |
| Web renderer | Separate `@vis.gl/react-google-maps`-style component | Same `<Image>` on native + web |
| API key exposure | Client-side (web), mitigated only by HTTP-referrer restrictions in the Google Cloud console | Never leaves the server |
| Cost per load | ~$7/1000 (Dynamic Maps) | ~$2/1000 (Static Maps) |
| Geocoding | Needs resolved lat/lng for a smooth pan/zoom experience | Accepts free-text addresses directly; Google resolves them internally |
| Interactivity | Pan/zoom/tap pins | None — a picture that re-renders when the itinerary changes |

**What this costs us:** no pan/zoom, no tap-to-open-pin, and — the one worth calling
out explicitly — **no connecting route line between pins in v1.** Google's `path`
parameter (the line Wanderlog draws between same-day stops) requires real `lat,lng`
pairs; it does not accept address strings the way `markers` does. Since Lodging,
Activities, and Car Rentals only store free-text addresses today (confirmed by reading
`server/src/types.ts` — only `Flight`→airport and the curated `AttractionCatalogEntry`
catalog carry real coordinates), drawing a path would require a separate geocoding
step, which is exactly what the "use address strings directly" decision was about
avoiding. So v1 ships **pins only**. A route line is a legitimate Phase 2, and the
honest way to get there is a small, cached geocoding step via **Nominatim** (free,
OpenStreetMap-based, already integrated for merchant-category lookups in
`merchantCategoryLookupService.ts` — a different provider than the disabled Google
Places, so it doesn't touch that decision) rather than re-enabling Places.

---

## 2. What was built

### Backend

- **`GET /api/maps/trip-day`** in `server/src/routes/staticMapRoutes.ts` (same router
  as the pre-existing `/api/maps/static`, so it inherits `authenticate`).
  - Gated by `isFeatureEnabled('trip_day_map')` — returns `403 { code: 'FEATURE_DISABLED' }`
    when off, before touching cache, rate limits, or Google at all.
  - Accepts `?points=<JSON array>`, each item `{ kind, label?, address? | (lat, lng) }`.
  - `normalizeTripMapPoints()` validates and normalizes: drops unusable entries,
    truncates to a configured cap (`caching.googleStaticMaps.maxPointsPerTripDayMap`,
    default 12) rather than erroring the whole request, caps address length at 200
    chars, and auto-assigns A/B/C… labels when the caller doesn't supply one.
  - One color per entity kind: flight=blue, lodging=orange, activity=green,
    car_rental=purple.
  - Reuses the exact same cache (`createTtlCache`, 24h TTL), rate limiter
    (`reserveApiUsageOrThrow`), and cost tracker (`recordProviderRequestCost`) as the
    pre-existing single-address route — just under a new caller name (`TRIP_DAY_MAP`)
    so its volume and cost are visible separately.
  - Cache key is the JSON-serialized, order-preserved point list — any edit to the
    day's itinerary produces a new key automatically; no manual invalidation needed.
- **`server/config/api-limits.yaml`**:
  - `providers.GOOGLE_STATIC_MAPS.callers.TRIP_DAY_MAP: 300`/day (existing
    `STATIC_MAP_PREVIEW` caller stays at 500; provider `overall` cap raised 500→800).
  - `budgeting.GOOGLE_STATIC_MAPS: { monthlyBudgetUsd: 15, alertThresholdPercent: 80 }` —
    new; see §3 for how this number was chosen.
  - `requestPricing.GOOGLE_STATIC_MAPS: 0.002` — **this provider had no real price
    configured before** (`0`, a placeholder), even though the pre-existing
    `STATIC_MAP_PREVIEW` caller has been live since the lodging dialog shipped. Cost
    tracking was silently recording $0 for every call. Fixing this makes that
    existing feature's cost visible too, not just the new one.
  - `caching.googleStaticMaps.maxPointsPerTripDayMap: 12`.
- **`server/config/feature-flags.yaml`**: `trip_day_map`, `enabled: false`.

### Frontend

- **`app/utils/googleMaps.ts`**: `buildTripDayMapUrl(points, backendUrl)` — mirrors
  the server's point contract (kept in sync by hand; there's no shared types package
  wired up between `app/` and `server/` for this yet), caps to 12 points client-side
  too (defense in depth, not the enforcement point), returns `''` when there's nothing
  to render.
- **`app/components/TripDayMap.tsx`**: renders the `<Image>` with the auth header
  pattern already established in `LodgingDetailsDialog.tsx`
  (`{ uri, headers: requestHeaders }`). Fails **silently** (renders nothing) on image
  load error — matches how the existing day-hero background image already degrades to
  a plain color box instead of showing an error banner. This is deliberate: while the
  flag is off (today) or no key is configured, every request 403s/503s, and that's not
  something an end user needs an explanation for.
- **`app/tabs/overview.tsx`**: in the day-detail branch, assembles `dayMapPoints` from
  the day's flights (departure + arrival), lodgings (address), tours (start location),
  and car rentals (pickup + dropoff, deduped if identical), in that order, and renders
  `<TripDayMap>` right after the existing hero card.

### Tests

- `server/__tests__/tripMapPoints.test.ts` — 10 tests, pure `normalizeTripMapPoints()`
  logic (truncation, invalid entries, coordinate precedence, label handling).
- `server/__tests__/tripDayMapRoute.test.ts` — 8 tests against the live route via
  `supertest` + `pg-mem`: flag off, auth required, happy path + cache hit (asserts the
  upstream Google URL via `URL`/`searchParams`, not brittle string matching), point
  truncation, malformed/empty input, missing API key (503), rate limit exhausted (429).
- `app/tests/googleMaps.test.ts` — 6 tests for `buildTripDayMapUrl`.
- `app/tests/TripDayMap.test.tsx` — 4 tests: empty states, correct URL + headers,
  collapses to nothing on image error.
- Full suites re-run after all changes: **server 1599/1602 passing** (3 pre-existing
  failures in `brandingAssets.test.ts` and `destinationAttractionAutocompleteService.test.ts`
  — unrelated to this change, confirmed via `git status` that neither file was touched),
  **app 818/818 passing** (2 pre-existing suite-level compile failures from a missing
  `react-native-svg` type declaration in `GoogleLogo.tsx`/`AppleLogo.tsx` — also
  unrelated, same failure reproduces on a plain `tsc --noEmit` with no changes applied).

---

## 3. Cost estimate

Google Static Maps standard tier: **$2 per 1000 loads** ($0.002/request).

- Hard ceiling from the configured caps: `TRIP_DAY_MAP: 300/day` × 30 days = 9,000
  requests/month = **$18/month worst case**, and that's before the 24h response cache
  is accounted for.
- In practice: a day's map only re-fetches from Google when its point set actually
  changes (new cache key) or the previous cache entry has expired (24h TTL). Repeat
  views of an unchanged day within the same 24h window cost nothing beyond the
  in-memory cache lookup.
- `budgeting.GOOGLE_STATIC_MAPS.monthlyBudgetUsd` is set to **$15** — below the
  worst-case ceiling on purpose, so the 80% alert threshold (`$12`) fires while there's
  still real headroom before the hard caller/day caps would even matter.
- This budget and the two rate caps (`overall: 800`/day across both map callers,
  `TRIP_DAY_MAP: 300`/day specifically) are all editable in `api-limits.yaml` without a
  code change — the admin cost-estimator panel mentioned in that file's comments
  (Phase 3) would also surface this once built.

**What this doesn't cover:** GCP's own account-level Maps Platform pricing tiers,
volume discounts, or any promotional credit that may or may not apply to this specific
billing account in 2026 — I don't have visibility into the account's actual Google
Cloud billing setup, so the number above is the request-volume-based estimate from
published per-request pricing, not a guarantee of the actual invoice.

---

## 4. Setup steps (not done — needs a human with GCP console access)

1. In the Google Cloud project already used for Places (`travel-itinerary-app-483623`
   per `server/.env`), enable the **Maps Static API**.
2. Create (or reuse) an API key. Restrict it to the Static Maps API specifically —
   this key never reaches a browser (the server proxies every request), so IP
   restriction to the server's egress IP(s) is also worth considering, tighter than
   the HTTP-referrer restriction a client-exposed key would need.
3. Set `GOOGLE_STATIC_MAPS_API_KEY` in the real `server/.env` (or wherever production
   secrets are actually managed — `server/.env` is the local dev source per
   `CLAUDE.md`). Falls back to `GOOGLE_MAPS_API_KEY` if that's already set for
   something else.
4. Confirm a GCP budget alert exists on this project (or add one) independent of the
   in-app `budgeting.GOOGLE_STATIC_MAPS` check — the in-app check can only alert via
   the app's own logging, not stop a runaway bill by itself if something bypasses it.
5. Flip `trip_day_map` to `enabled: true` in `feature-flags.yaml` (seed default) or via
   the admin panel (DB value wins at runtime either way, per the existing feature-flag
   precedence rules in `docs/feature-flags.md`).

None of this was done as part of this session — I don't have Google Cloud console
access, and creating billing-relevant cloud resources isn't something to do without
you present regardless.

---

## 5. Known limitations / explicit non-goals for v1

- **No connecting route line.** See §1 — needs a geocoding step this version
  deliberately doesn't add. Real Phase 2 candidate via Nominatim.
- **No pan/zoom/tap.** It's a picture, not a map widget. Google auto-fits the viewport
  to whichever pins are present (no `center`/`zoom` params sent), so it always shows
  the whole day, just not interactively.
- **Marker geocoding accuracy is Google's best-effort address match**, same as any
  address string typed into Google Maps search — not a verified/pinned coordinate.
  Good enough for "does this day's plan make geographic sense," not survey-grade.
- **Day view only.** No trip-wide multi-day map. The original competitive-analysis
  doc flagged this as an open question (day vs. trip-wide) — this implementation
  answers it by building day-only, since that's what the existing day-detail view
  already had a natural slot for.
- **No live-app visual confirmation from me.** Local end-to-end verification via a
  real browser was blocked by a pre-existing, unrelated gap: `server/src/ingestion/shared/repository.ts`
  talks to Firestore unconditionally regardless of `DB_PROVIDER`, and this dev
  environment has neither a running Firestore emulator nor (safely) production
  credentials I should be pointing local runs at. Verification instead relied on the
  automated test suites (§2) plus a manual line-by-line audit of the `overview.tsx`
  diff against the real `Flight`/`Lodging`/`Tour`/`CarRental` type definitions (that
  file is `@ts-nocheck`, so this specific risk — a typo'd field name — isn't caught by
  the compiler). Worth an actual browser check once a real API key exists and the flag
  is flipped on somewhere reachable.
