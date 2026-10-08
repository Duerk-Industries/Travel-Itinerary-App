# Analytics Upgrade Implementation Plan

Status: proposed; documentation only.
Created and reviewed: October 8, 2026.
Revision: 2. Canonical path: `docs/implementation-plans/analytics-upgrade.md`; the former underscore-directory path is a forwarding document.
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
- `server/src/services/privacyConsentService.ts`: purpose-specific admission checks and optimistic preference updates. Serialize preference/epoch validation with event admission using a DB transaction or equivalent consistency boundary in each adapter. A process-local TTL cache plus local invalidation cannot enforce withdrawal across replicas; do not use cached grants for admission. Recheck permission before downstream optional export and handle in-flight withdrawal/erasure ordering explicitly.
- Feature flags in `server/config/feature-flags.yaml`: `analytics_collection_enabled` (kill switch) and `diagnostics_user_linked_enabled`, both **default disabled and fail-closed**. These must not inherit entitlement fail-open behavior. When disabled, consent updates, export, and deletion must still work.
- Review `server/src/instrument.ts`: `sendDefaultPii: false`; strip `user.ip_address`, cookies, auth headers, request bodies, and query strings in `beforeSend`/`beforeSendTransaction`. Necessary server error monitoring does not depend on the user's optional choice.

**Client**

- New `app/utils/privacyConsent.ts` (state machine: unknown/off, granted, withdrawn, obsolete-notice) and `app/hooks/usePrivacyConsent.ts`. Fetch on bootstrap and on foreground. Keep a minimal UI cache, but the server stays authoritative and a stale "allow" cache never admits events after withdrawal.
- First-run consent sheet with equal-weight **Accept** / **Reject** / **Customize**. Show it once after login, not before the user can use the app. No nagging after refusal.
- **Account → Privacy** section in `app/tabs/account.tsx` / `AccountProfileManagement.tsx`: two switches, a necessary-processing explanation, and links to export, delete analytics data, delete account, privacy policy, cookie notice, and privacy choices. testIDs follow `privacy-{action}`.
- Web: handle `Sec-GPC: 1` at the server and `navigator.globalPrivacyControl` in the browser. Preserve applicable sale/sharing opt-outs independently; an analytics grant cannot override them. Product rule: active GPC or legacy DNT keeps product analytics off. Show which signal is active; do not conflate either with diagnostic permission.
- **Sentry redesign** (`app/utils/sentry.ts`, `app/AppEntry.js`): default the optional client SDK to uninitialized until `optional_diagnostics` is granted. A pre-consent crash-only mode is permitted only after a documented necessity/basis/storage review and payload inspection; “crash only” does not make IPs, breadcrumbs or stack content anonymous. Disable automatic session/network/console capture before permission. Verify SDK/native shutdown semantics so withdrawal discards pending data rather than flushing it; do not assume `Sentry.close()` discards a queue. Audit native auto-start and transport behavior in the installed SDK. Keep necessary server diagnostics separately reviewed and minimized.
- Regrant starts a new epoch, and events from an old epoch are rejected. Login, reinstall, or a new device never turns missing permission into acceptance.

**Independent purpose and revocation checks**

| Product analytics | Detailed diagnostics | Expected optional collection |
|---|---|---|
| Off | Off | None |
| On | Off | Product events only; no optional Sentry activity |
| Off | On | Approved diagnostic payloads only; no feature/session product events |
| On | On | Both, independently gated and revocable |

Use an authenticated, size-limited diagnostic forwarding path with server-side purpose/epoch validation if immediate cross-device revocation is promised. Audit or replace direct SDK transports so stale devices cannot bypass it. Scrub before forwarding, reject unsupported envelope types and never expose provider credentials. Otherwise explicitly document and approve a weaker revocation guarantee; do not claim a server preference can intercept direct-to-provider traffic. Preference enforcement must remain available when the behavioral ingestion service is disabled.

**Acceptance:** network and storage evidence (web DevTools, iOS/Android proxy capture) shows zero optional data before permission and after withdrawal, including error paths, account switches, and stale devices. Core trip, quota, and billing regression suites pass.

## Phase 2: Event pipeline and initial feature instrumentation

Owners: frontend/backend leads. Development depends on Phase 1 and reviewed policy drafts. Production collection additionally depends on Phase 4 rights/retention delivery and publication of approved notices; drafted pages alone are insufficient.

- **Registry:** one canonical, versioned definition under `server/src/analytics/` generates a dependency-light client event catalog and strict server Zod schemas. Share model types through `server/src/types.ts`; never import server runtime/secrets into the Expo bundle. CI verifies generated output. Avoid maintaining two manually edited registries.
- **Client utility:** `app/utils/analytics/track.ts` plus `useTrackView(feature)`. This is a cross-cutting utility, not a centralized business API layer. Tab files keep their own fetch helpers.
- **Instrumentation:** routing and trip selection in `app/App.tsx`, then trip overview, itinerary, activities, lodging, transfers, expenses, packing, imports, and collaboration. Guard against duplicate render/effect events in React 19 Strict Mode.
- **Ingest:** `POST /api/analytics/events` mounted in `app.ts` (new `analyticsRoutes.ts`), authenticated users only. Anonymous/acquisition tracking is deferred to a separate design.
- **Validation:** enforce batch size, names, versions, property types/lengths and timestamps. Initial event-age limit is 24 hours with at most 5 minutes future skew; store receipt time and reject invalid clocks with a reason. Derive identity/permission from auth and verify trip access. Treat platform/version as untrusted analytical labels, never authorization. Freeze batches/IDs for retries and deduplicate per subject/purpose epoch.
- **Limits:** 20 events per batch, 32 KiB payload, 30-second foreground flush, max 100 queued events and 24-hour expiry; bounded exponential retry and per-event accepted/rejected reasons. On web use authenticated `fetch` with bounded `keepalive` when appropriate for visibility changes. `sendBeacon` cannot set the existing Bearer Authorization header, so do not use it for this endpoint or place tokens in URLs/bodies. Background delivery remains best-effort. No retries on consent denial. [MDN sendBeacon transport guidance](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)
- **Queue:** in-memory only at first. A durable offline queue requires encrypted storage, expiry, a withdrawal purge, and a cookie/storage notice update first. Lost offline events are reported as a coverage limitation.
- **Server outcomes:** after the business transaction commits, pass consent-filtered events to a bounded asynchronous writer with observed success/drop counts. Fire-and-forget work is not durable across process termination or Cloud Run throttling; expose loss and use a durable outbox only where confirmed-outcome completeness justifies its write cost. Never use this lossy path for financial settlement or quota enforcement.
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
- Extend account deletion to pseudonym mappings, trip-linked analytics, raw events, user/trip facts, captures, nested JSON identities, relevant logs and external diagnostics. Verify provider-specific erasure capabilities and the supported process; a data-scrubbing rule for future events is not proof that historic Sentry data was deleted. Capture completion evidence and verify Postgres and Firebase independently.
- Keep only genuinely necessary billing, security, and consent evidence under documented exceptions, access controls, and schedules. Keeping collaboration content does not justify keeping analytics linkage.
- Suppress or rebuild attributable rollups after erasure. Keep aggregates only after a re-identification assessment. A minimum cohort of 10 is a guardrail, not proof of anonymity. Block filter-differencing in drill-downs and exports.
- Durable deletion jobs with retries, tombstones, provider confirmation, and status. Event ingestion, settlement, and rollup replay check tombstones so deleted or restricted subjects are not recreated.
- Backups expire on a documented cycle, and a restore reapplies tombstones before serving data. Logs, object storage, and vendor data need lifecycle configuration, not only SQL cascades.
- Track rights deadlines by jurisdiction and request type with proportionate identity verification. GDPR responses are generally due within one month, subject to permitted extensions and notice. Applicable CCPA access/correction/deletion responses generally use 45 days; opt-outs have a different timeline. Support required appeals without attributing every state right to every law. [European Commission rights guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en), [California AG guidance](https://oag.ca.gov/privacy/ccpa)

### Retention (proposed; approve against actual purposes and provider capabilities)

| Data | Proposed limit | Enforcement |
|---|---|---|
| Client optional queue | 24 h, or withdrawal/logout | Client expiry and purge |
| Raw behavioral events | 90 days | Exclude expired records from reads/exports immediately; batched deletion plus Firestore TTL as a cleanup backstop. TTL is asynchronous and is not a deadline guarantee. |
| Linked daily user/trip facts | 13 months | Scheduled purge plus subject erasure |
| Consent choice evidence | Purpose-specific duration approved in Phase 0 | Minimal restricted evidence; document why any post-withdrawal/account-deletion retention is necessary. No automatic account-lifetime-plus-three-years rule. |
| Minimized diagnostic logs/traces | 30 days | Cloud Logging bucket retention, Sentry project retention, local rotation |
| AI captures | ≤ 30 days for diagnostics, shorter where restricted-data terms require | GCS lifecycle rule plus subject deletion |
| Assessed anonymous aggregates | 25 months, then review/purge | Aggregate lifecycle and disclosure review |
| Cost ledger, billing | Separate operational-cost and legally required accounting schedules | Internal cost telemetry is not automatically a statutory financial record. Limit linkage/retention by purpose and document legal holds. |

Publish only schedules that have been configured and tested. Firestore TTL is eventual cleanup and chargeable; explicit rights requests need deletion jobs with completion evidence, including nested/subcollection data where used. [Firestore TTL behavior](https://firebase.google.com/docs/firestore/ttl)

### Privacy policy and web page deliverables

Policy updates are a **release dependency**, not a follow-up. Pick one canonical source and generate the rest from it.

**Step 1: consolidate.** Make `docs/legal/privacy-policy.md` the single canonical source once the Finding 6 conflicts are resolved. Add a small build script (`scripts/build-legal-pages.mjs`) that renders it into `app/public/privacy.html` and `server/src/legal/privacyPolicyHtml.ts`, plus a CI check that fails if the generated outputs drift. Alternatively, `/privacy` can redirect (301) to `/privacy.html`.

**Step 2: per-surface changes.**

| Surface | Required change and verification |
|---|---|
| `docs/legal/privacy-policy.md` (canonical) | Resolve controller/operator, contact, minimum age. Add the sections listed under "Required new or changed notice content" below. Version number, effective date, and change summary at the top. |
| `app/public/privacy.html` | Generated from canonical. Replace generic "optional analytics, advertising, or non-essential cookies — consent where required" with the actual collection, controls, and retention. Keep the Gmail Limited Use and Plaid sections word-for-word unless reviewed. |
| `server/src/legal/privacyPolicyHtml.ts` → `/privacy` | Generated from canonical or redirect. Remove the contradictory embedded text (under-13 statement, "no marketing-analytics SDKs" wording that needs to describe first-party analytics). Test both routes against the production bundle. |
| `app/public/cookies.html` | Inventory actual privacy-choice and SDK storage, purpose, operator and duration. Minimal storage honoring refusal is distinct from optional session/queue storage; the initial queue/session state is in memory. List future persisted keys only when implemented and reviewed. Add a working Manage preferences control. |
| `app/public/privacy-choices.html` (new) | Public explanation of the two optional controls. Browser-level opt-out for signed-out visitors (stored locally); account-wide settings after sign-in. Links to export, deletion, and contact. Generates no optional analytics itself. Also serves as the "Your Privacy Choices" link for US state laws. |
| `app/public/delete-account.html` (new) | Public deletion-request page naming the app and operator, with identity verification, what is deleted, retained exceptions, and timing. Works without reinstalling the app. **This URL goes in the Play Console Data safety "Delete account URL" field.** |
| `app/tabs/account.tsx`, `AccountProfileManagement.tsx` | Privacy section (Phase 1). Make the legal links point to the canonical routes. Keep in-app deletion with proportional confirmation; normal deletion must not require contacting support. |
| `server/src/app.ts` | Serve `/privacy`, `/privacy.html`, `/cookies.html`, `/privacy-choices`, `/delete-account` with stable aliases. Static pages are matched **before** the SPA fallback so a missing page returns 404 instead of the app shell. |
| Web footer / login screen | Add "Privacy Choices" next to the Privacy and Terms links. |
| `docs/app-store-review-packet.md`, store metadata | Updated App Privacy and Data safety answers, policy/choices/deletion URLs, SDK inventory, and reviewer steps with screenshots of the consent sheet and Privacy settings. |
| `docs/sentry.md`, `docs/admin.md`, `docs/feature-flags.md` | Permission gating, diagnostic sampling/retention, metric definitions, coverage, the new flags, and rollout runbook. |

**Required new or changed notice content:**

1. **What we collect for analytics**: feature views, task outcomes, session timing, platform/app version/browser family, and trip phase (before/during/after, from trip dates, not location). State that it is linked to a pseudonymous account ID and that this is still personal data.
2. **Diagnostics**: distinguish reviewed necessary server monitoring from optional client diagnostics; describe Sentry fields, linkage, region and retention. Describe any pre-consent client crash mode only if its basis and implementation have been approved.
3. **Cost metering**: explain the minimum units needed for quota/service-cost administration and their approved basis; distinguish optional behavioral enrichment. Do not classify all cost-related processing as necessary.
4. **Legal basis table**: purpose-specific consent for optional analytics/diagnostics; document the applicable basis for security, quotas and cost administration; distinguish statutory billing retention. Avoid listing contract, legitimate interests and legal obligation as interchangeable justifications.
5. **Your choices**: explain separate toggles, withdrawal, analytics erasure, Account > Privacy and the public choices page. Describe GPC legal opt-outs separately from the additional product rule honoring GPC/DNT as an analytics refusal.
6. **Retention**: the approved schedule from the table above, in plain language.
7. **Recipients and transfers**: inventory actual providers, data categories, locations, subprocessor links and applicable transfer mechanisms. Verify any adequacy/certification coverage and SCC/UK safeguards rather than assuming a provider name establishes a valid transfer.
8. **Rights**: access, correction, deletion, restriction, objection, portability, withdrawal, complaint to a supervisory authority, US-state appeal process, response timelines, and how to submit (in-app, web page, email).
9. **What we do not do**: no sale or sharing for cross-context behavioral advertising, no advertising IDs, no fingerprinting, no session replay, no GPS, no use of Gmail/Plaid content for analytics.
10. **Device identifiers**: describe push tokens under notification functionality, their actual lifecycle and deletion behavior. Keep them out of analytics joins and verify disclosure categories against the final SDK payloads.
11. **Children**: a single consistent minimum age matching the registration age gate, and no analytics profiling of minors or non-account companions.
12. **Changes**: material purpose/data/recipient changes require review and renewed permission where needed for the affected purpose. Distinguish notice publication version from consent-purpose version so editorial updates do not re-prompt everyone.

Do not promise anonymity, universal deletion, or vendor behavior the implementation cannot demonstrate.

Publish a purpose/data/recipient matrix and sign processor agreements (DPAs) with each provider. Verify subprocessor notifications and transfer mechanisms; naming SCCs in a policy is not the assessment. [European Commission transfer guidance](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)

## Regulatory and mobile release requirements

### GDPR, UK GDPR, ePrivacy/PECR

- Purpose limitation, minimization, retention limits, and accountable access controls throughout.
- Consent must be freely given, specific, informed, and unambiguous. Record evidence and make withdrawal as easy as giving consent. Core features never depend on optional tracking. [EDPB consent guidelines](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en)
- ePrivacy Art. 5(3) and UK PECR reg. 6 apply to **any** storage or access on the device, so `localStorage` and native SDK storage are not exempt because they are not cookies. Analytics storage is set only after consent. [ICO storage/access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)
- This plan chooses opt-in globally. If a regional statistical/audience-measurement exception is considered later, verify current law, commencement and regulator conditions at that time; document it as a reviewed exception rather than assuming an exemption applies.
- Maintain the processing register, DPIA screening and representative/DPO applicability review. Incident procedures must assess notification thresholds: notify a supervisory authority without undue delay and, where feasible, within 72 hours of awareness when required; notify affected people without undue delay when the high-risk threshold applies. Document non-notification decisions. [ICO breach guidance](https://ico.org.uk/pdb)

### US state privacy laws (CCPA/CPRA and similar)

- Support access, correction, deletion, appeal, and non-discrimination. Honor GPC as a recognized opt-out signal.
- This design includes no sale or targeted advertising. Do not mislabel necessary service-provider processing as a sale, and do not describe every analytics toggle as a statutory "Do Not Sell or Share" opt-out. Link "Your Privacy Choices" to `privacy-choices.html`. [California AG CCPA guidance](https://oag.ca.gov/privacy/ccpa)
- Maintain an applicability matrix covering EU/EEA, UK, the relevant US states, Canada (PIPEDA/Quebec Law 25), and any launch markets.

### Restricted data sources

Gmail (Google API Limited Use) and Plaid terms apply independently. Consent to product analytics never authorizes reuse of their content, so no content-derived properties go into events.

### iOS / App Store

| Requirement | Action |
|---|---|
| App Privacy labels (App Store Connect) | Map actual Product Interaction, User ID, device/push identifiers and diagnostics to purposes and linkage. Optional collection is still disclosed unless an Apple exception actually applies; a pseudonym is not automatically unlinked. Confirm the tracking answer against SDK behavior. [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/) |
| App Tracking Transparency | Not expected for this design; verify actual SDK/data use before marking tracking absent. Advertising/data-broker linkage or IDFA access changes the assessment and may require ATT in addition to legal permission. [Apple user privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/) |
| Privacy manifest | Inspect `expo.config.shared.cjs`, generated native output and each SDK manifest. Declare actual collected data and required-reason APIs with approved reasons matching real use; do not copy a generic reason code. Verify applicable SDK signatures and the archived Xcode privacy report. [Apple third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/) |
| Account deletion (5.1.1(v)) | In-app initiation of full deletion including analytics; no deactivation-only or support-only flow. [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) |
| Policy URLs | Privacy policy URL and (optional) privacy choices URL in App Store Connect, both live before submission. |

### Android / Google Play

| Requirement | Action |
|---|---|
| Data safety form | Map App interactions, User IDs, push/device identifiers and diagnostics to actual purposes, optionality and sharing under Google definitions. Verify encryption and deletion claims in the built app; include SDK behavior and applicable service-provider exceptions. [Google Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) |
| Advertising ID | Add `com.google.android.gms.permission.AD_ID` to `android.blockedPermissions` in `expo.config.shared.cjs` and answer "No" to the advertising ID declaration. Verify the final merged manifest from the EAS build. |
| User Data policy | Verify whether prominent disclosure is required and that the consent flow explains the actual fields/use before collection; a generic sheet is not sufficient evidence. Keep an accessible policy matching runtime behavior. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en) |
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

## Delivery traceability and evidence

| Goal | Minimum deliverable | Completion evidence |
|---|---|---|
| Features used | Views, engaged reads and confirmed outcomes; eligibility-aware adoption | Known journeys reconcile to unique users and attempt outcomes |
| User costs | Trusted ledger, allocation version and pricing/invoice coverage | Failure/retry/cache fixtures and provider reconciliation |
| User performance | Retained timings plus task success, with platform coverage | Measured p50/p95 and controlled failure/load runs |
| App versus website | Explicit web/iOS/Android and signed-in overlap | Same consenting account tested across platforms without duplicate population totals |
| During-trip use | Trip-local phase and eligible traveler denominator | Boundary/DST/overlapping-trip fixtures including non-engagers |
| Privacy and maintainability | Separate choices, canonical policies, typed registry, erasure/export | Four-choice matrix, stale-replica tests, generated-page parity and deletion evidence |

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

- **Postgres:** measure serialized row size, index overhead, WAL, backups, vacuum and query CPU under representative load. For illustration, 1 KiB/event yields about 195 MiB/month of raw payload and 586 MiB across three such months, before overhead. Do not assume marginal cost is negligible on an existing instance.
- **Firestore:** initially use one event document per event (200,000 document writes in this example), plus consent reads, rollups, retries, retention deletes and export/erasure work. Budget index storage and billed query index reads; do not treat indexes as separately billed document writes. TTL deletes are billed and excluded from free usage. Atomic write batches reduce network overhead, not the number of billed document writes. [Firestore pricing](https://firebase.google.com/docs/firestore/pricing)
- **Daily job:** budget bounded scans of one day of events, late-arrival recomputation, rollup writes and durable leases. Measure actual runtime and supported scheduling configuration; do not assume one invocation has no retry/read overhead.
- **Sentry:** user-linked sessions and traces only for consenting users, with explicit sample rates. Monitor quota.

A later packed-batch storage optimization needs a separate benchmark and design for stable batch IDs, cross-batch deduplication, single-subject/purpose/epoch ownership, bounded document size, access/export/erasure and query indexes. Its lower write count is not sufficient justification on its own.

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
| Client (Jest) | Zero collection before permission; equal reject path; reload and account switch; consent sync errors; stale epoch/regrant; withdrawal during flush; bounded queue and offline expiry; duplicate renders; Sentry permission gating, no flush on withdrawal, and any approved minimal mode | `app/tests/privacyConsent.test.ts`, `analyticsTrack.test.ts`, extend `sentry.test.ts`, `AccountProfileManagement.test.tsx` |
| API (Supertest) | Auth; user/trip spoofing; invalid schema and oversized batches; deduplication; denied/withdrawn consent; stale revisions across two replicas; concurrent withdrawal/admission and stale diagnostic forwarding; all four purpose combinations; flags off or missing (fail-closed); deletion races; rate limits | `server/__tests__/analytics-ingest.test.ts`, `privacy-preferences.test.ts` |
| Adapter integration | Postgres/Firebase parity; index and query behavior; batch transactions; concurrent ingestion; leases and idempotent jobs; retention purge; nested-data erasure. Memory-adapter tests alone do not prove Firebase behavior. | `analytics-adapter-parity.test.ts`, run in memory plus isolated Postgres and Firebase emulator/disposable test environments; never point destructive tests at production |
| Cost | Every provider path; retries, failures, cache, shared and system attribution; reservation versus settlement; double-record protection; known/unknown rates; credits; invoice fixtures | extend `openai-usage-accounting.test.ts`, `usage-tracking.test.ts`; new `provider-cost-ledger.test.ts` |
| Metrics | Histogram retention, label preservation, process identity, Prometheus export | extend `metrics.test.ts` |
| Reports | Golden journeys; zero/nonzero denominators; eligibility history; late events; distinct counts; weighted rates; percentile buckets; consent bias; small-cohort suppression and differencing; CSV/UI parity | `analytics-reports.test.ts`, extend `firebase-admin-analytics.test.ts` |
| Rights | Export completeness and scope (no other travelers); partial-provider deletion and retry; rollup rebuild; retained-exception separation; backup-restore replay; tombstones; captures | extend `accountExport.test.ts`, `accountDelete.test.ts`; new `analytics-erasure.test.ts` |
| Legal pages | Generated pages match canonical; all aliases return 200 (not the SPA shell); required sections present | `server/__tests__/legal-pages.test.ts` |
| Web E2E (Playwright) | Fresh browser accept/reject/customize/withdraw; no optional storage or network before permission (assert on `page.on('request')` and `localStorage`); GPC header/browser signal and DNT product rule honored; analytics opt-in cannot override legal opt-outs; public policy, choices, and deletion links work; app usable after refusal | `app/e2e/privacy-consent.test.ts` |
| Native release | iOS/Android proxy and storage inspection; startup/background/resume/withdrawal; Xcode privacy report; merged manifest without AD_ID; deletion without reinstall; store disclosure reconciliation | Manual checklist in `docs/app-store-review-packet.md` |
| Load and failure | Reference devices and both DBs at forecast peak; DB/provider outage; queue limits; timeout/backoff; collector failure isolation; replica/restart behavior; measured monthly cost | Extend `app/e2e/performance.test.ts`; load script in `scripts/` |

Run the existing app and server suites and the affected Playwright flows for every implementation PR. Use the existing logger, usage-accounting, metrics, Sentry, admin, and Firebase analytics tests as regression anchors. Prefer adversarial cases over tests that only restate schemas.

## Rollout and completion criteria

1. Merge reviewed schemas, privacy controls, and permission-aware Sentry initialization with collection flags **off**.
2. Deploy the consolidated policy pages, privacy choices, deletion page, and verified rights workflows. Prepare matching App Store and Play disclosures **before** the mobile build that contains the consent UI ships.
3. Run synthetic consenting and refusing journeys in staging. No production user data is copied into fixtures.
4. Turn on `analytics_collection_enabled` for a consenting canary cohort, then a small percentage, with full coverage indicators. Internal/admin journeys use a separate validation view and remain excluded from customer adoption figures. Compare ledger accounting against existing counters without double-counting spend.
5. Monitor ingest failures, consent enforcement, report freshness, latency, and dollar budgets. Expand only after the acceptance evidence passes.

The kill switch stops optional producers, admission, and SDK export. Preference changes, erasure, export, retention jobs, and required accounting keep working. Rollback must not drop ledger records or recreate withdrawn or deleted subject data.

**Done when:** the five dashboards are trusted; privacy controls are tested on all three platforms; one canonical notice is served on all routes; jurisdiction, basis, processor, and transfer decisions are documented; rights and retention jobs work; store submissions match the built apps; adapter parity, regression, and load evidence exist; attribution and consent coverage are measured; and runbooks exist for incidents, cost alerts, SDK upgrades, and definition changes.

**Open decisions for Phase 0:** legal controller/operator, contact, and minimum age; launch jurisdictions and representatives; retention schedules; shared-cost allocation; trip timezone fallback; reference devices and load baseline; consent renewal triggers; processor deletion capabilities; BigQuery/warehouse need. Unresolved privacy, rights, essential metric definitions or budget gates keep optional production collection disabled. A future warehouse decision does not block launch on the approved initial infrastructure.
