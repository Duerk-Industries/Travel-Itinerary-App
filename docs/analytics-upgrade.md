# Analytics Upgrade: Collection, Goals, and Behavior

Status: proposed design. No new collection, SDK, or policy change is enabled by this document.
Assessment date: October 8, 2026.
Delivery plan: [Analytics Upgrade Implementation Plan](implementation_plans/analytics-upgrade.md).

This document explains what analytics WanderBunnies collects today, what the upgrade adds, why, how collection behaves on web, iOS, and Android, and which privacy commitments constrain it. The implementation plan covers sequencing, privacy-policy page changes, tests, performance, and cost.

## Summary

- **Goals:** understand feature value, cost per user and per trip, app performance, native versus web use, and whether people use the app during their trips.
- **Approach:** a small, typed, first-party event pipeline built on the existing server and database. Initially there is no third-party analytics SDK, no advertising identifier, no fingerprinting, no session replay, and no GPS.
- **Privacy default:** optional product analytics and optional detailed diagnostics are **off until the user opts in**, on every platform and in every region. Refusing changes nothing about the travel features.
- **Separation:** necessary operational records (security, quotas, billing, cost metering) are kept apart from optional behavioral analytics and are never silently repurposed as optional analytics.
- **Compliance posture:** designed to support GDPR/UK GDPR, ePrivacy/PECR, US state privacy laws, Apple App Store privacy rules, and Google Play User Data policy. Legal sign-off is still required. This document does not certify compliance.

## Purpose and scope

The current data answers "what did it cost" and "did it crash" in places. It does not answer "which features do people value", "does anyone open the app on the trip", or "is the native app worth its cost compared with web." This upgrade fills those gaps with the fewest new moving parts.

This assessment describes the repository's implementation, not verified production collection. Before rollout, inventory deployed environment settings, database populations, provider retention, SDK network traffic, and actual reporting coverage. Operational data that already exists must not become a historical behavioral dataset just because it can be queried.

## Current collection and format

| Collection | Recorded information | Format/storage | Source and constraints |
|---|---|---|---|
| HTTP access | Time, method, original URL, status, duration, request ID | JSON lines in production/Cloud Run; text locally; console | [app.ts](../server/src/app.ts). No explicit user/platform fields. URLs may contain sensitive query values. Polling is not engagement. |
| Application/error logs | Processing messages, errors/stacks, request context, sometimes authenticated user ID | JSON/text to console and `server/logs/api-info.log` / `api-error.log` when writable | [logger.ts](../server/src/logger.ts). Metadata keys are redacted. Free-text messages and URLs still need review. |
| Per-user usage | Trip creations, successful itinerary generations, selected AI calls/tokens/estimated costs, weather and import operations | `usage_events` (user, metric key, amount, JSON metadata, timestamp); `usage_counters` (user/metric/window totals) | [entitlementService.ts](../server/src/services/entitlementService.ts), [openaiApi.ts](../server/src/apis/openaiApi.ts), [aiProviderRegistry.ts](../server/src/ai/registry/aiProviderRegistry.ts). Coverage depends on caller context and accounting settings. |
| Provider limits/budgets | Provider/caller/window usage; provider/window estimated spend | `api_usage_counters`; `api_cost_counters` in integer USD microdollars | [usageLimiter.ts](../server/src/apis/usageLimiter.ts), [providerBudgeting.ts](../server/src/apis/providerBudgeting.ts). Provider totals alone are not a per-user cost ledger. |
| Itinerary telemetry | User/trip, outcome, tokens, cost estimate, stage latency, parse failure, quality, cache/fallback, avoided inference | `itinerary_generation_metrics`: indexed columns plus JSON | [itineraryMetricsService.ts](../server/src/services/itineraryMetricsService.ts). Best-effort writes. User/trip linkage means this data is not anonymous. |
| AI captures/evaluation | Parsing/generation captures, evaluations, experiments, provider/model/prompt and cost rollups | Gzipped JSON locally or in Google Cloud Storage; DB metrics by period/dimension | [captureService.ts](../server/src/ai/capture/captureService.ts), [aggregationJob.ts](../server/src/ai/analytics/aggregationJob.ts). The aggregation job reads local captures, so production completeness is unverified. |
| Ingestion operations | Job/stage outcomes, duplicates, retries, dead letters, quota, related LLM usage | Durable import records and admin JSON; in-memory queue gauges | [ingestionMetricsService.ts](../server/src/services/ingestionMetricsService.ts), [admin reference](admin.md). |
| Trip activity | Selected changes, actor, trip, type, metadata, timestamps | `trip_activity` records; grouped feed | [activityFeed.ts](../server/src/services/activityFeed.ts). Contributions are visible. Reading and abandoned actions are not. |
| Admin audit | Actor/target, before/after, reason, timestamp | `audit_log` | [admin reference](admin.md). Administrative actions only. |
| Sentry | Client/server crashes, sampled performance, client auto-session tracking | Sentry events/traces; default trace sampling 10% | [app/utils/sentry.ts](../app/utils/sentry.ts), [instrument.ts](../server/src/instrument.ts), [Sentry guide](sentry.md). DSN-gated; replay disabled. **Client init runs in `AppEntry.js` before any privacy choice exists.** |
| Push tokens | Expo push token per device (encrypted at rest) | Push-token records | [pushNotifications.ts](../app/utils/pushNotifications.ts), [pushTokenCrypto.ts](../server/src/utils/pushTokenCrypto.ts). A device identifier for app-store disclosure purposes; not an analytics identifier. |
| Server counters/gauges | Cache totals/ratios, queue depths | Per-process maps; admin JSON and `/metrics` Prometheus text | [metrics.ts](../server/src/metrics.ts). Restart resets values. Counters drop labels. **`recordTiming` calls a no-op `emit`, so no latency is retained.** |
| Cost forecasting | Assumed usage, pricing, infrastructure line items | YAML/admin settings and estimate responses | [cost-model.yaml](../server/config/cost-model.yaml), [costEstimatorService.ts](../server/src/services/costEstimatorService.ts). Forecasts are not incurred cost. |

Postgres stores SQL rows/JSONB and Firebase stores collections/documents. New storage must go through the [DB facade](../server/src/db.ts) in both adapters, with the memory adapter supporting meaningful tests.

Admin user-data reports cover 7-day, 30-day, and all-time windows: tier, visible trips, trip creations, successful generations, tokens, and API summaries. Some summaries use fallback estimates, so an API count must not be shown as a verified provider-call count without coverage metadata.

There is no general client feature/session event pipeline. The `AppState` and browser visibility listeners drive lifecycle and polling behavior, not analytics sessions.

## Goals and metric definitions

### 1. Feature adoption and value

Covers overview, itinerary, activities, transfers, lodging, car rentals, expenses/ledger, packing, chat, collaboration, imports, blog, and AI assistance.

| Metric | Definition | Decision it supports |
|---|---|---|
| Feature reach | Unique consenting users with a feature view ÷ consenting active users eligible for that feature in the window | Discoverability, navigation |
| Meaningful adoption | Unique consenting users with a completed meaningful action or engaged read ÷ eligible consenting active users | Value beyond opening a tab |
| Completion | Completed task attempts ÷ started attempts, deduplicated by operation ID | Workflow friction |
| Repeat use | First-time feature users who return within a stated interval ÷ mature first-use cohort | Sustained usefulness |
| Time to value | Time from signup or first trip to a defined useful outcome | Onboarding |

Every chart states its eligibility rule, window, sample size, and consent coverage. Feature flags, tier access, traveler role, and platform availability all change denominators. Reading an itinerary or reference counts as value, because record creation alone understates it.

### 2. User and trip economics

Measure direct cost by initiating user, trip, feature, provider/model, and month. Include billable failures, retries, async jobs, and background work. Keep cache hits and avoided inference separate from actual spend.

- **Direct attributable cost**, **allocated shared infrastructure cost**, and **total** are reported separately, with the allocation rule and its version visible.
- A shared job is allocated once. A trip with five travelers does not incur five copies of one provider bill.
- Direct cost is the sum of priced billable units. An unknown price stays **unknown**, never zero. Show attribution coverage, pricing coverage, and invoice reconciliation variance. Store USD microdollars and label estimates separately from invoiced adjustments.
- Useful views: median/p95 cost per user, cost by tier/feature/platform, cost per active trip, cost per successful generation/import, expensive-user distribution, contribution margin (with tax, refunds, store/payment fees handled consistently).

Cost metering is necessary operational processing and does not depend on the analytics toggle. Joining cost to optional behavioral data requires the user's analytics permission.

### 3. Application performance and task effectiveness

- **Technical:** cold start, trip-ready time, screen-ready latency, save latency, request failure rate, AI/import turnaround, crashes, hangs, connectivity failures. Report median/p95 and success rate by feature, platform, app version, and network category. Show sample rates.
- **Task:** wizard completion, invitation acceptance, time to first useful item, import corrections, AI-plan acceptance. Long reading time is not automatically friction. Distinguish intentional cancellation, failure, and inactivity abandonment.

### 4. Native versus web use

Record explicit platform (`web` / `ios` / `android`), web device category, browser/OS family, app version/build, and web standalone (installed PWA) mode when available. Never use advertising IDs, hardware identifiers, or fingerprinting.

Report unique users and sessions separately, with native-only, web-only, and both-platform cohorts. A mobile browser counts as web. Cross-device linkage uses only the signed-in account, and only with permission. Never infer that an unidentified browser and device are the same person.

### 5. Use during trips

Each trip-specific event is classified as `pre_trip`, `during_trip`, `post_trip`, or `unknown`. Classification uses the trip's inclusive start/end calendar dates in the trip's timezone, not the server's. Fallback order: segment timezone → trip timezone → `unknown`. Record the date/timezone version so later date edits do not silently rewrite history.

**During-trip engagement rate** = consenting eligible account travelers with meaningful engagement on that trip during its dates ÷ consenting eligible account travelers whose trip occurred in the window.

- Non-engagers stay in the denominator.
- Canceled trips, unregistered companions, and users without access at the time are excluded.
- Users with missing consent or unusable dates are reported as excluded/unknown coverage, not as inactive.

Also measure the share of trips with any engagement, engaged trip days, itinerary/detail reads, map-link opens, expense entry, packing, and chat. Events attach to the selected trip, so activity on an unrelated future trip does not count for a current one. Concurrent trips are classified separately.

These metrics show use **during scheduled travel dates**, not physical presence at the destination. GPS/location collection is out of scope.

## Behavioral event contract

One typed, versioned registry. Every event declares purpose, owner, allowed properties, units, emitting boundary, consent category, retention, and sampling. Shared models live in `server/src/types.ts`, and client input is validated with strict Zod schemas.

- **Envelope:** `event_id`, `schema_version`, `event_name`, `occurred_at`, `received_at`, `source`, `purpose`, `session_id` (where applicable), `platform`, `app_version`, `environment`.
- **Server-derived (clients cannot assert):** analytics subject ID, tier/role, authorized trip reference, consent revision/epoch.
- **Event-specific:** `feature`, `action`, `outcome`, `operation_id`, `trip_phase`, date/timezone version, allowlisted `properties`.

| Event family | Examples | Emitted from |
|---|---|---|
| Session | `session_started`, `engaged_session_summary` | Client foreground/visibility, consent-gated |
| Views | `feature_viewed`, `trip_reference_viewed` | Client, after real visible render |
| Tasks | `task_started`, `task_cancelled`, `task_failed` | Client, with a correlation ID per attempt |
| Confirmed outcomes | `trip_created`, `item_saved`, `invite_accepted`, `import_completed` | Server after the business outcome commits, consent-filtered |
| AI value | `itinerary_viewed`, `itinerary_edited`, `generation_requested` | Client/server as appropriate; viewing does not mean acceptance |
| Utility | `map_link_opened`, `report_exported`, `packing_item_checked` | Semantic action only; no link contents or item text |
| Operational ledger | `provider_attempt_settled`, `shared_cost_allocated` | Trusted server accounting, separate from optional behavior |

Example optional event (values illustrative):

~~~json
{
  "event_id": "event-uuid",
  "schema_version": 1,
  "event_name": "feature_viewed",
  "occurred_at": "2026-10-08T14:00:00Z",
  "received_at": "2026-10-08T14:00:01Z",
  "source": "client",
  "purpose": "product_analytics",
  "analytics_subject_id": "random-account-pseudonym",
  "session_id": "random-session-id",
  "platform": "ios",
  "app_version": "release-version",
  "environment": "production",
  "feature": "itinerary",
  "trip_ref": "restricted-trip-pseudonym",
  "trip_phase": "during_trip",
  "consent_revision": 3,
  "properties": { "entry_point": "trip_tab" }
}
~~~

A pseudonym is still personal data under GDPR while linkage is possible, and the docs and policies must say so.

**Sessions:** a new foreground session starts after 30 minutes of inactivity. Track bounded active intervals, not hidden time, and cap intervals after unexpected termination. No per-second heartbeats and no logging of every scroll or tap. Repeated renders, polling, prefetch, and background workers are not engagement.

**Never collected in behavioral events:** raw email/name, age, gender, home address, destination or place text, GPS, booking references, prompts, chat text, uploaded documents, financial transactions, full URLs/query strings, arbitrary exception messages. Import events may carry feature-level success/count metadata only after restricted-data review. Gmail and Plaid contents, and anything derived from them, never enter general analytics, as required by the Google API Limited Use policy and Plaid terms.

## Privacy behavior

### What the user sees

- **Account → Privacy** on web, iOS, and Android, plus a public **Privacy Choices** page on web.
- Two optional switches, both **off by default**:
  1. **Product analytics**: feature, session, platform, and trip-phase events described above.
  2. **Detailed diagnostics**: user-linked crash/performance details and session tracking in Sentry.
- A plain-language explanation of **necessary processing** (security logs, quotas, billing, cost metering, aggregate error monitoring) that has no misleading "off" switch.
- Links to export data, delete analytics data, delete the account, the privacy policy, and the cookie notice.

The first consent prompt offers **Accept**, **Reject**, and **Customize** with equal prominence. There are no preselected switches, no bundling with terms acceptance, no repeated nagging after refusal, and no loss of features or price difference for refusing.

### Consent states and enforcement

| State | Client behavior | Server behavior |
|---|---|---|
| Unknown / not yet asked | No optional SDK init, no event queue | Rejects optional events |
| Granted (epoch *n*) | Queues and sends events; detailed diagnostics enabled | Admits events stamped with the current epoch |
| Withdrawn | Stops producers, clears queue and identifiers, shuts down optional SDK features | Rejects new and in-flight events; deletion of history is a separate, explicit action |
| Notice changed materially | Treated as unknown until re-asked | Rejects until a new grant |

- The account-level choice is authoritative and server-enforced. Other devices pick it up on next foreground.
- Login, reinstall, or a new device never turns missing local permission into acceptance.
- Re-granting starts a new epoch. Events queued before withdrawal are never replayed.
- **Global Privacy Control** (web) and **Do Not Track** are treated as a refusal of optional analytics unless the user explicitly opts in afterwards.
- Store minimal, versioned consent evidence: choice, notice version, timestamp, platform. No IP address or device fingerprint.
- Collection flags default **off** when missing or unreadable. The entitlement system's fail-open rule does **not** apply to privacy.

### Platform-specific behavior

| Platform | Behavior |
|---|---|
| Web | Analytics storage uses `localStorage` only after consent and is cleared on withdrawal or logout. The cookie notice lists each key, purpose, and duration. Visiting the public privacy pages generates no optional analytics. |
| iOS | No IDFA and no App Tracking Transparency prompt, because nothing here meets Apple's definition of "tracking". Required-reason API use is declared in a privacy manifest. App Store privacy labels list Product Interaction, User ID, Device ID (push token), and Crash/Performance data, with their real linkage and purposes. Account deletion stays in-app. |
| Android | No advertising ID. `com.google.android.gms.permission.AD_ID` is removed from the merged manifest. The Play Data safety form lists App interactions, Device or other IDs, and Crash logs/Diagnostics as optional where applicable. In-app deletion plus a public web deletion URL. |

The consent switch, the iOS ATT prompt, and Android runtime permissions are independent controls, and none substitutes for another.

### Rights

Export, deletion, restriction, and objection cover linked analytics events, daily user/trip facts, pseudonym mappings, AI captures, identifiable logs, vendor data (Sentry), and attributable rollups. Removing a `user_id` while leaving trip linkage or JSON identity behind is not deletion. Small-group statistics are not automatically anonymous: cohorts below 10 are suppressed in reports and exports.

The [implementation plan](implementation_plans/analytics-upgrade.md#privacy-policy-and-web-page-deliverables) lists every policy page change, regulatory requirement, and release gate.

## Additional analytics (after the initial five views are trusted)

| Area | Measures |
|---|---|
| Activation | Signup → first trip → first useful item → first collaborator; elapsed time/drop-off |
| Retention | Same-trip return and next-trip planning; mature trip cohorts rather than daily retention |
| Collaboration | Invite acceptance, contributing members, organizer-only versus shared participation |
| AI value | Views, edits, regeneration, explicit acceptance, suggestions converted to planned items |
| Imports | Success, duplicates, user corrections, time to usable result |
| Monetization | Consented upgrade/checkout funnels, trials, conversion; necessary billing records separate |
| Notifications | Open and resulting action where measurable; delivery is not engagement |
| Acquisition | Allowlisted campaign/referrer category after permission; no raw referrer queries or cross-site profiles |
| Data quality | Consent coverage, missing context, deduplication, dropped batches, unknown cost, job freshness |

## Ease of analysis and maintenance

- **Five initial admin views** in `AdminTab`: feature adoption, cost, reliability, platform mix, trip-phase engagement. Each shows definition, window/timezone, units, numerator/denominator, consent coverage, freshness, and schema version, with bounded date/platform/tier/feature filters and privacy-safe CSV export.
- **Curated daily facts and additive rollups**, with explicit non-additive distinct-user logic. Never sum daily uniques into monthly uniques, average averages, or derive p95 from averages.
- **Purpose-separated datasets.** Operational, billing, and behavioral data stay in separate tables. Individual cost drill-down is restricted to authorized finance/operations admins. Routine product analysis uses aggregates with small-cohort suppression. No email lookup in product reports.
- **Existing infrastructure first.** No new analytics vendor or warehouse until measured volume, query latency, regional controls, or maintenance effort justify one. A daily CSV/BigQuery export is the expected upgrade path when ad-hoc analysis outgrows admin views.

Defaults, retention periods, and performance budgets are proposals in the implementation plan and must be verified before release.
