# Public maps, keepsakes, native maps and optional geocoding

Implemented 2026-10-20. Rollout remains independent from native encrypted storage.

## Behavior and privacy

- Public readers request `/public/blog/:username/:tripSlug/maps` separately from cached prose. The server resolves publication before and after projection, returns `private, no-store`, selects only public, ready, unblocked media and checks location-sharing consent again. Exact EXIF, media IDs and private lodging coordinates never enter this response. Lodging-adjacent cells are suppressed by the existing 1.5 km rule; approximate points use its 0.01-degree grid and two-cell minimum. The public reader clears/rechecks maps on visibility changes and every 30 seconds. Previously downloaded exports cannot be revoked.
- Authenticated `/api/trips/:id/blog/maps` resolves membership before and after reading. Travelers can see their own exact points; followers see only consented coarse points from their visible audiences. `?shared=1` always selects public-only, consented approximate locations, including for travelers. Both adapters implement the same projection.
- The recap requests fresh map points separately; recap snapshots persist no coordinates. Account/trip/preview changes fence day-map results. In-app public previews do not reuse traveler map points.
- Keepsake export requests `?shared=1`. It captures at most six 640×400 JPEG maps sequentially, at most 1 MB each, with a four-second renderer budget each. Only the export instance preserves its drawing buffer. It waits for map idle (including glyph/tile work), includes attribution and numbered coarse-area lists in the HTML, and disposes its renderer/host on every exit. Up to 60 days retain area lists; failed, oversized or unavailable images are explicitly labeled. Print waits for document images/fonts, with a five-second fallback. Native PDF exports currently use those area lists; real-device `expo-print` image capture remains a later compatibility check.
- MapLibre GL JS 6 needs its external module worker at an explicit URL after Metro bundling. Both web launch/export scripts generate a versioned same-origin worker asset from the pinned package. No CDN or new CSP origin is needed. Live and export maps use one shared worker.

## Native renderer

`@maplibre/maplibre-react-native` is pinned to 10.4.2 and its Expo config plugin is registered for app-root and workspace-root builds. The renderer has markers, selection, bounds, numbered visit-order lines, attribution, list/external-link fallback, load failure/timeout handling and foreground/background disposal.

Activation requires BOTH a new EAS binary built with `NATIVE_MAP_RENDERER=1` and the DB flag `planning_native_map`. The flag defaults off and missing flag rows deny native rendering. Existing binaries, Expo Go, and disabled builds keep the list/Google live-view path; Google routes and keys have not been retired. A flag rollback is independent of storage rollout. Rebuild native apps after adding this dependency; an OTA update cannot install native code.

Before enabling: run named iOS/Android EAS builds; verify new-architecture compatibility, gestures, VoiceOver/TalkBack, attribution, low-memory behavior, background/resume and Expo Print. Source checks and mocked native tests are not device compatibility evidence. Retire legacy Google/artifact infrastructure only after the supported old-client window closes.

## Optional public-POI geocoding

There is no default external endpoint. A Nominatim-compatible self-hosted or contracted endpoint is supported. The public OSM endpoint is rejected: its policy does not authorize a generic, recurring distributed worker. No arbitrary user-entered addresses, private lodgings, car-rental addresses, autocomplete or bulk backfill are submitted.

For unresolved current activity stops, resolution reuses item/airport/catalog coordinates before looking at the public-POI cache. Only an exact match to a server-side catalog record with an approved reusable source can enqueue lookup. Names/context come from that catalog record, not request text. Results overlay the current map response; the worker never overwrites an item or an edited address. Merchant classification now uses the same catalog queue/cache/admission and no longer independently sends arbitrary merchant text to public Nominatim. This intentionally narrows the older lookup feature.

The bounded state record holds at most 150 jobs/cache entries and 700 KB, using a PostgreSQL row transaction or Firestore document transaction. Cache keys include normalized name, locality, country, language and operator-supplied provider/normalizer version. Reviewed positive cache TTL is at most 30 days; negative TTL at most one day. The mandatory policy can shorten either retention period (minimum 60 seconds). Cache/job keys also bind the endpoint, policy revision/permissions, attribution, retention and normalizer revision; changing the provider contract cannot reuse old results. Failures use exponential backoff and become visible dead jobs after four attempts (retained one day). Admission permits one in-flight provider request across instances and at least 15 seconds after release. Thirty-second renewable/fenced ownership surrounds an eight-second hard-deadline provider operation with a 64 KiB body limit and no redirects. Provider requests are bound to a live job key and lease before quota is spent; ownership is renewed/rechecked after awaited quota/flag checks. Stale workers cannot commit. Failed/oversized repository mutations cannot leak in-place JSON changes. A daily atomic UTC request budget defaults to 100, is capped by the reviewed policy and can be lowered to zero. Quota exhaustion defers until the next UTC day without consuming job attempts; Retry-After on 429/503 establishes a durable app-wide cooldown (bounded to one day). Cache hits do not consume provider quota. Cache pressure evicts completed records, never pending work; provider-version changes retire old-version entries. Strict provider-side concurrency guarantees still require endpoint admission controls: a database lease cannot cancel HTTP already sent by a suspended process.

Apply `server/migrations/20261020_add_geocoding_state.sql` for PostgreSQL. Firestore initializes its single state document transactionally, with no new composite index. Set the following only after documenting endpoint input, storage, export and attribution rights:

```text
GEOCODING_SEARCH_URL=https://your-reviewed-service.example/search
GEOCODING_USER_AGENT=WanderBunnies/1.0 (a real operator contact)
GEOCODING_PROVIDER_VERSION=your-provider-and-normalizer-version
GEOCODING_PUBLIC_POI_APPROVED=1
GEOCODING_MAX_DAILY_REQUESTS=100
GEOCODING_POLICY_JSON_FILE=/run/config/geocoding-policy.json
```

The policy file is a mandatory operator assertion after an actual terms/privacy/storage/display/export review. The approval boolean alone is insufficient. For example, replace the example terms URL and attribution with the reviewed endpoint's actual requirements:

```json
{
  "revision": "review-2026-10-20",
  "termsUrl": "https://your-reviewed-service.example/terms",
  "publicPoiInputs": true,
  "storage": true,
  "display": true,
  "export": true,
  "attribution": "Your reviewed provider and dataset attribution",
  "positiveTtlSeconds": 2592000,
  "negativeTtlSeconds": 86400,
  "minIntervalMs": 15000,
  "dailyRequestLimit": 100
}
```

`GEOCODING_POLICY_JSON` can instead hold this JSON directly. Unknown fields, missing permissions, non-HTTPS terms, invalid retention/rate values or absent attribution fail closed. This first release requires permission for storage, text attribution/display and export; do not activate a contract whose additional requirements the client does not meet. Text attribution is carried with the map points and shown on both renderers, including the list fallback. Manual/catalog/airport coordinates retain their existing resolution priority.

Then enable `planning_geocoding` in the DB. Every external lookup checks this flag; missing configuration/flag denies external work without blocking item saves or the itinerary. Configure a trusted scheduler to POST `/api/internal/blog/geocoding` with `X-Ingestion-Worker-Secret` (existing `INGESTION_WORKER_SHARED_SECRET`); one request processes at most one job. GET on the same path returns enabled/pending/ready/dead counts, next admission time and dead-job key/attempt/error-code diagnostics without query text. Keep this scheduler running when the flag is off: POST/GET also purge expired records and withdraw cached results when policy approval disappears. Expiry is enforced on every lookup; physical cleanup depends on this scheduled maintenance. No scheduler, provider account, production flag or secret was changed by this implementation.

Provider selection via Stripe Directory query `geocoding API` was unavailable because the local CLI authentication expired; no provider account was selected or purchased. The configurable interface allows a separately reviewed deployment decision.

## Find locations (Geoapify), 2026-10-21

Lodging, car rentals and most typed-in activities have no coordinates, because the public-POI worker above only
handles reviewed catalog places. "Find locations" fills that gap on request, with Geoapify.

- **Who and when:** a trip member presses **Find locations for N stops** under the day map (or the item has no
  pin yet). Nothing runs in the background and nothing is backfilled.
- **What leaves the server:** one address per stop, read from the item's own saved address (`POST
  /api/trips/:id/locate-item` takes `kind`, `itemId` and for rentals `which`, never free text). A bare place
  name gets the trip's destination appended. No traveler names or other fields are sent.
- **Result:** stored with `coordinateSource = 'geocoder'` through `setItemCoordinates`. An item that already has
  coordinates is never replaced, so a hand-set or catalog location wins. A match below 0.5 confidence is treated
  as not found, since a wrong pin is worse than none.
- **Credit:** Geoapify allows storing results if the data-source attribution travels with them, and its free plan
  needs a visible follow-link. The day-map response adds `coordinateAttribution`
  ("Locations by Geoapify · © OpenStreetMap contributors"), `coordinateProvider` and `coordinateCreditLinks` to every
  stored geocoder point, and the map renders those links ("Powered by Geoapify" for this provider).
- **Setup:** set `GEOAPIFY_API_KEY` (a `_FILE` secret also works) in `server/.env` and restart. Without a key the
  route answers 503 `NOT_CONFIGURED` and the button is hidden. `GEOCODER_MAX_DAILY_REQUESTS` (default 500;
  `GEOAPIFY_MAX_DAILY_REQUESTS` is still read if it is unset) is a hard cap shared by all users, and
  `ITEM_LOCATE_RATE_LIMIT_MAX` / `_WINDOW_MS` limit each person (default 40 per 10 minutes).
- **Switches:** the `planning_locate_items` flag (seeded on, fail-closed, toggle in Admin) turns it off instantly.
  The map itself still needs `planning_web_map`.
- **Key safety:** the key goes in a query parameter because that is how Geoapify authenticates, so the request
  URL is never logged. The adapter reduces provider errors to a short code, and the shared layer does it again for
  any error an adapter lets through, so a URL or key cannot leave the geocoding layer.

### Accuracy rules and what real addresses did (2026-10-21)

A confidence score is not enough on its own, so the shared layer and the lookup service add these rules. They were
chosen after live lookups with a real key against the Japan trip's own addresses.

- **Minimum confidence 0.5.** A weak match becomes "not found", never a pin. Without it, a nonsense query returned
  invented coordinates (confidence 0) and a rough Asakusa address landed in Fuchu (0.29).
- **Stay in the trip's country.** The country comes from the trip destination (`countryFromPlace`; "Georgia" is
  ambiguous and gives no restriction). A match in another country is kept only at 0.8 or higher; otherwise the lookup
  repeats restricted to the trip's country and that answer must itself be confident. This fixed a hotel name that
  resolved to **Copenhagen at 0.62**; restricted to Japan it resolved to Asakusa at 0.76. Each provider request counts
  against the daily cap.
- **Address, then name.** Japanese block-number addresses (`Asakusa 2-6-7`) are mostly absent from open map data to the
  building, while the place's name is found. So a lodging or activity whose address has no confident match is searched
  again as `name, place names from its address` (street and block numbers dropped, because adding a partial address
  found a same-named hotel in Yokohama). Car rentals use the address only.
- **No proximity bias.** Biasing toward a point pulled Kanazawa results toward Tokyo, so only the country filter is used.

Result with the 13 hotels and activities of the Japan trip: **11 located, all in the right place, none in the wrong
country**; Kawaguchiko Lakeside Hotel and Koyasan Shukubo Yochiin were left unpinned (matches were only city-level).
Lower-confidence pins (0.5 to 0.7, for example Royal Park Hotel Kurashiki) are usually the right town but can be a
street or two off; there is not yet a way to mark a pin "approximate".

### Provider adapter

The provider sits behind `GeocoderAdapter` (`server/src/services/geocoder/types.ts`). Nothing outside
`server/src/services/geocoder/` names a provider: the route, `locateItemService`, the day-map credit and the app all
read the active adapter.

| Piece | Where | Responsibility |
|---|---|---|
| `GeocoderAdapter` | `types.ts` | `id`, `displayName`, `credit` (text and required links), `isConfigured()`, `geocode(query, { language, signal })` |
| `geoapifyAdapter` | `geoapifyAdapter.ts` | The only provider-specific code: its URL, credential, response shape and failure mapping |
| `geocodeAddress()` | `index.ts` | Rules every provider gets: query bounds, per-provider daily cap, 8 s timeout, 0.5 minimum confidence, coordinate range check, and reducing any error to a `GeocoderError` code |
| `getGeocoder()`, `storedCoordinateCredit()` | `index.ts` | Select the provider (`GEOCODER_PROVIDER`, default `geoapify`; an unknown id means "not configured", never a silent fallback) and supply the credit shown on stored coordinates |

To add a provider: implement the interface in a new file, call `registerGeocoder(adapter)` where the registry is built,
set `GEOCODER_PROVIDER` to its id, and review its terms for storage, display and attribution. Add it to
`GEOCODER_PREVIOUS_PROVIDERS` when you switch away from one whose results are still stored, because coordinates do not
record which provider found them and its credit has to keep showing.

- **Not covered:** flights (placed by airport code), trains and stations, and the existing catalog worker, which is
  unchanged. Tested with a mocked provider only: no live call was made, so check one real address after adding the key.

Review before wide use: Geoapify's full terms (including the free plan's "limited commercial use"), your privacy
policy wording for sending a stop's address to a geocoder, and a sample of real addresses for accuracy.

## Verification

- Focused frontend tests cover keepsake safety/fallback, native flag/load failure/background lifecycle, public reader, recap, trip-day map and blog controls.
- Backend tests cover projection, public publication/revocation, consent withdrawal, shared export, durable adapter storage, normalized/deduplicated cache keys, bounded queue, provider admission, stale-owner fencing, negative cache, retry/dead jobs, response bounds and daily quota.
- The same map/storage/public tests pass against the Firestore emulator as well as the default memory adapter. Real PostgreSQL contention/multi-instance latency remain deployment checks.
- Local Chromium captured a visible Paris map (~73 KB), with two numbered markers and zero remaining canvases. The worker-load failure path also returned labeled areas and zero canvases. A production web export includes the versioned worker asset. Actual native device/EAS, deployed CSP, provider rights/configuration and production delivery evidence remain open.

Primary references: [MapLibre Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/), [MapLibre v10 migration](https://maplibre.org/maplibre-react-native/docs/setup/migrations/v10/), [MapLibre GL JS Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/), [OSMF Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

Latest local results: 9 frontend suites / 45 tests; 8 backend suites / 35 distinct tests across focused runs; Firestore emulator parity 3 suites / 11 tests. Frontend TypeScript, backend build, production web export and diff checks passed. Full workspace suites and real native builds were not run for this slice.


## Geocoding policy/recovery continuation — 2026-10-20

Implemented explicit reviewed policy, endpoint/policy-scoped retention, reviewed attribution propagation, hard fetch/body deadlines, quota deferral, Retry-After cooldown, lease/query binding, stale completion fencing and redacted diagnostics. Durable state remains in the existing Postgres/Firestore adapter contract and migration; new job diagnostics are additive JSON fields and need no new schema migration. Pending jobs are never evicted to make cache space. Old provider-version jobs are retired when the active policy changes, and a current authorized map lookup enqueues the new version; the worker never backfills arbitrary locations.

The [public Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) was rechecked for this continuation. The public endpoint remains excluded, including a trailing-dot hostname alias. This implementation does not select, purchase or activate a provider. Verify the actual endpoint's terms, request/response contract, allowed attribution format, endpoint-side admission and scheduler in staging before enabling. A DB lease cannot enforce physical exclusivity across a process suspended between its final ownership check and sending HTTP; provider-side admission is still required for that guarantee.


Validation for this continuation: four backend suites passed with 34 tests on the memory adapter (one contention test intentionally skipped because pg-mem lacks row-lock isolation), and 35 tests on the Firestore emulator including concurrent admission. Three additional planning/public-map backend suites passed 18 tests. Two frontend map suites passed 12 tests. Both TypeScript checks, production web export and diff checks passed. Full workspace suites, live-provider calls and production deployment were not run.
