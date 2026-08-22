# Trip Blog — Creation, Collaboration & Recap PRD

**Author:** Product (social/consumer)
**Status:** Proposal for engineering review
**Companion documents:** `docs/trip-blog-social-architecture.md` (design of record for this work),
`docs/trip-blog-social-implementation-plan.md` (execution)
**Predecessors:** `docs/travel-blog-architecture.md`, `docs/travel-blog-implementation-plan.md` —
those describe the blog platform that already exists. This document only covers what is *added*.

---

## 1. Where the product stands today

The trip blog is built and shipping behind flags. What exists (verified in code, not assumed):

| Capability | Where | State |
|---|---|---|
| Day-organized blog, text + media items | `server/src/blog/`, `app/tabs/tripBlog.tsx` | Shipped |
| Rich-text editor | `app/components/BlogRichTextEditor.tsx` | Shipped |
| Photo/video upload, transcode, renditions, signed URLs | `blogMediaProcessingService.ts`, `blogStorageClient.ts` | Shipped |
| Per-uploader storage ledger, quota, paid add-ons | `blog_storage_accounts`, `blogStorageRoutes.ts` | Shipped |
| Unanimous-consent publication, unilateral revoke | `blogPublicationRoutes.ts` | Shipped |
| Public page + sitemap + structured data | `publicBlogRoutes.ts`, `blogSitemapRoutes.ts` | Shipped |
| Day cover photo | `20260808_add_blog_day_cover.sql` | Shipped |
| Itinerary → blog seeding | `syncItineraryToBlog`, `blog/narrative.ts` | Shipped |
| Instagram/Facebook cross-post | `blogSocialRoutes.ts` | Scaffold |
| Gallery + lightbox | `DayMediaGallery.tsx`, `DayMediaLightbox.tsx` | Shipped |

### The three gaps

**1. Authoring is a chore.** Writing a day means: enter edit mode → pick a day → press "+ Add note"
→ type into an empty box → press Save. Every day starts from a blank page. `blog_days.headline` and
`blog_days.summary` exist in the schema and are returned by the API but **have no editing UI at
all**; the same is true of `trip_blogs.title` / `subtitle` / `introduction`. `POST /blog/items/reorder`
exists with no UI to call it. `media.audio` is a registered item kind with no capture path.

**2. There is no social layer.** Zero likes, zero reactions, zero comments, zero mentions anywhere
in the blog. A trip blog is written *at* people, not *with* them. The app already has the primitives
— `ReactionBar.tsx` with optimistic updates, `itineraryReactionService.ts`, `itemVoteService.ts`,
a live Socket.IO trip room with presence (`server/src/socket/`) — none of it is wired to the blog.
`blog_item_highlights` (a single star per item) is the closest thing and is effectively invisible.
Note that `blogSocialRoutes.ts`, despite the name, is Instagram/Facebook *cross-posting* — outbound
distribution, not in-app interaction.

**3. The blog does not know what actually happened.** The app holds flights, lodging check-ins, car
rentals, activities with statuses, expenses with currencies, geocoded places, and photo `captured_at`
timestamps. The blog day renders a weather chip, a list of *planned* activities, and the photos.
Nothing about distance covered, money spent, where the group actually went, or planned-vs-actual.

### Why this matters commercially

Blog storage is a paid add-on (`blog-storage-tiers.json`). Storage revenue is a function of media
volume; media volume is a function of how often people open the blog and add to it. Reactions and
comments are the highest-leverage retention mechanic available here because they create a reason to
*return* to a trip that already ended — the exact window in which the existing product goes quiet.
Followers are currently a read-only audience with no way to signal anything; they are the cheapest
source of the engagement that pulls travelers back in.

---

## 2. Objectives and success measures

| Objective | Measure | Target (90 days post-GA) |
|---|---|---|
| Lower authoring cost | Median seconds from opening the blog to a saved entry | < 45s (baseline unmeasured; instrument in stage 1) |
| Lower authoring cost | % of trip days with ≥1 text item, on trips that have ≥1 photo | 60% |
| Collaboration | % of trips with ≥2 distinct contributing authors | 45% |
| Collaboration | Reactions per published day | ≥ 3 |
| Re-engagement | % of travelers who open a trip blog ≥7 days after trip end | 40% |
| Informativeness | % of days where the fact strip renders ≥3 facts | 80% |
| Monetization (leading) | Median blog bytes per completed trip | +50% |

Guardrail metrics — these must **not** regress: publication-consent grant rate, blog page p95 load
time, media upload success rate, abuse reports per 1,000 published days.

Targets above are hypotheses, not commitments; several have no baseline yet because the relevant
events are not instrumented. Stage 1 of the rollout exists partly to establish those baselines.

---

## 3. Personas

- **The Chronicler** — one traveler per group who writes everything. Today they do 90% of the work
  and burn out by day 4. Needs: speed, drafts that write themselves, a way to pull others in.
- **The Shutterbug** — dumps 300 photos, writes nothing. Needs: photo-first authoring where captions
  are optional and their contribution is still visible and credited.
- **The Lurker (traveler)** — reads, never contributes. Needs: a one-tap way to participate.
  Reactions convert this persona; a text box never will.
- **The Follower** — parent, friend, colleague following along. Currently read-only with no voice.
  Needs: reacting and commenting. This is the audience that makes writing feel worth it.
- **The Returner** — opens the blog 6 months later. Needs: recap, stats, map, searchable index.

---

## 4. Feature set

Priority: **P0** = required for the release to make sense. **P1** = high value, ships in the same
program. **P2** = follow-on.

### Theme A — Easier to create entries

| # | Feature | Pri | Summary |
|---|---|---|---|
| A1 | **Day Starter drafts** | P0 | Each empty day offers a pre-written draft assembled from that day's itinerary details, activities, lodging, transfers and weather. One tap accepts it as an editable `core.text` item. Extends the existing `syncItineraryToBlog` + `buildNarrativeBlogBody` path from a silent background sync into a visible, dismissible suggestion. |
| A2 | **Photo-first composer** | P0 | Pick photos once for the whole trip; the composer buckets them into days by `captured_at`, shows the proposed grouping, and commits in one action. Removes today's "choose a day, then upload into it" loop. |
| A3 | **Day headline & summary editing** | P0 | Surface the `blog_days.headline` / `summary` columns that already exist and are already returned by `GET /:tripId/blog` but have no UI. A day gets a title instead of a bare ISO date. |
| A4 | **Blog masthead editing** | P1 | Same for `trip_blogs.title` / `subtitle` / `introduction`. |
| A5 | **Inline autosave with draft state** | P0 | Replace the explicit Save button with debounced autosave, a visible "Saving…/Saved" state, and a non-destructive conflict banner instead of today's `409` alert that tells the user to reload and lose their text. |
| A6 | **Writing prompts** | P1 | Empty days show three rotating prompt chips ("What surprised you?", "Best thing you ate", "Would you go back?"). Tapping one opens the editor pre-seeded with the prompt as a heading. |
| A7 | **Drag-to-reorder** | P1 | UI for the existing `POST /blog/items/reorder`. |
| A8 | **AI captions & alt text** | P1 | Per-photo suggested caption and `alt_text` (column exists, always null today). Accept / edit / dismiss. Alt text also closes a real accessibility gap on public pages. |
| A9 | **Voice notes** | P2 | Record → upload as `media.audio` (kind already registered) → transcribe → offer the transcript as a text draft. The fastest capture path while actually travelling. |
| A10 | **Quick capture entry point** | P1 | Promote the existing `POST /blog/share-intent` to a first-class app-level "Add to blog" action and OS share-sheet target, so capture doesn't require navigating to the tab. |
| A11 | **Offline queue** | P2 | Entries and photos composed without signal queue locally and flush on reconnect. Travel is the offline-heavy use case by definition. |

### Theme B — More fun to collaborate

| # | Feature | Pri | Summary |
|---|---|---|---|
| B1 | **Reactions on photos and items** | P0 | A small emoji set (❤️ 😂 😮 🔥 👏 🙏) on every media asset, text item and day. One reaction per user per target, changeable. Optimistic UI modelled on `ReactionBar.tsx`. |
| B2 | **Threaded comments** | P0 | Two-level threads (comment + replies) on days, items and individual photos. Plain text, 2,000 chars, 15-minute edit window, soft delete. |
| B3 | **@mentions** | P1 | Mention travelers and followers of the trip in comments. Autocomplete scoped to trip membership — never to the global user table. |
| B4 | **Realtime delivery** | P1 | New reactions and comments appear live for anyone with the blog open, over the existing Socket.IO trip room. No new transport, no new port. |
| B5 | **Contributor strip** | P0 | Each day shows avatars of everyone who contributed text or media to it, plus a "3 travelers · 47 photos · 12 reactions" line. Credit is the cheapest motivator available. |
| B6 | **Contribution nudges** | P1 | "Nobody has written Day 4 yet" for travelers; a digest for followers when a trip publishes new days. Strictly capped (FR-B6.1). |
| B7 | **Photo of the day** | P1 | Reaction counts propose a day cover; a traveler confirms. Today `cover_asset_id` is last-writer-wins with no signal behind it. |
| B8 | **Follower participation** | P0 | Followers may react and comment; they may never author, edit, delete, set covers or publish. This is the change that makes the blog feel social rather than broadcast. |
| B9 | **Blog presence** | P2 | "Alex is writing Day 3…" using the existing `presenceManager`. |
| B10 | **Trip Awards recap card** | P2 | End of trip: most-loved photo, most photos contributed, most-commented day. Computed from B1/B2 data, shareable. |
| B11 | **Report & moderate** | P0 | Report action on every comment; trip owner can hide any comment on their trip; reports route into the existing abuse pipeline. Ships *with* comments, never after. |

### Theme C — More informative about what happened

| # | Feature | Pri | Summary |
|---|---|---|---|
| C1 | **Day fact strip** | P0 | Compact chips under the day headline: weather (exists), distance travelled, places visited, spend, first/last photo time, photo/video counts. |
| C2 | **Day map** | P0 | Static map of the day's geotagged photos and itinerary points, reusing `TripDayMap.tsx` and `staticMapRoutes.ts`. Photo geotags are opt-in per trip and stripped from public renditions. |
| C3 | **Actual timeline rail** | P1 | Chronological merge of transfers, lodging check-in/out, car pickups, activities and photo clusters into a single vertical rail, interleaved with the written entries. |
| C4 | **Spend summary** | P1 | Per-day and per-trip spend from `expenses`, using the existing client-side `costs.ts` / `exchangeRates.ts`. Defaults to `travelers` audience — money is never public by default. |
| C5 | **Planned vs. actual** | P1 | Uses the existing `Needed → Proposed → Booked → Completed \| Cancelled` lifecycle to show what was planned, what happened, and what was skipped. |
| C6 | **Places index** | P2 | Trip-level list of every place visited, deep-linked via `mapLinks.ts`. |
| C7 | **Trip recap** | P1 | A generated summary card set: days, distance, places, photos, top contributors, top photo. The artifact people actually share. |
| C8 | **Blog search UI** | P2 | UI for the existing `GET /blog/search`. |
| C9 | **Keepsake export** | P2 | Print/PDF layout via the registered-but-unused `core.export` kind. |

---

## 5. Requirements

Notation: **FR** functional, **NFR** non-functional, **PR** privacy/policy. Each is written to be
testable.

### 5.1 Authoring

- **FR-A1.1** For any trip day with no `core.text` item, the API returns at most one Day Starter
  draft assembled from that day's itinerary details, activities, lodging, transfers and weather.
- **FR-A1.2** A Day Starter is a *suggestion*, never a stored blog item. It becomes a `core.text`
  item only on explicit user acceptance, and is then authored to the accepting user.
- **FR-A1.3** Dismissing a Day Starter suppresses it for that user and day permanently.
- **FR-A1.4** A Day Starter must render usefully with zero itinerary data — photo-only fallback:
  "9 photos from Tuesday", plus place names when geotags are available.
- **FR-A2.1** The photo-first composer groups a multi-select of media by `captured_at` into
  trip-local calendar days, showing the count per day before commit.
- **FR-A2.2** Media with no `captured_at` goes into an "Unassigned" bucket the user must place before
  commit. It is never silently assigned to a day.
- **FR-A2.3** A day bucket outside the trip's date range is flagged and requires explicit confirmation.
- **FR-A2.4** Commit reuses the existing `upload-init` → `complete` flow, including the existing
  storage-quota block and its upgrade sheet. No second quota path is introduced.
- **FR-A3.1** Any active traveler may set a day's `headline` (≤ 120 chars) and `summary` (≤ 500).
- **FR-A3.2** Where a headline is set it replaces the ISO date as the day's visual title; the date
  remains visible in secondary text.
- **FR-A5.1** Text edits autosave 1.5s after the last keystroke, and on blur, and on tab change.
- **FR-A5.2** Save state is always visible: `Saving…`, `Saved HH:MM`, or `Not saved — retrying`.
- **FR-A5.3** On a `409`, the user's text is never discarded. A banner offers "Keep mine" /
  "Use theirs" / "Show both", with the local draft preserved through all three.
- **FR-A8.1** Caption / alt-text suggestions are generated on demand, never automatically on upload,
  and never for more assets than are currently on screen.
- **FR-A8.2** Every AI-suggested string is labelled as suggested and is editable before it is saved.
- **FR-A8.3** AI suggestion calls go through `reserveApiUsageOrThrow` with a dedicated caller key.

### 5.2 Collaboration

- **FR-B1.1** Reaction targets are: a media asset, a blog item, or a blog day.
- **FR-B1.2** Exactly one reaction per (user, target). Re-tapping the same emoji clears it; tapping a
  different one replaces it.
- **FR-B1.3** Reaction UI is optimistic and reconciles against the server response, matching the
  behaviour of `ReactionBar.tsx`'s `computeOptimisticSummary`.
- **FR-B1.4** A reaction summary returns per-emoji counts, the total, and the caller's own reaction.
- **FR-B1.5** Reactor identities are visible to travelers and followers; the public page shows counts
  only, never names.
- **FR-B2.1** Comments are plain text, ≤ 2,000 characters. No HTML, no markdown rendering, no
  embedded media in v1.
- **FR-B2.2** Threads are two levels: a top-level comment and its replies. Replies do not nest further.
- **FR-B2.3** An author may edit their own comment for 15 minutes; edited comments are marked.
- **FR-B2.4** Delete is a soft delete. A deleted comment that has replies renders as a tombstone so
  the thread stays coherent; a deleted comment with no replies disappears entirely.
- **FR-B2.5** Comments paginate at 20 per request — newest-first at the day level, oldest-first
  inside a thread.
- **FR-B3.1** Mention autocomplete resolves only against travelers and followers of the current trip.
- **FR-B3.2** A mention notifies the mentioned user once, on comment creation, never on edit.
- **FR-B4.1** New comments and reactions broadcast to the trip's existing Socket.IO room.
- **FR-B4.2** Realtime is an enhancement, never a correctness requirement: with sockets unavailable
  the blog remains fully functional over REST, and reconnect reconciles by refetch.
- **FR-B5.1** The contributor strip lists distinct authors of that day's non-deleted items and assets,
  ordered by contribution count.
- **FR-B6.1** Contribution nudges are capped at one per user per trip per 72 hours, are suppressed
  entirely once the trip ended more than 30 days ago, and are opt-out in account settings.
- **FR-B7.1** Photo-of-the-day *proposes* the highest-reacted asset; it never changes
  `cover_asset_id` without a traveler confirming.
- **FR-B8.1** Followers may create reactions and comments. Every authoring, edit, delete, cover and
  publication endpoint remains denied to them.
- **FR-B11.1** Every comment exposes a report action to every user who can see it, except its author.
- **FR-B11.2** A trip owner may hide any comment on their trip. Hiding is reversible and written to
  `audit_log`.
- **FR-B11.3** A user hidden three times on a trip cannot comment on that trip again.

### 5.3 Informativeness

- **FR-C1.1** The fact strip renders only facts that are actually derivable. It never shows a zero, a
  dash, or a placeholder for missing data.
- **FR-C1.2** Distance is derived from geocoded itinerary points for the day and is labelled as
  approximate.
- **FR-C2.1** The day map renders when the day has ≥1 geocoded point (itinerary or photo geotag).
- **FR-C2.2** Photo geotags are used only when the trip has explicitly enabled photo location
  (PR-3), and are always excluded from the public projection.
- **FR-C3.1** The timeline rail merges transfers, lodging, car rentals, activities and photo clusters
  into one time-ordered list in the trip's local timezone.
- **FR-C4.1** Spend rendering respects the existing `travelers` audience and never appears on the
  public page unless a traveler explicitly changes that item's audience.
- **FR-C7.1** The recap is generated on demand and cached. It is never computed during a page render.

### 5.4 Non-functional

- **NFR-1** `GET /:tripId/blog` p95 must not regress by more than 15% with reactions, comments and
  facts included. Counts are read from denormalized counters, never aggregated per request.
- **NFR-2** All new endpoints behave identically on the `postgres`, `firebase` and `memory` adapters.
- **NFR-3** All new limits live in `server/config/api-limits.yaml` under `tripBlog`, never hardcoded.
- **NFR-4** Every feature above ships behind its own flag in `server/config/feature-flags.yaml`,
  default off, fail-open per the existing entitlement convention.
- **NFR-5** Comment write rate limit 10/min/user/trip; reaction write rate limit 60/min/user.
- **NFR-6** Comment and reaction counts on the public page are served from cache with the existing
  `cdnCacheTtlSeconds`. A new comment must not invalidate the whole public page.
- **NFR-7** New tables carry `ON DELETE CASCADE` from `trips`, so trip deletion stays a single
  operation consistent with the deletion guarantee in `travel-blog-architecture.md`.
- **NFR-8** All comment and reaction text is rendered as text. No path exists from user input to HTML
  on the public page.

### 5.5 Privacy and policy

- **PR-1** **The public page is read-only for the public.** Unauthenticated visitors see reaction
  counts and comments but cannot create either. This is a deliberate v1 decision: opening comments to
  anonymous visitors imports a spam and moderation burden this product has no staffing model for, and
  would place unmoderated third-party text on a page every traveler was required to *unanimously*
  consent to publish. Re-opening this decision requires a moderation staffing answer first.
- **PR-2** Publication consent covers traveler-authored content. Comments are **not** retroactively
  swept into it: a comment carries its own audience, inherited from its target at creation time, and
  only `public`-audience comments ever appear publicly.
- **PR-3** Photo geotags are off by default per trip. Enabling is a traveler action, and enabling
  never extends location data to the public projection.
- **PR-4** Revoking publication immediately hides all comments and reactions from public view, in the
  same operation and with the same immediacy as the existing content revoke.
- **PR-5** A user data export (`userDataExport.ts`) must include that user's comments and reactions.
- **PR-6** Account deletion soft-deletes that user's comments to tombstones. It does not cascade-
  delete other users' threads.
- **PR-7** Mention autocomplete must not become a user-directory leak — trip-scoped only (FR-B3.1).

---

## 6. UI design

### 6.1 Principles

1. **The blog is a reading surface first.** Today the tab defaults to a reading view and hides
   authoring behind an "Edit blog" toggle. Keep that. Authoring affordances stay quiet until invoked.
   Social affordances are the exception — reacting must be one tap from the reading state.
2. **Every day answers three questions before any prose:** *when*, *where*, *what happened*. The
   headline, fact strip and map do that above the fold.
3. **Contribution is visible.** Faces and counts, not anonymous content.
4. **Nothing new is destructive.** Reactions toggle, comments soft-delete, drafts never vanish.

Tokens come from `app/theme/theme.ts` — `spacing`, `typography`, `colors`. New surfaces must respect
`MIN_TOUCH_TARGET` / `hitSlop`, which matters more here than elsewhere because reaction and comment
controls are small by nature.

### 6.2 Day card — reading state (web, ≥900px)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Tuesday, 14 May · Day 3                                        ☀ 24°C     │  ← headline (A3)
│  Lost in Trastevere                                                        │     + date, weather
│  ─────────────────────────────────────────────────────────────────────     │
│  [ 🚶 6.2 km ] [ 📍 4 places ] [ 💶 €142 ] [ 📷 23 · 🎬 2 ] [ 08:41–23:10 ] │  ← fact strip (C1)
│                                                                            │
│  ┌──────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │                                  │  │  ▸ 09:10  Train → Roma Termini │  │
│  │        [ day map, C2 ]           │  │  ▸ 11:00  Colosseum      ✔done │  │  ← timeline rail (C3)
│  │   pins: itinerary + photo geo    │  │  ▸ 13:30  ▓▓▓ 8 photos         │  │
│  │                                  │  │  ▸ 19:45  Da Enzo        ✔done │  │
│  └──────────────────────────────────┘  │  ▸ 21:00  Hotel Santa Maria    │  │
│                                        └────────────────────────────────┘  │
│                                                                            │
│  ●●●  Maya, Sam +1 contributed · 23 photos · 12 reactions                   │  ← contributor strip (B5)
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  We meant to see the Colosseum at nine and instead spent two hours    │  │
│  │  arguing about coffee. Worth it.                                     │  │
│  │                                             — Maya · 14 May, 22:40   │  │
│  │  ❤️ 4   😂 2   ＋                                       💬 3 comments │  │  ← reactions (B1)
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌────────┬────────┬────────┬────────┬────────┐                            │
│  │ ▓▓▓▓▓▓ │ ▓▓▓▓▓▓ │ ▓▓▓▓▓▓ │ ▓▓▓▓▓▓ │  +18   │  ← existing DayMediaGallery │
│  │ ❤️ 6   │ ❤️ 2   │        │ 😂 1   │        │     + per-photo count badge │
│  └────────┴────────┴────────┴────────┴────────┘                            │
│                                                                            │
│  💬  Add a comment…                                                        │  ← collapsed composer
└────────────────────────────────────────────────────────────────────────────┘
```

Notes on the layout:

- The fact strip is **elastic** — chips with no data are absent, not greyed out (FR-C1.1). A day with
  only photos shows only the photo chip and the time span, and the row still reads as intentional
  rather than broken.
- Map and timeline sit side by side above 900px and stack below it, map first.
- `❤️ 4  😂 2  ＋` is the entire reaction affordance. `＋` opens the emoji row. The user's own
  reaction renders with a filled chip background (`colors.surfaceMuted`) and the emoji at full opacity.
- Photo reaction badges appear only on assets that have reactions, so an unreacted gallery is
  visually identical to today's.

### 6.3 Day card — editing state

Entering edit mode (the existing toggle) adds authoring affordances **in place** rather than swapping
layouts, so the writer never loses their bearings:

```
│  Tuesday, 14 May · Day 3                                        ☀ 24°C      │
│  ✎ Lost in Trastevere                            [ headline · 21/120 ]      │  ← A3 inline field
│  ✎ A day we planned badly and enjoyed anyway.    [ summary  · 44/500 ]      │
│  ─────────────────────────────────────────────────────────────────────      │
│                                                                             │
│  ┌── ✨ Day Starter ────────────────────────────────────────── [ ✕ ] ───┐   │  ← A1
│  │  You took the 09:10 train to Roma Termini, visited the Colosseum and  │   │
│  │  the Roman Forum, and finished the evening at Da Enzo al 29. You took │   │
│  │  23 photos between 08:41 and 23:10.                                   │   │
│  │                                                                       │   │
│  │  [ Use this draft ]   [ Rewrite ]   [ Not now ]                        │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Or start from:  ( What surprised you? ) ( Best thing you ate )              │  ← A6 prompt chips
│                  ( Would you come back? )                                    │
│                                                                             │
│  ⠿ ┌────────────────────────────────────────────────────────────────────┐   │  ← ⠿ drag handle (A7)
│    │  [ B  I  U  •  1.  🔗 ]                                            │   │
│    │  We meant to see the Colosseum at nine and instead…                │   │
│    └────────────────────────────────────────────────────────────────────┘   │
│      Saved 22:41 · only you are editing                   [ Remove ]         │  ← A5 autosave state
│                                                                             │
│  [ + Note ]  [ + Photo/Video ]  [ 🎙 Voice note ]                            │
```

The Day Starter card is the single most important pixel change in this design. It converts the
blank-page moment — the point at which the Chronicler becomes the only person who ever contributes —
into an accept-or-edit decision.

### 6.4 Conflict banner (replaces the current `409` alert)

Today a conflicting save produces `Alert.alert('Someone else edited this block. Reload to resolve the
conflict.')`, and the user's typing is stranded behind a modal that offers no way to keep it. Instead:

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚠  Sam edited this while you were writing.                          │
│    [ Keep mine ]  [ Use Sam's ]  [ Show both ]        Your draft is  │
│                                                       saved locally. │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.5 Photo lightbox with the social layer

`DayMediaLightbox.tsx` gains a right rail on wide screens and a bottom sheet on narrow ones:

```
┌──────────────────────────────────────────┬──────────────────────────────┐
│                                          │  ❤️ 6  😂 1  😮 2      ＋    │
│                                          │  ──────────────────────────  │
│                                          │  ● Sam                       │
│              [  photo  ]                 │    The light here was unreal │
│                                          │    2h ago      ❤️ 1  Reply   │
│                                          │                              │
│                                          │    ● Maya                    │
│                                          │      you took 40 of these    │
│                                          │      1h ago         Reply    │
│                                          │  ──────────────────────────  │
│  ‹  4 / 23  ›                            │  ● Write a comment…          │
│  📷 Maya · 13:42 · Piazza Trilussa       │                              │
│  [ ⭐ Set as day cover ]                  │                              │
└──────────────────────────────────────────┴──────────────────────────────┘
```

The attribution line (`📷 Maya · 13:42 · place`) is new and does double duty: it credits the
Shutterbug and answers "what happened" at the same time.

### 6.6 Comment thread

```
  ● Dad                                                    ⋯ report
    Is that the same square from your last trip?
    3 May, 19:12                                    ❤️ 2   Reply
    │
    ├─ ● Maya                                              ⋯ edit · delete
    │   @Dad yes! same bar, same waiter                    ← B3 mention chip
    │   3 May, 19:20  (edited)                      ❤️ 1   Reply
    │
    └─ ● Sam
        he remembered us
        3 May, 19:31                                       Reply

  ▾ Show 4 earlier comments
```

Followers' avatars carry a ring in `colors.info` and their name a `Following` chip, so a traveler can
always tell at a glance whether they are talking to the group or to an audience.

### 6.7 Photo-first composer (A2)

```
┌── Add photos to your blog ──────────────────────────────────── [ ✕ ] ──┐
│                                                                        │
│  147 items selected · grouped by when they were taken                  │
│                                                                        │
│  ▸ Mon 13 May · Day 2      ▓▓ ▓▓ ▓▓ ▓▓ ▓▓   31 items     [ change ]    │
│  ▸ Tue 14 May · Day 3      ▓▓ ▓▓ ▓▓ ▓▓ ▓▓   62 items     [ change ]    │
│  ▸ Wed 15 May · Day 4      ▓▓ ▓▓ ▓▓          48 items     [ change ]    │
│                                                                        │
│  ⚠ 6 items have no date                                                │
│     ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓        Assign to  [ pick a day  ▾ ]              │
│                                                                        │
│  ──────────────────────────────────────────────────────────────────    │
│  Uses 412 MB of your 1.4 GB remaining          [ Cancel ] [ Add 147 ]  │
└────────────────────────────────────────────────────────────────────────┘
```

The storage line is deliberately shown *before* commit. Today the quota block surfaces mid-upload as
a modal, which is the worst possible moment to ask someone to buy storage. Showing headroom up front
converts better and annoys less.

### 6.8 Trip recap (C7)

A full-bleed card stack, one screen, built to be screenshotted:

```
┌──────────────────────────────────────────┐
│                                          │
│           ITALY · 12 DAYS                │
│                                          │
│     4 cities   ·   612 km   ·   €2,140   │
│     384 photos ·  3 travelers            │
│                                          │
│   ┌────────────────────────────────┐     │
│   │      [ most-loved photo ]      │     │
│   │      ❤️ 14 · by Sam            │     │
│   └────────────────────────────────┘     │
│                                          │
│   Most photos      Maya       218        │
│   Most comments    Dad         41        │
│   Busiest day      Day 7    9 stops      │
│                                          │
│   [ Share ]   [ Open the blog ]          │
└──────────────────────────────────────────┘
```

### 6.9 Mobile (< 700px)

Single column in this order: headline → fact strip (horizontally scrollable chips) → cover photo →
map (collapsed, tap to expand) → entries → gallery → comments (collapsed, showing count). Reaction
controls stay pinned to their content rather than a floating bar; the comment composer docks above
the keyboard. The photo-first composer becomes a full-screen sheet with day groups as sections.

### 6.10 Empty and degraded states

| Condition | Treatment |
|---|---|
| Day with nothing at all | Day Starter card if itinerary data exists; otherwise prompt chips. Never a bare "No notes yet." |
| No itinerary and no photos | "Nothing recorded for this day. [ Write something ] [ Add photos ]" |
| Comments flag off | The comment affordance is absent, not disabled. |
| Follower viewing | Authoring controls absent; reaction and comment controls present. |
| Socket disconnected | Static content; a small "Reconnecting…" chip on the comment composer only. |
| Media still processing | Existing processing placeholder; no reaction control until state is `ready`. |

---

## 7. Rollout

| Stage | Contents | Gate to the next stage |
|---|---|---|
| 1 | A3, A5, C1 | Internal trips. Authoring-time metric instrumented and baselined. |
| 2 | A1, A2, C2 | Day Starter acceptance rate > 30% on internal trips. |
| 3 | B1, B5, B8, B11 | Reactions + moderation together. 5% of trips. |
| 4 | B2, B3, B4 | Comments. Abuse reports per 1,000 days below threshold at stage 3. |
| 5 | C3, C4, C5, C7, A4, A6, A7, A8, B6, B7 | GA. |
| 6 | A9, A10, A11, B9, B10, C6, C8, C9 | Follow-on. |

Reactions ship before comments deliberately: they carry most of the engagement value at a fraction of
the moderation risk, and they generate the signal that B7 and B10 depend on.

---

## 8. Open questions

1. **Follower comment defaults.** On by default per trip, or opt-in by the trip owner?
   Recommendation: **on by default, owner can disable per trip.** An opt-in default would leave the
   feature unused on most trips, which is the failure mode that kills social features.
2. **AI caption cost.** A8/A9 volume is per-photo and trips produce hundreds. Needs a per-tier cap in
   `api-limits.yaml` before stage 5, and a decision on whether it is Premium-only.
3. **Comment retention after trip deletion.** NFR-7 cascades comments away with the trip. Confirm
   with legal that this satisfies the deletion guarantee already made in
   `travel-blog-architecture.md`, given comments may be authored by non-travelers.
4. **Distance methodology.** Straight-line between geocoded points is cheap and wrong for road trips;
   routed distance costs a Directions API call per day. Recommendation: straight-line, labelled
   "approx.", revisit if users complain.
5. **Public reaction counts.** PR-1 shows counts publicly. Confirm this does not itself need to fall
   under the publication-consent vote — counts reveal engagement volume but no identities.
