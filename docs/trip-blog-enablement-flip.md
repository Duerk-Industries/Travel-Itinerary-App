# Trip blog — flag-flip script + local test recipe

Companion to `docs/trip-blog-enablement-runbook.md`. That doc has the *why* and the
verification checklist; this one is the *mechanical* part: copy-paste commands that flip the
flags in the right order.

Everything here calls the same admin API that the **Feature Flags** panel in AdminTab uses
(`GET /api/admin/features`, `PATCH /api/admin/features/:key/flag`). Nothing privileged beyond
being logged in as an admin. Every flip writes an `audit_log` row.

---

## Part 1 — set `BASE` and `TOKEN`

```bash
# Production API. Confirm it answers:
BASE="https://wander-bunnies.com"
curl -s "$BASE/api/healthz"        # -> {"ok":true,...}

# For a LOCAL run instead, see Part 4 and use:  BASE="http://localhost:4000"

# Admin JWT — log in as a bootstrap admin (bryan.duerk@gmail.com / tristan.duerk@gmail.com):
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"identifier":"bryan.duerk@gmail.com","password":"<your-password>"}' | jq -r .token)

# Sanity-check the token works and you're admin:
curl -s "$BASE/api/admin/features" -H "Authorization: Bearer $TOKEN" | jq '.features | length'
#   a number  -> good.   {"error":...} / 401 / 403 -> not admin or bad token.
```

Alternatively grab the token from a logged-in browser: DevTools → Application → Local Storage →
`stp.session` (it's JSON with a `token` field).

---

## Part 2 — helpers

```bash
# Show current state of every blog / notification flag:
audit () {
  curl -s "$BASE/api/admin/features" -H "Authorization: Bearer $TOKEN" \
  | jq -r '.features[]
      | select(.key|test("^(trip_blog|notifications|trip_day_map)"))
      | "\(if .enabled then "ON " else "off" end)  \(.key)"' \
  | sort
}

# Flip one flag. Usage: flip <key> <true|false> "<short reason>"
flip () {
  curl -s -X PATCH "$BASE/api/admin/features/$1/flag" \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"enabled\": $2, \"reason\": \"blog enablement: $3\"}" \
  | jq -c '{key, enabled, previousEnabled}'
}

audit    # <- run this FIRST and keep the output; it's your rollback reference
```

---

## Part 3 — the ordered flips

Run **one group at a time**. After each group, do the matching verification from the runbook
(publish a blog, open it, react, add photos, …). The 60-second flag cache means a flip takes up
to a minute to show up in the app.

### Group 0 — prerequisites (verify, flip only if `audit` shows them off)

```bash
flip trip_blog              true  "g0 prereq"
flip trip_blog_photo_uploads true "g0 prereq"
flip trip_blog_video_uploads true "g0 prereq"
flip trip_blog_public_sharing true "g0 prereq"
```

### Group 1 — authoring assist (Day Starter, photo composer, facts, spend, recap)

```bash
flip trip_blog_authoring_assist true "g1 parent"
flip trip_blog_day_starter      true "g1 A1"
flip trip_blog_photo_composer   true "g1 A2"
flip trip_blog_day_facts        true "g1 C1"
flip trip_blog_spend_summary    true "g1 C4"
flip trip_blog_recap            true "g1 C7"
flip trip_blog_alt_text         true "g1 A8"
```

Verify: empty day shows the ✨ Day Starter card; "＋ Add photos to this trip" appears in edit
mode and sorts a multi-select by capture day; masthead shows Trip spend; recap opens after the
last day.

### Group 2 — social layer (master switch FIRST)

```bash
flip trip_blog_social_layer true "g2 master"
flip trip_blog_reactions    true "g2 B1"
flip trip_blog_comments     true "g2 B2"
flip trip_blog_mentions     true "g2 B3"
```

Verify: as a traveler, react + comment + @mention on a day/photo and reload — persists. As a
follower of the trip: can react/comment, cannot author or publish.

### Group 3 — notifications (needed for mention emails + nudges)

```bash
flip notifications_outbox_enabled true "g3 delivery worker"
flip notifications_in_app         true "g3 inbox"
flip notifications_web_push       true "g3 web push"
# notifications_push  -> LEAVE OFF until APNs/FCM creds + EXPO_ACCESS_TOKEN are provisioned
flip trip_blog_nudges             true "g3 B6"
```

Verify: a mention produces an in-app notification for the mentioned user; watch
`notification_outbox` for stuck rows.

### Group 4 — public reader engagement

```bash
flip trip_blog_public_engagement true "g4 public counts+comments"
# optional SEO:
flip trip_blog_public_indexing   true "g4 sitemap"
flip trip_blog_structured_data   true "g4 schema.org"
```

Verify: publish a blog (unanimous traveler consent), open the public URL logged-out — per-day
reaction counts and comment threads show, no author identities, no spend figure. Flip
`trip_blog_public_engagement` back off → the page renders exactly as before.

### Group 5 — LEAVE OFF until infra is confirmed

```bash
# trip_blog_day_map_render  -> Google Static Maps $15/mo budget + reserved-prefix reconciliation
# trip_day_map              -> needs GOOGLE_STATIC_MAPS_API_KEY / GOOGLE_MAPS_API_KEY
# trip_blog_caption_ai      -> Premium/Pro paid provider; needs BLOG_CAPTION_SUGGEST quotas in
#                              config/cost-model.yaml
# trip_blog_ai_highlights   -> the Day Starter "Rewrite" button has no endpoint yet (deferred)
```

### Group 6 — older phase 7/8 features (optional, out of this enablement's scope)

`audit` may show these off; they are pre-existing, separately tested, and safe to enable if you
want the feature:

```bash
# flip trip_blog_search        true "g6"
# flip trip_blog_places        true "g6"
# flip trip_blog_offline_queue true "g6"
# flip trip_blog_trip_awards   true "g6"
# flip trip_blog_keepsake_export true "g6"
# flip trip_blog_audio         true "g6"
# flip trip_blog_audio_transcription true "g6"   # Premium/Pro provider
# flip trip_blog_mobile_share_ios / _android  true "g6"   # needs the share-extension build
```

---

## Rollback

```bash
flip <key> false "rollback — <reason>"          # any single flag, effective within 60s
flip trip_blog_social_layer false "rollback"     # kills reactions+comments+mentions+public engagement at once
flip notifications_outbox_enabled false "rollback"  # stops all push/email delivery, keeps in-app writes
```

No schema rollback is ever needed — every migration is additive and the columns/tables sit inert
while the flags are off.

---

## Part 4 — test locally first

The repo's local dev setup uses the **Firestore emulator** (`server/src/.local_env` sets
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`). That is a separate database on your machine —
**flipping flags against localhost does not touch production.** It won't catch infra issues
(real GCS signed URLs, bucket CORS) but it catches every wiring/gating bug.

```bash
# terminal 1 — the emulator (needs firebase-tools + a JDK)
firebase emulators:start --only firestore

# terminal 2 — the API (predev seeds dev accounts into the emulator)
cd server && npm run dev            # -> http://localhost:4000

# terminal 3 — the web app
cd app && npm run web              # -> http://localhost:8081 (or as printed)
```

`npm run dev`'s `predev` step seeds `test_inputs/default_accounts.json` into the emulator, but
only when `ALLOW_TEST_ACCOUNT_SEED=1` is set in `server/.local_env`. Those accounts are
`bryan.duerk@gmail.com` / `tristan.duerk@gmail.com` / … , all with password `testtest`, and the
bryan/tristan ones are auto-granted admin.

Then, in a fourth terminal, run Parts 1–3 with:

```bash
BASE="http://localhost:4000"
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"identifier":"bryan.duerk@gmail.com","password":"testtest"}' | jq -r .token)
```

Click-through checklist (edit mode on a trip with itinerary data + a few days):

- [ ] Empty day → ✨ Day Starter card; "Use this draft" adds an editable note; "Not now" hides it and it stays hidden on reload
- [ ] Fact strip shows ≥3 chips on days that have activities/lodging
- [ ] "＋ Add photos to this trip" → pick several photos → they group by capture day; a photo with no EXIF date sits in "still need a day" and blocks commit until placed
- [ ] Per-day "+ Photo/Video" opens the same composer defaulted to that day
- [ ] Masthead shows Trip spend; it is absent from the public page
- [ ] React + comment + @mention as a traveler; reload — persists
- [ ] Publish (consent), open the public URL in a private window — prose/photos render, per-day reaction + comment counts show, no identities, no spend
- [ ] Flip `trip_blog_public_engagement` off → public page still renders, engagement UI gone

If a step fails locally, fix it before flipping that group in production.

> Fallback without the emulator/JDK: `cd server && USE_IN_MEMORY_DB=1 npm run dev` is *intended*
> to use pg-mem, but `server/.env` currently pins `DB_PROVIDER=firebase` and the local env loader
> overrides shell vars — you'd have to temporarily edit that line. The emulator path above is the
> supported one.
