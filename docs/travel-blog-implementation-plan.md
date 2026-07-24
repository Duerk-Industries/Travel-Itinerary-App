# Trip Blog — Phased Implementation Plan

## How to use this document

This is the execution companion to `docs/travel-blog-architecture.md` (the design of record — read
that first). This document turns section 18's high-level phase list into concrete engineering tasks:
files to create, migrations to write, flags to ship (default off), and exit criteria per phase. Where
a task says "reuse `X`," that file already exists in this repo — check it before writing something
new. Section references below (§N) point back into the architecture document.

Nothing in this feature is implemented yet. Sizes are relative (S/M/L/XL), not calendar estimates —
this repo has no prior blog-feature velocity data to calibrate against.

**Architecture alignment rule:** `docs/travel-blog-architecture.md` is the design of record. Before
each phase starts, reconcile migrations, routes, flags, limits, and acceptance tests against that
document; do not carry field names or consent behavior forward from an older draft.

---

## Prerequisites (start immediately, block specific later phases — not the whole project)

These are cross-cutting dependencies called out in the architecture doc that are *not* blog-feature
code per se, but the blog depends on them. They can run in parallel with Phase 0.

| Item | Blocks | Size | Status |
|---|---|---|---|
| `server/config/blog-storage-tiers.json` (tier sizes, admin ceiling, add-on blocks) | Phase 2 entitlement checks | S | **Done** — created earlier this round |
| Registration age gate: `date_of_birth` column, `POST /register` validation in both `authRoutes.ts` and `webAuthRoutes.ts`, OAuth "complete your profile" interstitial (§3 "Registration age gate") | Phase 5 (consent-eligibility integrity) | M | Not started |
| `lodging_locations` catalog table + cached Google Time Zone API lookup, wired into `Lodging` creation (§9 "Confirmed approach — a trip-independent lodging catalog") | Phase 2 timezone enrichment (not core upload availability) | M | Not started |
| `api-limits.yaml` additions: `GOOGLE_PHOTOS`, `META_GRAPH`, `GOOGLE_TIME_ZONE`, translation/transcription provider entries, plus named GCS/Cloud Run/CDN callers (§15) | Phases 2, 4, 7, 8 | S | Not started |
| `server/config/cost-model.yaml` extension with the blog cost-model block (§15) | All phases (cost estimation) | S | Not started |

The registration age gate is the one item worth flagging loudly: it's easy to defer since it's not
"blog code," but Phase 5's entire unanimous-consent guarantee is only as strong as this gate actually
existing. Land it before Phase 5 starts, not before Phase 5 ships.

---

## Phase 0 — Provider, legal, and cost spikes

**Objective:** de-risk the assumptions the rest of the plan is built on, before writing product code.

- Google Photos Picker: confirm session flow, `baseUrl` expiry (~60 min), scopes, and rate limits
  against current docs (§9). Output: a short spike doc, not production code.
- Apple PhotoKit + iOS Share Extension: confirm this requires a native (non–Expo Go) build; identify
  the config-plugin/EAS build changes needed.
- Meta Graph API: confirm current Instagram Business/Creator account eligibility, app review
  requirements, carousel/video limits, and rate-limit headers (§12).
- Media benchmarks: transcode a representative sample of phone photos/videos through candidate
  ffmpeg/Sharp settings to validate the §6 constraints table and get real compute-cost numbers for
  `cost-model.yaml`.
- Stripe add-on lifecycle: confirm recurring capacity-block Price/subscription-item modeling works
  with the existing `billingService.ts`/`subscriptionReconciliationService.ts` without a new billing
  primitive. Use Billing APIs plus hosted Checkout/Customer Portal, verified webhook signatures,
  idempotent event handling, and server-side secrets/least-privilege restricted keys; native clients
  use the architecture's web-first “manage on web” path.
- Define a threat model and launch SLOs before implementation: IDOR/private-cache leakage, malicious
  media parsers, OAuth token theft, consent races, queue abuse, and provider outage paths. Set target
  p95 read/upload-processing latency, revoke-to-private purge SLA, ledger drift, and recovery time.
- Produce low/base/high volume and cost scenarios (storage GB-month, GCS operations, Cloud Run
  CPU/GiB-seconds, CDN fill/egress, provider calls, and Stripe fees). Define alerts and degraded
  behavior or a kill switch for every budget dimension.
- Minors/likeness: confirm with legal counsel that the registration age-gate design (§3) plus the
  family/dependent mechanism is sufficient, or whether additional guardian-consent work is needed.

**Exit criteria:** every "Confirm..." above has a written answer. No user-facing code ships in this
phase.

---

## Phase 1 — Internal private text (foundation)

**Objective:** the joint text blog works end-to-end, privately, for real trip members. No media yet.

**Backend:**
- Migration: `trip_blogs`, `blog_days`, `blog_items` (with registry `kind_key`, `schema_version`,
  audience, and planned-activity reference fields from §4), `blog_text_contents`,
  `blog_item_versions` (§4 schema, minus the media/gallery/structured-card tables).
- Build the `BlogItemTypeDescriptor` registry and generic dispatch/capability validation in this
  phase. Register only `core.text` initially, but reject unknown or disabled kinds server-side;
  future phases must not add controller-level kind switches.
- `server/src/routes/blogRoutes.ts`: `GET /api/trips/:tripId/blog`, `PATCH /api/trips/:tripId/blog`,
  `POST/PATCH/DELETE .../blog/items`, `.../blog/items/reorder`, `GET .../blog/capabilities` (§13).
- **Weather Badge Integration**: Wire `openMeteoWeatherApi.ts` through a cached/derived daily
  provider (destination/date/timezone key, bounded TTL, stale fallback). Never call the provider on
  every blog render; the badge is optional and independently flaggable.
- **Cursor Pagination**: Implement `?date=` and `?cursor=` filtering in the repository from Day 1.
  - Wire through `entitlementService.ts` (`assertCanUseFeature(userId, 'trip_blog', role)`), matching
    the existing route-handler → entitlement pattern used elsewhere (`EntitlementError` → 402).
- Optimistic-locking `PATCH` with `If-Match`/`Idempotency-Key` (§5).
- Emit revision/cache-invalidation events on every committed edit and use ETag/conditional reads;
  authenticated responses must not enter shared/CDN caches.
- Socket.IO: extend `server/src/socket/` with a presence-only "editing this block" event on the
  existing trip room — no new socket server needed.
- Add `db.postgres.ts` + `db.firebase.ts` + in-memory adapter parity for every new DB function, per
  this repo's `DatabaseAdapter` convention.
- Add the `trip_blog` feature flag to `server/config/feature-flags.yaml` (default off) and its
  entitlement row via `entitlementService.ts`'s existing seed pattern.

**Frontend:**
- `app/tabs/tripBlog.tsx` (new tab, per the "one file per feature area" convention) with its own fetch
  helpers, day-by-day view, one initial empty text editor per day (§2), autosave, version-conflict UI.
- Add the tab behind the `trip_blog` flag in `App.tsx`, following the existing tab-gating pattern.

**Tests:**
- Server: `server/__tests__/blog-text.test.ts` (supertest + pg-mem) — CRUD, optimistic-lock conflict,
  reorder, entitlement/flag gating, adapter-contract parity.
- App: Jest tests for the tab's fetch helpers and conflict-resolution UI.
- Unicode acceptance test: save/reload Chinese, emoji, RTL, combining characters through the full save
  → conflict → resolve cycle (§4 Unicode section).
- Stored-XSS and plain-text HTML/markdown-boundary escaping, IDOR, and request-size/idempotency-limit
  tests for text editing; do not enable rich text until its separate security decision is complete.

**Exit criteria (§18):** authoring/save error rate, Unicode round-trip test passing, follower
read-only enforcement verified. Rollback: `trip_blog` flag off hides the tab entirely; no data loss
since nothing else depends on it yet.

---

## Phase 2 — Private photos, per-uploader quotas, lapse/restore

**Objective:** photo upload works, storage is metered and capped per-uploader, and the lapse/grace/
restore lifecycle is real — this is the highest-risk phase in the whole plan (new infra: quarantine
bucket, worker, ledger).

**Backend:**
- Migration: `blog_media_assets`, `blog_media_renditions`, `blog_item_assets`,
  `blog_storage_accounts`, `blog_storage_reservations`, `blog_storage_ledger`,
  `blog_media_retention_actions` (§4, §8).
- Connect billing reconciliation's **inactive entitlement** event (after the existing billing/dunning
  period) to a resumable retention worker: hide the uploader's oldest visible assets until under the
  active limit, start `delete_after = inactive_at + 30 days`, restore newest grace-hidden assets first
  when capacity returns, and physically delete only after the grace deadline. The worker must be
  idempotent and account-scoped across all trips.
- `upload-init`/`upload-status` endpoints (§7, §13) using the atomic
  `atomicIncrementApiUsageIfUnderLimit`-style transaction/idempotency pattern (§8 "Reuse, don't
  reinvent") — do not write a new locking scheme, and keep storage reservations in their own
  namespace from provider/API request counters.
- Media worker (Cloud Run service triggered via Eventarc/Object Finalize, §7 diagram): validation
  (magic bytes, decoded dimensions), EXIF GPS strip (preserving orientation tags), normalization (Sharp), 
  thumbnail generation, ledger commit. New file: `server/src/services/blogMediaProcessingService.ts`.
- **Storage Lifecycle Policy**: Configure staging/quarantine TTLs for abandoned or failed uploads;
  successful originals are deleted only after validation, rendition creation, ledger finalization,
  and an idempotent outbox event. Retention must never race ledger accounting or grace restore.
- **Highlight "Starring"**: §4 promises manual starring but its schema has not yet persisted the
  marker. Amend the architecture first, then add either `blog_items.is_highlight` or a dedicated
  `blog_item_highlights` relation (not an undocumented `blog_media_assets.is_highlight` field) and
  cover it in the registry contract.
- Add separate named limits and budgets for upload-init, bytes/day, concurrent processing, GCS
  requests, stored GB-month, Cloud Run compute, and CDN fill/egress. A provider request counter is
  not a substitute for a storage or compute budget. Wire `blog_storage_bytes_included` /
  `blog_upload_bytes_per_day` through `entitlementService.ts`, sourced from
  `blog-storage-tiers.json`.
- `GET /api/account/blog-storage`, `GET /api/account/blog-storage/grace-media` (§13).
- Treat `lodging_locations`/Time Zone API as a soft dependency for upload availability. Apply the
  §9 precedence (lodging timezone, media metadata, device/upload time); unresolved or out-of-range
  media goes to **Unassigned** for review instead of blocking uploads or guessing a day.

**Frontend:**
- Photo upload UI: direct-to-GCS resumable upload, progress, retry, JIT-purchase prompt on
  `QUOTA_EXCEEDED` (§7 step 1).
- Personal storage meter (used/reserved/grace-hidden/available, §2).
- Grace-hidden media placeholder UI for other travelers (§8 step 4).

**Tests:**
- Concurrent-reservation race test (two uploads near the limit, only one should succeed).
- Full lapse → grace-hide → restore-within-30-days and lapse → grace-hide → expire → physical-delete
  state-machine tests, with the 30-day clock starting only after billing/dunning reconciliation marks
  the storage entitlement inactive. Assert deterministic oldest-first hiding, newest-first restore,
  physical deletion only after grace expiry, and the "another traveler sees a placeholder, not
  reordered content" case.
- Adapter-contract test running the reconciliation worker against Postgres, Firebase, and pg-mem with
  an artificially small batch size to actually exercise the bounded-batch path, not just the happy
  path.
- Security tests for IDOR, signed-key scope/object-generation checks, MIME spoofing, decode bombs,
  EXIF/metadata leakage, duplicate-finalize replay, and concurrent quota reservations. Reconcile
  usage with a resumable cursor and bounded transactions (including Firestore batch/size limits).
- HEIC-to-JPEG client-side conversion test (§6).

**Exit criteria:** upload success rate, processing p95, storage-ledger drift == 0 in a soak test,
lapse/restore correctness. Rollback: `trip_blog_photo_uploads` flag off stops new uploads without
breaking already-stored media or the text blog from Phase 1.

---

## Phase 3 — Premium video

**Objective:** video upload/playback, gated to Premium+, reusing Phase 2's pipeline rather than a
parallel one.

**Backend:**
- Extend the Phase 2 worker with ffmpeg transcode (H.264/AAC, 1080p/30fps output per §6), poster-frame
  generation, and the hard safety envelope validation (reject beyond 1 GB/5 min/4K60fps).
- Reserve input and output bytes separately, cap transcoding concurrency and total processing seconds,
  run ffprobe/parser work in a sandbox, and make jobs idempotent with retry/dead-letter handling.
  Account every rendition and temporary object in the storage/cost ledger; no HLS or unbounded
  bitrate ladder is introduced by this phase.
- `trip_blog_video` entitlement check at `upload-init`, evaluated against **the uploading account**,
  not the trip owner (§ top decisions — this was the reverted contradiction; make sure the
  implementation matches, not an earlier draft).
- `blog_video_processing_seconds_per_month` limit via `entitlementService.ts`.

**Frontend:** video player component (progressive MP4 only per §1 non-goals — no HLS yet), upload
flow reusing Phase 2's UI with a video-specific progress/processing state.

**Tests:** entitlement-gate test (Free uploader rejected, Premium accepted), transcode correctness
against the §6 benchmarks from Phase 0, processing-failure/dead-letter path, replay/idempotency,
resource-exhaustion, and output-byte accounting tests.

**Exit criteria:** measured compute cost per video-minute matches (or updates) the Phase 0 benchmark;
failure rate within budget. Rollback: `trip_blog_video_uploads` flag off; photos/text unaffected.

---

## Phase 4 — Google Photos, Apple Photos, mobile share

**Objective:** import paths, each behind its own flag, none blocking the others.

**Backend:**
- Google Photos Picker session/complete endpoints (§9, §13); OAuth token storage mirrors the
  `social_connections` encrypted-token pattern from §12.
- Use PKCE/state, least-privilege scopes, encrypted server-side tokens, revocation/disconnect cleanup,
  and never log provider tokens or expiring `baseUrl` values. Imported media is attributed to the
  importing account and consumes that account's quota.
- Add `GOOGLE_PHOTOS` provider caller entries to `api-limits.yaml` (§15) — replace any placeholder
  `PHOTOS_ALBUM_LIST` caller with actual Picker session/item operations.
- Day-matching against the confirmed timezone precedence (§9), landing items outside the trip range
  in the "Unassigned" review queue rather than guessing.
- Bound Picker polling/import batches with exponential backoff+jitter, resumable cursors, session
  expiry cleanup, deduplication by provider ID/checksum, and provider-specific per-user/trip/IP caps.

**Frontend/native:**
- iOS PhotoKit multi-select import + iOS Share Extension (requires an EAS/native build, not Expo Go
  — confirmed in Phase 0).
- Android `SEND` intent handler.
- "Unassigned" import-review UI for day-matching failures.

**Tests:** dedup test (re-running an import skips already-imported media via checksum/provider ID),
Unassigned-queue test for out-of-range dates, native-build smoke test for the share extension.

**Exit criteria:** import success rate, dedup correctness, zero silent day-guessing. Each of the three
import paths (`trip_blog_google_photos_import`, `trip_blog_apple_photos_import`,
`trip_blog_mobile_share_ios`/`_android`) rolls back independently.

---

## Phase 5 — Public consent, revocation, public URLs

**Objective:** the highest-trust phase — unanimous consent, revocation, and anonymous public serving.
**Do not start this phase until the registration age-gate prerequisite has actually shipped**, since
this phase's entire consent-eligibility guarantee depends on it.

**Backend:**
- Migration: `blog_publication_epochs`, `blog_publication_consents`, `blog_public_aliases` (§10).
- **Unilateral Revocation Logging**: Ensure the `blog_publication_epochs.revoked_by` column 
  is populated with the specific user ID who pulled the blog private for auditability.
- Preserve the architecture consent rule: only the initial publication and republication after a
  revocation require unanimous consent of current adult/account travelers. Edits, additions,
  reordering, and removals while already public are immediately visible without a new vote. Guests
  and minor/dependent placeholders are excluded by a server-derived denominator.
- **Privacy "No Costs" Integration**: Dedicated public repository method + allowlisted DTO (§11) — 
  a hard requirement: **never** fetch a broad trip object and strip fields after the fact.
- Public alias resolution (`GET /:username/:tripSlug`), 30-day rename-redirect retention, `noindex`
  by default.
- Key public caches by `(trip_id, visibility_epoch, content_revision, audience, kind/schema)` and
  purge on publish, revoke, hide/restore/delete, and alias changes. Never cache authenticated or
  pending-consent responses in shared caches; add a purge-failure alert and privacy canary.
- Auto-generated Open Graph share-card image (§10 suggestion) — cheap, do it in this phase, not later.
- Audit log entries for every consent decision and revocation (reuse the existing `audit_log` pattern
  used by admin mutations).

**Frontend:**
- Publication-request flow, per-traveler consent dialog, decliner-visible request status, 14-day
  expiry countdown.
- Public page renderer (server-rendered or a dedicated public route) — must visibly differ from the
  authenticated app view, since it's serving anonymous traffic.

**Tests:**
- Every consent-state-machine transition (§10 state flow) as its own test case.
- Membership-change race tests (join/leave/guest/minor changes while consent is pending), duplicate
  request/webhook idempotency, stale-epoch rejection, and public serializer tests for every registry
  kind. Verify ordinary public edits do not create consent prompts.
- **The most important test in this phase:** an integration test that logs in as an anonymous
  visitor, fetches a public trip, and asserts zero cost/expense/booking/email fields are present —
  not "the page loaded," an explicit field-absence assertion.
- IDOR test: a non-member cannot reach a private trip's blog via any route in this phase.
- Revocation-purges-CDN-and-caches test.

**Exit criteria:** consent completion/expiry rates, revoke-to-private latency, zero privacy-contract
test failures, security review sign-off (§17 checklist). This phase should get the most scrutiny of
any phase before its flag flips on for any real user.

---

## Phase 6 — Public indexing

**Objective:** a separate, later opt-in from "public" itself (§10) — a trip can be public and still
`noindex`.

**Backend:** `trip_blog_public_indexing` flag, sitemap entry generation for indexed trips, canonical
alias selection for `<link rel="canonical">`/sitemap.

**Tests:** verify a public-but-not-indexed trip never appears in the sitemap; verify the canonical
alias survives a username rename inside the 30-day redirect window.

**Exit criteria:** allowlist rollout, then percentage rollout, per §18.

---

## Phase 7 — Social posting (Meta)

**Objective:** per-traveler Instagram/Facebook posting, provider by provider.

**Backend:**
- `social_connections`, `social_post_jobs` (§12), OAuth connect/disconnect endpoints.
- Per-day, per-provider post job: preview → explicit confirmation → idempotent enqueue → bounded
  retry with dead-letter.
- `META_GRAPH` provider entries in `api-limits.yaml` with per-caller daily caps (§15).
- Encrypt tokens at rest, use OAuth state/PKCE and disconnect revocation, enforce per-account/day,
  provider and IP/job concurrency caps, and make retries idempotent. Re-check public visibility at
  enqueue and execution time; preserve a native-share fallback when provider APIs reject a post.
- Hard gate: content must already be public (§12) before a post job can be created.

**Frontend:** per-post preview matching the actual Meta rendering, explicit "this can't be recalled
once posted" warning (§12) before confirmation.

**Tests:** gate test (private day cannot be posted), token-refresh test, provider-outage/retry test,
disconnect-revokes-token test.

**Exit criteria:** social post success rate, zero posts originating from non-public content. Rolls out
provider by provider (Instagram, then Facebook, or vice versa) — each is its own canary.

---

## Phase 8 — Additional modalities, via the registry contract

**Objective:** every later modality ships through the `BlogItemTypeDescriptor` registry (§2 "Modality
extension contract"), not a one-off branch — this phase is really N independent sub-phases, each
gated by its own flag and passing the full registry lifecycle contract (§2 rule 7: authorization,
public serialization, deletion/export, accessibility, moderation, caching, observability, quota
accounting, cost estimation, adapter-parity tests) before it can ship.

Recommended order (§18), each an independent canary with its own cost baseline and rollback flag:

1. **Galleries** (`trip_blog_galleries`) — multi-asset carousel/grid items; reuses Phase 2's asset
   pipeline per-child, billed to each child's own uploader (§14 "Gallery child bytes remain charged to
   their uploaders").
2. **Structured cards** (`trip_blog_structured_cards`) — allowlisted place/activity/lodging/route
   snapshots linking a blog item to a planned itinerary entry (§4 `planned_activity_ref`,
   `blog_structured_cards`); this is the trip-blog-to-itinerary cross-link feature suggestion (§20).
3. **Item audiences** (`trip_blog_item_audiences`) — per-item traveler/follower/public visibility
   (§4); requires the audience-in-cache-key discipline from §16 before enabling. Until this flag is
   enabled, retain §4's default-public behavior and server-side audience filtering.
4. **Audio** (`trip_blog_audio`) — voice notes/ambient snippets, plus the "listen to this day" TTS
   narration suggestion (§20); needs its own moderation and transcript/accessibility policy (§17).
5. **Translation** (`trip_blog_translation`) — on-demand machine translation for public/follower
   viewers; needs the `blog_translation_characters_per_month` limit and a translation provider entry
   in `api-limits.yaml` (§14, §15).
6. **Exports** (`trip_blog_exports`) — portable archive now, PDF/photo-book later; overlaps with the
   existing `userDataExport.ts` pattern for account-data export — check for reuse before building a
   parallel export pipeline.
7. **Panoramas/360°** (`trip_blog_panorama_media`) — immersive viewer; highest-effort, lowest-priority
   of this list.
8. **AI-Proposed Highlights** (`trip_blog_ai_highlights`, Pro) — Cloud Vision aesthetic score + LLM
   sentiment-based auto-curation (§4); requires its own Cloud Vision/LLM cost estimation and a
   moderation pass on AI-suggested content before it's shown, per §2 rule 7. Ship after, not
   alongside, the other modalities in this list — it is the most expensive and highest-risk item in
   this phase.

Also from §20, lower-effort work worth scheduling opportunistically inside this phase: visibility-aware
full-text search (Postgres FTS on `blog_text_contents.body`) and schema.org/JSON-LD structured data
on public pages, each behind its own flag and serializer/cache tests. A "currently traveling" badge
is optional. **Do not schedule public or private co-traveler comments here**: the architecture marks
comments an indefinite non-goal until moderation, notification, consent, retention, and cost are
separately designed.

---

## Cross-cutting, every phase

- **Adapter parity is not optional per phase** — every new DB function ships in `db.postgres.ts`,
  `db.firebase.ts`, and passes the in-memory/pg-mem test adapter before a phase is considered done,
  per this repo's existing convention.
- **Cost model updates every phase** — extend `server/config/cost-model.yaml` as each phase adds a
  new cost dimension (§15); don't batch this up for "later."
- **Feature flags default off, always** — no phase's flag flips on for real users without its exit
  criteria met, per §14/§18.
- **Audit logging** — every consent, revocation, admin storage-tier change, and account/trip deletion
  writes to the existing `audit_log`, from Phase 1 onward, not retrofitted in Phase 5.
- **Standard limit admission:** every route, queue, provider call, object operation, and rendition
  declares a named caller/limit in `api-limits.yaml`; every modality declares user/trip/IP,
  bytes, concurrency, processing, storage, and monthly cost dimensions. Exhaustion must fail closed
  or degrade only that component, with alerts and a kill switch.
- **Caching discipline:** use revision/ETag and event-driven invalidation across instances; immutable
  rendition URLs may be CDN-cached, while audience/visibility-aware HTML/JSON uses short TTLs. Never
  place OAuth/signed tokens or authenticated payloads in shared caches.
- **Delivery and rollback:** use expand/contract migrations, forward-compatible schema/API versions,
  idempotent backfills with resumable cursors, staged canaries, and flags that stop new writes/jobs
  while preserving safe reads. No destructive down-migration is a rollback strategy.
- **Observability/runbooks:** ship correlation IDs, queue/DLQ dashboards, p95/error/ledger-drift,
  cache-hit/purge-SLA, provider quota, and cost alerts with documented replay, restore, purge, and
  incident procedures before enabling a phase for real users.
- **Quality gate:** each phase must include API/schema contracts, accessibility checks, dependency
  and parser security review, load/soak tests at the configured limits, adapter parity, and an
  acceptance-test matrix covering private, follower, public, guest, and dependent roles.

## Dependency graph

```mermaid
flowchart TD
    Prereq1[Registration age gate] --> P5[Phase 5: Public consent]
    Prereq2[lodging_locations + Time Zone API<br/>(optional enrichment)] -.-> P2[Phase 2: Photos]
    Prereq3[blog-storage-tiers.json] --> P2
    P0[Phase 0: Spikes] --> P1[Phase 1: Private text]
    Prereq4[api-limits + cost-model] --> P0
    P1 --> P2
    P2 --> P3[Phase 3: Video]
    P2 --> P4[Phase 4: Import paths]
    P2 --> P5
    P5 --> P6[Phase 6: Indexing]
    P5 --> P7[Phase 7: Social posting]
    P1 --> P8[Phase 8: Additional modalities]
    P2 --> P8
    P1 --> Registry[Modality registry foundation]
    Registry --> P2
    Registry --> P8
```
