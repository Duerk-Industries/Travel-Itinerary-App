# Application architecture

[README](../README.md) · [Documentation hub](README.md) · [Configuration](configuration.md) · [Tests](../TEST_PLAN.md)

This describes the checked-in implementation as of 2026-11-08. Feature availability also depends on deployment configuration, database flags, cohorts, tiers, and credentials. Implementation plans describe intent and are not proof that a feature is enabled in production.

## Runtime and repository boundaries

| Area | Responsibility and source |
|---|---|
| `app/` | React 19, React Native 0.81, Expo 54 and TypeScript; one client for web, iOS and Android |
| `app/App.tsx` | Session bootstrap, selected trip, shared state and tab composition; `app/navigationConfig.ts` supplies React Navigation screen/deep-link mappings, including Admin/AI Operations; root `App.tsx` re-exports it |
| `app/hooks/` | Extracted data/session behavior, including `useTripsData.ts` for groups, trips and the active member roster |
| `app/tabs/` | Feature screens and their fetch helpers; `overview.tsx`, `activities.tsx`, lodging, transfers, expenses, ledger, account and `AdminTab.tsx` |
| `app/components/` | Shared forms, modal/keyboard boundaries, selectors, grids, maps and admin sections; `ActivityEditForm.tsx` is shared by activity and overview editing |
| `app/utils/` | Dates, map links, parsing, sessions, currency and client-side expense splitting/coverage |
| `server/src/` | Express 4 API, JWT/OAuth, authorization, database facade, services and integration boundaries |
| `packages/` | Workspaces: `domain`, `messaging`, `analytics`, `plaid-transactions`, `image-size-safe` |
| `functions/` | Firebase functions and emulator-related deployment assets; separate from the Express entry point |
| `scripts/`, `.github/workflows/` | Operational tools, release manifests/evidence, CI and deployment automation |

Canonical shared models are in [`server/src/types.ts`](../server/src/types.ts). Use the existing shared contracts rather than introducing screen-specific copies.

## Request and data flow

The client obtains a session and sends `Authorization: Bearer <token>` to the API. [`server/src/app.ts`](../server/src/app.ts) installs middleware and route groups; [`server/src/index.ts`](../server/src/index.ts) binds the server, initializes data/defaults and starts configured background work. Webhooks needing original request bytes are registered before ordinary JSON parsing.

Routes authorize account/group/trip access, apply feature and entitlement checks, and delegate to services and repositories. [`db.ts`](../server/src/db.ts) delegates to the cached adapter selected by [`db.providers.ts`](../server/src/db.providers.ts):

1. `USE_IN_MEMORY_DB=1` selects pg-mem.
2. Explicit `DB_PROVIDER` selects `postgres`, `firebase`, or `memory` (`dynamodb` is an unimplemented stub).
3. A Firestore emulator host selects Firebase.
4. Cloud Run/GCP runtime markers select Firebase; other runtimes default to Postgres.

**Production runs on Firestore** (Cloud Run selects the Firebase adapter). Postgres and pg-mem are used locally and in tests. Every data change must work on Firestore; see [Database variants](../TEST_PLAN.md#database-variants).

`DatabaseAdapter` is derived from the Postgres implementation, excluding internal transaction/query helpers. Firebase must match that public contract. Postgres migrations and Firestore indexes/access backfills are separate operational concerns; a memory test pass does not validate Firestore queries or rules.

## API areas

| Prefix | Scope |
|---|---|
| `/api/auth`, `/api/web-auth` | Authentication; web-auth compatibility alias |
| `/api/trips`, `/api/groups`, `/api/account` | Trips, membership, profiles, privacy/account flows and trip-blog functionality |
| `/api/transfers`, `/api/flights` | Transfers; `/api/flights` remains a permanent alias |
| `/api/lodgings`, `/api/activities`, `/api/car-rentals` | Trip items and completed-item ratings |
| `/api/expenses`, `/api/payments` | Expenses and ledger payments |
| `/api/itinerary`, `/api/itineraries` | Generation jobs and stored itinerary/day records |
| `/api/ingestion`, `/api/ingestion/gmail` | Document/mail intake, review and Gmail integration |
| `/api/billing`, `/api/plaid` | Optional subscription billing and bank transaction import |
| `/api/places`, `/api/maps`, `/api/affiliate` | Place lookup, maps and affiliate descriptors |
| `/api/trip-templates`, `/api/template-images`, `/api/traits` | Templates, images and travel preferences |
| `/api/notifications`, `/api/analytics` | Notifications and analytics intake |
| `/api/admin` | Server-authorized administration, including billing/ingestion sections |
| `/api/internal/*` | Worker, billing, deploy and blog callbacks with their own authentication |
| `/public/blog`, sitemap routes | Published blog output |

Two more mounts aren't obvious from the table. `dataTransferRoutes` is mounted directly on `/api` and handles CSV/JSON import and export for activities, lodging, transfers, car rentals and day plans. `/api/admin/trip-templates` handles template administration. Real-time chat and presence use Socket.IO on the same HTTP port (`server/src/socket/`, shared types in `packages/messaging/`). See `app.ts` for exact mounts and each route file for validation. `/api/healthz` returns `ok`, `sha` and `revision`; outside E2E it is a liveness check, not a full database/provider readiness test. `/metrics` is the Prometheus route.

## Jobs, providers and collaboration

AI routing/capture/evaluation code lives under `server/src/ai/`; provider/model selection can be managed through Admin → AI Operations. Itinerary orchestration and async jobs live under `services/`. Ingestion has intake, extraction, review, assignment and worker paths; its queue mode determines whether work runs in-process or through authenticated callbacks. Configured schedulers also handle retention, retries, billing reconciliation, notifications, blog reconciliation and catalogs. Inspect `index.ts` and the relevant worker before relying on restart recovery or multi-instance behavior.

### Subsystems

Many subsystems ship switched off behind flags. The [feature activation guide](operations/feature-activation.md) says how to turn each one on.

| Subsystem | Main source | Flags (see [inventory](feature-flag-inventory.md)) | Reference |
|---|---|---|---|
| Maps (web, public, native) | `app/components/TripMap*.tsx`, `server/src/services/planningPointsService.ts`, `server/src/routes/staticMapRoutes.ts` (native stopgap) | `planning_web_map`, `planning_native_map`, `trip_day_map` | [Maps](operations/gap-closing-maps.md) |
| Discovery and day planning | `nearbyPlacesService.ts`, `planningOperations.ts`, `packages/domain/src/dayOrder.ts` | `planning_nearby`, `planning_day_order`, `planning_optimize_order`, `planning_trip_inspiration` | [Day order and inspiration](operations/gap-closing-day-order-inspiration.md) |
| Geocoding | `server/src/services/geocoder/`, `geocodingService.ts` | `planning_locate_items`, `planning_geocoding` | [Maps](operations/gap-closing-maps.md) |
| Imports | `server/src/ingestion/` (intake, extraction, assignment, workers) | `feature_ingest_*`, `planning_structured_import`, `planning_auto_assign` | [Ingestion rollout](ingestion-rollout.md), [P0](operations/gap-closing-p0.md) |
| Notifications | `notificationService.ts`, `notificationOutboxWorker.ts`, `planningNotificationScheduler.ts`; client `NotificationInbox.tsx` | `notifications_*`, `planning_notifications`, `activity_recap` | [P1](operations/gap-closing-p1.md) |
| Offline | `planningBundleService.ts` (server bundle); `app/utils/offlineTripCache.ts`, `offlineSnapshotStorage.*`, `app/hooks/usePendingWrites.ts`, `app/public/sw.js` | `trip_bundle`; native build `NATIVE_ENCRYPTED_STORAGE` | [Native storage](operations/gap-closing-native-storage.md) |
| Affiliate links | `getYourGuide*` config, service and routes (`/api/affiliate`); planned provider-neutral stays layer | `getyourguide_activity_suggestions` | [Stay22 plan](implementation_plans/stay22-integration-plan.md) |
| Trip blog | `server/src/routes/blog*.ts`, `publicBlogRoutes.ts` | `trip_blog_*` | [Blog architecture](trip-blog-social-architecture.md) |
| AI | `server/src/ai/`, itinerary services | `ai_*`, `itinerary_*` | [AI chapters](implementation_plans/Chapter_02_Core_AI_Platform_Architecture.md) |
| Billing and bank import | `server/src/billing/`, `packages/plaid-transactions/` | `premium`, `expense_import_plaid*` | [Tiers](tiers.md), [subscriptions](stripe-premium-subscriptions-checklist.md) |
| Chat and presence | `server/src/socket/`, `packages/messaging/` | — | [WebSockets and chat](websockets-and-chat.md) |

Use [WebSockets and chat](websockets-and-chat.md), [blog architecture](trip-blog-social-architecture.md), [ingestion rollout](ingestion-rollout.md), and the [AI implementation chapters](implementation_plans/Chapter_02_Core_AI_Platform_Architecture.md) for subsystem detail. The chapters include design/planning material; the checked-in service and flags determine actual behavior.

## Authorization and financial calculations

Authentication, trip membership and server RBAC remain authoritative. Admin visibility in the client is only an affordance. Admins bypass tier limits/entitlements and certain past-date checks, but do not bypass flags. General entitlement gaps are fail-open; designated rollout-sensitive flags are fail-closed. See [feature flags](feature-flags.md) and [tiers](tiers.md).

Expense splitting and coverage rollups run in `app/utils/costs.ts` and `coveredBy.ts`; server validation has a mirrored coverage helper. Keep both coverage implementations synchronized. Participant and payer selectors use active group members; an empty roster affects both controls. Test trip switches and refresh failures when changing roster loading.

## Delivery boundaries

Web assets are exported with `npm --prefix app run export:web`. Express can serve static SPA assets, and hosted web delivery also uses Firebase Hosting. `npm run build` builds the backend, not every client artifact. Native releases go through EAS/store workflows and cannot be rolled back by a web/API traffic switch. [Deployment](production-deployment-guide.md) and [rollout testing](operations/rollout-testing.md) cover the different release paths.
