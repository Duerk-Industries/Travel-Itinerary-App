# Cloud Run OOM (SIGABRT) — Remediation Plan

**Status:** Steps 1–6 implemented. Step 7 (Redis adapter and horizontal scaling) remains separate infrastructure work.
**Last updated:** 2026-08-18
**Authors:** assistant, in collaboration with @bryanduerk
**Incident:** `travel-itinerary-app` revisions `00359-76m` / `00360-nx7` (SHA `b9d4e68`) aborting with
`Uncaught signal: 6, pid=1` every 30–60s under load, surfacing as 503s with 14–36s latency on
`/socket.io/`, `/api/itinerary/images`, and `/api/itinerary/async/:id`.
**Related:** [itinerary-narrative-depth-and-validation.md](itinerary-narrative-depth-and-validation.md)
(unrelated feature work on the same service — not a contributor to this incident)

---

## 1. Summary

Production aborts under load because a single request path transiently allocates more heap than the
entire container budget. The container has no explicit `--memory` setting, so Cloud Run gives it the
512 MiB default.

The allocation comes from `ensureDestinationCatalog`, which mirrors the attractions catalog to a
19.8 MB / 65,365-row CSV **on every call, including cache hits** — downloading, parsing, diffing, and
potentially rewriting the entire global catalog once per destination per itinerary generation.

The single most important finding, which was not in the original triage:

> **On Cloud Run the CSV mirror is write-only.** Its only consumer is
> `syncAttractionsCatalogFromCsvToDbOnStartup()`, which is gated by `ATTRACTIONS_STARTUP_SYNC` and
> defaults to `!isCloudRunRuntime` — i.e. **off in production**. Every one of these download →
> parse → diff → upload cycles produces an artifact that production never reads.

That makes the P0 fix a deletion rather than a redesign, which is the lowest-risk possible change for
an active incident.

---

## 2. Root cause

### 2.1 The allocation

`ensureDestinationCatalog` ([attractionsCatalogService.ts:1001](../../server/src/services/attractionsCatalogService.ts))
calls `persistCatalogRowsToCsv` / `persistDestinationCatalogRowsToCsv` at **five** call sites:

| Line | Path | Has new data to write? |
|---|---|---|
| 1019 | Fresh cache hit | No — rows were just read from Firestore |
| 1025 | Discovery disabled, cache present | No |
| 1037 | Fresh cache hit (inside refresh lock) | No |
| 1043 | Discovery disabled (inside refresh lock) | No |
| 1094 | After discovery + enrichment | Yes |

Four of the five fire on paths where nothing changed. Each one runs `readCatalogCsv()`, which on
Cloud Run (`useLocal === false`) downloads the full catalog from GCS. The sequence per call:

1. `file.download()` → ~20 MB `Buffer`
2. `.toString('utf8')` → ~20 MB string
3. `parseAttractionCatalogCsv` → 65,365 objects × 24 fields (~150 MB, estimated)
4. `mergeCatalogRows` → `Map` over all rows
5. `catalogRowsEquivalent` → builds **two** `Map`s, calling `JSON.stringify` on **every row, twice**
6. If changed: `stringifyAttractionCatalogCsv` + `Buffer.from` → ~40 MB more

Steps 4–6 exist solely to decide whether to skip a write that, on the fast path, was always going to
be skipped. **The fast path pays the full cost of the slow path.**

`getAttractionShortlistForDestinations` ([:1125](../../server/src/services/attractionsCatalogService.ts))
loops this once per destination. Sequential iteration lets GC reclaim between passes — which is why
the service survives at all — but the peak of a *single* pass already exceeds the 512 MiB budget, so
any concurrent request arriving mid-parse tips it over.

### 2.2 Why signal 6 matters

`Uncaught signal: 6` is **SIGABRT**, not SIGKILL. A kernel OOM-kill (container exceeding its memory
cgroup) arrives as **signal 9**. SIGABRT is the process aborting itself, and in Node the dominant
cause is V8's own `FATAL ERROR: Reached heap limit — JavaScript heap out of memory`.

This changes the remediation: **raising `--memory` alone may not fix it.** V8 sizes its old-space
heap from what it detects at startup and does not automatically grow to fill a larger container. A
bigger box with an unchanged heap cap can abort at exactly the same allocation. `--max-old-space-size`
must be set alongside it so the two ceilings are aware of each other and V8 GCs hard instead of
aborting.

### 2.3 Why the fix never reached production

`deploy-api.yml` triggers only on `push` to `main`. The autocomplete prewarm fix (`8fdf642`) is on
`Trip-Blog`. **No new revision was ever built** — the crashing revision simply kept running. This is
a trigger gap, not a verification gap, but production also has no way to report which commit it is
running: `/api/healthz` returns a bare `{ ok: true }`.

---

## 3. Corrections to the original triage

Recorded so nobody implements a fix for a bug that isn't there.

### 3.1 The image cache null-handling item is a non-bug

The brief proposed: *"Fix the image cache's handling of cached null values so repeated misses do not
repeat GCS checks."*

`TtlCache.get()` returns `V | undefined`, and `null !== undefined`, so a cached `null` is already a
genuine cache hit. `getCachedImageUrl` already negative-caches GCS misses for `SIGNED_URL_TTL_MS`
(1h), and `urlLookupCache` in `unsplashCallers.ts` already negative-caches Unsplash misses (10 min).
Implementing this item would change nothing.

**The real cause of the repeated lookups is the cache key.** `getItineraryImage`
([image-service.ts:257–268](../../server/src/image-service.ts)) builds its *primary* Unsplash query
from `contextText` — that day's activity names, joined. That string is unique per day, so the
`caller::query` key is unique per day, so the negative cache can never hit across days. Thirty days
means thirty guaranteed misses, each a live Unsplash call. Only the *fallback* destination query is
shared — which is exactly the repeated "Japan" query visible in the logs. See step 5.

### 3.2 `TtlCache` is unbounded (not in the original list)

`TtlCache` has **no max size and no sweep**. Expired entries are evicted only when that exact key is
read again after expiry; a key written once and never re-read stays resident for the life of the
process. Five caches use it. `staticMapRoutes` caches `{ body: Buffer; contentType: string }` — raw
image bytes in the JS heap, one entry per unique map ever requested, never evicted.

On a single long-lived instance absorbing all traffic this grows monotonically, and it fits the
observed behaviour: an instance that is fine on cold start and aborts progressively sooner the
longer it serves. See step 6.

---

## 4. Implementation steps

Ordered by dependency, not by size. Steps 1–3 are containment and can ship within the hour; step 4 is
the actual defect fix.

### Step 1 — Land the deploy trigger

**Files:** `.github/workflows/deploy-api.yml`, `scripts/deploy-hosting.ps1`, `scripts/deploy-hosting.sh`
**Status:** Already written, currently **uncommitted** in the working tree.

Nothing else in this plan can reach production until this exists on `main`. The `workflow_dispatch`
trigger plus the `gh workflow run` calls in both deploy scripts let a fix on any branch deploy without
a merge to `main`.

- GitHub only offers dispatch-by-branch once the trigger exists on the **default** branch, so this
  must reach `main` once before dispatching other branches works.
- Until then the only paths to production are a merge to `main` or
  `production-deploy-direct.yml` (manual `workflow_dispatch`, already exists).

**Verify:** `gh workflow run deploy-api.yml --ref Trip-Blog` succeeds and a new revision appears.
**Rollback:** Revert the workflow file; push-to-`main` behaviour is unchanged by this step.

### Step 2 — Set memory and the V8 heap cap on every deploy path

**Files:** `.github/workflows/deploy-api.yml`, `production-deploy-direct.yml`, `production-cutover.yml`

```
gcloud run deploy travel-itinerary-app \
  --memory 2Gi \
  --cpu 1 \
  --set-env-vars NODE_OPTIONS=--max-old-space-size=1536 \
  --max-instances 1 \
  ... (existing flags unchanged)
```

- **2Gi, not 1Gi.** `--max-instances 1` means one container absorbs *all* production traffic, and
  the autocomplete index (~154k rows) plus the catalog work both want headroom. Start at 2Gi,
  measure, tune down.
- **1536 MB heap cap under 2Gi** leaves ~512 MiB for the Node runtime, native buffers, and
  GCS/Firebase client allocations that live outside the JS heap.
- **Apply to all three deploy paths** or they will silently drift back to the 512 MiB default.
- Note: `--update-env-vars` (already used) merges rather than replaces, so adding `NODE_OPTIONS`
  there is safe. Confirm it does not collide with an existing `NODE_OPTIONS` in the service config.

**Verify:** `gcloud run services describe travel-itinerary-app --region us-east5` shows the memory
limit and env var. Container start log should no longer be followed by SIGABRT under normal load.
**Rollback:** Redeploy without the flags. Pure configuration; no code risk.

### Step 3 — Make deploys self-verifying

**Files:** `server/src/app.ts` (`/api/healthz`, line ~269), `server/Dockerfile`, `.github/workflows/deploy-api.yml`

1. Add a build arg to `server/Dockerfile` (`ARG GIT_SHA` → `ENV GIT_SHA=$GIT_SHA`) and pass
   `--build-arg` / `--set-env-vars` from the workflow. Cloud Run already sets `K_REVISION` itself.
2. Extend `/api/healthz` to return `{ ok, sha, revision }` reading `GIT_SHA` and `K_REVISION` via
   `getEnvValue` (never `process.env` directly — see CLAUDE.md).
3. Echo the deployed revision in the workflow's final step so the Actions log is self-evidencing.

This must precede step 4, or there is no way to prove step 4 actually shipped — which is precisely
the confusion that cost a day on this incident.

**Verify:** `curl https://wander-bunnies.com/api/healthz` returns the SHA of the commit just deployed.
**Rollback:** Trivial; the endpoint stays backward compatible (`ok` field unchanged).

### Step 4 — Take the CSV mirror off the request path (the actual fix)

**Files:** `server/src/services/attractionsCatalogService.ts`

Because the mirror is write-only on Cloud Run (§1), this is primarily a deletion.

1. **Delete the four fast-path calls** at lines 1019, 1025, 1037, 1043. They mirror rows that were
   just *read* from Firestore. No behavioural change in any environment: in production nothing reads
   the CSV, and locally the rows already came from a DB that the CSV seeded.
2. **Gate the discovery-path call** at line 1094 — the only one with genuinely new data — to the
   local/dev path only, matching the `useLocal` condition that `readCatalogCsv` / `writeCatalogCsv`
   already apply internally (`isLocalEnv() && !process.env.K_SERVICE`). Hoisting that check into
   `persistDestinationCatalogRowsToCsv` makes the whole read-modify-write disappear in production
   instead of doing the work and then no-op'ing at the last step.
3. **Delete `catalogRowsEquivalent`** (line 795) along with its call sites. It exists only to avoid a
   GCS write that costs far less than the double-`JSON.stringify` diff itself. In the local path,
   just write.
4. **Add an admin-triggered export** so the capability to regenerate the seed CSV is not lost:
   `POST /api/admin/attractions/csv-mirror/export`, modelled on the existing
   `POST /api/admin/attractions/duration-metadata/invalidate`
   ([adminRoutes.ts:2054](../../server/src/routes/adminRoutes.ts)) — same `writeAuditLog` shape, same
   error handling.

**Deliberately not doing** dirty-key markers or a background scheduler. Both were considered and
rejected for this pass: the CSV has no production reader, so incremental freshness buys nothing, and
a full Firestore→CSV export would need a new `listAllAttractionCatalogEntries` implemented across all
three DB adapters (postgres, firebase, memory). Revisit only if a production reader appears.

**Verify:** Generate a multi-destination itinerary against a staging deploy; heap should stay flat
where it previously spiked. `npm run test:server` green.
**Rollback:** Revert the commit. The deleted calls have no dependents.

### Step 5 — Bound the day-image fan-out

**Files:** `app/tabs/overview.tsx:1477`, `server/src/routes/itineraryRoutes.ts`, `server/src/image-service.ts`

`Promise.all(missingCards.map(fetchOneImage))` issues one request per day with no ceiling — a 30-day
itinerary opens 30 concurrent connections to a single-instance service, landing precisely while
generation is already at peak heap.

1. **Add `POST /api/itinerary/images/batch`**, modelled directly on `POST /api/itinerary/weather/overview`
   ([itineraryRoutes.ts:263](../../server/src/routes/itineraryRoutes.ts)) two routes away, which takes
   an array, `slice(0, 31)`s it, and answers in one round trip. Thirty requests become one.
2. **Bound concurrency inside that handler** (4–6), where it is enforced once rather than trusted to
   every caller.
3. **Stop using raw per-day `contextText` as the primary Unsplash query** (§3.1). Either drop it and
   key on destination + day-of-trip, or normalize it to a small stable token set. These images are
   decorative; a unique-per-day query buys very little and costs an API call every time.
4. **Lengthen the negative TTL for "no result"** from 10 minutes to ~24h. A location with no Unsplash
   photo now will not have one in ten minutes.

If the batch route slips, the minimum viable change is replacing `Promise.all` with a 4–6 wide
semaphore and preferring visible days first.

**Verify:** Network panel shows one batch request per overview load. Unsplash call volume in the
metrics counters drops proportionally to trip length.
**Rollback:** Keep the batch route (additive) and revert the client to per-day GETs.

### Step 6 — Bound `TtlCache`

**Files:** `server/src/utils/ttlCache.ts`, `server/src/routes/staticMapRoutes.ts`

1. Add `maxEntries` with LRU eviction to `TtlCache`; all five callers inherit the bound.
2. Give the static-map cache a **byte budget**, not an entry count — entries vary in size by orders
   of magnitude, so "500 entries" is not a memory bound.
3. Optional: a periodic sweep of expired keys so write-once keys do not pin memory.

**Verify:** New unit tests in `server/__tests__/` asserting eviction at the cap and that a byte-budget
cache evicts on total size. Existing `ttlCache` consumers' tests stay green.
**Rollback:** Default `maxEntries` to `Infinity` to restore current behaviour without reverting.

### Step 7 — Redis adapter, then raise `--max-instances`

**Files:** `server/src/socket/presenceManager.ts`, `server/src/socket/index.ts`, deploy workflows

`presenceManager` holds `tripPresence` as an in-process `Map` and its own header comment states a
Redis adapter is required for multi-instance scaling. **`--max-instances 1` must stay until this is
done** — raising it first silently splits presence and chat state across containers.

Worth naming explicitly: `--max-instances 1` plus `--session-affinity` means you *cannot scale
horizontally out of a memory problem* right now, which is why steps 2 and 4 are load-bearing rather
than merely tidy.

The Socket.IO 503s/400s should clear on their own once the aborts stop — they are connections dying
mid-handshake, not an independent fault. Do not chase them separately until steps 1–4 are live.

---

## 5. Test plan

| Step | Automated | Manual |
|---|---|---|
| 1 | — | `gh workflow run` from a non-`main` branch produces a new revision |
| 2 | — | `gcloud run services describe` shows `2Gi` + `NODE_OPTIONS`; no SIGABRT under load |
| 3 | Route test for `/api/healthz` shape | `curl` returns the just-deployed SHA |
| 4 | `npm run test:server` (existing attractions suites); new test asserting no CSV read on the cache-hit path | Multi-destination generation on staging; watch Cloud Run memory graph |
| 5 | New route test for `/images/batch` incl. the 31 cap; client test for bounded concurrency | Overview load issues one batch request |
| 6 | New `ttlCache` eviction tests | — |
| 7 | Socket tests with the Redis adapter mocked | Two instances share presence |

Full suite before each deploy: `npm run test:server` and `npm run test:app`, plus
`npx tsc --noEmit` in both packages.

---

## 6. Rollout

1. Steps 1–3 ship together — containment plus the ability to verify anything at all.
2. Step 4 ships alone, so the memory graph attributes cleanly to it.
3. Steps 5–6 ship together once the service is stable.
4. Step 7 is separate work with its own plan.

**Monitoring during rollout:** Cloud Run container memory utilization, `run.googleapis.com/varlog/system`
filtered to `Uncaught signal`, and request-latency p95 on `/api/itinerary/*`. Success criterion for
steps 1–4: zero SIGABRT over 24h at normal traffic.

---

## 7. Explicitly not in scope

- **The startup config warnings.** Missing `SHADOW_PARSE` and `GOOGLE_STATIC_MAPS` pricing entries and
  the Stripe price-ID messages are startup warnings with no allocation behaviour behind them. Noise in
  the same log window, not contributors. Worth silencing eventually so they stop drawing attention
  during the next incident.
- **The itinerary narrative/annotation work** on `Trip-Blog`
  ([itinerary-narrative-depth-and-validation.md](itinerary-narrative-depth-and-validation.md)). Never
  deployed; not a contributor.
- **`AUTOCOMPLETE_PREWARM` (`8fdf642`).** Already fixed and committed; it reduces cold-start memory but
  is not the crash cause. It is on `Trip-Blog` and ships with step 1.
