# Trip Blog Social & Recap Layer — Implementation Plan

**Execution companion to** `docs/trip-blog-social-architecture.md` (design of record — read it
first) and `docs/trip-blog-social-prd.md` (requirements, numbered FR/NFR/PR).

Sizes are relative (S / M / L / XL), not calendar estimates. Where a task says "reuse `X`", that file
exists in this repo today — read it before writing anything new.

**Alignment rule:** the architecture document is authoritative for schema, routes, flags and the
authorization matrix. If a task here disagrees with it, the architecture document wins and this
document is wrong. Reconcile before each phase starts rather than carrying a stale field name
forward.

**Every phase ships behind flags defaulting to off** (§9.1 of the architecture). No phase is "done"
until its flag can be turned on for an internal trip and turned off again without a deploy.

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

---

## Phase 0 — Spikes and prerequisites

**Objective:** de-risk the four assumptions the rest of the plan rests on. Output is measurements and
short notes, not production code.

| Task | Size | Detail |
|---|---|---|
| pg-mem compatibility spike | S | Verify partial unique indexes with `WHERE`, the multi-branch `CHECK`, and `ON CONFLICT … DO UPDATE` on the counters table all run under pg-mem. Architecture §3.4 lists the known limitations; confirm which actually bite. **Blocks Phase 2.** |
| EXIF geotag benchmark | S | Add lat/lng extraction to a copy of `blogMediaProcessingService.ts` and measure the delta on the existing upload path. Architecture Q4. **Blocks Phase 5.** |
| Read-path baseline | S | Instrument `GET /:tripId/blog` query count and p95 on a seeded 14-day / 300-asset trip. This is the NFR-1 baseline; without it "no more than 15% regression" is unenforceable. **Blocks Phase 2.** |
| Socket role caching spike | S | Confirm `authMiddleware.ts` + `chatHandler.ts` can carry `{ role }` on the socket at join time for per-socket audience filtering (architecture §6 rule 2). **Blocks Phase 4.** |
| Cost-model entries | S | `BLOG_CAPTION_SUGGEST`, `BLOG_STARTER_REWRITE` in `server/config/cost-model.yaml` and `api-limits.yaml`. **Blocks Phase 6.** |

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
| Repository methods `updateBlogDayMeta`, `updateBlogMeta` in all three adapters | S | `blog/postgresRepository.ts`, `blog/firebaseRepository.ts`; memory inherits |
| Extend the `BlogRepository` interface | S | `blog/repository.ts` |
| Length validation per FR-A3.1 (120 / 500) | S | route-level, Zod |

### App

| Task | Size | Files |
|---|---|---|
| Inline headline/summary fields in edit mode | M | `app/tabs/tripBlog.tsx` — the day header block |
| Headline replaces the ISO date as day title in read mode (FR-A3.2) | S | same |
| Blog masthead editing (A4) | S | same, the card header |
| **Autosave** — debounce 1.5s, on blur, on tab change (FR-A5.1) | M | new `app/utils/useAutosave.ts`; wire into the `save(item)` path |
| Save-state indicator (FR-A5.2) | S | `tripBlog.tsx` |
| **Conflict banner** replacing the `409` `Alert.alert` (FR-A5.3) | M | new `app/components/blog/ConflictBanner.tsx`; the current alert is at the `response.status === 409` branch in `save()` |
| Photo/video counts + time-span chips (the two C1 facts derivable with no new query) | S | `tripBlog.tsx` — computed from the `allMedia` flatMap that already exists |
| Authoring-time instrumentation | S | tab-open → first successful save, per PRD §2 |

### Tests

- `app/tests/` — autosave debounce fires once per burst; conflict banner preserves the local draft
  across all three resolution choices.
- `server/__tests__/` — headline/summary length validation; follower gets `403` on both PATCH routes.

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
| Migration `20260901_add_blog_authoring.sql` + rollback | S | Architecture §3.3. Includes `engagement_revision` on `trip_blogs`. |
| `blog/engagementRepository.ts` — interface + provider selection | S | Mirror the shape of `blog/repository.ts` exactly |
| `blog/postgresEngagementRepository.ts` | L | Upserts, batched counter reads (`IN (…)`, not array params), soft delete, tombstone rule |
| `blog/firebaseEngagementRepository.ts` | L | Native atomic increment for counters (architecture Q1) |
| `services/blogEngagementService.ts` — `resolveEngagementTarget` | L | The single target-resolution function every route must use. Architecture §4 step 3. |
| `ensureUserFollowsTrip(tripId, userId)` | S | `db.ts` facade + all three adapters, reading `trip_followers` |
| Feature flag rows | S | `server/config/feature-flags.yaml`, all default false |
| Limit entries | S | `server/config/api-limits.yaml` under `tripBlog`, architecture §9.2 |
| **Authorization matrix test** | L | Table-driven over actor × target × action. Architecture §11 bullet 1. Written **before** Phase 3's routes. |
| Counter reconciliation job | M | Extend the `blogStorageReconciliationService.ts` scheduling pattern |
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
| `routes/blogEngagementRoutes.ts` — the four reaction endpoints | M | Architecture §5.1 rows 1–3 |
| `services/blogModerationService.ts` — strikes, hide, `audit_log` write | M | new; `hide` is needed now because reactions are cheap to abuse via spam accounts even before comments exist |
| Batched `engagement` block on `GET /:tripId/blog` | M | `blogRoutes.ts` — one counters read per page, joined in memory. Do **not** add a per-item query. |
| `contributors` per day | M | `blog/postgresRepository.ts` — distinct authors of non-deleted items + assets, ordered by count |
| Rate limiting | S | `httpRateLimitService.ts`, 60/min/user |

### App

| Task | Size | Files |
|---|---|---|
| `app/components/blog/BlogReactionBar.tsx` | M | Copy the optimistic-update shape from `ReactionBar.tsx`'s `computeOptimisticSummary`; emoji set instead of ±1 |
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
- Property test: N random reaction operations → counters equal a recomputed aggregate.
- Public projection snapshot: counts present, reactor names absent (FR-B1.5).
- E2E: react → reload → persists.

**Exit criteria:** `trip_blog_reactions` on for internal trips; reactions per published day
measurable; no read-path regression beyond NFR-1.

**Gate to Phase 4:** abuse reports per 1,000 published days below threshold at 5% rollout.

---

## Phase 4 — Comments, mentions, realtime, full moderation (B2, B3, B4, B11)

### Server

| Task | Size | Files |
|---|---|---|
| Comment CRUD endpoints | L | `blogEngagementRoutes.ts`, architecture §5.1 rows 4–8 |
| Day-level comment fetch (one request per day, not per target) | M | The shape decision in §5.1 — a 23-photo day must not produce 27 requests |
| Tombstone rule (FR-B2.4) | S | Soft delete with replies → tombstone; without → gone |
| 15-minute edit window | S | Server-enforced, not client-enforced |
| Mentions: `blog_comment_mentions`, `GET /blog/mentionable` | M | Trip-scoped only (FR-B3.1, PR-7) |
| Report + hide endpoints, strike escalation | M | `blogModerationService.ts` |
| Mention notification via `smtpCallers.ts` | M | One per mention, on creation only (FR-B3.2) |
| `socket/blogEngagementHandler.ts` | L | Per-socket audience filtering (architecture §6 rule 2) |
| New event constants | S | `packages/messaging` |
| Rate limiting | S | 10/min/user/trip |

### App

| Task | Size | Files |
|---|---|---|
| `BlogCommentThread.tsx`, `BlogCommentComposer.tsx` | L | Two-level threads, 3 reply previews, "show earlier" |
| Mention autocomplete | M | Trip-scoped; renders as a chip, stores as a user id |
| Comment rail in the lightbox | M | `DayMediaLightbox.tsx` — right rail wide, bottom sheet narrow |
| Report / edit / delete / hide affordances | M | Overflow menu per comment |
| Realtime subscription | M | `app/utils/socket.ts`; refetch-on-reconnect reconciliation |
| Follower ring + "Following" chip | S | Per UI §6.6 |
| "Visible to travelers" chip on non-public comments | S | The PR-2 consequence made visible |

### Tests

- Audience inheritance: comment created private stays private after publication; comment created
  public disappears on revoke (PR-2, PR-4).
- Tombstone rendering with and without replies.
- Strike escalation blocks the fourth comment after three hides.
- E2E: comment as follower in a second browser context → owner hides → gone for both.
- No-HTML assertion on the public page payload (NFR-8).

**Exit criteria:** comments on for 5% of trips; moderation path exercised end to end at least once on
a real report; `trip_blog_comments` can be turned off cleanly with existing comments intact but
hidden.

---

## Phase 5 — What actually happened (C1, C2, C3, C5, A1, A2)

### Server

| Task | Size | Files |
|---|---|---|
| `services/blogDayFactsService.ts` | XL | Architecture §7.1 — one service, two projections (facts + timeline) |
| `routes/blogInsightRoutes.ts` — `GET …/days/:dayDate/facts` | M | Separate request from the blog document, per §5.2 |
| EXIF lat/lng extraction | M | `blogMediaProcessingService.ts`, gated read by `photo_location_enabled` |
| `services/blogDayStarterService.ts` | L | Deterministic template, reusing `blog/narrative.ts` |
| Starter endpoints (get / accept / dismiss) | M | `blogAuthoringRoutes.ts` |
| `source_type = 'day_starter'` on accepted items | S | So acceptance rate is measurable — the stage gate depends on it |
| `services/blogMediaGroupingService.ts` + `POST /blog/media/group` | M | Stateless bucketing; no writes, no storage reservation |
| Facts in-process cache | S | `factsCacheTtlMs` |

### App

| Task | Size | Files |
|---|---|---|
| `DayFactStrip.tsx` | M | Elastic — absent chips, never zeros (FR-C1.1) |
| Day map | M | Reuse `TripDayMap.tsx` + `staticMapRoutes.ts`; collapsed on mobile |
| `DayTimelineRail.tsx` | L | Side-by-side with the map ≥900px, stacked below |
| `DayStarterCard.tsx` | M | Use / Rewrite / Not now |
| `PhotoFirstComposer.tsx` | XL | Day buckets, Unassigned bucket, out-of-range confirm, headroom line before commit |
| Storage headroom before commit | S | `GET /blog-storage` — already exists |
| Planned-vs-actual markers | S | Reuse `utils/itineraryStatus.ts` |

**The photo-first composer is the largest single client task in the program.** It reuses the existing
`upload-init` → `complete` flow and the existing quota modal (FR-A2.4) — the new work is bucketing
UI, the Unassigned flow, and moving the quota conversation before commit instead of mid-upload.

### Tests

- Day Starter determinism against fixed fixtures (byte-identical output).
- Starter suppressed after dismissal, and for days that already have text.
- Bucketing: no-`captured_at` items land in Unassigned and are never auto-assigned (FR-A2.2).
- Facts omit undeliverable rows entirely rather than emitting zeros.
- Public projection contains no geotags (FR-C2.2, PR-3).

**Exit criteria:** Day Starter acceptance rate > 30% on internal trips; fact strip renders ≥3 facts
on 80% of days with itinerary data.

---

## Phase 6 — Recap, spend, polish (C4, C7, A6, A7, A8, B6, B7)

| Task | Size | Files |
|---|---|---|
| `services/blogRecapService.ts` + `GET /blog/recap` | L | Cache keyed on `(tripId, contentRevision, engagementRevision)`; `202` + retry on slow generation |
| `TripRecapCards.tsx` | L | Screenshot-first layout per UI §6.8 |
| Spend summary | M | Reuse `utils/costs.ts` + `exchangeRates.ts`; `travelers` audience default (FR-C4.1) |
| Writing prompts | S | Static rotating set; seeds the editor with a heading |
| Drag-to-reorder UI | M | Wire the existing `POST /blog/items/reorder` |
| AI caption / alt text | L | On demand only; `reserveApiUsageOrThrow` with `BLOG_CAPTION_SUGGEST`; every string labelled as suggested |
| Photo of the day proposal | S | Proposes from reaction counts; a traveler confirms (FR-B7.1) |
| Contribution nudges | M | Scheduled job + `smtpCallers.ts`; 72h cap, 30-day-post-trip suppression, opt-out |

**Blocked on PRD open question 2** (is AI captioning Premium-only?) before the caption flag goes past
internal trips.

**Blocked on architecture question 5** (where nudges dispatch from) before B6 starts — if an in-app
notification inbox is coming, an email-only nudge path is work that gets unwound.

**Exit criteria:** GA. All PRD §2 measures reporting.

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
- [ ] Rate limit applied from `api-limits.yaml`, not hardcoded
- [ ] `logInfo` / `logError` from `logger.ts` — never `console.log`
- [ ] Env access via `getEnvValue` / `getEnvFlag` only
- [ ] Implemented in `db.postgres.ts`, `db.firebase.ts`, and verified under pg-mem
- [ ] Non-existent-but-invisible targets return `404`, not `403`

### Every new client component

- [ ] `app/theme/theme.ts` tokens — no ad-hoc pixel values or hex colors
- [ ] `MIN_TOUCH_TARGET` / `hitSlop` on every interactive control
- [ ] `Platform.OS !== 'web'` guards where native modules are involved
- [ ] `testID` in `{entity}-{action}[-{id}]` format
- [ ] Renders correctly for: traveler, traveler-in-edit-mode, follower, public preview
- [ ] Degrades cleanly with the feature flag off (absent, not disabled)

### Definition of done, per phase

1. All three DB adapters pass the same tests.
2. `npm run test:server` and `npm run test:app` green.
3. The authorization matrix test covers every new action.
4. Feature flags default off and toggle cleanly both directions without a deploy.
5. Public projection snapshot updated and reviewed — **manually reviewed, not just regenerated.**
6. `GET /:tripId/blog` p95 within 15% of the Phase 0 baseline.
7. Docs reconciled: if implementation diverged from the architecture document, the architecture
   document is updated in the same PR.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Read-path regression from engagement counts | Medium | High | Denormalized counters, one batched read, benchmark in the DoD |
| Privacy leak via audience mismatch | Low | Severe | Single `resolveEngagementTarget`; matrix test written before routes (Phase 2) |
| Moderation demand exceeds capacity | Medium | High | PR-1 keeps the public read-only; strikes auto-block; staged rollout with an abuse-rate gate |
| pg-mem rejects the schema | Medium | Medium | Phase 0 spike; fallbacks identified in architecture §3.4 |
| Realtime silently breaks when scaled horizontally | Medium | Medium | Documented as accepted risk (architecture Q2); REST degrades gracefully |
| Fail-open flags open commenting on a schema gap | Low | High | Comment routes additionally require non-fail-open checks (`follower_comments_enabled`, strikes) |
| AI caption cost scales with photo count | High | Medium | Per-day/user caps; on demand only; Premium gate decision before stage 5 |
| Phase 2 gets merged into Phase 3 under schedule pressure | **High** | **Severe** | Named here explicitly so it is a visible decision rather than a quiet one |
