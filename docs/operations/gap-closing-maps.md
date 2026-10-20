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

The bounded state record holds at most 150 jobs/cache entries and 700 KB, using a PostgreSQL row transaction or Firestore document transaction. Cache keys include normalized name, locality, country, language and operator-supplied provider/normalizer version. Positive cache TTL is 30 days; negative TTL one day. Failures use exponential backoff and become visible dead jobs after four attempts (retained one day). Admission permits one in-flight provider request across instances and at least 15 seconds after release. Thirty-second renewable/fenced ownership surrounds an eight-second abortable provider operation with a 64 KiB body limit and no redirects. Stale workers cannot commit. A daily atomic request budget defaults to 100 and can be lowered to zero. Cache hits do not consume provider quota. Cache pressure evicts completed records, never pending work; provider-version changes retire old-version entries. Strict provider-side concurrency guarantees still require endpoint admission controls: a database lease cannot cancel HTTP already sent by a suspended process.

Apply `server/migrations/20261020_add_geocoding_state.sql` for PostgreSQL. Firestore initializes its single state document transactionally, with no new composite index. Set the following only after documenting endpoint input, storage, export and attribution rights:

```text
GEOCODING_SEARCH_URL=https://your-reviewed-service.example/search
GEOCODING_USER_AGENT=WanderBunnies/1.0 (a real operator contact)
GEOCODING_PROVIDER_VERSION=your-provider-and-normalizer-version
GEOCODING_PUBLIC_POI_APPROVED=1
GEOCODING_MAX_DAILY_REQUESTS=100
```

Then enable `planning_geocoding` in the DB. Every external lookup checks this flag; missing configuration/flag denies external work without blocking item saves or the itinerary. Configure a trusted scheduler to POST `/api/internal/blog/geocoding` with `X-Ingestion-Worker-Secret` (existing `INGESTION_WORKER_SHARED_SECRET`); one request processes at most one job. GET on the same path returns enabled/pending/ready/dead counts without query text. No scheduler, provider account, production flag or secret was changed by this implementation.

Provider selection via Stripe Directory query `geocoding API` was unavailable because the local CLI authentication expired; no provider account was selected or purchased. The configurable interface allows a separately reviewed deployment decision.

## Verification

- Focused frontend tests cover keepsake safety/fallback, native flag/load failure/background lifecycle, public reader, recap, trip-day map and blog controls.
- Backend tests cover projection, public publication/revocation, consent withdrawal, shared export, durable adapter storage, normalized/deduplicated cache keys, bounded queue, provider admission, stale-owner fencing, negative cache, retry/dead jobs, response bounds and daily quota.
- The same map/storage/public tests pass against the Firestore emulator as well as the default memory adapter. Real PostgreSQL contention/multi-instance latency remain deployment checks.
- Local Chromium captured a visible Paris map (~73 KB), with two numbered markers and zero remaining canvases. The worker-load failure path also returned labeled areas and zero canvases. A production web export includes the versioned worker asset. Actual native device/EAS, deployed CSP, provider rights/configuration and production delivery evidence remain open.

Primary references: [MapLibre Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/), [MapLibre v10 migration](https://maplibre.org/maplibre-react-native/docs/setup/migrations/v10/), [MapLibre GL JS Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/), [OSMF Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

Latest local results: 9 frontend suites / 45 tests; 8 backend suites / 35 distinct tests across focused runs; Firestore emulator parity 3 suites / 11 tests. Frontend TypeScript, backend build, production web export and diff checks passed. Full workspace suites and real native builds were not run for this slice.
