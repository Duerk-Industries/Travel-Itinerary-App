# Analytics Upgrade Implementation Plan

Status: Phase 1 code implemented with collection flags off; release validation and later phases remain open.
Created and reviewed: October 8, 2026.
Revision: 7 (records Phase 1 implementation and remaining release checks). Canonical path: `docs/implementation-plans/analytics-upgrade.md`; the former underscore-directory path is a forwarding document.
Design and collection inventory: [Analytics Upgrade: Collection, Goals, and Behavior](../analytics-upgrade.md).
Phase 0 evidence and review state: [Analytics Phase 0](../analytics-phase-0.md).
Proposed approvals and decision order: [Phase 0 recommendations](../analytics-phase-0.md#recommendations-for-the-open-decisions).

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

   The code sets a 16-year age threshold and includes a post-sign-in verification path, but server enforcement is feature-flagged. Controller/contact choice remains unverified against the conflicting public notices. See the [Phase 0 audit](../analytics-phase-0.md#recorded-decisions-and-sign-off-state). The older under-13 statement must be reconciled before publishing a new policy.
7. The older notices claim "we do not access camera, photo library…". The Expo config registers image/video share intents and the blog supports media upload, so verify the wording against actual native permissions before republishing.
8. `app/public/cookies.html` promises consent before optional diagnostics/analytics. Sentry's current startup behavior does not yet meet that promise.
9. The iOS config in `expo.config.shared.cjs` has **no `ios.privacyManifests`** entry, and the Android config has **no `blockedPermissions`** entry, so `AD_ID` may be merged in by a dependency. The required-reason APIs used by React Native, Expo modules, and the Sentry SDK (e.g. `UserDefaults`, file timestamps, system boot time) need verification in the archived build's privacy report.
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

- Use the [Phase 0 verified deployment and retention inventory](../analytics-phase-0.md#deployment-and-retention-inventory) as the baseline. Complete its remaining SDK, vendor-contract, data-volume and policy-retention checks before the release gate closes; record facts without copying secrets.
- Review and sign the [provider and cost coverage map](../analytics-phase-0.md#provider-and-cost-coverage-map); test attribution, pricing and billable failures on each active path before claiming complete user cost.
- Product owner reviews and signs the [initial event and metric dictionary](../analytics-phase-0.md#initial-event-and-metric-dictionary), including eligibility, consent population, session/phase/outcome semantics and allowed dimensions.
- Use the [draft processing register and DPIA screening](../analytics-phase-0.md#processing-register-draft-ropa) to complete a signed ROPA, purpose-specific lawful-basis review and full DPIA before optional collection.
- Document necessary metering/security purposes and any legitimate-interests assessment. Broad feature tracking is not "necessary" just because it helps the business.
- Treat the [recorded product decisions](#phase-0-decisions-recorded-october-8-2026) as proposals subject to the [Phase 0 review gates](../analytics-phase-0.md#recorded-decisions-and-sign-off-state). The controller/contact, EU/UK representative and DPO assessment, provider agreements and retention require independent verification before publication.
- Put the [recommended default and approval evidence for each open decision](../analytics-phase-0.md#recommendations-for-the-open-decisions) before the operator, privacy, product and finance owners. Record accepted choices and exceptions with names/dates; do not infer approval from the recommendations.
- Approve global default-off for optional analytics and diagnostics with separate controls.

**Acceptance:** The engineering inventory, load baseline, coverage map, draft processing register, DPIA screening, dictionary and policy gap list are documented in the Phase 0 record. Product, legal/privacy and finance sign-offs listed there remain open; optional collection stays off until those gates and later implementation gates close.

---

## Phase 1: Privacy Settings, Controls, and Enforcement

**Owners:** Frontend Lead, Backend Lead, Privacy Owner. Depends on Phase 0.

### Server Implementation
- `GET` / `PATCH /api/account/privacy-preferences` in `accountRoutes.ts`: Authenticated owner only, optimistic `revision` check, server timestamps, append to `privacy_choice_events`. No admin can grant consent on a user's behalf.
- `server/src/services/privacyConsentService.ts`: Purpose-specific admission checks and optimistic preference updates. Serialize preference/epoch validation with event admission using a DB transaction or equivalent consistency boundary in each adapter. Do not use cached grants for admission.
- Feature flags in `server/config/feature-flags.yaml`: `analytics_collection_enabled` (kill switch) and `diagnostics_user_linked_enabled`, both **default disabled and fail-closed**. These must not inherit entitlement fail-open behavior. When disabled, consent updates, export, and deletion must still work.
- Review `server/src/instrument.ts`: `sendDefaultPii: false`; strip `user.ip_address`, cookies, auth headers, request bodies, and query strings in `beforeSend`/`beforeSendTransaction`. Server-side Sentry stays on as necessary processing (legitimate interest in service security and reliability) and does not depend on the user's optional choice. Set its event retention to the approved 30 days.

### Client Implementation
- New `app/utils/privacyConsent.ts` (state machine: unknown/off, granted, withdrawn, obsolete-notice) and `app/hooks/usePrivacyConsent.ts`. Fetch on bootstrap and on foreground. Server stays authoritative.
- First-run consent sheet with equal-weight **Accept** / **Reject** / **Customize**. Show it once after login, not before the user can use the app. No nagging after refusal.
- **Account → Privacy** section in `app/tabs/account.tsx` / `AccountProfileManagement.tsx`: Two switches, a necessary-processing explanation, and links to export, delete analytics data, delete account, privacy policy, cookie notice, and privacy choices.
- Web: Handle `Sec-GPC: 1` at the server and `navigator.globalPrivacyControl` in the browser. Active GPC or DNT keeps product analytics off.
- **Sentry Redesign** (`app/utils/sentry.ts`, `app/AppEntry.js`): Move `initSentry()` out of `AppEntry.js` startup into the consent bootstrap, and call it only when `optional_diagnostics` is granted and its collection flag is enabled. Keep `wrapApp()`'s error boundary around the app when a DSN is configured. Before permission, no SDK init occurs. On grant, init with `sendDefaultPii: false`, scrub request/context payloads, and set the Sentry user to a rotating diagnostic pseudonym, never the raw user ID or email. On withdrawal or account switch, close Sentry and verify on devices that queued/native envelopes cannot leave afterward. The installed Android Sentry manifest sets `io.sentry.auto-init=false`; `autoInitializeNativeSdk` is a **runtime SDK option**, not an Expo-plugin switch, and setting it false on grant would also disable native initialization then. Verify iOS startup and both native transports in a release build. Publish a 30-day expiry claim only after checking the Sentry project setting. Accepted trade-off: no client crash reports from non-consenting users.

### Independent Purpose & Revocation Matrix

| Product Analytics | Detailed Diagnostics | Expected Optional Collection |
|---|---|---|
| Off | Off | None |
| On | Off | Product events only; no optional Sentry activity |
| Off | On | Approved diagnostic payloads only; no feature/session product events |
| On | On | Both, independently gated and revocable |

**Acceptance:** Network and storage evidence shows zero optional data before permission and after withdrawal, including error paths and account switches. Core trip, quota, and billing regression suites pass.

**Phase 1 implementation state (October 8, 2026):** The two default-off/fail-closed flags, authenticated revisioned preferences, atomic choice evidence in Postgres/Firestore, GPC/DNT handling, first-run sheet, Account privacy controls, and consent-gated Sentry initialization are implemented. The account links include public choice/deletion request pages and an authenticated export; analytics-data deletion currently routes to support because the Phase 2 event store and Phase 4 self-service erasure endpoint do not exist yet. No product events are collected in Phase 1. Grant requests are refused while their flag is off; refusal and withdrawal still work. Targeted API tests passed in the in-memory Postgres adapter and the Firestore emulator. A Playwright pre-login check of an exported web build with a fake configured Sentry DSN showed no Sentry request; its backend was intentionally absent, so this does not prove signed-in choice or withdrawal behavior. Remaining acceptance evidence: signed-in web/iOS/Android network traces (including Sentry queue behavior and startup), actual Sentry project retention/processor terms, updated canonical legal pages and store disclosures, and full release/regression checks. Keep both flags off until these gates close.

---

## Phase 2: Event Pipeline, Schema Registry, and Instrumentation

**Owners:** Frontend Lead, Backend Lead. Development depends on Phase 1.

- **Registry:** New workspace package `packages/analytics` (`@wanderbunnies/analytics`), modeled on `packages/domain` and `packages/messaging`. It exports event names, strict Zod schemas, and metadata (purpose, owner, consent category, retention, sampling), and both `app/` and `server/` import it directly. No code generation, no mirrored copies. Persisted record types that the DB adapters return go in `server/src/types.ts`.
- **Client Utility:** `app/utils/analytics/track.ts` plus `useTrackView(feature)`.
- **Instrumentation:** Routing/trip selection in `app/App.tsx`, then overview, itinerary, activities, lodging, transfers, expenses, packing, imports, blog, and collaboration. Guard against duplicate render events in React 19 Strict Mode.
- **Ingest Route:** `POST /api/analytics/events` in `analyticsRoutes.ts`, authenticated users only.
- **Validation & Limits:** 20 events per batch, 32 KiB payload, 30-second foreground flush plus a flush on background/`visibilitychange` (`fetch` with `keepalive` on web, so the auth header is still sent), max 100 queued events and 24-hour expiry. Enforce max event age (24h) and future skew (5m). Store receipt time and reject invalid clocks. Freeze batches/IDs for retries and deduplicate per subject/purpose epoch.
- **Queue:** In-memory only initially. A durable offline queue requires encrypted storage, expiry, withdrawal purge, and a storage notice update.
- **Server Outcomes:** After the business transaction commits, pass consent-filtered events to a bounded asynchronous writer.
- **Trip Phase:** `server/src/utils/tripPhase.ts` (pure function with date/timezone version). Adds an optional IANA `timezone` on trips, filled from cached Places details, with fallback segment → trip → event device timezone → `unknown` (decision 5).
- **Exclusions:** Sessions use bounded foreground intervals, never API polls. Admins, E2E/automation users, prefetch, and background workers are marked for exclusion.

**Acceptance:** Golden fixture journeys produce expected deduplicated events and phase classifications with no prohibited properties. Consent-denied journeys produce no optional events.

---

## Phase 3: Cost Metering, Performance Monitoring, and `metrics.ts` Fixes

**Owners:** Backend Lead, Finance/Operations Owner. Depends on Phase 0.

- Route all cost recording through `settleProviderAttempt()` recording attempt ID, provider/model/caller, feature, initiating user, trip, units, cache status, failure/retry state, and price version in integer USD microdollars.
- Audit `openaiApi.ts` and `aiProviderRegistry.ts` accounting to prevent double settlement. Add a uniqueness constraint on attempt ID.
- Unattributed calls recorded as `system`/`unattributed`. Shared trip/background costs classified once under `allocation_v1`: equal split across accounts active that month, with a request-volume split shown for comparison (decision 4).
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
| **Consent Choice Evidence** | Account lifetime + 3 years | Minimal restricted evidence in `privacy_choice_events`; purge job keyed on account deletion date |
| **Minimized Diagnostic Logs/Traces** | 30 days | Cloud Logging bucket retention, Sentry project retention |
| **AI Captures** | ≤ 30 days for diagnostics | GCS object lifecycle rule + subject deletion cascade |
| **Assessed Anonymous Aggregates** | 25 months, then review/purge | Aggregate lifecycle job and disclosure review |
| **Cost Ledger** | User/trip linkage 13 months; feature/provider totals retained | Scheduled de-linking job; kept separate from behavioral analytics |
| **Billing Records** | 7 years (tax/accounting) | Existing Stripe/billing tables; documented legal hold |

### Privacy Policy and Web Page Deliverables

**Step 1: Consolidate Canonical Source**
Make `docs/legal/privacy-policy.md` the single canonical source. Add `scripts/build-legal-pages.mjs` to compile it into `app/public/privacy.html` and `server/src/legal/privacyPolicyHtml.ts`. CI fails if outputs drift.

**Step 2: Per-Surface Changes**

| Surface | Required Deliverable |
|---|---|
| `docs/legal/privacy-policy.md` (canonical) | Operator Tristan Duerk (company name once registered). Single contact **`support@wander-bunnies.com`** (already published), replacing both personal addresses. Minimum age **16 everywhere**, matching `registrationAgeGate.ts`. Do not claim an EU/UK representative. Apply every change in Step 3. Add version number, effective date, and a change summary at the top. |
| `app/public/privacy.html` | Compiled from canonical source. Serves web policy page. |
| `server/src/legal/privacyPolicyHtml.ts` → `/privacy` | Compiled from canonical source or 301 redirect to `/privacy.html`. |
| `app/public/cookies.html` | Inventory storage keys, purpose, operator, and duration. Interactive "Manage Preferences" button. |
| `app/public/privacy-choices.html` (new) | Public explanation of dual opt-in controls, GPC signal handling, and rights links ("Your Privacy Choices"). |
| `app/public/delete-account.html` (new) | Public account deletion request page for Google Play policy compliance. |
| `app/tabs/account.tsx`, `AccountProfileManagement.tsx` | Account → Privacy UI with 2 switches, necessary processing text, and legal links. |
| `server/src/app.ts` | Serve `/privacy`, `/privacy.html`, `/cookies.html`, `/privacy-choices`, `/delete-account` with stable aliases. Static pages matched before SPA fallback. |
| Web Footer / Login Screen | Add "Privacy Choices" link next to Privacy and Terms links. |
| App Store & Google Play Packets | Updated App Privacy labels, ATT verification, Privacy Manifests (`ios.privacyManifests`), Data Safety declarations, `AD_ID` removal, and Delete account URL. See section 4 below. |
| `docs/sentry.md`, `docs/feature-flags.md`, `docs/admin.md` | Consent-gated client init, server scrubbing and retention, the two new flags, metric definitions, and the kill-switch runbook. |

**Step 3: Required notice content changes**

Changes to the current text (found in the July 2026 notices):

| Current statement | Where | Required change |
|---|---|---|
| "We use Sentry to automatically collect crash reports and performance diagnostics" | `/privacy`, `privacy-policy.md` | Server error monitoring is necessary processing (scrubbed, 30 days). App crash/performance diagnostics are collected **only if you turn on Detailed Diagnostics**. |
| "We do not use third-party advertising or marketing-analytics SDKs" | `/privacy`, `privacy-policy.md` | Keep the no-advertising promise, and add that WanderBunnies runs **first-party** product analytics, only with opt-in consent. |
| "We do not access your device's … camera, photo library" | `/privacy`, `privacy-policy.md` | Verify against the share-intent and blog-media permissions (Finding 7) and rewrite to describe actual access ("only photos/videos you choose to share or upload"). |
| "not directed at children under 13" | `/privacy`, `privacy-policy.md` | Accounts require age 16+. Travelers under 16 can be listed by an adult but are never analytics subjects. |
| Legal-basis row "Use optional analytics, advertising, or non-essential cookies — Consent, where required" | `privacy.html` | Replace with explicit rows: product analytics (consent), detailed diagnostics (consent), cost metering and quotas (contract/legitimate interests), security logs and server error monitoring (legitimate interests), billing records (legal obligation). |
| "Device, usage, and security data … diagnostic telemetry" | `privacy.html` | Split into necessary technical data and optional analytics/diagnostics, and add push notification tokens (purpose, encryption, deleted on logout/account deletion). |
| Retention section (criteria only) | All | Add the approved schedule (raw events 90 days, daily facts 13 months, diagnostics 30 days, aggregates 25 months), published only once configured and tested. |

New sections to add:

1. **Product analytics**: what is collected (feature views, task outcomes, session timing, platform/app version/browser family, trip phase derived from trip dates, never location), the pseudonymous account linkage (still personal data), and that it is off unless you opt in.
2. **Your privacy choices**: the two switches, where to find them (Account → Privacy, `/privacy-choices`), withdrawal at any time, GPC/DNT honored as refusal, and no loss of features or price difference for refusing.
3. **Rights**: access/export, correction, deletion (account and analytics-only), restriction, objection (including to legitimate-interest processing), portability, complaint to a supervisory authority, the US-state appeal process, response times (1 month GDPR / 45 days CCPA), and how to submit (in-app, web page, email).
4. **Recipients and transfers**: Google Cloud/Firebase, Sentry, AI providers, email providers. Transfer mechanism per provider (adequacy, EU–US Data Privacy Framework, or SCCs) and a link to the subprocessor list.
5. **What we don't do**: no sale/sharing for cross-context advertising, no advertising IDs, no fingerprinting, no session replay, no GPS, no use of Gmail or Plaid content for analytics (keep the existing Google Limited Use and Plaid sections word-for-word unless reviewed).
6. **Changes to this notice**: a material change to analytics purposes bumps the notice version and asks for consent again; an unchanged choice is never assumed.

`app/public/cookies.html` gets one row per storage key, each with name, purpose, necessary/optional, duration, and operator:
- consent record (necessary, until changed)
- analytics session ID (optional, 30 minutes of inactivity)
- in-memory queue (no persistent storage)
- Sentry SDK storage (optional, cleared on withdrawal)

It also gets a "Manage preferences" control that opens the same choices as `/privacy-choices`.

`app/public/privacy-choices.html` and `app/public/delete-account.html` must:
- name the app and the operator
- work while signed out
- generate no optional analytics
- link back to the canonical policy

`delete-account.html` also states what is deleted, what is retained and why (billing/legal, consent evidence), identity verification, and timing.

### 4. Mobile Store Compliance Tasks

| Task | Change | Verification |
|---|---|---|
| iOS privacy manifest | Add `ios.privacyManifests` to `expo.config.shared.cjs`: `NSPrivacyTracking: false`; `NSPrivacyCollectedDataTypes` for product interaction, user ID, device ID, crash and performance data (linked, not tracking, with purposes); `NSPrivacyAccessedAPITypes` for the reasons the build actually reports. | Xcode **Privacy Report** from the archived EAS production build; reconcile against the SDK manifests from React Native, Expo, and Sentry. |
| iOS App Privacy labels | Update App Store Connect to match the manifest and the policy. Optional collection is still declared. | Reviewer notes in `docs/app-store-review-packet.md` with screenshots of the consent sheet and Account → Privacy. |
| ATT | No prompt and no `NSUserTrackingUsageDescription`. | Proxy capture of a release build shows no IDFA access and no third-party tracking domains. |
| Android AD_ID | Add `android.blockedPermissions: ['com.google.android.gms.permission.AD_ID']`. | Inspect the merged `AndroidManifest.xml` from the EAS build. Play Console advertising-ID declaration: No. |
| Play Data safety | Update data types, purposes, optionality, encryption in transit, and deletion. Add the `/delete-account.html` URL. | Form answers stored in the review packet and diffed against the analytics registry metadata at each release. |
| Disclosure drift check | CI test that every registry event's consent category maps to a declared store data type. | Fails the build when a new event category is added without a disclosure update. |

---

## Phase 5: Reporting, Admin Dashboards, and Analysis

**Owners:** Product Lead, Backend Lead, Frontend Lead. Depends on Phase 1–4.

- Add **Analytics** section to `AdminTab` with 5 aggregate views: Feature Adoption, Cost, Reliability, Platform Mix, Trip-Phase Engagement.
- Reuse admin components and RBAC; endpoints under `/api/admin/analytics/*`.
- Metric calculations in `server/src/analytics/metrics/` shared by API and CSV export.
- Cohort suppression (<10 users) on all views and exports.
- Scheduled export of suppressed aggregate rollups to CSV in Cloud Storage for ad-hoc analysis. No BigQuery for now (decision 9).

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
- **Sentry:** Only consenting users generate client events, so quota grows with the opt-in rate rather than with MAU. Set explicit `tracesSampleRate` and per-project quotas.
- **Sensitivity:** Re-run the model at 1×, 5×, and 10× volume with current Postgres, Firestore, Cloud Run job, and Sentry pricing before Phase 2 ships. If Firestore write cost becomes material, the first optimization is storing one document per ingest batch, with rollups computed by the daily job. This trades simpler per-event erasure for about 20× fewer writes.
- **Cost Cap & Kill Switch:** Approved monthly budget recorded in `cost-model.yaml`. Alerts at 80% and 100% come from a Google Cloud Billing budget plus the Sentry quota alert. Response: reduce sampling first, then turn off the `analytics_collection_enabled` kill switch. Consent changes, rights requests, and required accounting keep working.

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
| **Native Release** | iOS Privacy Manifest, App Store Nutrition Labels, ATT verification, Android Data Safety, `AD_ID` removal, in-app deletion; proxy capture showing zero optional traffic before consent and after withdrawal; startup/background/resume behavior | `docs/app-store-review-packet.md` checklist |
| **Store Disclosure Drift** | Every registry consent category maps to a declared App Privacy / Data safety type | `server/__tests__/analytics-disclosures.test.ts` |
| **Load & Failure** | 20-event batches at forecast peak on Postgres and Firestore (emulator plus a staging run); DB/provider outage isolation (travel actions still succeed); queue caps and backoff; replica restart with daily-job leases; client `track()` p95 on reference devices | `app/e2e/performance.test.ts` (extend), `scripts/analytics-load.mjs` |

---

## Rollout and Completion Criteria

1. Merge schemas, privacy controls, and permission-aware Sentry init with collection flags **off**.
2. Deploy consolidated policy pages (`docs/legal/privacy-policy.md`, `privacy.html`, `privacyPolicyHtml.ts`, `cookies.html`, `privacy-choices.html`, `delete-account.html`).
3. Update App Store and Google Play disclosures (privacy manifest, App Privacy labels, Data safety, Delete account URL) with the first mobile build that **contains** the collection code, even though collection is still flagged off server-side. Store disclosures cover what a build can collect, not just what a flag currently enables.
4. Enable `analytics_collection_enabled` for a consenting canary cohort, then scale gradually.
5. Monitor ingest failure rates, consent enforcement, report freshness, and cost budgets.

The kill switch stops optional producers, ingest admission, and client SDK export. Preference changes, erasure, export, retention jobs, and required accounting keep working. Rollback never drops ledger records or recreates withdrawn or deleted data.

**Done When:** All 5 dashboards are live and trusted; privacy controls are verified across web, iOS, and Android; canonical privacy notices are published across all endpoints; rights and retention jobs are operational; store submission requirements are fulfilled; and test coverage and performance budget evidence is verified.

---

## Phase 0 Decisions (Recorded October 8, 2026)

Ten product choices have been recorded for implementation planning. They are provisional where legal identity, jurisdiction, consent, vendor terms, retention or budget require evidence. The [Phase 0 audit](../analytics-phase-0.md#recorded-decisions-and-sign-off-state) distinguishes verified facts from pending approvals. No recorded choice alone authorizes optional production collection.

| # | Decision | Choice | Rationale | Follow-up |
|---|---|---|---|---|
| 1 | Controller/operator and privacy contact | Operator **Tristan Duerk** until Duerk Industries is formally registered, then the company. Single contact **`support@wander-bunnies.com`**, the role address already published on the support, terms and DSA pages (confirmed 2026-10-08; no separate privacy@ mailbox). | A role address survives changes in ownership and staffing, and reusing the published one avoids a second mailbox. | Send/receive test. Replace both personal addresses on every policy page and store listing. Six public pages name Bryan as operator; the Terms change alters the contracting party and needs review before publishing (see the [Phase 0 gates](../analytics-phase-0.md#recorded-decisions-and-sign-off-state)). |
| 2 | Jurisdictions, representatives, DPO | **EU/EEA and UK are treated as targeted markets for planning.** Representative and DPO applicability remain open legal findings. | The existing notice already targets EU users (GDPR sections, withdrawal form, DSA page). Analytics is designed as first-party opt-in; the scale and core-activity/DPO conclusions require documented legal review. | Art. 27 requires a representative for a non-EU/UK controller targeting those markets unless processing is occasional and low-risk. Record the exemption reasoning in the ROPA. **Complete the Article 27 and UK representative analysis before launch; 1,000 accounts is not a statutory safe harbor.** The privacy policy must not claim a representative exists. |
| 3 | Retention | Proposed schedule pending purpose-by-purpose approval. **Consent evidence:** account lifetime + 3 years as a review candidate. **Billing records:** 7 years (tax/accounting). **Cost ledger:** user/trip linkage removed after 13 months, keeping feature/provider totals. | Consent records only need to prove past consent, and the user link in cost data is only needed while per-user analysis is useful. | Implement in the Phase 4 purge jobs; publish only after the jobs are tested. **Done 2026-10-08:** 30-day lifecycle rule on the production AI capture bucket. |
| 4 | Shared-cost allocation | Direct costs → initiating user and trip. Shared infrastructure → **equal split across accounts active that month**, with a **request-volume split** shown alongside for comparison. | Simple, explainable, hard to game. Add complexity only if the two views diverge materially. | Version the rule as `allocation_v1` in `provider_cost_ledger` reports. |
| 5 | Trip timezone fallback | Add an optional `timezone` (IANA) field to trips, filled automatically from the destination/first lodging via cached Google Places details. Fallback order: segment timezone → trip timezone → **device timezone reported on the event** → `unknown`. | Trips have no timezone today. A traveler's device usually switches to local time, so it is a reasonable proxy. | Schema change in both adapters plus migration; classification in `server/src/utils/tripPhase.ts`. Reports show the share of events classified by each fallback level. |
| 6 | Reference devices and load baseline | Devices: **mid-range Android** (Pixel 6a or Galaxy A-series), **iPhone 12**, **mobile Safari**, **desktop Chrome**. Load: busiest hour of the last 30 days from Cloud Run request logs, tested at **10×** with modeled analytics batches added. | Flagship phones hide main-thread costs, and the real peak grounds the targets. | Phase 0 Cloud Monitoring baseline: 4,061 requests in the busiest UTC hour of the 30-day interval ending October 8, 2026; target 40,610/hour plus modeled analytics traffic. See the [load baseline](../analytics-phase-0.md#load-baseline). |
| 7 | Consent re-prompt triggers | Re-ask **only on a material change**: a new purpose, a new data category, or a new recipient category (e.g. adding a third-party analytics vendor). Wording edits never re-prompt. A refusal is **never re-asked** unless such a change occurs. No periodic re-prompt. | Repeated prompts after refusal are a common enforcement finding. | `notice_version` bumps only for material changes, with a changelog entry stating why. |
| 8 | Processor deletion | **Sentry proposal:** send only a diagnostic pseudonym (never user ID or email) and configure 30-day retention. Publish an expiry claim only after vendor settings and deletion capabilities are verified. **AI providers:** confirm API retention terms, use zero-retention options where eligible, and never put user identifiers in prompts. | The provider deletion capability and data linkage need verification. Short retention and pseudonyms reduce risk but do not automatically satisfy an erasure request. | Set the Sentry project retention, and verify scrubbing in a staging event. Record each AI provider's retention term in the subprocessor list. |
| 9 | BigQuery | **Not now.** Start with the five admin views plus a scheduled CSV export of suppressed aggregate rollups to Cloud Storage. | Avoids another data store, transfer path, and permission surface. | Revisit when analysts need custom SQL more than about weekly, or admin queries miss the 2 s p95 budget. |
| 10 | Age gate on all sign-in paths | **Implemented** (see below). | Accounts created through Google/Apple sign-in, and any registration without a date of birth, had no age check, which contradicted the 16+ policy. | Enable `age_gate_enforcement` once app builds with the prompt are the supported minimum. |

### Decision 10 implementation: account age verification

Finding: `validateRegistrationAge` accepted a missing date of birth as "pending", **no client ever sent one**, and the Google (`findOrCreateGoogleUser`) and Apple (`findOrCreateAppleUser`) sign-in paths never called it. So in practice **no sign-up path verified 16+**.

What was built:

| Layer | Change |
|---|---|
| DB | `hasUserDateOfBirth` and `setUserDateOfBirth` in `db.postgres.ts` and `db.firebase.ts` (memory adapter inherits), exposed through `db.ts`. A declared date is written once and never overwritten. |
| Service | `server/src/services/ageVerificationService.ts`: `isAgeVerificationRequired` (positive results cached in-process, bounded at 50k users, so verified users cost no extra queries), `declareDateOfBirth` (an under-16 declaration is **not stored**, for data minimization), and `isAgeGateEnforced`. |
| API | `GET /api/account/age-verification` → `{ required, enforced, minimumAge }`. `POST /api/account/age-verification` `{ dateOfBirth }` → 200, 400 `INVALID_DATE_OF_BIRTH`, or 403 `UNDER_MINIMUM_AGE`. |
| Enforcement | `authenticate` in `server/src/auth.ts` returns 403 `AGE_VERIFICATION_REQUIRED` for unverified accounts when the **`age_gate_enforcement`** flag is on. Allowlisted: age-verification status/declaration, password setup, data export, and account deletion. The flag is **default off and fail-closed**, so app builds from before the prompt are not locked out. |
| Client | `app/components/AgeVerificationDialog.tsx`, shown after sign-in (web, iOS, Android) for any account not yet verified, unless the iOS shortcut below verifies it first. It is a neutral age screen that doesn't reveal the threshold before entry and can't be dismissed. An under-16 result offers **Delete my account** or **Sign out**. Trip data loads only after verification. |
| iOS shortcut (Apple Declared Age Range) | On iOS 26+, before showing the prompt, `app/utils/appleAgeRange.ts` asks Apple, through `expo-age-range` with a single age gate at 16, whether the Apple Account is 16+. If Apple confirms, the client calls `POST /api/account/age-verification/apple` `{ lowerBound }`. The server stores only `age_verification_source = 'apple_declared_age_range'` plus `age_verified_at`, with **no birthdate**, and the prompt is skipped. A decline, under 16, "not available", older iOS, Android, web, a build without the entitlement, or any error falls back to the date-of-birth prompt. A lower bound under 16, missing, or not an integer gets 400 `AGE_RANGE_NOT_CONFIRMED`, which also falls back. |
| Verification record | New `users.age_verification_source` (`self_declared_dob` or `apple_declared_age_range`) and `age_verified_at` columns (migration `20261008_add_age_verification_source.sql`; Firebase fields `ageVerificationSource` / `ageVerifiedAt`). The first verification is never overwritten. The gate treats either a date of birth or a source as verified. |
| Tests | `server/__tests__/age-verification.test.ts` (17 cases: status, invalid/future dates, 16th-birthday boundary, under-age not stored, Apple bounds 16/18/21 accepted without a birthdate, under-16/missing/non-integer/string rejected, enforcement on/off, allowlist, self-deletion), `app/tests/AgeVerificationDialog.test.tsx`, and `app/tests/appleAgeRange.test.ts` (never calls Apple on web, Android, iOS < 26, or without the entitlement flag; decline, below-minimum, and unavailable fall back; server rejection falls back). |

**Apple shortcut setup and caveats:**
- **Enable per build:**
  1. Turn on the **Declared Age Range** capability on the App ID in the Apple Developer portal. Capability auto-sync is disabled for this app (`EXPO_NO_CAPABILITY_SYNC`), so this is manual.
  2. Set `APPLE_DECLARED_AGE_RANGE_ENABLED=1` for the EAS build. That adds the `com.apple.developer.declared-age-range` entitlement and `extra.appleDeclaredAgeRangeEnabled`.

  Without both, the app always uses the prompt.
- **Xcode 26:** `expo-age-range` imports Apple's `DeclaredAgeRange` framework, so iOS builds must use an Xcode 26+ EAS image. Confirm the image before the next iOS build.
- **Alpha package:** `expo-age-range` 0.2.x is marked alpha by Expo. Re-check its API on each Expo SDK upgrade, and test on a physical device signed in to an Apple Account (simulators are unreliable).
- **iOS < 26 must stay guarded:** on iOS < 26 and web, `expo-age-range` returns `lowerBound: 18` without asking anyone. The wrapper's iOS 26+ check prevents that from verifying users, and a test covers it.
- **Android excluded:** the package is excluded from Android autolinking (`expo.autolinking.android.exclude` in both `package.json` files), so Google Play Age Signals is not bundled. Android uses the prompt.
- **Same trust level as the prompt:** Apple provides no server-verifiable attestation for the range, so this is a client assertion, like a typed date of birth. The difference is that the age comes from the Apple Account (self- or guardian-declared, and sometimes confirmed by Apple).
- **Disclosures:** the privacy policy should say that on iOS, age may be confirmed through Apple's age-range feature, and that only the fact "16+ confirmed via Apple" is stored. The App Privacy answers are unchanged, since no birthdate or range is collected.

Rollout:
1. Ship the server and the client prompt with the flag off. Existing and new users are prompted on their next sign-in.
2. Once the minimum supported native build includes the prompt, turn on `age_gate_enforcement`.
3. Then tighten registration to require `dateOfBirth`, adding the field to the registration form.

Known limits:
- Self-declared age gates can be circumvented by entering a false date. This matches common practice and the policy's "we do not knowingly" standard.
- Under-age accounts that neither delete nor sign out stay blocked once enforcement is on. A scheduled purge of accounts that stay unverified (e.g. 30 days after enforcement) is a follow-up.

Apple's guidelines forbid *forcing* extra account-creation steps after Sign in with Apple (this exact issue caused a past rejection over password setup). Collecting a date of birth for a legal age requirement is a different case, but explain it in the App Review notes.
