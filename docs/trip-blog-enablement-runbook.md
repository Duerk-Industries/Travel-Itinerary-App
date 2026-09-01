# Trip Blog — feature enablement runbook

**Status:** draft, 2026-08-31
**Audience:** whoever holds admin access to a running WanderBunnies environment (staging first, then prod).

Most of the trip-blog social + "what actually happened" work is **built, tested, and shipped dark** —
the code is in `main` (or in review: PR #80, #81) but the feature flags that gate it are off in the
target environment's `feature_flags` table. This runbook is the ordered procedure to turn them on,
verify each, and roll back cleanly.

It does **not** cover code changes. Every step here is a flag flip through the admin API (or the
Admin panel's Feature Flags section) plus a manual verification.

---

## How flags resolve (why the seed file is not enough)

- `server/config/feature-flags.yaml` seeds a row **only if one does not already exist**. Once a row
  exists, the DB value wins and the YAML is inert (`entitlementService.ts` comment; CLAUDE.md).
- A **missing** row resolves per `FAIL_CLOSED_FLAGS` in `entitlementService.ts`:
  - **fail-open** (missing row ⇒ *enabled*): `trip_blog_authoring_assist`, `trip_blog_day_starter`,
    `trip_blog_photo_composer`, `trip_blog_day_facts`, `trip_blog_spend_summary`, `trip_blog_recap`,
    `trip_blog_alt_text`.
  - **fail-closed** (missing row ⇒ *disabled*): `trip_blog_social_layer`, `trip_blog_reactions`,
    `trip_blog_comments`, `trip_blog_mentions`, `trip_blog_public_engagement`,
    `trip_blog_day_map_render`, `trip_blog_caption_ai`, `trip_blog_nudges`, all four
    `notifications_*`, and the older `trip_blog_{search,places,offline_queue,trip_awards,keepsake_export,audio*}`.
- Runtime cache TTL is **60 s** — a flip takes up to a minute to take effect.

**Therefore the first action is an audit**, not a flip — you cannot assume the current state from
the YAML.

### Audit current state

```bash
BASE=https://<env-host>            # staging first
TOKEN=<admin JWT>                  # from a Sign-in as a bootstrap admin
curl -s $BASE/api/admin/features -H "Authorization: Bearer $TOKEN" \
  | jq -r '.features[] | select(.key|startswith("trip_blog") or startswith("notifications")) | "\(.enabled)\t\(.key)"' \
  | sort
```

### Flip one flag

```bash
curl -s -XPATCH $BASE/api/admin/features/<key>/flag \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"enabled": true, "reason": "blog enablement pass — <phase>"}'
```

Every flip writes `audit_log` (`FEATURE_FLAG_UPDATED`, before/after). Rollback is the same call with
`"enabled": false`.

---

## Ordered rollout

Do these **one group at a time on staging**, run the verification, let it sit, then repeat on prod.
Dependencies matter — a child flag does nothing while its parent is off.

### Group 0 — prerequisites (verify, don't assume)

| Flag | Want | Note |
|---|---|---|
| `trip_blog` | on | Master. Almost certainly already on. |
| `trip_blog_photo_uploads`, `trip_blog_video_uploads` | on | Media pipeline. |
| `trip_blog_public_sharing` | on | Consent flow + vanity URLs. Required before Group 4. |

### Group 1 — authoring assist (fail-open; likely already effective)

| Flag | Depends on |
|---|---|
| `trip_blog_authoring_assist` | — (parent surface) |
| `trip_blog_day_starter` | `trip_blog_authoring_assist` |
| `trip_blog_day_facts` | — (day map sub-feature also needs `trip_day_map`, keep off) |
| `trip_blog_spend_summary` | — (traveler-only, client-side, never in public payloads) |
| `trip_blog_recap` | — |

**Verify:**
1. Open a trip with itinerary data, enter blog edit mode. An empty day shows the **✨ Day Starter**
   card (PR #81). "Use this draft" creates an editable note; "Not now" hides it and it stays hidden
   on reload.
2. A day with activities/lodging shows a **fact strip** (≥3 chips on 80 % of days with itinerary
   data — the Phase 5 exit criterion).
3. Masthead shows **Trip spend** in trip currency. Confirm it is absent from the public page
   (Group 4) and from any follower view.
4. After the last day, the **recap / "Relive this trip"** entry point renders; opening it returns a
   recap (may `202` then settle).

### Group 2 — social layer, authenticated only

| Flag | Depends on |
|---|---|
| `trip_blog_social_layer` | — (master kill switch; **flip first**) |
| `trip_blog_reactions` | `trip_blog_social_layer` |
| `trip_blog_comments` | `trip_blog_social_layer` |
| `trip_blog_mentions` | `trip_blog_social_layer` + `trip_blog_comments` |

**Verify:** as a traveler, react to a day/photo and reload — persists. Comment, reply, `@`-mention a
co-traveler. As a *follower* of the trip: can react + comment, cannot author/set cover/publish
(the `canAuthor` vs `canEngage` split). Check counter reconciliation telemetry shows no drift.

### Group 3 — notifications (needed for mentions email + nudges)

| Flag | Want | Note |
|---|---|---|
| `notifications_outbox_enabled` | on | Master switch for the delivery worker. |
| `notifications_in_app` | on | `GET/PATCH /api/notifications/*` inbox. |
| `notifications_web_push` | on | Web push. |
| `notifications_push` | **off for now** | Needs APNs/FCM creds in EAS + `EXPO_ACCESS_TOKEN`. Confirm provisioned before flipping. |
| `trip_blog_nudges` | on (after the above) | Fail-closed; contribution nudges. Scheduled scan claims a DB window. |

**Verify:** a mention (Group 2) produces an in-app notification for the mentioned user; if
`notifications_web_push` is on and the browser subscribed, a web push arrives. Watch
`notification_outbox` for stuck rows.

### Group 4 — public reader surface

| Flag | Depends on |
|---|---|
| `trip_blog_public_engagement` | `trip_blog_social_layer` + `trip_blog_public_sharing` |
| `trip_blog_public_indexing` / `trip_blog_structured_data` | optional; SEO |

**Verify (PR #80):** publish a trip blog (unanimous traveler consent), open the public URL in a
logged-out browser:
- Prose, photos, cover render; **no** spend figure, **no** author identities on comments.
- Per-day reaction counts + comment count appear. Tapping the count expands the thread (role labels
  only). "Show more" paginates.
- Turning `trip_blog_public_engagement` back off leaves the published page rendering exactly as
  before (no engagement UI) — confirm.

### Group 5 — deferred / needs infra decision

| Flag | Blocker |
|---|---|
| `trip_blog_day_map_render` | `GOOGLE_STATIC_MAPS` $15/mo budget + reserved-prefix reconciliation exclusion + artifact reaping. Do not flip until §14.1/§14.4 items confirmed. |
| `trip_blog_caption_ai` | Premium/Pro paid provider; per-user quota + `BLOG_CAPTION_SUGGEST` provider budget must exist in `config/api-limits.yaml` / `cost-model.yaml`. |
| `trip_blog_ai_highlights` (Day Starter "Rewrite") | No rewrite endpoint exists yet — see PR #81. |
| `trip_blog_photo_composer` | Parent flag is fine to leave on, but `PhotoFirstComposer.tsx` (the client) is not built — no user-visible effect until it lands. |

---

## Rollback

- Any single feature: `PATCH .../features/<key>/flag {"enabled": false, "reason": "..."}`. Effective
  within 60 s.
- Whole social layer at once: flip `trip_blog_social_layer` off — reactions/comments/mentions/public
  engagement all gate on it.
- Notifications: flip `notifications_outbox_enabled` off to stop all push/email delivery while
  keeping in-app writes.
- No schema rollback is needed — every migration (`20260901_add_blog_authoring.sql` etc.) is additive
  and the columns/tables are inert while flags are off.

---

## Verification status (as of 2026-08-31)

- Server blog suites green under `DB_PROVIDER=memory`: `blog-day-starter` (9), `blog-day-facts`,
  `blog-recap`, `blog-public-engagement`, `blog-media-grouping`, `blog-reaction-routes`,
  `blog-comment-routes`, `blog-engagement-authorization`, `blog-phase6-governance` — 82 + 9 tests.
- App: `blogDayStarterCard`, `publicTripBlogEngagement`, `tripBlog*` suites green.
- **Not yet done:** a real click-through in a running environment. A local end-to-end boot needs the
  Firestore emulator or a Postgres + env plumbing (`server/.env` pins `DB_PROVIDER=firebase`); the
  quick `DB_PROVIDER=memory tsx src/index.ts` path is not honored by the running server the way it is
  by the test harness. Staging is the right place for the click-through.
