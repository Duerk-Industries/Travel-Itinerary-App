# Analytics Upgrade Implementation Plan

Status: proposed; documentation only.
Created and reviewed: October 8, 2026.
Revision: 3. Canonical path: `docs/implementation-plans/analytics-upgrade.md`; the former underscore-directory path is a forwarding document.
Design and collection inventory: [Analytics Upgrade: Collection, Goals, and Behavior](../analytics-upgrade.md).

## Outcome and Delivery Rules

Deliver reliable reporting for feature use, cost per user/trip, technical and task performance, native versus web use, and engagement during scheduled trips. Privacy controls, rights handling, and matching public disclosures (policy pages, cookies notice, privacy choices, account deletion web page, and app-store safety labels) must ship **before** any optional collection starts.

This plan provides compliance capabilities and release evidence; it does not certify GDPR or app-store compliance. The privacy owner resolves jurisdiction, controller, lawful-basis, processor-contract, and retention questions against the actual deployment. Recheck official rules before release, as regulatory guidance and platform policies change over time.

Repository rules that apply throughout:

- Strict TypeScript, shared types in `server/src/types.ts`, Zod validation of all client input.
- All storage goes through the `server/src/db.ts` facade, implemented in `db.postgres.ts` **and** `db.firebase.ts` together, with `db.memory.ts` supporting unit and integration tests. Postgres migrations go in `server/migrations/` with matching `.rollback.sql` files.
- Env access only via `getEnvValue` / `getEnvFlag`; logging only via `logInfo` / `logError`.
- Preserve existing quota accounting, entitlement behavior, and the `/api/flights` alias.
- No vendor selection, service provisioning, store submission, or new paid SDK is authorized by this document. Initial delivery uses existing infrastructure.

---

## Findings That Affect Implementation

1. `usage_events` and AI accounting cover selected user actions and costs, but not every provider attempt or a general feature/session journey. Avoid counting the same AI operation in both existing accounting and a new ledger.
2. `recordTiming` in `server/src/metrics.ts` calls a no-op emitter, so that helper retains no latency. Access logs, itinerary captures and configured Sentry tracing provide other limited timing sources. Counters drop labels and revision-based instance identity may be shared by replicas; fix these before relying on aggregate percentiles or per-instance reporting.
3. AI capture storage supports Cloud Storage, but `aggregationJob.ts` reads local files. A "successful" production aggregation run may miss captures.
4. Frontend Sentry is initialized in `app/AppEntry.js` before account preferences are known, with `enableAutoSessionTracking: true` and 10% trace sampling. A settings switch added later cannot control data that was already collected at startup.
5. `server/src/services/userDataExport.ts` (`EXPORT_SCHEMA_VERSION = 1`) exports account, trip, authored-item, and billing data but has no analytics, consent, or diagnostics section. The account deletion route (`DELETE /api/account` in `accountRoutes.ts`) cascades DB rows and cancels Stripe, but it does not prove removal of captures, nested JSON identities, logs, or Sentry data.
6. **Three conflicting privacy notices exist:**
   - `/privacy` → `server/src/legal/privacyPolicyHtml.ts`. Last updated July 21, 2026; operator/contact Tristan Duerk (`tristan.duerk@gmail.com`); "not directed at children under 13".
   - `/privacy.html` → `app/public/privacy.html`, linked from `app/tabs/account.tsx`. Last updated July 17, 2026; GDPR-style controller section; contact `bryan.duerk@gmail.com`; "under 16 may not hold an account".
   - `docs/legal/privacy-policy.md` matches the older `/privacy` text.

   These must be reconciled on facts (controller, contact, minimum age; see the `registration_age_gate` migration), not by picking one silently.
7. The older notices claim "we do not access camera, photo library…". The Expo config registers image/video share intents and the blog supports media upload, so verify the wording against actual native permissions before republishing.
8. `app/public/cookies.html` promises consent before optional diagnostics/analytics. Sentry's current startup behavior does not yet meet that promise.
9. The iOS config in `expo.config.shared.cjs` has **no `ios.privacyManifests`** entry. The required-reason APIs used by React Native, Expo modules, and the Sentry SDK (e.g. `UserDefaults`, file timestamps, system boot time) need verification in the archived build's privacy report.
10. Expo push tokens (`app/utils/pushNotifications.ts`) are device identifiers that must appear in store disclosures, even though they are not used for analytics.

---

## Architecture and Storage

Three processing paths, kept separate in code, storage, access, and policy text:

| Path | Purpose | Reliability and Privacy Rule |
|---|---|---|
| **Optional Behavioral Events** | Views, tasks, engagement, funnels | Fail **closed** on unknown consent; collection failure never breaks a travel action |
| **Operational / Accounting Records** | Service delivery, quotas, security, cost metering | Preserve existing accounting; documented basis; never repurposed as behavioral tracking |
| **Optional Detailed Diagnostics** | User-linked client crash/performance/session details | Permission-aware SDK initialization and scrubbing; necessary aggregate reliability stays narrowly scoped |

Proposed tables/collections (Postgres table name = Firestore collection name):

| Store | Contents | Notes |
|---|---|---|
| `privacy_preferences` | One row per user: independent `product_analytics` and `optional_diagnostics` choices, purpose-specific epochs/notice versions, optimistic revision and timestamps | Changes to one purpose do not grant or revoke the other; necessary processing is described separately |
| `privacy_choice_events` | Append-only consent/withdrawal evidence: choice, notice version, platform, timestamp | No behavioral payload, IP address, or device identifier |
| `analytics_subjects` | Random per-account pseudonym ↔ user mapping, epoch | Restricted access. Never an email hash. Rotated on withdrawal/regrant. |
| `analytics_events` | Validated envelopes and allowlisted properties; unique `(subject, purpose_epoch, event_id)` | Initially one row/document per event in both adapters. This simplifies retry deduplication, subject export and erasure; batching requests does not change event storage semantics. |
| `analytics_eligible_daily` | Minimal consented eligible user/trip/feature facts used as denominators | Personal data; deletable |
| `provider_cost_ledger` | Unique provider attempt, units, price version, user/trip/feature attribution, outcome, reconciliation state | Necessary operational data; restricted access |
| `analytics_daily_facts` / `analytics_rollups` | Bounded query shapes, definition and aggregation version | User/trip facts are personal. Only assessed anonymous aggregates get longer retention. |
| `analytics_job_runs` | Durable cursor, lease, version, freshness, counts, errors | No raw payloads |

Design rules:

- Use named columns for frequent dimensions (`event_name`, `feature`, `platform`, `trip_phase`, `occurred_at`) and bounded JSONB/maps for rare properties. Design Postgres indexes and Firestore composite indexes from the **same supported admin queries**.
- Interactive Firebase reports never scan raw events; they read precomputed rollups.
- Never use per-user or per-operation identifiers as metric labels.
- Daily jobs use durable leases/cursors and idempotent upserts so they are safe with multiple Cloud Run replicas. Retries replace a period rather than adding to it. Late events use a documented watermark (proposed: 48 h) with bounded recomputation. Expose partial coverage when data has expired.
- Keep production query correctness first; use focused adapter contract tests and a Firebase emulator/disposable test project. Document actual pg-mem incompatibilities when encountered rather than prescribing unverified SQL restrictions.

---

## Phase 0: Inventory, Definitions, Legal Analysis, and Privacy Decisions

**Owners:** Product Lead, Backend Lead, Privacy Owner.

- Verify the production DB provider, Sentry/capture settings, volumes, SDK network traffic, vendor contracts, data regions, and retention. Record facts without copying secrets.
- Inventory every outbound provider path (AI registry and direct callers, Places/maps, Unsplash, email, weather, imports, Plaid, background jobs) and mark whether each is attributable, priced, and covers billable failures.
- Approve the event/metric dictionary: eligibility, consent population, session rule, trip timezone fallback, outcome semantics, allowed dimensions.
- Maintain a **Record of Processing Activities (ROPA)** (purpose, data, basis, recipients, retention, rights, transfers). Run DPIA screening and complete a DPIA if the high-risk criteria apply.
- Document necessary metering/security purposes and any legitimate-interests assessment. Broad feature tracking is not "necessary" just because it helps the business.
- Resolve the Finding 6 conflicts (legal controller/operator, contact address, minimum age matching `registration_age_gate`), territorial reach, EU/UK representative and DPO applicability, and legal retention schedules.
- Approve global default-off for optional analytics and diagnostics with separate controls.

**Acceptance:** Signed-off dictionary, deployment inventory, coverage map, processing register, retention proposal, policy gap list. Optional collection stays off.

---

## Phase 1: Privacy Settings, Controls, and Enforcement

**Owners:** Frontend Lead, Backend Lead, Privacy Owner. Depends on Phase 0.

### Server Implementation
- `GET` / `PATCH /api/account/privacy-preferences` in `accountRoutes.ts`: Authenticated owner only, optimistic `revision` check, server timestamps, append to `privacy_choice_events`. No admin can grant consent on a user's behalf.
- `server/src/services/privacyConsentService.ts`: Purpose-specific admission checks and optimistic preference updates. Serialize preference/epoch validation with event admission using a DB transaction or equivalent consistency boundary in each adapter. Do not use cached grants for admission.
- Feature flags in `server/config/feature-flags.yaml`: `analytics_collection_enabled` (kill switch) and `diagnostics_user_linked_enabled`, both **default disabled and fail-closed**. These must not inherit entitlement fail-open behavior. When disabled, consent updates, export, and deletion must still work.
- Review `server/src/instrument.ts`: `sendDefaultPii: false`; strip `user.ip_address`, cookies, auth headers, request bodies, and query strings in `beforeSend`/`beforeSendTransaction`.

### Client Implementation
- New `app/utils/privacyConsent.ts` (state machine: unknown/off, granted, withdrawn, obsolete-notice) and `app/hooks/usePrivacyConsent.ts`. Fetch on bootstrap and on foreground. Server stays authoritative.
- First-run consent sheet with equal-weight **Accept** / **Reject** / **Customize**. Show it once after login, not before the user can use the app. No nagging after refusal.
- **Account → Privacy** section in `app/tabs/account.tsx` / `AccountProfileManagement.tsx`: Two switches, a necessary-processing explanation, and links to export, delete analytics data, delete account, privacy policy, cookie notice, and privacy choices.
- Web: Handle `Sec-GPC: 1` at the server and `navigator.globalPrivacyControl` in the browser. Active GPC or DNT keeps product analytics off.
- **Sentry Redesign** (`app/utils/sentry.ts`, `app/AppEntry.js`): Default the optional client SDK to uninitialized until `optional_diagnostics` is granted. Disable automatic session/network/console capture before permission. Verify SDK/native shutdown semantics so withdrawal discards pending data rather than flushing it.

### Independent Purpose & Revocation Matrix

| Product Analytics | Detailed Diagnostics | Expected Optional Collection |
|---|---|---|
| Off | Off | None |
| On | Off | Product events only; no optional Sentry activity |
| Off | On | Approved diagnostic payloads only; no feature/session product events |
| On | On | Both, independently gated and revocable |

**Acceptance:** Network and storage evidence shows zero optional data before permission and after withdrawal, including error paths and account switches. Core trip, quota, and billing regression suites pass.

---

## Phase 2: Event Pipeline, Schema Registry, and Instrumentation

**Owners:** Frontend Lead, Backend Lead. Development depends on Phase 1.

- **Registry:** One canonical definition under `server/src/analytics/` generates client types and strict server Zod schemas. Share model types through `server/src/types.ts`.
- **Client Utility:** `app/utils/analytics/track.ts` plus `useTrackView(feature)`.
- **Instrumentation:** Routing/trip selection in `app/App.tsx`, then overview, itinerary, activities, lodging, transfers, expenses, packing, imports, blog, and collaboration. Guard against duplicate render events in React 19 Strict Mode.
- **Ingest Route:** `POST /api/analytics/events` in `analyticsRoutes.ts`, authenticated users only.
- **Validation & Limits:** 20 events per batch, 32 KiB payload, 30-second foreground flush, max 100 queued events and 24-hour expiry. Enforce max event age (24h) and future skew (5m). Store receipt time and reject invalid clocks. Freeze batches/IDs for retries and deduplicate per subject/purpose epoch.
- **Queue:** In-memory only initially. A durable offline queue requires encrypted storage, expiry, withdrawal purge, and a storage notice update.
- **Server Outcomes:** After the business transaction commits, pass consent-filtered events to a bounded asynchronous writer.
- **Trip Phase:** `server/src/utils/tripPhase.ts` (pure function with date/timezone version).
- **Exclusions:** Sessions use bounded foreground intervals, never API polls. Admins, E2E/automation users, prefetch, and background workers are marked for exclusion.

**Acceptance:** Golden fixture journeys produce expected deduplicated events and phase classifications with no prohibited properties. Consent-denied journeys produce no optional events.

---

## Phase 3: Cost Metering, Performance Monitoring, and `metrics.ts` Fixes

**Owners:** Backend Lead, Finance/Operations Owner. Depends on Phase 0.

- Route all cost recording through `settleProviderAttempt()` recording attempt ID, provider/model/caller, feature, initiating user, trip, units, cache status, failure/retry state, and price version in integer USD microdollars.
- Audit `openaiApi.ts` and `aiProviderRegistry.ts` accounting to prevent double settlement. Add a uniqueness constraint on attempt ID.
- Unattributed calls recorded as `system`/`unattributed`. Shared trip/background costs classified once under an explicit allocation rule.
- Monthly invoice reconciliation covering credits, refunds, committed spend, and currency metadata.
- **Fix `metrics.ts`:** Retain timings as fixed-bucket histograms with low-cardinality labels, export on `/metrics`, add a unique process identity (`K_REVISION` plus random instance ID), and expose `countersStartedAt`.
- Screen/trip readiness spans and task outcomes under the appropriate consent category. Use browser Performance API on web and native startup/frame measurements where supported.
- Fix AI aggregation job to read the configured capture backend (GCS in production) with durable cursors and leases.

**Acceptance:** Synthetic calls reconcile exactly; dashboards distinguish unknown, estimated, and billed costs. Performance data is retained, bounded, and labeled.

---

## Phase 4: Rights, Retention, and Policy & Web Page Deliverables

**Owners:** Backend Lead, Privacy Owner. Depends on Phase 1 & 2.

### 1. Rights Handling
- Bump `EXPORT_SCHEMA_VERSION` to 2 in `userDataExport.ts` and add `privacy` (preferences/history), `analytics` (events, daily facts, pseudonym), `costs` (attributed ledger rows), and `diagnostics` (capture metadata). Use machine-readable JSON.
- New `DELETE /api/account/analytics-data` ("Delete my analytics data"), separate from withdrawal.
- Extend account deletion (`DELETE /api/account`) to pseudonym mappings, trip-linked analytics, raw events, user/trip facts, captures, nested JSON identities, logs, and external diagnostics.
- Suppress or rebuild attributable rollups after erasure. Cohorts below 10 are suppressed in reports and exports.
- Durable deletion jobs with retries, tombstones, and provider confirmation.
- Track rights deadlines by jurisdiction (GDPR 1 month, CCPA 45 days).

### 2. Data Retention Schedule

| Data Category | Retention Limit | Enforcement Mechanism |
|---|---|---|
| **Client Optional Queue** | 24 hours, or withdrawal / logout | Client-side expiry and immediate purge |
| **Raw Behavioral Events** | 90 days | Exclude expired records from queries immediately; batched deletion + Firestore TTL |
| **Linked Daily User/Trip Facts** | 13 months | Scheduled daily purge job + subject erasure cascade |
| **Consent Choice Evidence** | Purpose-specific duration approved in Phase 0 | Minimal restricted evidence in `privacy_choice_events` |
| **Minimized Diagnostic Logs/Traces** | 30 days | Cloud Logging bucket retention, Sentry project retention |
| **AI Captures** | ≤ 30 days for diagnostics | GCS object lifecycle rule + subject deletion cascade |
| **Assessed Anonymous Aggregates** | 25 months, then review/purge | Aggregate lifecycle job and disclosure review |
| **Cost Ledger & Billing** | Legally required accounting schedule | Internal cost telemetry kept separate from behavioral analytics |

### 3. Privacy Policy and Web Page Deliverables

**Step 1: Consolidate Canonical Source**
Make `docs/legal/privacy-policy.md` the single canonical source. Add `scripts/build-legal-pages.mjs` to compile it into `app/public/privacy.html` and `server/src/legal/privacyPolicyHtml.ts`. CI fails if outputs drift.

**Step 2: Per-Surface Changes**

| Surface | Required Deliverable |
|---|---|
| `docs/legal/privacy-policy.md` (canonical) | Reconcile controller/operator, contact (`tristan.duerk@gmail.com`), and age gate (16 EU/UK, 13 US). Include updated collection, dual opt-in toggles, GPC/DNT rules, retention schedule, rights, and subprocessors. |
| `app/public/privacy.html` | Compiled from canonical source. Serves web policy page. |
| `server/src/legal/privacyPolicyHtml.ts` → `/privacy` | Compiled from canonical source or 301 redirect to `/privacy.html`. |
| `app/public/cookies.html` | Inventory storage keys, purpose, operator, and duration. Interactive "Manage Preferences" button. |
| `app/public/privacy-choices.html` (new) | Public explanation of dual opt-in controls, GPC signal handling, and rights links ("Your Privacy Choices"). |
| `app/public/delete-account.html` (new) | Public account deletion request page for Google Play policy compliance. |
| `app/tabs/account.tsx`, `AccountProfileManagement.tsx` | Account → Privacy UI with 2 switches, necessary processing text, and legal links. |
| `server/src/app.ts` | Serve `/privacy`, `/privacy.html`, `/cookies.html`, `/privacy-choices`, `/delete-account` with stable aliases. Static pages matched before SPA fallback. |
| Web Footer / Login Screen | Add "Privacy Choices" link next to Privacy and Terms links. |
| App Store & Google Play Packets | Updated App Privacy labels, ATT verification, Privacy Manifests (`ios.privacyManifests`), Data Safety declarations, `AD_ID` removal, and Delete account URL. |

---

## Phase 5: Reporting, Admin Dashboards, and Analysis

**Owners:** Product Lead, Backend Lead, Frontend Lead. Depends on Phase 1–4.

- Add **Analytics** section to `AdminTab` with 5 aggregate views: Feature Adoption, Cost, Reliability, Platform Mix, Trip-Phase Engagement.
- Reuse admin components and RBAC; endpoints under `/api/admin/analytics/*`.
- Metric calculations in `server/src/analytics/metrics/` shared by API and CSV export.
- Cohort suppression (<10 users) on all views and exports.
- Scheduled export of anonymized rollups to CSV in Cloud Storage / BigQuery for ad-hoc analysis.

---

## Performance Budgets, Cost Model, Maintainability, and Test Coverage

### 1. Performance Budgets

- **Disabled State:** 0 optional requests, 0 analytics writes.
- **Client `track()`:** p95 < 2 ms; non-blocking in-memory queue.
- **Server Ingest:** p95 < 200 ms per 20-event batch.
- **Admin Reports:** p95 < 2 s for 30-day queries reading `analytics_rollups`.

### 2. Cost Model (1,000 Consenting MAU Example)

- **Volume Assumption:** 1,000 MAU × 8 sessions/month × 25 events/session = 200,000 events/month (~10,000 batches).
- **Postgres Storage:** ~195 MiB/month raw payload (~586 MiB for 90 days retention).
- **Firestore Operations:** 200,000 document writes/month, precomputed rollup reads, TTL purge deletes.
- **Cost Cap & Kill Switch:** Monthly budget cap defined in `cost-model.yaml` with automated alerts at 80% and 100%. `analytics_collection_enabled` kill switch disables optional collection instantly if needed.

### 3. Maintainability
- Single event registry, Zod schemas, CI drift checks between client, server, and legal pages.
- Each new event requires a product justification, schema, permission category, retention rule, and PR checklist approval.

### 4. Comprehensive Test Coverage Matrix

| Layer | Required Test Cases | Test File Location |
|---|---|---|
| **Pure Utilities** | Registry validation, session caps, trip phase timezone/DST/boundary logic, cost arithmetic, units | `server/__tests__/analytics-registry.test.ts`<br>`trip-phase.test.ts`<br>`app/tests/analyticsSession.test.ts` |
| **Client (Jest)** | Zero collection before permission, equal reject path, reload/account switch, GPC/DNT handling, Sentry gating, queue overflow, offline expiry | `app/tests/privacyConsent.test.ts`<br>`analyticsTrack.test.ts`<br>`sentry.test.ts`<br>`AccountProfileManagement.test.tsx` |
| **API (Supertest)** | Auth, spoofing protection, Zod validation, batch caps, deduplication, denied/withdrawn consent, replica synchronization, fail-closed flags, rate limits | `server/__tests__/analytics-ingest.test.ts`<br>`privacy-preferences.test.ts` |
| **Adapter Parity** | Postgres and Firebase adapter parity, index behavior, transaction safety, lease locking, retention purge, deletion cascades | `analytics-adapter-parity.test.ts` (run in memory + isolated DBs) |
| **Cost Metering** | `settleProviderAttempt()`, retry/failure pricing, USD microdollar precision, double-record prevention, invoice reconciliation | `openai-usage-accounting.test.ts`<br>`provider-cost-ledger.test.ts` |
| **Metrics & Telemetry** | Histogram retention, label preservation, process ID generation, `/metrics` export | `metrics.test.ts` |
| **Reports & Dashboards** | Golden journeys, denominator calculations, late event handling, cohort suppression (<10 users), CSV/UI parity | `analytics-reports.test.ts`<br>`firebase-admin-analytics.test.ts` |
| **Data Subject Rights** | Export schema v2 completeness, analytics deletion endpoint, full account deletion cascade, tombstone integrity, GCS capture purging | `accountExport.test.ts`<br>`accountDelete.test.ts`<br>`analytics-erasure.test.ts` |
| **Legal Pages** | Generated HTML matches canonical Markdown, stable alias routing, 200 status verification | `server/__tests__/legal-pages.test.ts` |
| **Web E2E (Playwright)** | Consent sheet Accept/Reject/Customize, GPC/DNT signal response, zero network calls when rejected, public choices & deletion links | `app/e2e/privacy-consent.test.ts` |
| **Native Release** | iOS Privacy Manifest, App Store Nutrition Labels, ATT verification, Android Data Safety, `AD_ID` removal, in-app deletion | `docs/app-store-review-packet.md` checklist |

---

## Rollout and Completion Criteria

1. Merge schemas, privacy controls, and permission-aware Sentry init with collection flags **off**.
2. Deploy consolidated policy pages (`docs/legal/privacy-policy.md`, `privacy.html`, `privacyPolicyHtml.ts`, `cookies.html`, `privacy-choices.html`, `delete-account.html`).
3. Prepare and submit App Store and Google Play disclosures (Privacy Manifests, ATT, Data Safety, Delete account URL) **before** shipping the consent UI mobile build.
4. Enable `analytics_collection_enabled` for a consenting canary cohort, then scale gradually.
5. Monitor ingest failure rates, consent enforcement, report freshness, and cost budgets.

**Done When:** All 5 dashboards are live and trusted; privacy controls are verified across web, iOS, and Android; canonical privacy notices are published across all endpoints; rights and retention jobs are operational; store submission requirements are fulfilled; and test coverage and performance budget evidence is verified.
