# Analytics Upgrade Implementation Plan

Status: proposed; documentation only.
Created: October 8, 2026.
Design and collection inventory: [Analytics Upgrade: Collection, Goals, and Behavior](../analytics-upgrade.md).

## Outcome and delivery rules

Deliver reliable reporting for feature use, cost per user/trip, technical and task performance, native versus web use, and engagement during scheduled trips. Privacy controls, rights handling, and matching public disclosures (policy pages and app-store labels) must ship **before** any optional collection starts.

This plan provides compliance capabilities and release evidence; it does not certify GDPR or app-store compliance. The privacy owner resolves jurisdiction, controller, lawful-basis, processor-contract, and retention questions against the actual deployment. Recheck official rules before release, because they change.

Repository rules that apply throughout:

- Strict TypeScript, shared types in `server/src/types.ts`, Zod validation of all client input.
- All storage goes through the `server/src/db.ts` facade, implemented in `db.postgres.ts` **and** `db.firebase.ts` together, with the memory adapter supporting tests. Postgres migrations go in `server/migrations/` with matching `.rollback.sql` files.
- Env access only via `getEnvValue` / `getEnvFlag`; logging only via `logInfo` / `logError`.
- Preserve existing quota accounting, entitlement behavior, and the `/api/flights` alias.
- No vendor selection, service provisioning, store submission, or new paid SDK is authorized by this document. Initial delivery uses existing infrastructure.

## Findings that affect implementation

1. `usage_events` and AI accounting are a useful base but do not cover every provider attempt or any user behavior. The same AI operation must not be counted in both the old accounting and a new ledger.
2. `recordTiming` in `server/src/metrics.ts` calls `emit`, which is a no-op, so **no latency data is retained today**. Counters are keyed by name and drop labels, and the instance label may be a revision shared by replicas. Fix these before claiming percentile or per-instance reporting.
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

## Architecture and storage

Three processing paths, kept separate in code, storage, access, and policy text:

| Path | Purpose | Reliability and privacy rule |
|---|---|---|
| Optional behavioral events | Views, tasks, engagement, funnels | Fail **closed** on unknown consent; collection failure never breaks a travel action |
| Operational/accounting records | Service delivery, quotas, security, cost metering | Preserve existing accounting; documented basis; never repurposed as behavioral tracking |
| Optional detailed diagnostics | User-linked client crash/performance/session details | Permission-aware SDK initialization and scrubbing; necessary aggregate reliability stays narrowly scoped |

Proposed tables/collections (Postgres table name = Firestore collection name):

| Store | Contents | Notes |
|---|---|---|
| `privacy_preferences` | One row per user: `product_analytics`, `optional_diagnostics`, `revision`, `epoch`, `notice_version`, timestamps | Necessary processing is described in the UI and not stored as a flag |
| `privacy_choice_events` | Append-only consent/withdrawal evidence: choice, notice version, platform, timestamp | No behavioral payload, IP address, or device identifier |
| `analytics_subjects` | Random per-account pseudonym ↔ user mapping, epoch | Restricted access. Never an email hash. Rotated on withdrawal/regrant. |
| `analytics_events` | Validated immutable envelopes plus allowlisted properties; idempotent on `event_id` | Indexed by time/subject/event/feature. Postgres: one row per event. Firebase: one document per **batch** (see cost below), with TTL. |
| `analytics_eligible_daily` | Minimal consented eligible user/trip/feature facts used as denominators | Personal data; deletable |
| `provider_cost_ledger` | Unique provider attempt, units, price version, user/trip/feature attribution, outcome, reconciliation state | Necessary operational data; restricted access |
| `analytics_daily_facts` / `analytics_rollups` | Bounded query shapes, definition and aggregation version | User/trip facts are personal. Only assessed anonymous aggregates get longer retention. |
| `analytics_job_runs` | Durable cursor, lease, version, freshness, counts, errors | No raw payloads |

Design rules:

- Use named columns for frequent dimensions (`event_name`, `feature`, `platform`, `trip_phase`, `occurred_at`) and bounded JSONB/maps for rare properties. Design Postgres indexes and Firestore composite indexes from the **same supported admin queries**.
- Interactive Firebase reports never scan raw events; they read precomputed rollups.
- Never use per-user or per-operation identifiers as metric labels.
- Daily jobs use durable leases/cursors and idempotent upserts so they are safe with multiple Cloud Run replicas. Retries replace a period rather than adding to it. Late events use a documented watermark (proposed: 48 h) with bounded recomputation. Expose partial coverage when data has expired.
- pg-mem constraints (from existing tests): avoid `NOT EXISTS`, `ANY($1::uuid[])`, `ON CONFLICT DO NOTHING` with `INSERT…SELECT`, and `IS NOT NULL` across joins in queries the memory adapter must run.

## Phase 0: Inventory, definitions and privacy decisions

Owners: product lead, backend lead, privacy owner.

- Verify the production DB provider, Sentry/capture settings, volumes, SDK network traffic, vendor contracts, data regions, and retention. Record facts without copying secrets.
- Inventory every outbound provider path (AI registry and direct callers, Places/maps, Unsplash, email, weather, imports, Plaid, background jobs) and mark whether each is attributable, priced, and covers billable failures.
- Approve the event/metric dictionary: eligibility, consent population, session rule, trip timezone fallback, outcome semantics, allowed dimensions.
- Maintain a **record of processing activities** (purpose, data, basis, recipients, retention, rights, transfers). Run DPIA screening and complete a DPIA if the high-risk criteria apply.
- Document necessary metering/security purposes and any legitimate-interests assessment. Broad feature tracking is not "necessary" just because it helps the business.
- Resolve the Finding 6 conflicts (legal controller/operator, contact address, minimum age), territorial reach, EU/UK representative and DPO applicability, and legal retention schedules. A policy that says "not applicable" does not count as the assessment.
- Approve global default-off for optional analytics and diagnostics with separate controls. If a regional analytics exemption is used later, document its exact conditions as a reviewed exception.

**Acceptance:** signed-off dictionary, deployment inventory, coverage map, processing register, retention proposal, policy gap list. Optional collection stays off.

## Phase 1: Privacy settings and enforcement

Owners: frontend/backend leads, privacy owner. Depends on Phase 0.

**Server**

- `GET` / `PATCH /api/account/privacy-preferences` in `accountRoutes.ts`: authenticated owner only, optimistic `revision` check, server timestamps, append to `privacy_choice_events`. No admin can grant consent on a user's behalf.
- `server/src/services/privacyConsentService.ts`: `getConsent(userId)` and `assertAnalyticsAllowed(userId, epoch)`, with a short TTL cache that is invalidated on `PATCH`.
- Feature flags in `server/config/feature-flags.yaml`: `analytics_collection_enabled` (kill switch) and `diagnostics_user_linked_enabled`, both **default disabled and fail-closed**. These must not inherit entitlement fail-open behavior. When disabled, consent updates, export, and deletion must still work.
- Review `server/src/instrument.ts`: `sendDefaultPii: false`; strip `user.ip_address`, cookies, auth headers, request bodies, and query strings in `beforeSend`/`beforeSendTransaction`. Necessary server error monitoring does not depend on the user's optional choice.

**Client**

- New `app/utils/privacyConsent.ts` (state machine: unknown/off, granted, withdrawn, obsolete-notice) and `app/hooks/usePrivacyConsent.ts`. Fetch on bootstrap and on foreground. Keep a minimal UI cache, but the server stays authoritative and a stale "allow" cache never admits events after withdrawal.
- First-run consent sheet with equal-weight **Accept** / **Reject** / **Customize**. Show it once after login, not before the user can use the app. No nagging after refusal.
- **Account → Privacy** section in `app/tabs/account.tsx` / `AccountProfileManagement.tsx`: two switches, a necessary-processing explanation, and links to export, delete analytics data, delete account, privacy policy, cookie notice, and privacy choices. testIDs follow `privacy-{action}`.
- Web: honor `navigator.globalPrivacyControl` as a refusal unless the user later opts in explicitly in the UI.
- **Sentry redesign** (`app/utils/sentry.ts`, `app/AppEntry.js`). Start in a minimal necessary mode: crash capture only, `enableAutoSessionTracking: false`, no breadcrumbs from network/console/navigation, no traces, no user ID, `sendDefaultPii: false`. Enable session tracking, traces, and the user ID only after `optional_diagnostics` is granted. On withdrawal, call `Sentry.close()` (or re-init in minimal mode) and drop pending events. Audit native auto-start in the `@sentry/react-native/expo` plugin; do not assume a JS flag stops native collection.
- Regrant starts a new epoch, and events from an old epoch are rejected. Login, reinstall, or a new device never turns missing permission into acceptance.

**Acceptance:** network and storage evidence (web DevTools, iOS/Android proxy capture) shows zero optional data before permission and after withdrawal, including error paths, account switches, and stale devices. Core trip, quota, and billing regression suites pass.

## Phase 2: Event pipeline and initial feature instrumentation

Owners: frontend/backend leads. Depends on Phase 1 and the Phase 4 policy pages being drafted.

- **Registry:** `server/src/analytics/eventRegistry.ts` exports the Zod schemas and metadata (purpose, owner, consent category, retention, sampling). It is mirrored in `app/utils/analytics/eventRegistry.ts` with a CI drift check, following the same convention as `coveredBy.ts` and `itineraryStatus.ts`.
- **Client utility:** `app/utils/analytics/track.ts` plus `useTrackView(feature)`. This is a cross-cutting utility, not a centralized business API layer. Tab files keep their own fetch helpers.
- **Instrumentation:** routing and trip selection in `app/App.tsx`, then trip overview, itinerary, activities, lodging, transfers, expenses, packing, imports, and collaboration. Guard against duplicate render/effect events in React 19 Strict Mode.
- **Ingest:** `POST /api/analytics/events` mounted in `app.ts` (new `analyticsRoutes.ts`), authenticated users only. Anonymous/acquisition tracking is deferred to a separate design.
- **Validation:** batch size, schema versions, event names, property types and lengths, timestamp bounds (±24 h skew). The server derives subject and consent from auth, verifies trip access, normalizes platform claims, and rejects spoofed identity fields.
- **Limits:** 20 events per batch, 32 KiB payload, flush every 30 s while active and on background/`visibilitychange` (`navigator.sendBeacon` on web), max 100 queued events, 24 h expiry. Bounded exponential backoff and deduplication. The response returns accepted/rejected counts. No retries on a consent denial (HTTP 403 with code `ANALYTICS_CONSENT_REQUIRED`).
- **Queue:** in-memory only at first. A durable offline queue requires encrypted storage, expiry, a withdrawal purge, and a cookie/storage notice update first. Lost offline events are reported as a coverage limitation.
- **Server outcomes:** emitted after the business transaction commits, via fire-and-forget `recordServerEvent()`. Analytics failure never rolls back the business action.
- **Trip phase:** `server/src/utils/tripPhase.ts` (pure function with date/timezone version), so mutable current dates never silently rewrite history.
- **Exclusions:** sessions use bounded foreground intervals and never API polls. Admins, E2E/automation users, prefetch, and background workers are marked for exclusion.

**Acceptance:** golden fixture journeys produce the expected deduplicated events and phase classifications, with no prohibited properties. Consent-denied journeys produce no optional events.

## Phase 3: Cost attribution and performance

Owners: backend lead, finance/operations owner. Depends on Phase 0; user-linked diagnostics also need Phase 1.

- Route all cost recording through one trusted `settleProviderAttempt()` API that records attempt ID, provider/model/caller, feature, initiating user, trip, units, cache status, failure/retry state, and price version. Budget/quota reservations stay separate from settled cost.
- Audit `openaiApi.ts` and `aiProviderRegistry.ts` accounting to prevent double settlement and keep compatibility. Add a uniqueness constraint on attempt ID and durable recovery. Report settlement failures instead of silently understating spend.
- Calls without a user are recorded as `system`/`unattributed`. Shared-trip and background costs are classified once under an explicit allocation rule. Adjustments are stored as new rows rather than overwriting estimates.
- Test units against invoices and rate config, including cached-token pricing and non-token request units. Unknown rates or usage are marked `unknown`. Forecast, avoided cost, and billed cost stay distinct.
- Allocation v1 (e.g. monthly shared infrastructure ÷ active service accounts), with alternatives and sensitivity shown; finance approves it. Operational activity used for allocation is not consented product engagement.
- Monthly invoice reconciliation covering credits, refunds, committed spend, and currency metadata. Publish direct-cost coverage and unexplained variance.
- **Fix `metrics.ts`:** retain timings as fixed-bucket histograms with low-cardinality labels, export them on `/metrics`, add a unique process identity (`K_REVISION` plus a random instance ID), and expose `countersStartedAt` so counter resets are not mistaken for falling activity.
- Screen/trip readiness spans and task outcomes under the appropriate consent category. Use the browser Performance API on web and native startup/frame measurements where supported. Do not claim native p95 without measurements.
- Correlate request/job IDs across logs and spans without broadly exporting raw account/trip IDs. Keep `/metrics` free of sensitive or unbounded labels.
- Fix the AI aggregation job to read the configured capture backend (GCS in production) with durable cursors and leases, so replicas do not repeat expensive reads.

**Acceptance:** synthetic successful/failed/retried/cached calls reconcile exactly, and dashboards distinguish unknown, estimated, and billed costs. Performance data is retained, bounded, and labeled with its sampling.

## Phase 4: Rights, retention and policy delivery

Owners: backend lead, privacy owner. Depends on the new schemas and consent enforcement.

### Rights handling

- Bump `EXPORT_SCHEMA_VERSION` to 2 in `userDataExport.ts` and add `privacy` (current preferences and choice history), `analytics` (the user's events, daily facts, pseudonym), `costs` (attributed ledger rows), and `diagnostics` (AI capture metadata where linked). Use machine-readable JSON with pagination or async delivery for large accounts and expiring download links. Never include other travelers' personal data.
- Map access, correction, erasure, restriction, objection, and portability to actual stores. Portability has a narrower legal scope than access.
- New `DELETE /api/account/analytics-data` ("Delete my analytics data"), separate from withdrawal. Withdrawal stops future processing; deletion erases history (subject to documented exceptions).
- Extend account deletion to pseudonym mappings, trip-linked analytics, raw events, user/trip facts, captures, nested JSON identities, Sentry user data (via the Sentry API / data-scrubbing request), and relevant logs. Verify Postgres and Firebase independently.
- Keep only genuinely necessary billing, security, and consent evidence under documented exceptions, access controls, and schedules. Keeping collaboration content does not justify keeping analytics linkage.
- Suppress or rebuild attributable rollups after erasure. Keep aggregates only after a re-identification assessment. A minimum cohort of 10 is a guardrail, not proof of anonymity. Block filter-differencing in drill-downs and exports.
- Durable deletion jobs with retries, tombstones, provider confirmation, and status. Event ingestion, settlement, and rollup replay check tombstones so deleted or restricted subjects are not recreated.
- Backups expire on a documented cycle, and a restore reapplies tombstones before serving data. Logs, object storage, and vendor data need lifecycle configuration, not only SQL cascades.
- Track rights deadlines with proportionate identity verification. GDPR generally requires a response within one month (extendable with notice); CCPA/CPRA within 45 days. [European Commission rights guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en)

### Retention (proposed; approve against actual purposes and provider capabilities)

| Data | Proposed limit | Enforcement |
|---|---|---|
| Client optional queue | 24 h, or withdrawal/logout | Client expiry and purge |
| Raw behavioral events | 90 days | Postgres: daily batched delete job. Firestore: TTL policy on `expires_at`. |
| Linked daily user/trip facts | 13 months | Scheduled purge plus subject erasure |
| Consent choice evidence | Account lifetime + 3 years (to prove past consent) | Restricted store; no behavioral payload |
| Minimized diagnostic logs/traces | 30 days | Cloud Logging bucket retention, Sentry project retention, local rotation |
| AI captures | ≤ 30 days for diagnostics, shorter where restricted-data terms require | GCS lifecycle rule plus subject deletion |
| Assessed anonymous aggregates | 25 months, then review/purge | Aggregate lifecycle and disclosure review |
| Cost ledger, billing | Tax/accounting schedule approved in Phase 0 | Separate restricted store; documented legal holds |

Publish only schedules that have been configured and tested.

### Privacy policy and web page deliverables

Policy updates are a **release dependency**, not a follow-up. Pick one canonical source and generate the rest from it.

**Step 1: consolidate.** Make `docs/legal/privacy-policy.md` the single canonical source once the Finding 6 conflicts are resolved. Add a small build script (`scripts/build-legal-pages.mjs`) that renders it into `app/public/privacy.html` and `server/src/legal/privacyPolicyHtml.ts`, plus a CI check that fails if the generated outputs drift. Alternatively, `/privacy` can redirect (301) to `/privacy.html`.

**Step 2: per-surface changes.**

| Surface | Required change and verification |
|---|---|
| `docs/legal/privacy-policy.md` (canonical) | Resolve controller/operator, contact, minimum age. Add the sections listed under "Required new or changed notice content" below. Version number, effective date, and change summary at the top. |
| `app/public/privacy.html` | Generated from canonical. Replace generic "optional analytics, advertising, or non-essential cookies — consent where required" with the actual collection, controls, and retention. Keep the Gmail Limited Use and Plaid sections word-for-word unless reviewed. |
| `server/src/legal/privacyPolicyHtml.ts` → `/privacy` | Generated from canonical or redirect. Remove the contradictory embedded text (under-13 statement, "no marketing-analytics SDKs" wording that needs to describe first-party analytics). Test both routes against the production bundle. |
| `app/public/cookies.html` | Add a table row per analytics key (`wb_analytics_consent`, `wb_analytics_session`, queue key if persisted, Sentry storage), each with purpose, duration, necessary/optional, and operator. Add a working "Manage preferences" link. Keep necessary storage listed separately. |
| `app/public/privacy-choices.html` (new) | Public explanation of the two optional controls. Browser-level opt-out for signed-out visitors (stored locally); account-wide settings after sign-in. Links to export, deletion, and contact. Generates no optional analytics itself. Also serves as the "Your Privacy Choices" link for US state laws. |
| `app/public/delete-account.html` (new) | Public deletion-request page naming the app and operator, with identity verification, what is deleted, retained exceptions, and timing. Works without reinstalling the app. **This URL goes in the Play Console Data safety "Delete account URL" field.** |
| `app/tabs/account.tsx`, `AccountProfileManagement.tsx` | Privacy section (Phase 1). Make the legal links point to the canonical routes. Keep in-app deletion with proportional confirmation; normal deletion must not require contacting support. |
| `server/src/app.ts` | Serve `/privacy`, `/privacy.html`, `/cookies.html`, `/privacy-choices`, `/delete-account` with stable aliases. Static pages are matched **before** the SPA fallback so a missing page returns 404 instead of the app shell. |
| Web footer / login screen | Add "Privacy Choices" next to the Privacy and Terms links. |
| `docs/app-store-review-packet.md`, store metadata | Updated App Privacy and Data safety answers, policy/choices/deletion URLs, SDK inventory, and reviewer steps with screenshots of the consent sheet and Privacy settings. |
| `docs/sentry.md`, `docs/admin.md`, `docs/feature-flags.md` | Permission gating, diagnostic sampling/retention, metric definitions, coverage, the new flags, and rollout runbook. |

**Required new or changed notice content:**

1. **What we collect for analytics**: feature views, task outcomes, session timing, platform/app version/browser family, and trip phase (before/during/after, from trip dates, not location). State that it is linked to a pseudonymous account ID and that this is still personal data.
2. **Diagnostics**: necessary crash reporting versus optional detailed diagnostics (user-linked sessions/performance), with the provider (Sentry), region, and retention.
3. **Cost metering**: per-user/trip AI and API usage recorded to run quotas and manage costs, on a necessary/legitimate-interests basis that does not depend on the analytics toggle.
4. **Legal basis table**: consent for optional analytics/diagnostics; contract/legitimate interests for security, quotas, and cost metering; legal obligation for billing records.
5. **Your choices**: how to opt in, opt out, and withdraw (Account → Privacy, Privacy Choices page). Refusing does not affect features. GPC/DNT are honored as refusal.
6. **Retention**: the approved schedule from the table above, in plain language.
7. **Recipients and transfers**: Google Cloud/Firebase (hosting/storage), Sentry, AI providers. Transfer mechanism (adequacy / EU-US Data Privacy Framework / SCCs) per provider, with a link to the subprocessor list.
8. **Rights**: access, correction, deletion, restriction, objection, portability, withdrawal, complaint to a supervisory authority, US-state appeal process, response timelines, and how to submit (in-app, web page, email).
9. **What we do not do**: no sale or sharing for cross-context behavioral advertising, no advertising IDs, no fingerprinting, no session replay, no GPS, no use of Gmail/Plaid content for analytics.
10. **Device identifiers**: push notification tokens (purpose, encryption, deletion on logout/account deletion).
11. **Children**: a single consistent minimum age matching the registration age gate, and no analytics profiling of minors or non-account companions.
12. **Changes**: material changes to analytics purposes trigger an in-app notice and a new consent request (the notice-version bump moves users to the obsolete-notice state).

Do not promise anonymity, universal deletion, or vendor behavior the implementation cannot demonstrate.

Publish a purpose/data/recipient matrix and sign processor agreements (DPAs) with each provider. Verify subprocessor notifications and transfer mechanisms; naming SCCs in a policy is not the assessment. [European Commission transfer guidance](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)

## Regulatory and mobile release requirements

### GDPR, UK GDPR, ePrivacy/PECR

- Purpose limitation, minimization, retention limits, and accountable access controls throughout.
- Consent must be freely given, specific, informed, and unambiguous. Record evidence and make withdrawal as easy as giving consent. Core features never depend on optional tracking. [EDPB consent guidelines](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en)
- ePrivacy Art. 5(3) and UK PECR reg. 6 apply to **any** storage or access on the device, so `localStorage` and native SDK storage are not exempt because they are not cookies. Analytics storage is set only after consent. [ICO storage/access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)
- This plan chooses opt-in globally, even where a reviewed statistical exemption (e.g. the UK DUA Act 2025 analytics exception, CNIL audience-measurement exemption) might allow otherwise. Any later use of an exemption is a documented, reviewed exception.
- Article 30 record, DPIA screening, Article 27 representative and DPO applicability, and breach-response process (72 h notification).

### US state privacy laws (CCPA/CPRA and similar)

- Support access, correction, deletion, appeal, and non-discrimination. Honor GPC as a recognized opt-out signal.
- This design includes no sale or targeted advertising. Do not mislabel necessary service-provider processing as a sale, and do not describe every analytics toggle as a statutory "Do Not Sell or Share" opt-out. Link "Your Privacy Choices" to `privacy-choices.html`. [California AG CCPA guidance](https://oag.ca.gov/privacy/ccpa)
- Maintain an applicability matrix covering EU/EEA, UK, the relevant US states, Canada (PIPEDA/Quebec Law 25), and any launch markets.

### Restricted data sources

Gmail (Google API Limited Use) and Plaid terms apply independently. Consent to product analytics never authorizes reuse of their content, so no content-derived properties go into events.

### iOS / App Store

| Requirement | Action |
|---|---|
| App Privacy labels (App Store Connect) | Declare **Product Interaction** (analytics, linked to user), **User ID** (app functionality and analytics, linked), **Device ID** (push token, app functionality), **Crash Data** and **Performance Data** (app functionality, plus analytics when optional diagnostics are on), and **Other Diagnostic Data** as applicable. Optional collection must still be declared. "Used for tracking" is **No**. [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/) |
| App Tracking Transparency | Not required. Nothing links data with other companies' data for advertising or shares it with brokers, and no IDFA is accessed. Confirm by SDK network inspection. If tracking is ever introduced, it requires both ATT and legal consent, and ATT is not GDPR consent. [Apple user privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/) |
| Privacy manifest | Add `ios.privacyManifests` in `expo.config.shared.cjs` declaring `NSPrivacyCollectedDataTypes` (matching the labels), `NSPrivacyTracking: false`, and required-reason APIs (`NSPrivacyAccessedAPICategoryUserDefaults` CA92.1, file timestamp, system boot time, disk space as reported). Validate with the Xcode **Privacy Report** on the archived EAS build, not just the JS config. [Apple third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/) |
| Account deletion (5.1.1(v)) | In-app initiation of full deletion including analytics; no deactivation-only or support-only flow. [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) |
| Policy URLs | Privacy policy URL and (optional) privacy choices URL in App Store Connect, both live before submission. |

### Android / Google Play

| Requirement | Action |
|---|---|
| Data safety form | Declare **App activity → App interactions** (analytics, optional), **Device or other IDs** (push token, app functionality), **App info and performance → Crash logs, Diagnostics** (necessary crash reporting plus optional detail), **Personal info → User IDs**. Data is encrypted in transit and users can request deletion. Include SDK collection and check any service-provider exceptions against Google's definitions. [Google Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) |
| Advertising ID | Add `com.google.android.gms.permission.AD_ID` to `android.blockedPermissions` in `expo.config.shared.cjs` and answer "No" to the advertising ID declaration. Verify the final merged manifest from the EAS build. |
| User Data policy | Prominent in-app disclosure and consent before optional collection (the consent sheet satisfies this if it appears before any collection). Accurate, accessible policy link in-app and on the store listing. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en) |
| Account deletion | In-app deletion **plus** a public web URL (`delete-account.html`) entered in Play Console. Disclose retained-data exceptions. [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) |

Store labels, manifests, and policy pages complement each other, and none of them replaces real permission enforcement or rights processing.

## Phase 5: Reporting, ease of analysis and access

Owners: product/backend/frontend leads. Depends on the privacy/rights gates and validated collection.

- Add an **Analytics** section to `AdminTab` with five aggregate views: feature adoption, cost, reliability, platform mix, trip-phase engagement. Reuse existing admin components and RBAC, with bounded, paginated endpoints under `/api/admin/analytics/*`.
- Every view shows definition, units, window/timezone, eligible versus consenting population, numerator/denominator, sampling, freshness, and unknowns. Consent-biased samples are never labeled "all users".
- Metric calculations live in one versioned module (`server/src/analytics/metrics/`) that both the API and the CSV export use, so the two cannot disagree. CSV exports include definition/version metadata and the same suppression as the UI.
- Least privilege: aggregate product views by default; cost/user investigation restricted and audited in `audit_log`; no public behavioral reports or email joins.
- Percentiles come from histograms or raw permitted measures, never from averaged p95s. Validate native and web coverage separately.
- **Ad-hoc analysis path:** a scheduled export of rollups (not raw events) to CSV in GCS, or to BigQuery if Phase 0 approves it. This lets analysts use SQL or spreadsheets without production DB access.
- Activation, collaboration, retention, AI value, and monetization views come only after the first five are trusted.

**Acceptance:** fixture reports match independently calculated expected results, explain exclusions, and enforce small-cohort and export controls.

## Performance, cost and maintainability

### Performance budgets (acceptance targets, not current measurements)

- Analytics disabled: zero optional network requests and zero persistent analytics writes.
- Client: p95 < 2 ms per `track()` call on reference devices; no synchronous network or storage in render paths.
- Product mutations: ≤ 5 ms p95 added synchronous work; persistence runs outside the response path.
- Ingest: p95 < 200 ms per 20-event batch at forecast peak, tested on both Postgres and Firestore.
- Admin reports: p95 < 2 s for 30-day views; no request scans the full event store.
- Daily jobs: freshness within 24 h, alerts on missed runs, dashboards show actual lag.
- Behavior events are unsampled at first. Diagnostics start at a low explicit sample rate. If behavior events are sampled later, document weights and avoid biased funnels and uniques.

### Cost model

Monthly overhead ≈ consenting MAU × sessions/user × events/session, plus batch writes, index writes, rollup reads, retained bytes, job runs, export/deletion, logging, and egress. An illustrative calculation to re-run with Phase 0 numbers and current pricing:

| Input | Assumption |
|---|---|
| Consenting MAU | 1,000 |
| Sessions per user per month | 8 |
| Events per session | 25 |
| **Events per month** | **200,000** (~10,000 batches) |

- **Postgres:** about 0.5 KB per row with indexes, so about 100 MB/month and about 300 MB at 90-day retention. Marginal cost is negligible on the existing instance.
- **Firestore:** one document per event means 200k writes plus index-entry writes. One document per **batch** means about 10k writes, roughly 20× fewer, so store raw events per batch and compute rollups in the daily job. Disable indexing on the `events` array field, and use TTL deletes (which are free of write charges, but verify current pricing).
- **Daily job:** one Cloud Run job execution per day reading one day of batches.
- **Sentry:** user-linked sessions and traces only for consenting users, with explicit sample rates. Monitor quota.

Re-run at 1×, 5×, and 10× expected volume. The operations owner sets a monthly dollar cap with alerts at 80% and 100%. When over budget, reduce optional detail or sampling, or turn off optional collection with the kill switch, while keeping privacy choices and required accounting working. Never log individual events or copy payloads into error output.

### Maintainability

- One registry, one calculation layer, shared constants, adapter contract tests, and named owners per event family.
- No auto-capture. Each new event is reviewed for the product question it answers, its schema, permission category, retention, expected volume, and any policy/store-label impact (a PR checklist item in the registry file header).
- CI checks for registry drift between client and server, for generated legal pages drifting from the canonical source, and for any `track()` call using an event name not in the registry.
- Add infrastructure (warehouse, third-party analytics) only when query or cost evidence shows a need.

## Test coverage and validation

| Layer | Required cases | Suggested files |
|---|---|---|
| Pure utilities | Registry validation; session inactivity/foreground caps; trip phase with timezone, DST, inclusive boundaries, missing dates, concurrent trips; cost arithmetic, units, unknown pricing | `server/__tests__/analytics-registry.test.ts`, `trip-phase.test.ts`, `app/tests/analyticsSession.test.ts` |
| Client (Jest) | Zero collection before permission; equal reject path; reload and account switch; consent sync errors; stale epoch/regrant; withdrawal during flush; bounded queue and offline expiry; duplicate renders; Sentry minimal mode and shutdown | `app/tests/privacyConsent.test.ts`, `analyticsTrack.test.ts`, extend `sentry.test.ts`, `AccountProfileManagement.test.tsx` |
| API (Supertest) | Auth; user/trip spoofing; invalid schema and oversized batches; deduplication; denied/withdrawn consent; stale revisions; flags off or missing (fail-closed); deletion races; rate limits | `server/__tests__/analytics-ingest.test.ts`, `privacy-preferences.test.ts` |
| Adapter integration | Postgres/Firebase parity; index and query behavior; batch transactions; concurrent ingestion; leases and idempotent jobs; retention purge; nested-data erasure. Memory-adapter tests alone do not prove Firebase behavior. | `analytics-adapter-parity.test.ts`, run with `DB_PROVIDER=memory` and `firebase` |
| Cost | Every provider path; retries, failures, cache, shared and system attribution; reservation versus settlement; double-record protection; known/unknown rates; credits; invoice fixtures | extend `openai-usage-accounting.test.ts`, `usage-tracking.test.ts`; new `provider-cost-ledger.test.ts` |
| Metrics | Histogram retention, label preservation, process identity, Prometheus export | extend `metrics.test.ts` |
| Reports | Golden journeys; zero/nonzero denominators; eligibility history; late events; distinct counts; weighted rates; percentile buckets; consent bias; small-cohort suppression and differencing; CSV/UI parity | `analytics-reports.test.ts`, extend `firebase-admin-analytics.test.ts` |
| Rights | Export completeness and scope (no other travelers); partial-provider deletion and retry; rollup rebuild; retained-exception separation; backup-restore replay; tombstones; captures | extend `accountExport.test.ts`, `accountDelete.test.ts`; new `analytics-erasure.test.ts` |
| Legal pages | Generated pages match canonical; all aliases return 200 (not the SPA shell); required sections present | `server/__tests__/legal-pages.test.ts` |
| Web E2E (Playwright) | Fresh browser accept/reject/customize/withdraw; no optional storage or network before permission (assert on `page.on('request')` and `localStorage`); GPC header honored; public policy, choices, and deletion links work; app usable after refusal | `app/e2e/privacy-consent.test.ts` |
| Native release | iOS/Android proxy and storage inspection; startup/background/resume/withdrawal; Xcode privacy report; merged manifest without AD_ID; deletion without reinstall; store disclosure reconciliation | Manual checklist in `docs/app-store-review-packet.md` |
| Load and failure | Reference devices and both DBs at forecast peak; DB/provider outage; queue limits; timeout/backoff; collector failure isolation; replica/restart behavior; measured monthly cost | Extend `app/e2e/performance.test.ts`; load script in `scripts/` |

Run the existing app and server suites and the affected Playwright flows for every implementation PR. Use the existing logger, usage-accounting, metrics, Sentry, admin, and Firebase analytics tests as regression anchors. Prefer adversarial cases over tests that only restate schemas.

## Rollout and completion criteria

1. Merge reviewed schemas, privacy controls, and the Sentry minimal mode with collection flags **off**.
2. Deploy the consolidated policy pages, privacy choices, deletion page, and verified rights workflows. Prepare matching App Store and Play disclosures **before** the mobile build that contains the consent UI ships.
3. Run synthetic consenting and refusing journeys in staging. No production user data is copied into fixtures.
4. Turn on `analytics_collection_enabled` for an internal/admin canary cohort, then a small percentage, with full coverage indicators. Compare ledger accounting against existing counters without double-counting spend.
5. Monitor ingest failures, consent enforcement, report freshness, latency, and dollar budgets. Expand only after the acceptance evidence passes.

The kill switch stops optional producers, admission, and SDK export. Preference changes, erasure, export, retention jobs, and required accounting keep working. Rollback must not drop ledger records or recreate withdrawn or deleted subject data.

**Done when:** the five dashboards are trusted; privacy controls are tested on all three platforms; one canonical notice is served on all routes; jurisdiction, basis, processor, and transfer decisions are documented; rights and retention jobs work; store submissions match the built apps; adapter parity, regression, and load evidence exist; attribution and consent coverage are measured; and runbooks exist for incidents, cost alerts, SDK upgrades, and definition changes.

**Open decisions for Phase 0:** legal controller/operator, contact, and minimum age; launch jurisdictions and representatives; retention schedules; shared-cost allocation; trip timezone fallback; reference devices and load baseline; consent renewal triggers; processor deletion capabilities; BigQuery/warehouse need. While any of these is open, optional production collection stays disabled.
