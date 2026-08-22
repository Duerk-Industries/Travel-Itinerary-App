# Trip Blog Social & Recap Layer — Implementation Plan

**Execution companion to** `docs/trip-blog-social-architecture.md` (design of record — read it
first) and `docs/trip-blog-social-prd.md` (requirements, numbered FR/NFR/PR).

Sizes are relative (S / M / L / XL), not calendar estimates. Where a task says "reuse `X`", that file
exists in this repo today — read it before writing anything new.

**Alignment rule:** the architecture document is authoritative for schema, routes, flags and the
authorization matrix. If a task here disagrees with it, the architecture document wins and this
document is wrong. Reconcile before each phase starts rather than carrying a stale field name
forward.

**Every major independently releasable capability ships behind flags defaulting to off** (§9.1 of
the architecture). Bug fixes and small presentation changes may share the parent flag or ship
unflagged. A flagged phase is not done until it can be enabled internally and disabled without a
deploy.

---

## Phase ordering rationale

The order is not the PRD's priority order. It is driven by three dependencies:

1. **Instrumentation first.** Phase 1's authoring metrics are the baseline every later gate is
   measured against. Shipping Day Starter before we can measure authoring time means we never learn
   whether it worked.
2. **Authorization before features.** Phase 2 builds the target-resolution and authorization spine
   with nothing on top of it, so the matrix test exists before the first surface that can leak.
3. **Reactions before comments.** Most of the engagement value, a fraction of the moderation risk,
   and it produces the signal B7 and B10 consume.
4. **Durable notifications before mentions.** Comment core can ship without mentions; mention/reply
   delivery cannot ship until inbox, preferences, outbox and privacy-safe payloads exist.

---

## Phase 0 — Spikes and prerequisites

**Objective:** de-risk the assumptions the rest of the plan rests on, and start anything with
external lead time. Output is measurements, short notes and credentials — not production code, with
the exceptions of capture-metadata plumbing, shared DB lease primitives and limit/cost configuration,
which are real prerequisites that must land first.

| Task | Size | Detail |
|---|---|---|
| pg-mem compatibility spike | S | Verify partial unique indexes with `WHERE`, the multi-branch `CHECK`, and `ON CONFLICT … DO UPDATE` on the counters table all run under pg-mem. Architecture §3.4 lists the known limitations; confirm which actually bite. **Blocks Phase 2.** |
| ~~EXIF geotag benchmark~~ | — | **Resolved without a spike, architecture §12.4.** Extraction moves client-side, so there is no server-cost question to benchmark. Replaced by the row below. |
| **Capture metadata plumbing** | M | `captured_at` is read from `req.body?.capturedAt` at `upload-init` and **`app/utils/blogUpload.ts` has never sent it — the column is NULL for every asset in existence.** Add `capturedAt` / `capturedLat` / `capturedLng` extraction to the client picker paths (native: `expo-image-picker` with `exif: true`; web: a small EXIF reader over the `File`), send them at `upload-init`, and validate server-side. **Blocks Phase 5** — A2's bucketing and C1's time-span chip both read this field and are inert without it. Existing assets cannot be backfilled (sharp already discarded the metadata) and fall into the composer's "Unassigned" bucket. |
| Read-path baseline | S | Instrument `GET /:tripId/blog` query count and p95 on a seeded 14-day / 300-asset trip. This is the NFR-1 baseline; without it "no more than 15% regression" is unenforceable. **Blocks Phase 2.** |
| Whole-trip media fanout audit | S | Record assets read, signed URLs minted and peak signer concurrency for a one-page blog request. Current `listMedia()` + unbounded `Promise.all` touches the whole trip. **Blocks the Phase 1 bounded-read fix.** |
| Audience-room socket spike | S | Prove `BLOG_SUBSCRIBE` can authorize travelers/followers into separate `blog:<tripId>:travelers|followers` rooms without admitting followers to `trip:<tripId>` chat. **Blocks Phase 4.6.** |
| Limit + cost-model contract | M | Add every §9.2 provider/caller, operation unit, retained-KiB `reserveCapacityOrThrow` lifecycle, tier quota and §9.3 low/base/high/cap-driven estimator dimension/test. A missing finite cap or price keeps the related flag off. **Blocks the phase that introduces that caller, not merely Phase 6.** |
| **Static Maps budget re-check** | S | `GOOGLE_STATIC_MAPS` carries a **$15/month** budget and a 24h *in-process* cache. Under the original per-request day-map design the blog would have exceeded it roughly 5× (architecture §14.1). Confirm the corrected render-once volume fits, and raise the budget deliberately if not. **Blocks Phase 5.** |
| Cloud Run `--max-instances=1` | S | Not blog work, but adjacent and cheap. Cloud Run can autoscale today and nothing in the app is multi-instance safe; pin it and record the pin in `docs/production-deployment-guide.md`. See `docs/horizontal-scaling-requirements.md` §1. |
| Push credentials | M | APNs key + FCM config in EAS credentials; `EXPO_ACCESS_TOKEN` and versioned token encryption/hash keys through `_FILE`-capable server env. **Blocks real push canary.** Start external setup in Phase 0. |
| DB lease primitive | M | Implement/test the adapter-neutral claim/lease contract used by recap snapshots, notification outbox and new scheduled jobs. Postgres uses transactional row locking; Firebase uses a document transaction. **Blocks Phases 2, 4.5 and 6.** |

**Exit criteria:** each spike has a written answer, and any schema change the pg-mem spike forces is
folded into the Phase 2 migration before it is written.

---

## Phase 1 — Authoring quick wins (A3, A4, A5, C1 partial)

**Objective:** make the existing surface pleasant, and instrument it. Nothing here needs new tables.

This phase exists because three of the highest-friction problems are *already-built backend
capabilities with no UI*. That is the cheapest work in the whole program.

### Server

| Task | Size | Files |
|---|---|---|
| `blogAuthoringRoutes.ts` with `PATCH /:tripId/blog/days/:dayDate` (headline, summary) and `PATCH /:tripId/blog` (title, subtitle, introduction) | S | new route file; mount in `server/src/app.ts` under `/api/trips` |
| **Optimistic concurrency for blog_days** | S | Add `update_version` to `blog_days`; enforce in PATCH routes |
| Repository methods `updateBlogDayMeta`, `updateBlogMeta` in all three adapters | S | `blog/postgresRepository.ts`, `blog/firebaseRepository.ts`; memory inherits |
| Extend the `BlogRepository` interface | S | `blog/repository.ts` |
| Length validation per FR-A3.1 (120 / 500) | S | route-level, Zod |
| Page-first media read + bounded signer pool | M | `blogRoutes.ts` + media repositories: fetch media only for returned day IDs, cursor the lightbox, cap signed-URL concurrency from config |
| Early conditional GET | M | Cheap auth/revision/audience lookup evaluates `If-None-Match` before media URLs, counters or contributors; ETag includes audience class, flag generation and opaque caller digest |

### App

| Task | Size | Files |
|---|---|---|
| Inline headline/summary fields in edit mode | M | `app/tabs/tripBlog.tsx` — the day header block |
| Headline replaces the ISO date as day title in read mode (FR-A3.2) | S | same |
| Blog masthead editing (A4) | S | same, the card header |
| **Autosave** — debounce 1.5s, on blur, on tab change (FR-A5.1) | M | new `app/utils/useAutosave.ts`; wire into the `save(item)` path |
| Split tab state into focused hooks | M | Keep fetch helpers co-located with `tripBlog.tsx`; move document/autosave cancellation and normalized drafts into `useBlogDocument`/`useBlogAutosave` before social state arrives |
| Save-state indicator (FR-A5.2) | S | `tripBlog.tsx` |
| **Conflict banner + server contract** replacing the `409` `Alert.alert` (FR-A5.3) | L | Architecture §5.5: bounded Keep mine, Use theirs, idempotent Show both; current alert is in `save()` |
| Scoped draft recovery | M | account/trip/item namespaced persistent draft, 7-day TTL, clear on save/logout/account deletion, redacted from telemetry |
| Photo/video counts + time-span chips (the two C1 facts derivable with no new query) | S | `tripBlog.tsx` — computed from the `allMedia` flatMap that already exists |
| Authoring-time instrumentation | S | tab-open → first successful save, per PRD §2 |
| **Remove `@ts-nocheck` from `tripBlog.tsx`** | M | Before the file doubles in size. See "Type safety" in the cross-cutting section. |
| Remove `@ts-nocheck` from `BlogRichTextEditor.tsx` | S | Touched by A5 autosave anyway |

### Tests

- `app/tests/` — autosave debounce fires once per burst; conflict banner preserves the local draft
  across all three resolution choices.
- `server/__tests__/` — headline/summary length validation; follower gets `403` on both PATCH routes.
- Performance fixture — a one-day page from a 300-asset trip reads/signs only that page's assets and
  never exceeds configured signer concurrency.

**Exit criteria:** median authoring time is measurable and has a recorded baseline; a day can be
titled; no code path can discard a user's typing on conflict.

**Flag:** none — these are fixes to existing surfaces, not new capability. The conflict banner and
autosave replace strictly worse behaviour.

---

## Phase 2 — Engagement spine (no user-visible features)

**Objective:** schema, repository, authorization and the matrix test, with nothing on top. This phase
ships dark.

| Task | Size | Detail |
|---|---|---|
| Migration `20260901_add_blog_engagement.sql` + rollback | M | Architecture §3.2 verbatim. All five tables. |
| Migration `20260901_add_blog_authoring.sql` + rollback | M | Architecture §3.3. Includes `engagement_revision` and durable recap snapshots. |
| `blog/engagementRepository.ts` — interface + provider selection | S | Mirror the shape of `blog/repository.ts` exactly |
| `blog/postgresEngagementRepository.ts` | L | Upserts, batched counter reads (`IN (…)`, not array params), soft delete, tombstone rule |
| `blog/firebaseEngagementRepository.ts` | L | Native Firestore transaction/increment behavior from architecture §§3.5, 12.1 |
| Firestore indexes + deny-direct rules | M | Architecture §3.5; emulator proves only server adapter access and bounded cursor/lease queries |
| `services/blogEngagementService.ts` — `resolveEngagementTarget` | L | The single target-resolution function every route must use. Architecture §4 step 3. |
| `ensureUserFollowsTrip(tripId, userId)` | S | `db.ts` facade + all three adapters, reading `trip_followers` |
| New feature flag rows + fail-closed set | S | `server/config/feature-flags.yaml`, new rows default false; high-risk keys added to `FAIL_CLOSED_FLAGS` per architecture §9.1 |
| Limit entries | S | `server/config/api-limits.yaml` under `tripBlog`, architecture §9.2 |
| **Authorization matrix test** | L | Table-driven over actor × target × action. Architecture §11 bullet 1. Written **before** Phase 3's routes. |
| Counter reconciliation job | M | Reuse the storage reconciliation shape but require a unique DB-backed `(job_key, window_start)` lease; never start another uncoordinated per-process job |
| Adapter parity suite | M | Same repository tests against `postgres`, `firebase`, `memory` |

**Exit criteria:** all three adapters pass an identical repository suite; the authorization matrix
test compiles and passes against a service with no routes attached; `npm run test:server` green;
`GET /:tripId/blog` query count unchanged from the Phase 0 baseline (nothing is wired in yet).

**Risk:** this is the phase most likely to be skipped or merged into Phase 3 under time pressure.
Don't. The matrix test is the only thing standing between this feature and a privacy incident, and it
is far harder to write retroactively against routes that already exist.

---

## Phase 3 — Reactions, contributors, moderation primitives (B1, B5, B8, B11 partial)

**Objective:** the first user-visible social surface.

### Server

| Task | Size | Files |
|---|---|---|
| `routes/blogEngagementRoutes.ts` — the three reaction endpoints | M | Architecture §5.1 rows 1–3; `PUT` sets, `DELETE` clears, so replay never toggles state |
| Batched `engagement` block on `GET /:tripId/blog` | M | `blogRoutes.ts` — audience-counter batch + caller-reaction batch, joined in memory. Do **not** add a per-item query. |
| `contributors` per day | M | `blog/postgresRepository.ts` — distinct authors of non-deleted items + assets, ordered by count |
| Rate/admission limiting | S | actor/IP limits plus `TRIP_BLOG_SOCIAL_API` and storage-unit reservations from architecture §9.2 |

### App

| Task | Size | Files |
|---|---|---|
| `app/components/blog/BlogReactionBar.tsx` | M | Copy the optimistic-update shape from `ReactionBar.tsx`'s `computeOptimisticSummary`; emoji set instead of ±1 |
| `useBlogEngagement` normalized store | M | Key by `targetKind:targetId`; own optimistic mutation, rollback, socket/REST reconciliation and request cancellation outside the tab render tree |
| `app/components/blog/ContributorStrip.tsx` | S | Reuse `colorForUser` / `initialsForName` from `packages/messaging` and the `PresenceAvatars.tsx` avatar treatment |
| Reaction badges on gallery tiles | S | `DayMediaGallery.tsx` |
| Reaction rail in the lightbox | M | `DayMediaLightbox.tsx` |
| Reactions on text items and days | S | `tripBlog.tsx` |
| Follower read/react mode | M | `tripBlog.tsx` — `readOnly` currently blocks everything; split into `canAuthor` vs `canEngage` |

The `readOnly` split is the subtle one. Today `readOnly` gates authoring, cover-setting and
publication together. B8 requires a follower to react and comment while still being blocked from all
three. Introduce `canAuthor` (traveler, edit mode) and `canEngage` (traveler or follower) and audit
every current `readOnly` usage in `tripBlog.tsx` against the §4 matrix.

### Tests

- Matrix test extended to the live routes.
- Property test: N random reaction operations → per-audience counters equal a recomputed aggregate;
  a replayed `PUT` is idempotent.
- Public projection snapshot: counts present, reactor names absent (FR-B1.5).
- E2E: react → reload → persists.

**Exit criteria:** `trip_blog_reactions` on for internal trips; reactions per published day
measurable; no read-path regression beyond NFR-1.

**Gate to Phase 4:** authorization violations are zero in canary telemetry, counter reconciliation
drift is within the agreed tolerance, and reaction write/error volume stays inside configured caps.

---

## Phase 4 — Comment core and full moderation (B2, B11)

### Server

| Task | Size | Files |
|---|---|---|
| Comment CRUD endpoints | L | `blogEngagementRoutes.ts`, architecture §5.1 rows 4–8 |
| Day-level comment fetch (one request per day, not per target) | M | The shape decision in §5.1 — a 23-photo day must not produce 27 requests |
| Tombstone rule (FR-B2.4) | S | Soft delete with replies → tombstone; without → gone |
| 15-minute edit window | S | Server-enforced, not client-enforced |
| Report + hide endpoints, strike escalation | M | `blogModerationService.ts`. Reports never auto-hide (threat S8); hiding is always a human action. |
| `resolveComment(actor, tripId, commentId)` | M | The second mandatory resolver. Comment-id routes bypass `resolveEngagementTarget` entirely — this is the likeliest IDOR in the feature (threat S3). Extend the matrix test to comment-id routes with a foreign trip's comment id. |
| **Public engagement endpoint** | M | `GET /api/public/:username/:tripSlug/engagement`, separate from the public blog payload so a new comment never invalidates the page cache (NFR-6, architecture §14.7). Own flag `trip_blog_public_engagement`, own IP-hashed rate limit, counts and public-audience comments only, never author ids. Unauthenticated — the most abusable surface in the feature. |
| Automated spam check | M | Invoke `blogModerationService.checkSpam()` inside public-audience comment creation before persistence (NFR-12); use deterministic in-process rules in v1, with no separate client-callable endpoint or uncapped provider call. Any future external classifier requires its own disabled-by-default flag, finite caller limit and cost-model entry before activation. |
| Rate/admission limiting | S | actor/IP/day/retained-row ceilings plus internal API/storage reservations |

### App

| Task | Size | Files |
|---|---|---|
| `BlogCommentThread.tsx`, `BlogCommentComposer.tsx` | L | Two-level threads, 3 reply previews, "show earlier" |
| Comment rail in the lightbox | M | `DayMediaLightbox.tsx` — right rail wide, bottom sheet narrow |
| Report / edit / delete / hide affordances | M | Overflow menu per comment |
| Follower ring + "Following" chip | S | Per UI §6.6 |
| "Visible to travelers" chip on non-public comments | S | The PR-2 consequence made visible |
| “Visible publicly” submit disclosure | S | Persistent label when the new comment will inherit `public` (PR-8) |

### Tests

- **Spam Filtering Test**: Public comment with known spam keywords is automatically hidden; traveler
  comment with same keywords is NOT hidden (as travelers are trusted).
- Audience inheritance: a private comment stays private after publication; a public comment
  disappears on revoke; public counters never include private-audience rows.
- Tombstone rendering with and without replies.
- Strike escalation blocks the fourth comment after three hides.
- Hide/unhide replay is idempotent; a reversed hide removes exactly one strike and does not expose a
  now-inaccessible target.
- Account deletion scrubs body/author, preserves a required tombstone, deletes reactions and adjusts
  counters transactionally.
- E2E: comment as follower in a second browser context → owner hides → gone for both after refresh.
- No-HTML assertion on the public page payload (NFR-8).

**Exit criteria:** comments progress from 1% to 5% only while abuse reports per 1,000 published days,
moderation queue age and response SLA stay within Trust & Safety's signed-off thresholds; the
moderation path is exercised end to end at least once on a real report; `trip_blog_comments` can be
turned off cleanly with existing comments intact but hidden.

---

## Phase 4.5 — Notification service (app-wide infrastructure)

**Objective:** build the notification service specified in `trip-blog-social-architecture.md` §13.
This is **not blog-specific** — it is app-wide infrastructure that the blog happens to be the first
consumer of, and it should be built and reviewed on those terms.

It sits between comment core and Phase 4.6 because mentions (B3) are the first real consumer, and
because it must exist before nudges (B6, Phase 6) rather than after — building an email-only nudge
path first is work that gets unwound.

**Prerequisite for push canary:** push credentials from Phase 0. Schema, inbox, preferences, outbox
and fake-provider tests may start without production credentials; no real push flag may turn on.

### Server

| Task | Size | Files |
|---|---|---|
| Migration `20260901_add_notifications.sql` + rollback | L | Architecture §13.2 — notifications, encrypted device tokens, preferences, thread mutes and durable outbox |
| `services/notificationService.ts` — transactional `notify()` | L | The single entry point. Resolve explicit preference → category default → off, apply thread mute, and write inbox/outbox without provider I/O. |
| `services/notificationOutboxWorker.ts` | L | DB claim/lease, bounded batch/concurrency/backoff, dead letter; safe with multiple instances |
| `apis/expoPushApi.ts` + `apis/expoPushCallers.ts` | M | Follows the existing `apis/` + callers split; batch 100; handle `DeviceNotRegistered` by disabling the device row |
| `routes/notificationRoutes.ts` | M | Inbox, read, preference, thread-mute and device endpoints, §13.3 |
| Repository methods across all three adapters | L | `db.postgres.ts`, `db.firebase.ts`; memory inherits |
| Socket `NOTIFICATION_CREATED` emit | S | Per-user emit; new constant in `packages/messaging` |
| Retention pruning | M | DB-leased pruning by `retentionDays` and `retainedRowsMaxPerUser` |
| Flags + limits + cost units | M | Architecture §§9.2, 9.3, 13.7; EXPO_PUSH/SMTP/internal API/storage reservations |

### App

| Task | Size | Files |
|---|---|---|
| `expo-notifications` dependency + plugin entry | M | `app/package.json`, `expo.config.shared.cjs` alongside `expo-image-picker` |
| `app/utils/notificationPermissions.ts` | M | Pre-prompt, platform-specific re-prompt rules, foreground re-check — §13.5. Includes `Linking.openSettings()`, the only reliable recovery path across platforms. |
| Android channel reconciliation | M | Read live channel state so the preferences UI can show "blocked in system settings" rather than a toggle that lies. OS authoritative for delivery, our table for intent — §13.5. |
| Provisional authorization evaluation | S | iOS 12+ quiet delivery with no prompt at all. Decide per category before committing to the pre-prompt flow — plausibly the better fit for mentions. §13.5. |
| `app/utils/notifications.ts` | M | Token registration on login, re-register on change, delete on logout |
| `NotificationBell.tsx` + `NotificationPanel.tsx` | L | Model on `ChatButton.tsx` / `ChatPanel.tsx` — that pair already solves badge-plus-panel against a socket |
| Preferences UI | M | `app/tabs/account.tsx`, per-category toggles |
| Deep-link routing | M | `app/App.tsx` — tapped notification → trip + tab + anchor |

### Tests

- Preference resolution: explicit row → checked-in known-category default → off; unknown category is
  fully off and thread mute overrides every channel.
- `dedupe_key` collapses duplicates; twenty reactions on one photo produce one digest row.
- `notify()` performs no provider call; a crash after commit leaves a claimable outbox row. Two
  workers cannot own the same live lease; crash-after-provider-accept may redeliver, and the client
  suppresses the stable `notificationId`; retry/dead-letter behavior is bounded.
- Permission denied → in-app inbox still works; email fires only when that category is explicitly
  enabled; no repeat prompting; settings deep link remains reachable.
- Android: channel disabled in OS settings while our row says `push = true` → preferences UI shows
  blocked, and we do not silently rewrite our own table.
- Adapter parity across all three providers.
- Device token ciphertext/hash never appears in logs or API reads; account deletion and logout scrub
  it. Push payload snapshots contain no comment text, trip spend or precise location.
- User export includes notification history/preferences but excludes every device-token/encryption
  field; deletion removes inbox/outbox/devices and releases retained capacity.

**Exit criteria:** a synthetic notification event produces exactly one permitted push and one durable
inbox row; permission denial degrades cleanly; `notifications_push` can be turned off without breaking
the inbox. Phase 4.6 proves the real mention integration.

**Rollback posture:** `notifications_in_app` off hides the bell and stops creation of new inbox rows;
existing rows are retained/pruned normally. `notifications_push` off stops new push outbox rows while
the inbox continues. Disabling either channel never deletes user history or bypasses preferences.

---

## Phase 4.6 — Mentions, replies and realtime integration (B3, B4, B12)

**Objective:** connect comments to the durable notification service and add live delivery without
crossing the traveler/follower audience boundary.

| Task | Size | Detail |
|---|---|---|
| Mentions + mentionable endpoint | M | `blog_comment_mentions`, trip-scoped autocomplete only; at most 10 mentions/comment |
| Mention/reply dispatch | M | Call transactional `notify()` once on creation, with dedupe keys and thread mutes; never on edit |
| `BLOG_SUBSCRIBE` + segmented rooms | L | Travelers/followers join separate blog rooms; followers never join `trip:<id>` chat |
| Blog event constants/client reconciliation | M | `packages/messaging`, `app/utils/socket.ts`; REST refetch on reconnect remains authoritative |
| Mention UI + notification deep links | M | Mention chips, inbox link to trip/day/comment, inaccessible target degrades to the trip blog |
| Two-instance contract test | M | Runs when Redis adapter work is available; until then asserts same-instance isolation and keeps Cloud Run pinned to one instance |

**Tests:** traveler chat is never delivered to a follower blog subscriber; audience-specific blog
events reach only allowed rooms; mention edits do not notify; a muted thread does not enqueue; socket
loss/reconnect reconciles through REST; removal/unfollow revokes the room immediately.

**Exit criteria:** a mention produces one inbox row and at most one provider delivery; realtime can be
disabled independently without affecting writes; audience isolation has a reviewed security test.

---

## Phase 5 — What actually happened (C1, C2, C3, C5, C10, C11, A1, A2)

### Server

| Task | Size | Files |
|---|---|---|
| `services/blogDayFactsService.ts` | XL | Architecture §7.1 — one service, two projections (facts + timeline) |
| `routes/blogInsightRoutes.ts` — `GET …/days/:dayDate/facts` | M | Separate request from the blog document, per §5.2 |
| Capture-metadata integration | S | Consume the Phase 0 client-supplied `capturedAt`; accept lat/lng only when `photo_location_enabled`, never parse EXIF server-side |
| `services/blogDayStarterService.ts` | L | Deterministic template, reusing `blog/narrative.ts` |
| Starter endpoints (get / accept / dismiss) | M | `blogAuthoringRoutes.ts` |
| `source_type = 'day_starter'` on accepted items | S | So acceptance rate is measurable — the stage gate depends on it |
| `services/blogMediaGroupingService.ts` + `POST /blog/media/group` | M | Stateless bucketing; no writes, no storage reservation |
| Facts in-process cache | M | Revision/audience-class key + local single-flight; cache is never an authorization boundary |
| **Day-map render job** | L | Background render → PNG → `blogStorageClient` under a reserved platform prefix, keyed `(tripDay, pointsHash)`. Debounced to `dayMapRerenderMinIntervalHours`. Two artifacts when photo geotags are on: traveler (with photo pins) and public (itinerary points only) — threat S14. **No request path may reach Google Static Maps.** Architecture §14.1. |
| Reserved-prefix exclusion in reconciliation | S | `blogStorageReconciliationService.ts` must exclude platform artifacts from uploader totals, or generated maps get billed to whoever's id is in the object key (§14.4) |
| **Platform-artifact reaping** | M | The exclusion above creates a storage leak — reconciliation is what deletes orphans, so a skipped prefix grows forever. Delete a trip's artifacts on trip deletion (prefix delete by `tripId`, upholding the existing "deleting a trip deletes its blog content" guarantee), delete the superseded object when a re-render promotes a new points-hash, and add a second reconciliation pass over the platform prefix only. §14.4 |
| `BLOG_DAY_MAP_RENDER` caller + budget check | S | `api-limits.yaml`; assert budget exhaustion degrades the card rather than erroring the page |
| Fact provenance | M | `sourceTypes[]`, `confidence`, `asOf`; filter sources before derivation |

### App

| Task | Size | Files |
|---|---|---|
| `DayFactStrip.tsx` | M | Elastic — absent chips, never zeros (FR-C1.1) |
| Day map (client) | S | Renders the **stored map artifact** by asset id through the existing signed-URL path — it does *not* call `staticMapRoutes.ts`. `TripDayMap.tsx` stays as-is for the planning surface. Collapsed on mobile. Architecture §14.1. |
| `DayTimelineRail.tsx` | L | Side-by-side with the map ≥900px, stacked below |
| `DayStarterCard.tsx` | M | Use / Rewrite / Not now |
| `PhotoFirstComposer.tsx` | XL | Day buckets, Unassigned bucket, out-of-range confirm, headroom line before commit |
| Storage headroom before commit | S | `GET /blog-storage` — already exists |
| Planned-vs-actual markers | S | Reuse `utils/itineraryStatus.ts` |
| End-of-day review | M | Quick actions call existing source-record update routes/status lifecycle; no duplicate blog “actual” records |
| Fact correction links | S | Deep-link authorized travelers to existing activity/transfer/lodging/car-rental editor |
| Spend chip | M | Compute only in the traveler client from authorized expenses using existing `costs.ts`, `coveredBy.ts`, `exchangeRates.ts`; never add expenses to facts/public payload |

**The photo-first composer is the largest single client task in the program.** It reuses the existing
`upload-init` → `complete` flow and the existing quota modal (FR-A2.4) — the new work is bucketing
UI, the Unassigned flow, and moving the quota conversation before commit instead of mid-upload.

### Tests

- Day Starter determinism against fixed fixtures (byte-identical output).
- Starter suppressed after dismissal, and for days that already have text.
- Bucketing: no-`captured_at` items land in Unassigned and are never auto-assigned (FR-A2.2).
- Facts omit undeliverable rows entirely rather than emitting zeros.
- Public projection contains no geotags (FR-C2.2, PR-3).
- Server rejects client-supplied coordinates when the trip toggle is off; enabling later does not
  backfill old assets.
- Fact provenance never names or links a source hidden from the current audience.
- End-of-day review updates the canonical source record and respects its existing authorization.

**Exit criteria:** Day Starter acceptance rate > 30% on internal trips; fact strip renders ≥3 facts
on 80% of days with itinerary data.

---

## Phase 6 — Recap, spend, polish (C4, C7, A6, A7, A8, B6, B7)

| Task | Size | Files |
|---|---|---|
| `services/blogRecapService.ts` + `GET /blog/recap` | L | Durable, leased snapshot keyed on `(tripId, contentRevision, engagementRevision, audienceClass)`; `202` while pending; retain three revisions/trip |
| `TripRecapCards.tsx` | L | Screenshot-first layout per UI §6.8 |
| Spend summary | M | Reuse `utils/costs.ts` + `exchangeRates.ts`; `travelers` audience default (FR-C4.1) |
| Writing prompts | S | Static rotating set; seeds the editor with a heading |
| Drag-to-reorder UI | M | Wire the existing `POST /blog/items/reorder` |
| AI caption / alt text | L | Premium/Pro, on demand only; reserve tier quota plus active-provider `BLOG_CAPTION_SUGGEST`; manual alt text remains available to all; every suggestion labelled |
| Alt-text publication readiness | M | Manual editor for all tiers; new publication validates text or explicit decorative mark; legacy public blogs get non-blocking remediation |
| Photo of the day proposal | S | Proposes from reaction counts; a traveler confirms (FR-B7.1) |
| **Traveler Spotlight Badge** | S | UI implementation of B17 in the Contributor Strip |
| Contribution nudges | M | DB-leased scheduled job → `notify()`; 72h dedupe, 30-day-post-trip suppression, opt-out; suppress before mentions/replies under backlog |

AI captioning/rewrite/transcription is resolved as Premium/Pro. Both customer monthly quota and
aggregate provider/cost-budget reservations are required. A provider/model switch must carry the same
caller names and limits, and a missing price keeps the flag off.

Nudges use the Phase 4.5 notification service and its durable outbox. The scheduled scan itself claims
a unique DB window so multiple instances cannot enqueue duplicates.

**Exit criteria:** GA. All PRD §2 measures reporting.

---

## Phase 6b — Late-added features (B15, B16, B14, A12, B13)

**Objective:** the five features the PRD added after the original phasing was written. Designed in
architecture §16. They are grouped here rather than scattered because three of them share the
notification budget and two share a schema change, so building them separately would mean building
the same plumbing three times.

Ordered cheapest-and-safest first. **B13 is last on purpose** — it is the only one that sends
unsolicited mail to followers.

| # | Task | Size | Detail |
|---|---|---|---|
| B14 | Reaction burst animation | S | Reads the B4 socket event; no endpoint, no storage, no cost. **`prefers-reduced-motion` respected unconditionally** — with it set, the count changes instantly and nothing animates. Coalesce to ≤1 burst per target per 3s; never animate off-screen targets. §16.4 |
| B16 | Engagement milestones | M | Detect crossings from the counter delta already returned by the write (`previousTotal < threshold <= newTotal`) — **no extra query on the reaction path**. Dedupe via `notifications.dedupe_key = trip:{id}:milestone:{n}`, so "fire once" is a DB constraint, not application luck. **In-app only, never push.** Thresholds from config. §16.3 |
| B15 | Migration: `blog_curation_stars` (**expand only**) | M | **Breaking change to a shipped table — expand/contract, do not drop here.** Create, backfill, dual-write; the drop of `blog_item_highlights` is a *later* migration after the rollback window, or a server rollback hits a missing table. §16.1. `blog_item_highlights.item_id` is a PRIMARY KEY, so it holds exactly one star per item and `setHighlight` silently overwrites another traveler's. Migrate existing rows (each becomes the sole star), then drop. New table uses the §3.1 polymorphic target so a *gallery photo* — which has no `blog_items` row of its own — can be starred. §16.1 |
| B15 | Star endpoint + compat shim | M | `PUT /:tripId/blog/:targetKind/:targetId/star` resolving through `resolveEngagementTarget`. Keep `POST /blog/items/:itemId/highlight` as a shim writing the new table — it is shipped and native clients may still call it. Scope `DELETE` to the calling user. |
| B15 | Recap Top Highlights ordering | S | Starred first, then reaction counts. This ordering *is* the feature — it lets a group promote the meaningful photo over the merely popular one. |
| A12 | Rotation state + prompt job | M | Table keyed `(trip_id, local_date)` recording who was asked and which prompt, so rotation is fair, non-repeating and idempotent under job re-run. **Shares the B6 nudge budget** — one cap for nudges as a class, or A12 becomes a second uncapped channel that defeats FR-B6.1. Suppress for a day that traveler already wrote. Static reviewed prompt list, no generation. §16.5 |
| B13 | Memory Lane job | L | Leased daily job. **Re-check publication state at send time, not enqueue** — a blog revoked since the trip must never resurface to followers. Followers opt *in* (`blog_memory_lane` defaults off for followers, on for travelers). Global daily cap with next-day deferral; skip trips below `memoryLaneMinEngagementScore`. §16.2 |

### Tests

- **B15 migration**: existing single stars survive as that user's star; a second traveler starring no
  longer displaces the first; one traveler cannot clear another's star.
- **B15 rollback**: with `blog_curation_stars` created and dual-writing, the *previous* server binary
  still functions against `blog_item_highlights`. This is the test that makes expand/contract real
  rather than aspirational.
- **B15 targets**: a gallery-member photo (no own item id) can be starred and unstarred.
- **B16**: 200 reactions crossing a threshold produce exactly **one** notification row, not one per
  viewer and not one per reaction; and no additional query is issued on the reaction write path.
- **B14**: with `prefers-reduced-motion` set, no animation runs; 20 socket reactions in 10s produce
  ≤4 bursts.
- **A12**: prompt job re-run on the same day is a no-op; a traveler who already wrote that day is not
  prompted; A12 + B6 together respect a single per-user cap.
- **B13**: a trip published then revoked produces zero follower notifications and still notifies
  travelers; two instances running the job produce one notification per recipient (register 15b).

**Exit criteria:** the shared nudge cap holds with A12 and B6 both enabled; B13 runs a full cycle on
internal trips with follower notifications observed to respect opt-in and revocation.

---

## Phase 7 — Follow-on (A9, A10, A11, B9, B10, C6, C8, C9)

Voice notes, quick capture, offline queue, blog presence, Trip Awards, places index, search UI,
keepsake export. Each is independently valuable and independently deferrable. Prioritize from GA
data rather than from this document — by then there will be real numbers, and the ordering here is
guesswork by comparison.

Two notes worth carrying forward:

- **A9 (voice notes)** unlocks `media.audio`, a registered item kind that has been sitting unused.
  It is likely the single fastest capture path while actually travelling, and may deserve promotion
  above its P2 priority if Phase 5 shows authoring is still the bottleneck.
- **C9 (keepsake export)** unlocks `core.export`, also registered and unused. It is the most likely
  candidate for a paid one-off, which makes it worth revisiting alongside the storage add-on numbers.

---

## Cross-cutting checklists

### Every new server route

- [ ] Mounted in `server/src/app.ts` under the correct `/api/` prefix
- [ ] `authenticate` middleware applied
- [ ] Feature flag checked via `isFeatureEnabled` (no admin bypass)
- [ ] Target resolved **only** through `resolveEngagementTarget`
- [ ] Actor/IP limit plus named DB-atomic API and storage-unit reservations applied from
      `api-limits.yaml` before work; no route-local or process-local enforcement counter
- [ ] Persistent rows reserve/finalize/release worst-case retained KiB idempotently through
      `reserveCapacityOrThrow`; deletion/retention tests prove capacity is reclaimed
- [ ] Payload/list/batch caps validated server-side and stable cursor pagination used
- [ ] Idempotency behavior documented and replay-tested for every write
- [ ] `logInfo` / `logError` from `logger.ts` — never `console.log`
- [ ] Env access via `getEnvValue` / `getEnvFlag` only
- [ ] Implemented in `db.postgres.ts`, `db.firebase.ts`, and verified under pg-mem
- [ ] Non-existent-but-invisible targets return `404`, not `403`
- [ ] Comment-id routes resolve through `resolveComment`, never `resolveEngagementTarget` (threat S3)
- [ ] Any external call passes a caller key that exists in `api-limits.yaml`, with a price in `cost-model.yaml`
- [ ] No user-supplied string reaches an HTML context (threats S1/S2)
- [ ] Cost dimensions and request outcome metrics recorded without logging bodies, tokens or precise
      location

### Type safety — a precondition, not a nicety

**Every file this program touches most heavily has type checking switched off.**
`app/tabs/tripBlog.tsx` opens with `// @ts-nocheck`, and so do `DayMediaGallery.tsx`,
`DayMediaLightbox.tsx`, `BlogRichTextEditor.tsx` and `BlogMediaPreview.tsx`. The plan roughly doubles
the size of `tripBlog.tsx` (648 lines today) and adds audience-dependent rendering to all of them —
that is precisely the code where an untyped `item.audience` typo silently renders private content.

Rules for this program:

- **No new file carries `@ts-nocheck`.** New components are typed from the start.
- **`tripBlog.tsx` loses `@ts-nocheck` in Phase 1**, before the social layer lands. Doing it later
  means doing it against three times the code. Budget this as **M**, not S — the file prop-drills
  loosely typed `styles`/`theme`/`headers` objects throughout.
- **Each existing blog component loses `@ts-nocheck` in the phase that first modifies it**
  (`DayMediaGallery`/`DayMediaLightbox` in Phase 3, `BlogRichTextEditor` in Phase 1).
- The engagement payload types are **shared, not redeclared** — define `BlogEngagementSummary`,
  `BlogComment` and the target-kind union once in `server/src/blog/types.ts` and import them, per the
  repo's "use types from `types.ts`, do not redefine locally" convention.

This is the highest-leverage maintainability item in the program and it is cheap only if done first.

### Every new client component

- [ ] `app/theme/theme.ts` tokens — no ad-hoc pixel values or hex colors
- [ ] `MIN_TOUCH_TARGET` / `hitSlop` on every interactive control
- [ ] `Platform.OS !== 'web'` guards where native modules are involved
- [ ] `testID` in `{entity}-{action}[-{id}]` format
- [ ] Renders correctly for: traveler, traveler-in-edit-mode, follower, public preview
- [ ] Degrades cleanly with the feature flag off (absent, not disabled)
- [ ] No `@ts-nocheck`; engagement types imported from `server/src/blog/types.ts`, not redeclared
- [ ] Reaction/comment controls reachable and legible at 320px width (see the mobile note below)
- [ ] Keyboard/screen-reader labels, focus restoration, reduced motion and 200% text sizing verified
- [ ] Long lists are virtualized/lazy; off-screen threads, facts and signed URLs are not prefetched

### Definition of done, per phase

1. All three DB adapters pass the same tests.
2. `npm run test:server` and `npm run test:app` green.
3. New modules meet ≥90% changed-line and ≥85% branch coverage without lowering repository
   thresholds; every auth/limit/privacy branch has a direct test.
4. The authorization matrix test covers every new action.
5. Applicable new feature flags default off and toggle cleanly both directions without a deploy.
6. Public projection snapshot updated and reviewed — **manually reviewed, not just regenerated.**
7. `GET /:tripId/blog` p95 within 15% of the Phase 0 baseline.
8. Cost estimator shows low/base/high and cap-driven totals; every new caller/storage dimension has a
   finite cap, active-adapter test and price/price-source entry.
9. New jobs/outbox paths pass lease-takeover/idempotency tests and add no unregistered in-process
   state to `horizontal-scaling-requirements.md`.
10. Logs/metrics/traces contain no comment bodies, device tokens, coordinates, spend or signed URLs.
11. Docs reconciled: if implementation diverged from the architecture document, the architecture
   document is updated in the same PR.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Read-path regression from engagement counts | Medium | High | Audience-aware counters plus a fixed set of bounded batch reads; query-count/payload benchmark in the DoD |
| Privacy leak via audience mismatch | Low | Severe | Single `resolveEngagementTarget`; matrix test written before routes (Phase 2) |
| Moderation demand exceeds capacity | Medium | High | PR-1 keeps the public read-only; strikes auto-block; staged rollout with an abuse-rate gate |
| pg-mem rejects the schema | Medium | Medium | Phase 0 spike; fallbacks identified in architecture §3.4 |
| Realtime silently breaks when scaled horizontally | Medium | Medium | Cloud Run pinned to one instance; segmented rooms now; Redis adapter + two-instance test required before raising the pin |
| Follower blog subscription leaks traveler chat | Low | Severe | Separate blog audience rooms; followers never join `trip:<id>`; explicit isolation test |
| Fail-open flags open commenting/provider writes on a schema gap | Low | High | Major social/comment/provider flags added to the existing fail-closed rollout set; YAML/seed parity asserted in CI |
| AI caption cost scales with photo count | High | Medium | Premium/Pro monthly quota, per-day cap, aggregate caller/budget, on demand only, estimator hard-cap scenario |
| Phase 2 gets merged into Phase 3 under schedule pressure | **High** | **Severe** | Named here explicitly so it is a visible decision rather than a quiet one |
| `captured_at` never gets populated, silently gutting A2 and C1 | Medium | High | Promoted to a Phase 0 prerequisite. The field looks implemented (column exists, API accepts it) which is exactly why it is easy to miss that nothing sends it. |
| Push permission prompt spent badly on first launch | Medium | High | §13.5 rules; pre-prompt before the OS dialog. iOS gives one chance per install. |
| Notification preferences resolved fail-open, spamming users | Medium | High | Explicit row → known-category default → off; unknown category off; thread mute overrides all channels |
| Provider send occurs in request or is duplicated across instances | Medium | High | Transactional outbox, DB lease, bounded retries/dead letter; `notify()` performs no provider I/O |
| Public counts leak private engagement | Low | Severe | Counters partitioned by audience; public endpoint reads `public` rows only; projection snapshot/property tests |
| Account deletion breaks threads or leaks deleted text | Medium | High | Nullable author FK, scrubbed body tombstones, transactional reaction/counter cleanup, deletion/export tests |
| Cost estimate omits “free” internal/storage work | Medium | High | Every route and DB operation uses named units; estimator contract fails when caller/dimension/price is absent |
