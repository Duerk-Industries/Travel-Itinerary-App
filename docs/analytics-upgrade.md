# Analytics Upgrade: Collection, Goals, and Behavior

Status: Phase 1 privacy controls implemented in source with optional collection flags off; event pipeline and release approvals remain open.
Assessment and requirements review: October 8, 2026.
Revision: 6; includes the verified Phase 0 technical baseline, draft processing register and event dictionary. Product choices remain subject to the review gates recorded in the Phase 0 audit.
Delivery plan: [Analytics Upgrade Implementation Plan](implementation-plans/analytics-upgrade.md).
Phase 0 evidence: [verified baseline, dictionary and privacy review](analytics-phase-0.md).

This document explains what analytics WanderBunnies collects today, what the upgrade adds, why, how collection behaves on web, iOS, and Android, and which privacy commitments and regulatory frameworks constrain it. The accompanying [implementation plan](implementation-plans/analytics-upgrade.md) covers execution sequencing, privacy-policy page changes, automated tests, performance budgets, and cost governance.

---

## Summary

- **Goals:** Understand feature value, cost per user and per trip, application and task performance, native versus web adoption, and user engagement during scheduled trip dates.
- **Approach:** A small, typed, first-party event pipeline built on the existing server and database. Initially, there is no third-party analytics SDK, no advertising identifier, no fingerprinting, no session replay, and no GPS tracking.
- **Privacy Default:** Optional product analytics and optional detailed diagnostics are **off by default until the user opts in**, on every platform and in every region. Refusing optional analytics changes nothing about the core travel-planning features.
- **Granular Consent Separation:** Users independently grant or revoke **Product Analytics** and **Detailed Diagnostics**. Granting one does not grant the other.
- **Purpose Separation:** Necessary operational records (security logs, quotas, billing, cost metering) are strictly separated from optional behavioral analytics and are never silently repurposed as behavioral tracking.
- **Compliance Posture:** Designed to support compliance with GDPR / UK GDPR, ePrivacy / PECR, US state privacy laws (CCPA/CPRA, etc.), Apple App Store privacy policies (App Privacy Labels, ATT, Privacy Manifests, In-App Deletion), and Google Play policies (Data Safety, User Data Policy, AD_ID removal, Public Account Deletion URL). Legal review and store submission evidence are still required; this document does not certify compliance.

---

## Purpose and Scope

The current data answers "what did it cost" and "did it crash" in isolated areas. It does not answer "which features do people value," "does anyone open the app during their trip," or "is the native app worth its maintenance cost compared with web." This upgrade fills those gaps with minimal new moving parts.

This assessment describes the repository's target implementation, not verified production collection. Before rollout, engineering must inventory deployed environment settings, database populations, provider retention, SDK network traffic, and actual reporting coverage. Operational data that already exists must not become a historical behavioral dataset just because it can be queried.

---

## Current Collection and Format

| Collection | Recorded Information | Format / Storage | Source and Constraints |
|---|---|---|---|
| **HTTP Access** | Time, method, original URL, status, duration, request ID | JSON lines in production/Cloud Run; text locally; console | [app.ts](../server/src/app.ts). No explicit user/platform fields. Query strings may contain sensitive values. Polling is not engagement. |
| **Application & Error Logs** | Processing messages, errors/stacks, request context, authenticated user ID (when present) | JSON/text to console and `server/logs/api-info.log` / `api-error.log` | [logger.ts](../server/src/logger.ts). Metadata keys are redacted. Free-text messages and URLs need review. |
| **Per-User Usage** | Trip creations, successful itinerary generations, selected AI calls/tokens/estimated costs, weather and import operations | `usage_events` (user, metric key, amount, JSON metadata, timestamp); `usage_counters` (totals by window) | [entitlementService.ts](../server/src/services/entitlementService.ts), [openaiApi.ts](../server/src/apis/openaiApi.ts), [aiProviderRegistry.ts](../server/src/ai/registry/aiProviderRegistry.ts). |
| **Provider Limits & Budgets** | Provider/caller/window usage; provider/window estimated spend in USD microdollars | `api_usage_counters`; `api_cost_counters` | [usageLimiter.ts](../server/src/apis/usageLimiter.ts), [providerBudgeting.ts](../server/src/apis/providerBudgeting.ts). Provider totals alone do not constitute a per-user cost ledger. |
| **Itinerary Telemetry** | User/trip ID, outcome, tokens, cost estimate, stage latency, parse failures, quality, cache/fallback hits, avoided inference | `itinerary_generation_metrics`: indexed columns plus JSONB | [itineraryMetricsService.ts](../server/src/services/itineraryMetricsService.ts). Best-effort writes. User/trip linkage means this data is personal data. |
| **AI Captures & Evaluation** | Parsing/generation captures, evaluations, experiments, provider/model/prompt and cost rollups | Gzipped JSON locally or in Google Cloud Storage; DB metrics by period/dimension | [captureService.ts](../server/src/ai/capture/captureService.ts), [aggregationJob.ts](../server/src/ai/analytics/aggregationJob.ts). The aggregation job reads local files, so production captures in GCS may be missed until it reads the configured backend. |
| **Ingestion Operations** | Job/stage outcomes, duplicates, retries, dead letters, quota, related LLM usage | Durable import records and admin JSON; in-memory queue gauges | [ingestionMetricsService.ts](../server/src/services/ingestionMetricsService.ts), [admin reference](admin.md). |
| **Trip Activity** | Selected changes, actor, trip, type, metadata, timestamps | `trip_activity` records; grouped feed | [activityFeed.ts](../server/src/services/activityFeed.ts). Contributions are visible. Reading and abandoned actions are not recorded. |
| **Admin Audit** | Actor/target, before/after, reason, timestamp | `audit_log` | [admin reference](admin.md). Administrative actions only. |
| **Sentry** | Server crashes/traces and, after a current diagnostics grant and enabled flag, client crashes/performance | Sentry events/traces; code defaults to 10% trace sampling | [app/utils/sentry.ts](../app/utils/sentry.ts), [instrument.ts](../server/src/instrument.ts), [Sentry guide](sentry.md). Phase 1 source removes pre-choice client initialization; deployed build behavior and vendor retention still require verification. |
| **Privacy choices** | Separate product-analytics and detailed-diagnostics choices, revision/epoch, notice version, coarse platform and timestamp | `privacy_preferences` and `privacy_choice_events` in Postgres/Firestore | [privacyConsentService.ts](../server/src/services/privacyConsentService.ts). Phase 1 controls only; product behavior events are not yet collected. |
| **Push Tokens** | Expo push token per device (encrypted at rest) | `notification_devices` | [pushNotifications.ts](../app/utils/pushNotifications.ts), [pushTokenCrypto.ts](../server/src/utils/pushTokenCrypto.ts). Device identifier for store disclosures; not an analytics identifier. |
| **Server Counters & Gauges** | Cache totals/ratios, queue depths | Per-process maps; admin JSON and `/metrics` Prometheus text | [metrics.ts](../server/src/metrics.ts). Restart resets values. **`recordTiming` calls a no-op `emit`, so no latency is currently retained.** |
| **Cost Forecasting** | Assumed usage, pricing, infrastructure line items | YAML/admin settings and estimate responses | [cost-model.yaml](../server/config/cost-model.yaml), [costEstimatorService.ts](../server/src/services/costEstimatorService.ts). Forecasts are not incurred cost. |

Postgres stores SQL rows/JSONB and Firebase stores collections/documents. All storage must go through the [DB facade](../server/src/db.ts) (`db.postgres.ts` and `db.firebase.ts`), with the memory adapter supporting unit/integration tests.

Admin user-data reports cover 7-day, 30-day, and all-time windows: tier, visible trips, trip creations, successful generations, tokens, and API summaries. Some summaries use fallback estimates, so an API count must not be shown as a verified provider-call count without coverage metadata.

There is currently no general client feature/session event pipeline. `AppState` and browser visibility listeners drive lifecycle and polling behavior, not analytics sessions.

---

## Analytics Goals and Metric Definitions

### 1. Feature Adoption and Value

Covers overview, itinerary, activities, transfers, lodging, car rentals, expenses/ledger, packing, chat, collaboration, imports, blog, and AI assistance.

| Metric | Definition | Decision It Supports |
|---|---|---|
| **Feature Reach** | Unique consenting users with a feature view ÷ consenting active users eligible for that feature in the window | Discoverability, navigation design |
| **Meaningful Adoption** | Unique consenting users with a completed meaningful action or engaged read ÷ eligible consenting active users | Value beyond opening a tab |
| **Completion Rate** | Completed task attempts ÷ started attempts, deduplicated by operation ID | Workflow friction and usability |
| **Repeat Use** | First-time feature users who return within a stated interval ÷ mature first-use cohort | Sustained usefulness |
| **Time to Value** | Time elapsed from signup or first trip creation to a defined useful outcome | Onboarding efficiency |

Every chart states its eligibility rule, window, sample size, and consent coverage. Feature flags, tier access, traveler role, and platform availability all change denominators. Reading an itinerary or reference counts as value, because record creation alone understates usefulness.

### 2. User and Trip Economics

Measure direct cost by initiating user, trip, feature, provider/model, and month. Include billable failures, retries, async jobs, and background work. Keep cache hits and avoided inference separate from actual spend.

- **Direct Attributable Cost**, **Allocated Shared Infrastructure Cost**, and **Total Cost** are reported separately, with the allocation rule and version visible.
- A shared job is allocated once. A trip with five travelers does not incur five copies of one provider bill.
- **Allocation rule (`allocation_v1`):** direct costs go to the initiating user and trip. Shared infrastructure is split equally across accounts active that month, with a request-volume split shown alongside for comparison.
- Direct cost is the sum of priced billable units. An unknown price stays **unknown**, never zero. Show attribution coverage, pricing coverage, and invoice reconciliation variance. Store USD microdollars and label estimates separately from invoiced adjustments.
- Useful views: median/p95 cost per user, cost by tier/feature/platform, cost per active trip, cost per successful generation/import, expensive-user distribution, contribution margin (with tax, refunds, store/payment fees handled consistently).

Minimum metering needed to enforce quotas and administer service costs continues under its documented necessary processing basis when optional analytics is off. Behavioral enrichment and joins require explicit product-analytics permission.

### 3. Application Performance and Task Effectiveness

- **Technical:** Cold start, trip-ready time, screen-ready latency, save latency, request failure rate, AI/import turnaround, crashes, hangs, connectivity failures. Report median/p95 and success rate by feature, platform, app version, and network category. Show sample rates.
- **Task:** Wizard completion, invitation acceptance, time to first useful item, import corrections, AI-plan acceptance. Long reading time is not automatically friction. Distinguish intentional cancellation, failure, and inactivity abandonment.

### 4. Native Versus Web Use

Record explicit platform (`web` / `ios` / `android`), web device category, browser/OS family, app version/build, and web standalone (installed PWA) mode when available. Never use advertising IDs, hardware identifiers, or fingerprinting.

Report unique users and sessions separately, with native-only, web-only, and both-platform cohorts. A mobile browser counts as web. Cross-device linkage uses only the signed-in account, and only with permission. Never infer that an unidentified browser and device belong to the same person.

### 5. Use During Trips

Each trip-specific event is classified as `pre_trip`, `during_trip`, `post_trip`, or `unknown`. Classification uses the trip's inclusive start/end calendar dates in the trip's timezone, not the server's. Trips gain an optional IANA `timezone`, filled automatically from the destination or first lodging via cached Google Places details. Fallback order: segment timezone → trip timezone → device timezone reported on the event → `unknown`. Reports show how many events were classified at each fallback level. Record the date/timezone version so later date edits do not silently rewrite history.

$$\text{During-Trip Engagement Rate} = \frac{\text{Consenting eligible account travelers with meaningful engagement on a trip during its dates}}{\text{Consenting eligible account travelers whose trip occurred in the window}}$$

- Non-engagers stay in the denominator.
- Canceled trips, unregistered companions, and users without access at the time are excluded.
- Users with missing consent or unusable dates are reported as excluded/unknown coverage, not as inactive.
- Compute the engagement rate per trip; for a portfolio-wide traveler-trip rate, count eligible traveler-trip pairs in both numerator and denominator.
- Also measure the share of trips with any engagement, engaged trip days, itinerary/detail reads, map-link opens, expense entry, packing, and chat. Events attach to the selected trip, so activity on an unrelated future trip does not count for a current one. Concurrent trips are classified separately.
- These metrics show use **during scheduled travel dates**, not physical presence at the destination. GPS/location collection is strictly out of scope.

---

## Behavioral Event Contract

One typed, versioned registry in a new shared workspace package, `packages/analytics` (`@wanderbunnies/analytics`), following the existing `@wanderbunnies/domain` and `@wanderbunnies/messaging` pattern so the app and server import the same event names and Zod schemas without code generation. Every event declares purpose, owner, allowed properties, units, emitting boundary, consent category, retention, and sampling. Shared models live in `server/src/types.ts`, and client input is validated with strict Zod schemas.

- **Envelope:** `event_id`, `schema_version`, `event_name`, `occurred_at`, `received_at`, `source`, `purpose`, `session_id`, `platform`, `app_version`, `environment`.
- **Server-Derived (clients cannot assert):** `analytics_subject_id`, `tier`, `user_role`, `authorized_trip_ref`, `consent_revision`, `purpose_epoch`.
- **Event-Specific:** `feature`, `action`, `outcome`, `operation_id`, `trip_phase`, date/timezone version, allowlisted `properties`.

| Event Family | Examples | Emitted From |
|---|---|---|
| **Session** | `session_started`, `engaged_session_summary` | Client foreground/visibility, consent-gated |
| **Views** | `feature_viewed`, `trip_reference_viewed` | Client, after real visible render |
| **Tasks** | `task_started`, `task_cancelled`, `task_failed` | Client, with a correlation ID per attempt |
| **Confirmed Outcomes** | `trip_created`, `item_saved`, `invite_accepted`, `import_completed` | Server after the business transaction commits, consent-filtered |
| **AI Value** | `itinerary_viewed`, `itinerary_edited`, `generation_requested` | Client/server; viewing does not imply acceptance |
| **Utility** | `map_link_opened`, `report_exported`, `packing_item_checked` | Semantic action only; no link contents or item text |
| **Operational Ledger** | `provider_attempt_settled`, `shared_cost_allocated` | Trusted server accounting, separate from optional behavior |

Example optional event payload:

```json
{
  "event_id": "8f3b2c1a-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "schema_version": 1,
  "event_name": "feature_viewed",
  "occurred_at": "2026-10-08T14:00:00Z",
  "received_at": "2026-10-08T14:00:01Z",
  "source": "client",
  "purpose": "product_analytics",
  "analytics_subject_id": "subj_a1b2c3d4e5f6",
  "session_id": "sess_9x8y7z6w5v4u",
  "platform": "ios",
  "app_version": "1.4.0",
  "environment": "production",
  "feature": "itinerary",
  "trip_ref": "trip_anon_778899",
  "trip_phase": "during_trip",
  "consent_revision": 3,
  "purpose_epoch": 2,
  "properties": { "entry_point": "trip_tab" }
}
```

A pseudonym is still personal data under GDPR while linkage is possible, and the docs and policies explicitly disclose this.

**Session Tracking Rules:**
- A new foreground session starts after 30 minutes of inactivity.
- Track bounded active intervals, not hidden background time, and cap intervals after unexpected termination.
- No per-second heartbeats, no logging of every scroll or tap.
- Repeated renders, polling, prefetch, and background workers are not engagement.

**Never Collected in Behavioral Events:**
Raw email/name, age, gender, home address, destination or place text, GPS coordinates, booking references, AI prompts, chat text, uploaded documents, financial transaction details, full URLs/query strings, or arbitrary exception messages. Content from Gmail or Plaid imports is strictly excluded from analytics.

---

## Privacy Architecture and Regulatory Compliance

### 1. User Privacy UI & Settings

- **Account → Privacy** on web, iOS, and Android, plus a public **Privacy Choices** page on web (`/privacy-choices`).
- Two optional switches, both **off by default**:
  1. **Product Analytics**: Feature views, task outcomes, session timing, platform, and trip-phase events.
  2. **Detailed Diagnostics**: All client-side Sentry collection (crash reports, performance traces, session tracking) from the user's device.
- A plain-language explanation of **Necessary Processing** (security logs, quotas, billing, cost metering, scrubbed **server-side** error monitoring) that has no misleading "off" switch.

Client crash reporting sits behind the Detailed Diagnostics switch because the Sentry SDK stores and reads data on the device (ePrivacy/PECR) and links crashes to a session. As a result, crashes from non-consenting users are not reported. Server-side error rates, failed-request counts, and support reports partly make up for this, and reliability dashboards state the consenting share so the gap is visible.
- Direct links to **Export Data**, **Delete Analytics Data**, **Delete Account**, **Privacy Policy**, and **Cookie Notice**.

The first-run consent sheet offers **Accept**, **Reject**, and **Customize** with equal prominence. There are no preselected switches, no bundling with terms acceptance, no repeated nagging after refusal, and no loss of core travel features or price discrimination for refusing.

### 2. Consent States and Enforcement

| State | Client Behavior | Server Behavior |
|---|---|---|
| **Unknown / Not Yet Asked** | No optional SDK init, no event queue created | Rejects incoming optional events with 403 |
| **Granted for Purpose (Epoch *n*)** | Enables only that specific purpose independently | Admits only that purpose and its current epoch |
| **Withdrawn** | Stops producers, clears queue and local identifiers, shuts down optional SDKs | Rejects new/in-flight events; deletion of history is triggered separately |
| **Purpose Material Change** | Pauses affected purpose pending new choice | Rejects affected purpose until new grant |

**Re-prompt rule:** users are asked again **only** after a material change: a new purpose, a new data category, or a new recipient category (such as adding a third-party analytics vendor). Wording edits never trigger a prompt, a refusal is never re-asked unless such a change occurs, and there is no periodic re-prompt.

- **Authoritative Server Enforcement:** The account-level choice is stored in `privacy_preferences` and enforced on the server.
- **Epoch Management:** Re-granting consent increments the purpose epoch and rotates the subject pseudonym. Events queued before withdrawal are never replayed.
- **Global Privacy Control (GPC) & Do Not Track (DNT):** Honor applicable legal sale/sharing/targeted-advertising opt-outs. An active GPC signal keeps optional product analytics **off**. DNT is treated as an optional-analytics refusal.
- **Age Gate Consistency:** The minimum account age is **16** worldwide (`MINIMUM_ACCOUNT_AGE` in `server/src/services/registrationAgeGate.ts`). Until this revision, no client sent a date of birth and Google/Apple sign-in skipped the check entirely. A post-sign-in age-check path is implemented for current clients, while server blocking remains gated by `age_gate_enforcement` and older builds may remain supported. On iOS 26+ (in builds with the entitlement enabled), Apple's Declared Age Range is asked first. If Apple confirms 16+, the account is recorded as "verified 16+ via Apple" with no birthdate collected, and no prompt appears. Otherwise, and on Android, web, and older iOS, the user sees a neutral date-of-birth screen that cannot be dismissed. Under-16 declarations are not stored, and those accounts can only be deleted or signed out of. Server-side blocking is controlled by the `age_gate_enforcement` flag (see the [plan, decision 10](implementation-plans/analytics-upgrade.md#decision-10-implementation-account-age-verification)). Because account holders are 16+, analytics consent does not need the GDPR Art. 8 parental-consent mechanism. Every policy page must state 16, and the "under 13" wording on `/privacy` must be removed. Minors entered as travelers or dependents are never analytics subjects.

### 3. GDPR and UK GDPR Compliance

- **Scope and contact:** EU/EEA and UK are treated as targeted markets for planning. The operator is Tristan Duerk and the privacy contact is `support@wander-bunnies.com` (decided 2026-10-08). The live public pages still name Bryan Duerk until they are synchronized. A [draft Article 27 assessment](legal/eu-uk-representative-assessment.md) and the [draft DPIA](legal/analytics-dpia.md) await counsel and controller sign-off. The [Phase 0 audit](analytics-phase-0.md#recorded-decisions-and-sign-off-state) records these unresolved facts.

- **Lawful Basis:** Explicit, freely given, specific, informed, and unambiguous opt-in consent (Art. 6(1)(a) GDPR) for optional product analytics and detailed diagnostics. Necessary processing (security, billing, quota enforcement) uses contractual necessity (Art. 6(1)(b)) or legitimate interests (Art. 6(1)(f)) after documented necessity assessments.
- **Withdrawal:** As easy to withdraw as to grant (Art. 7(3) GDPR). Available in-app at any time under Account → Privacy.
- **Pseudonymization:** All behavioral events use random subject pseudonyms (`analytics_subjects`), never raw user IDs or email hashes.
- **Data Subject Rights:**
  - **Access & Portability (Art. 15 & 20):** `GET /api/account/export` (Schema v2) includes current privacy preferences, choice history, user's behavioral events, daily facts, pseudonym, cost ledger rows, and diagnostic metadata.
  - **Erasure / Right to be Forgotten (Art. 17):** `DELETE /api/account/analytics-data` erases analytics events, subject mappings, daily facts, AI captures, and Sentry diagnostics. `DELETE /api/account` performs full account deletion including analytics erasure.
  - **Restriction & Objection (Art. 18 & 21):** For consent-based analytics and diagnostics, withdrawing consent immediately stops processing. For processing based on legitimate interests (cost metering joins, security logs), users can object through the privacy contact. Each objection is assessed and logged, and the outcome is recorded in the rights-request tracker.
- **Record of Processing Activities (ROPA):** A draft purpose/data/recipient register is recorded in the [Phase 0 audit](analytics-phase-0.md#processing-register-draft-ropa); the privacy owner must complete and approve basis, transfers, contracts and security measures.
- **Data Protection Impact Assessment (DPIA):** Phase 0 screening is recorded; a full DPIA is recommended and requires privacy-owner approval before optional collection.

### 4. ePrivacy Directive and UK PECR

- ePrivacy Art. 5(3) and PECR Reg. 6 apply to **any** storage or access of information on the user's terminal equipment (`localStorage`, `AsyncStorage`, cookies, SDK caches).
- Zero optional client storage or SDK initialization occurs before explicit consent is granted.
- Minimal storage necessary to remember privacy choices (e.g. refusal or grant) is used under the strictly necessary exception.

### 5. US State Privacy Laws (CCPA / CPRA and Successors)

- Applicability thresholds (revenue, volume of consumers' data) still require documented review; Phase 0 records the current gap. The controls below are built regardless, because they cost little and match the global opt-in design.
- Provides rights to Know, Delete, Correct, and Opt-Out of Sale/Sharing.
- WanderBunnies **does not sell or share** personal information for cross-context behavioral advertising.
- Public web page `/privacy-choices` serves as the "Your Privacy Choices" link for US residents.
- Appeals process for rights requests provided via email and web forms.

### 6. Mobile Platform Policies

Status as of this revision: **Done** means already true in the repository; **Required** means work in the implementation plan.

#### Apple iOS / App Store Policies

| Control | Status | Target behavior |
|---|---|---|
| App Privacy labels | Required | App Store Connect declares Product Interaction (analytics, linked), User ID (app functionality and analytics, linked), Device ID (push token, app functionality), and Crash/Performance Data (analytics, linked; optional). "Used for tracking": No. |
| App Tracking Transparency | Required (verification) | No ATT prompt, because nothing links data with other companies' data for advertising and no IDFA is accessed. Must be confirmed by network inspection of the release build's SDKs. |
| Privacy manifest | Required (not configured) | Add `ios.privacyManifests` to `expo.config.shared.cjs` declaring `NSPrivacyTracking: false`, collected data types matching the labels, and required-reason APIs (e.g. `UserDefaults` CA92.1, file timestamps, system boot time). Verify with the Xcode privacy report of the archived EAS build. |
| In-app account deletion (5.1.1(v)) | Done (DB cascade); Required (analytics/Sentry scope) | `DELETE /api/account` exists in the app. It must also erase analytics stores and request Sentry deletion. |

#### Google Android / Google Play Policies

| Control | Status | Target behavior |
|---|---|---|
| Data safety form | Required | Declares App interactions (optional), User IDs, Device or other IDs (push token), and Crash logs/Diagnostics (optional), encryption in transit, and deletion availability. |
| Advertising ID | Required (not configured) | Add `com.google.android.gms.permission.AD_ID` to `android.blockedPermissions` in `expo.config.shared.cjs`, confirm it is absent from the merged manifest, and answer "No" in Play Console. |
| User Data policy | Required | Prominent in-app disclosure (the consent sheet) appears before any optional collection. |
| Account deletion | Done (in-app); Required (web URL) | Add a public `/delete-account.html` page and enter it as the Delete account URL in Play Console. |

---

## Privacy Policy and Web Page Deliverables

Target state: the privacy notice is maintained in **one canonical Markdown file**, `docs/legal/privacy-policy.md`. A build script (`scripts/build-legal-pages.mjs`) compiles it into the public HTML page and the server's TypeScript string, and CI verifies they match. Today the three copies disagree (see Finding 6 in the plan). The exact content changes for each page are listed in the [implementation plan](implementation-plans/analytics-upgrade.md#privacy-policy-and-web-page-deliverables).

```
                  ┌───────────────────────────────────┐
                  │   docs/legal/privacy-policy.md    │
                  │        (Canonical Source)         │
                  └─────────────────┬─────────────────┘
                                    │
                       scripts/build-legal-pages.mjs
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
app/public/privacy.html  server/src/legal/privacyPolicyHtml.ts  CI Parity Check
```

### Page Deliverables Summary

| Page / Route | File Location | Purpose & Key Requirements |
|---|---|---|
| **Privacy Policy** | `docs/legal/privacy-policy.md`<br>`app/public/privacy.html`<br>`server/src/legal/privacyPolicyHtml.ts` | Consolidated canonical notice. Contains updated collection tables, lawful bases, dual opt-in toggles, GPC/DNT rules, retention schedules, data subject rights, subprocessors, and contact details. Resolves operator/contact conflicts. |
| **Cookie Notice** | `app/public/cookies.html` | Explains strictly necessary storage vs optional analytics storage. Interactive "Manage Preferences" button. |
| **Privacy Choices** | `app/public/privacy-choices.html` | Public web page for US state privacy choices ("Your Privacy Choices") and global opt-out explanations. Allows signed-out visitors to set browser opt-outs. |
| **Delete Account** | `app/public/delete-account.html` | Public web page for Google Play Account Deletion requirements. Describes deletion scope, retained legal exceptions, and identity verification. |
| **In-App Privacy UI** | `app/tabs/account.tsx`<br>`AccountProfileManagement.tsx` | Account → Privacy section with 2 independent switches, plain-language necessary processing explanation, Export Data, Delete Analytics, Delete Account, and policy links. |

---

## Data Retention (Proposed)

Proposed in the recorded product decisions; purpose-specific legal approval and technical enforcement remain open. Publish only schedules that are configured and tested.

| Data | Proposed retention |
|---|---|
| Unsent client analytics queue | 24 hours, or until withdrawal/logout |
| Raw behavioral events | 90 days |
| Linked daily user/trip facts | 13 months |
| Client diagnostics (Sentry) and minimized server logs/traces | 30 days |
| AI captures | ≤ 30 days |
| Assessed anonymous aggregates | 25 months, then review |
| Consent evidence | Account lifetime + 3 years |
| Cost ledger | User/trip linkage removed after 13 months; feature/provider totals kept |
| Billing records | 7 years (tax/accounting) |

The target is to send only a diagnostic pseudonym to Sentry and configure 30-day retention. Current SDK payloads, retention settings and deletion capabilities have not been verified, so neither claim belongs in the live policy yet.

Withdrawing consent stops new collection immediately. **Delete my analytics data** or account deletion erases the history.

---

## Ease of Analysis, Maintainability, Performance, and Cost

### 1. Ease of Analysis & Reporting

- **5 Initial Admin Views** in `AdminTab` (`/api/admin/analytics/*`):
  1. **Feature Adoption:** Reach, meaningful adoption, completion rates.
  2. **Cost & Economics:** Direct cost by user/trip/feature, USD microdollars, allocation breakdown.
  3. **Performance & Reliability:** Cold start, screen readiness, save latency, request error rates.
  4. **Platform Mix:** Web vs iOS vs Android cohorts, app version distribution.
  5. **Trip-Phase Engagement:** Pre-trip, during-trip, and post-trip engagement metrics.
- **Statistical Integrity:** Curated daily rollups. Non-additive metrics (like unique users) are computed with explicit set logic. Cohorts smaller than 10 users are suppressed in reports and exports to prevent filter-differencing re-identification.
- **Ad-Hoc Analysis Path:** Scheduled export of suppressed aggregate rollups (never raw events or user-level facts) to CSV in Cloud Storage. BigQuery is deferred until analysts need custom SQL more than about weekly or admin queries miss their 2 s budget. "Anonymous" is a claim made only after a re-identification assessment.

### 2. Maintainability

- **Single Event Registry:** `packages/analytics` exports event names, Zod schemas, and metadata consumed directly by both `app/` and `server/`, with no generated copies to drift.
- **Dual-Adapter DB Facade:** Implemented in `db.postgres.ts` and `db.firebase.ts` simultaneously, with `db.memory.ts` providing fast, complete unit/integration test execution.
- **CI Drift Prevention:** Automated build checks verify that client event names match the registry, generated legal HTML files match canonical Markdown, and Zod schemas validate all payloads.

### 3. Performance Budgets

| Metric | Budget Target | Enforcement Mechanism |
|---|---|---|
| **Disabled Overhead** | 0 requests, 0 writes | Code short-circuit before queue or SDK init |
| **Client `track()` Overhead** | p95 < 2 ms on reference devices (mid-range Android such as Pixel 6a, iPhone 12, mobile Safari, desktop Chrome) | Non-blocking, in-memory queue; async flush |
| **Load Baseline** | Busiest hour of the last 30 days (Cloud Run logs), tested at 10× | Load script plus Firestore emulator and staging run |
| **Server Ingest Throughput** | p95 < 200 ms per 20-event batch | Bounded async writer outside response path |
| **Admin Report Queries** | p95 < 2 s for 30-day queries | Reads precomputed `analytics_rollups`, no full table scans |

### 4. Cost Controls and Metering

- **Priced Metering:** `settleProviderAttempt()` records attempt ID, provider, model, caller, feature, initiating user, trip, units, cache status, and price version in integer USD microdollars.
- **No Double Counting:** Separates quota reservations from settled cost. Shared background costs are allocated once under an explicit formula.
- **Monthly Dollar Cap & Alerts:** A monthly analytics budget must be approved and recorded in `cost-model.yaml` for forecasting; no approved cap was verified in Phase 0. Alerts at 80% and 100% come from a Google Cloud Billing budget, plus the Sentry quota alert. When the budget is exceeded, an operator reduces sampling or pauses optional collection with the `analytics_collection_enabled` kill switch, without affecting travel features, consent changes, or rights requests.
