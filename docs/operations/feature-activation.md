# Feature activation guide

[README](../../README.md) · [Manual administration](manual-administration.md) · [Rollout testing](rollout-testing.md) · [Flag inventory](../feature-flag-inventory.md) · [Gap-closing status](../implementation_plans/implementation-plan-gap-closing.md#status-at-a-glance-2026-11-06)

Use this guide to turn on a feature that is built but switched off. It lists what each feature needs before you enable it, which flags to turn on (in order), how to check it works, and how to turn it back off. Reviewed against source on 2026-11-08. Production runs on **Firestore**; every step below assumes that.

Nothing here has been switched on in production by writing this guide. Check the live value of each flag in Admin → Feature Flags before you start.

## How to turn on any feature

1. **Read its row below** and do every "before you enable" item. Missing secrets or schedulers make the feature fail quietly or hide its controls.
2. **Deploy Firestore indexes** if anything changed in `firestore.indexes.json`: `.\scripts\deploy-firestore-indexes.ps1` (or `.sh`). Wait until Firebase shows them as built.
3. **Test in the isolated test environment first** ([rollout testing](rollout-testing.md)).
4. **In production, start with a cohort** when the flag supports one (marked **cohort** below). Use the [cohort procedure](manual-administration.md#limit-a-feature-to-a-cohort): add yourself and one ordinary test account, with an owner and a retirement date.
5. **Turn the flags on in the order listed.** Give a reason each time; it goes to the audit log. Wait 60 seconds for the cache, then reload the app.
6. **Check it works** using the "Check" column, as the cohort user **and** as a user outside the cohort, who must not see it.
7. **Widen the cohort, then remove it** (cohort `null` means everyone once the flag is on). Watch errors, cost and support reports between steps.
8. **Record the result** in the [release evidence](rollout-testing.md#release-evidence). For gap-closing features, also record it in the evidence packet (`npm run evidence:gap`, see [the evidence runbook](gap-closing-evidence.md)).

**To roll back:** turn the flag off (or empty its cohort) with a reason, wait 60 seconds and reload. Rollback never deletes data. Lists, manual entry, upload and saved copies keep working.

Admins don't bypass flags, so an admin account sees exactly what the flag allows. Use an ordinary account to check tier limits.

## Recommended order

Low-risk, read-only features first; features that write to shared trips last:

1. Web day map → Nearby and Add to day → Day order → Trips like this
2. Notification inbox → email and push delivery → deadline and digest reminders → Activity recap
3. Offline trip bundle
4. Structured import → forwarded mailbox → receiver trust → automatic adding
5. Native map, once a new native build has passed device checks

## Planning, maps and discovery

| Feature | Before you enable | Flags, in order | Check | Details |
|---|---|---|---|---|
| **Web day map** | Hosting CSP allows `https://tiles.openfreemap.org` (already in `firebase.json`) | `planning_web_map` (**cohort**) | Open a day → **Show map**: pins match the list; selecting a row highlights its pin; with tiles blocked, the list still shows "Map unavailable" | [Maps](gap-closing-maps.md) |
| **Nearby and Add to day** | None | `planning_nearby` (**cohort**) | Open a day → **Nearby** → **Add to [day]** once; a double tap creates one activity; **Undo** removes it | [P1](gap-closing-p1.md) |
| **Day order** | None | `planning_day_order` (**cohort**), then optionally `planning_optimize_order` | Move up/down and drag persist after reload; editing the same day in two sessions shows a conflict instead of overwriting; Optimize shows a preview and Undo | [Day order](gap-closing-day-order-inspiration.md) |
| **Trips like this** | Some public blogs with activity sharing turned on | `planning_trip_inspiration` (**cohort**) | Overview day details shows matching public trips; copied activities credit the source; private activities never appear | [Day order and inspiration](gap-closing-day-order-inspiration.md) |
| **Find locations** (geocode an item's own address) | `GEOAPIFY_API_KEY` in the server environment | `planning_locate_items` (seeded **on**) | Lodging/activity → Find location stores coordinates and attribution; without a key the button is hidden | [Maps](gap-closing-maps.md#find-locations-geoapify-2026-10-21) |
| **Native map (MapLibre)** | A new EAS build with `NATIVE_MAP_RENDERER=1`, passing [named-device checks](gap-closing-maps.md#native-renderer) | `planning_native_map` | On the new build the map draws on device; older builds keep the list or Google view | [Maps](gap-closing-maps.md#native-renderer) |
| **Native Google day map** (stopgap for old builds) | Server-only `GOOGLE_STATIC_MAPS_API_KEY` restricted to Maps Static | `trip_day_map` | Day map image loads; monthly cap and daily per-user caps hold | [Maps](gap-closing-maps.md) |
| **Optional geocoding** (public catalog places only) | Reviewed endpoint and policy settings ([maps record](gap-closing-maps.md#optional-public-poi-geocoding)), `server/migrations/20261020_add_geocoding_state.sql` on Postgres only, and a scheduler for `POST /api/internal/blog/geocoding` with `X-Ingestion-Worker-Secret`. Without the endpoint config nothing is looked up | `planning_geocoding` (seeded **on** since 2026-11-08; missing row = off. An existing database row keeps its value, so check it in Admin) | `GET /api/internal/blog/geocoding` shows pending/ready/dead counts; a catalog place without coordinates gains them; private addresses are never sent | [Maps](gap-closing-maps.md#optional-public-poi-geocoding) |
| **Legacy blog map images** | **Keep off** (stores Google images) | `trip_blog_day_map_render` must be **off** | Confirm the live value is off | Gap-closing §1 |

## Notifications

| Feature | Before you enable | Flags, in order | Check | Details |
|---|---|---|---|---|
| **Inbox** | Deploy Firestore indexes. Run `server/scripts/backfill-planning-notifications.ts` (dry run first, then `--apply`). Schedule `POST /api/internal/ingestion/notifications/run` once a minute with header `X-Ingestion-Worker-Secret` (`INGESTION_WORKER_SHARED_SECRET`), and alert on non-2xx | `notifications_outbox_enabled` (seeded on), then `notifications_in_app` (**cohort**) | The bell shows an unread count; opening an item deep-links to the right trip; reconnecting catches up on missed items | [P1](gap-closing-p1.md) |
| **Email delivery** | SMTP configured | `notifications_email` (seeded on, **cohort**) | Web users get the email fallback; quiet hours delay it | [P1](gap-closing-p1.md) |
| **Mobile push** | A native build with push registration (EAS `projectId` in `expo.config.shared.cjs`) | `notifications_push` (**cohort**) | Lock-screen text is generic; tapping opens the item; denied permission leaves the inbox working | Gap-closing §4 |
| **Deadline and digest reminders** | The scheduler above is running | `planning_notifications` | A lodging `refund_by` or activity free-cancellation date 48 hours ahead creates one reminder; the daily summary arrives at the chosen local time | [Completion audit](gap-closing-remaining.md) |
| **Activity recap** | Inbox enabled | `activity_recap` | A completed activity prompts one dismissible recap; nothing is published automatically | Gap-closing §4 |
| **Web push** | Not built | `notifications_web_push` must stay **off** | — | — |

## Offline

| Feature | Before you enable | Flags, in order | Check | Details |
|---|---|---|---|---|
| **Trip bundle** (saved trips) | None | `trip_bundle` (**cohort**) | **Save for offline** shows progress and size; a failed download keeps the previous copy; a revoked member never receives data | [P1](gap-closing-p1.md) |
| **Native encrypted storage** | On by default in builds (`NATIVE_ENCRYPTED_STORAGE` not `0`). Ship only a build that passed the [device gate](gap-closing-native-storage.md) | Build setting, not a flag | Kill, relaunch, reinstall and key loss behave as the runbook says | [Native storage](gap-closing-native-storage.md) |
| **Offline expenses** | Bundle working | None (part of the expense flow) | Add an expense offline → "Saved on this device"; reconnect → one expense, no duplicate | Gap-closing §5 |
| **Web app shell** | On in production web builds | Build with `EXPO_PUBLIC_DISABLE_OFFLINE_SHELL=1` to turn it off | Reload offline opens the app; a new deploy replaces the cached build | Gap-closing §5.4 |

## Imports

Enable these strictly in order; each step depends on the one before.

| Feature | Before you enable | Flags, in order | Check | Details |
|---|---|---|---|---|
| **Manual upload** | Scanner configured (below) for production | `feature_ingest_manual_upload` (seeded on) | Upload a synthetic confirmation → review → assign to a test trip | [Ingestion rollout](../ingestion-rollout.md) |
| **Structured import** (ICS, JSON-LD) | None | `planning_structured_import` (**cohort**) | An `.ics` attachment imports with no model call (check Admin → Ingestion Ops) | [P1](gap-closing-p1.md) |
| **Forwarded mailbox** | Inbound subdomain MX for `INGESTION_ALIAS_DOMAIN`; `MAILGUN_WEBHOOK_SIGNING_KEY`; strong `INGESTION_ENCRYPTION_SECRET`; private scanner with `INGESTION_VIRUS_SCAN_PROVIDER=clamav_http`, `INGESTION_VIRUS_SCAN_URL`, `INGESTION_VIRUS_SCAN_AUTH_TOKEN`; scheduler for `POST /api/internal/ingestion/mail-receipts/drain` with `X-Ingestion-Worker-Secret` | `feature_ingest_forwarded_mailbox` | **Send a test** shows "Test received" and creates nothing; a forwarded booking appears as a **suggestion**; rotating the address stops the old one | [P0](gap-closing-p0.md), [mailbox deployment](../ingestion-mailbox-deployment.md) |
| **Receiver trust** (verified forwarder) | A trusted gateway that signs observations; `INGESTION_RECEIVER_AUTH_SECRET`, `INGESTION_RECEIVER_AUTH_ID`, `INGESTION_RECEIVER_AUTH_POLICY_VERSION`; real Gmail/Outlook/Apple fixtures validated | `feature_ingest_receiver_auth` | A forward from a verified address is marked trusted; anything else stays a suggestion | [Receiver auth](gap-closing-receiver-auth.md) |
| **Automatic adding** | All of the above, **plus** the pilot gate: ≥99% precision over ≥200 audited assignments, zero wrong-trip (gap-closing §10.1 #7) | `planning_auto_assign` (**cohort**): admins first, then everyone | A confident match is added with "Added to … · Undo"; Undo works for 7 days; ambiguous matches still ask | [Matching and review](gap-closing-matching-review.md) |

## Premium and billing features

These use the `premium` master flag plus per-option settings in Admin → Billing → Premium parsing. See [feature flags: Premium and parsing options](../feature-flags.md#premium-and-parsing-options) and the [subscription checklist](../stripe-premium-subscriptions-checklist.md). Bank import (`expense_import_plaid*`) has its own [plan](../plaid-transaction-import-plan.md); its flags are fail-closed and must never block disconnect or deletion cleanup.

## Planned, not built

Hotel links ("Find a stay") will use `stays_partner_links` and `stays_provider_stay22`. They aren't in the flag file yet. See the [Stay22 integration plan](../implementation_plans/stay22-integration-plan.md).
