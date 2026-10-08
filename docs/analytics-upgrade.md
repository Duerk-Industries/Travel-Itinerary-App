# Analytics Upgrade: Collection, Goals, and Behavior

Status: proposed design; no new collection or policy changes are enabled by this document.
Assessment date: October 8, 2026.
Delivery details: [implementation plan](implementation_plans/analytics-upgrade.md).

## Purpose and scope

Understand which features deliver value, what users cost, how well the app performs, which platforms people use, and whether they use it during their trips. Build on existing accounting and diagnostics, with a small, consistent behavioral event system and explicit privacy choices.

This assessment describes repository implementation, not verified production collection. Before rollout, inventory deployed environment settings, database populations, provider retention, SDK traffic, and actual reporting coverage. Current operational data must not automatically become a historical behavioral dataset merely because it can be queried.

## Current collection and format

| Collection | Recorded information | Format/storage | Source and constraints |
|---|---|---|---|
| HTTP access | Time, method, original URL, status, duration, request ID | JSON lines in production/Cloud Run; text locally; console | [app.ts](../server/src/app.ts). Access entries omit explicit user/platform fields; URLs may include sensitive query values. Polling is not engagement. |
| Application/error logs | Processing messages, errors/stacks, request context, sometimes authenticated user ID | JSON/text to console and server/logs/api-info.log or api-error.log when writable | [logger.ts](../server/src/logger.ts). Redaction exists for metadata keys, but arbitrary message strings and URLs need review. |
| Per-user usage | Trip creations, successful itinerary generations, selected AI calls/tokens/estimated costs, weather and import-related operations | usage_events: user, metric key, numeric amount, JSON metadata, timestamp; usage_counters: user/metric/window totals | [entitlementService.ts](../server/src/services/entitlementService.ts), [OpenAI accounting](../server/src/apis/openaiApi.ts), [provider registry](../server/src/ai/registry/aiProviderRegistry.ts). Coverage depends on caller context and accounting settings. |
| Provider limits/budgets | Provider/caller/window usage; provider/window estimated spend | api_usage_counters; api_cost_counters with integer USD microdollars | [usageLimiter.ts](../server/src/apis/usageLimiter.ts), [providerBudgeting.ts](../server/src/apis/providerBudgeting.ts). Provider totals alone are not a complete user cost ledger. |
| Itinerary telemetry | User/trip, generation outcome, tokens, cost estimate, stage latency, parse failure, quality, cache/fallback and avoided inference | itinerary_generation_metrics: indexed columns plus JSON payload | [itineraryMetricsService.ts](../server/src/services/itineraryMetricsService.ts). Best-effort writes; capture configurable. User/trip linkage means this is not anonymous. |
| AI captures/evaluation | Parsing/generation captures, evaluations, experiments, provider/model/prompt and cost rollups | Gzipped JSON locally or Google Cloud Storage; database metrics by period/dimensions/key/value | [captureService.ts](../server/src/ai/capture/captureService.ts), [aggregationJob.ts](../server/src/ai/analytics/aggregationJob.ts). Inspected aggregation reads local captures; production object-storage completeness needs verification. |
| Ingestion operations | Job/stage outcomes, duplicates, retries, dead letters, quota and related LLM usage | Durable import records and admin JSON reports; queue gauges in memory | [ingestionMetricsService.ts](../server/src/services/ingestionMetricsService.ts), [admin reference](admin.md). Pipeline/configuration dependent. |
| Trip activity | Selected changes, actor, trip, type, metadata, timestamps | trip_activity records; grouped feed output | [activityFeed.ts](../server/src/services/activityFeed.ts). Contributions are observable; passive reading and abandoned actions are not. |
| Admin audit | Actor/target, before/after, reason, timestamp | audit_log rows/documents | [admin reference](admin.md). Administrative actions, not customer engagement. |
| Sentry | Client/server crashes and sampled performance; client auto-session tracking | Sentry events/traces; default trace sampling 10% | [client bootstrap](../app/utils/sentry.ts), [server bootstrap](../server/src/instrument.ts), [Sentry guide](sentry.md). DSN gated; replay disabled. Client initialization currently precedes a user privacy choice. |
| Server counters/gauges | Cache totals/ratios and queue depths | Per-process maps; admin JSON and /metrics Prometheus text | [metrics.ts](../server/src/metrics.ts), [Prometheus route](../server/src/routes/prometheusRoutes.ts). Restart resets; counters discard caller labels; recordTiming currently retains/exports nothing. Revision-based instance labeling needs verification for multiple instances. |
| Cost forecasting | Assumed usage, pricing and infrastructure line items | YAML/admin settings and estimate responses | [cost-model.yaml](../server/config/cost-model.yaml), [costEstimatorService.ts](../server/src/services/costEstimatorService.ts). Forecasts are distinct from incurred costs. |

Postgres uses SQL rows/JSONB; Firebase uses collections/documents. New storage and queries must work through the [DB facade](../server/src/db.ts) in both adapters, with the memory adapter supporting meaningful tests.

Existing admin user-data reports support 7-day, 30-day and all-time usage windows. They include tier, visible trips, trip creations, successful generations, tokens and API summaries. Some summaries use fallback estimates, so an API count must not be presented as a verified provider-call count without coverage metadata.

No general client feature/session event pipeline was found. AppState and browser visibility listeners currently support lifecycle/polling behavior, not a comprehensive analytics session model.

## Goals and metric definitions

### 1. Feature adoption and value

Track feature views and meaningful outcomes for overview, itinerary, activities, transfers, lodging, car rentals, expenses/ledger, packing, chat, collaboration, imports and AI assistance.

| Metric | Definition | Product decision |
|---|---|---|
| Feature reach | Unique consenting users with a feature view / consenting active users eligible for that feature in the same window | Discoverability and navigation |
| Meaningful adoption | Unique consenting users with a completed meaningful action or engaged read / eligible consenting active users | Value beyond opening a tab |
| Completion | Completed task attempts / started task attempts, deduplicated by operation ID | Workflow friction |
| Repeat use | First-time feature users who use it again within a stated interval / mature first-use cohort | Sustained usefulness |
| Time to value | Time from signup or first trip creation to a defined useful outcome | Onboarding improvements |

State the eligibility rule, time window, sample size and consent coverage on every chart. Feature flags, tier access, traveler role and platform availability affect denominators. Read-only itinerary/reference use counts as value; record creation alone understates it.

### 2. User and trip economics

Measure direct cost by initiating user, trip, feature, provider/model and month. Record billable failures, retries, asynchronous jobs and background work; separate cache hits and avoided inference from actual spend.

Report direct attributable cost, allocated shared infrastructure cost, and their total separately. Keep allocation rules and versions visible. Allocate shared jobs once; a trip with five travelers does not incur five copies of one provider bill.

Direct cost = sum of priced billable units. Unknown prices remain unknown, never zero. Show attribution coverage, pricing coverage and invoice reconciliation variance. Store USD microdollars for precision and label estimates versus invoiced adjustments.

Useful views: median/p95 user cost, cost by tier/feature/platform, cost per active trip, cost per successful generation/import, expensive-user distribution and contribution margin. Keep tax, refunds, store/payment fees and revenue periods consistent when reporting margin. Operational metering has its own justified purpose; behavioral joins require the appropriate permission.

### 3. Application performance and task effectiveness

Technical measures: startup, trip-ready time, screen-ready latency, save latency, request failures, AI/import turnaround, crashes, hangs and connectivity failures. Report median/p95 and success rate by feature, platform, app version and network category; show sample rates.

Task measures: wizard completion, invitation acceptance, time to add the first useful item, import correction and AI-plan acceptance. Long reading time is not automatically friction. Distinguish intentional cancellation, failure and inactivity abandonment.

### 4. Native versus web use

Record explicit platform (web/iOS/Android), web device category, browser/OS family, app version/build, and web standalone mode when available. Avoid advertising IDs, hardware identifiers and fingerprinting.

Report unique users and sessions separately, with native-only, web-only and both-platform cohorts. A mobile browser remains web. Cross-device linkage uses the signed-in account only when permitted; do not infer that an unidentified browser and device are the same person.

### 5. Use during trips

Classify trip-specific engagement as pre-trip, during-trip, post-trip or unknown from the relevant trip's scheduled dates and defined timezone. Use inclusive trip-local start/end calendar dates, not server-local dates. Preserve phase/date-version context for history; use a defined trip timezone, segment timezone where available, and an explicit fallback/unknown rule.

During-trip engagement rate = consenting eligible account travelers with meaningful engagement on that trip during its dates / consenting eligible account travelers whose scheduled trip occurred in the measurement window. Include non-engagers in the denominator. Exclude canceled trips, unregistered companions and users who lacked access then. Show users missing consent or usable dates as excluded/unknown coverage, not inactive users.

Also measure the share of eligible trips with engagement, engaged trip days, itinerary/detail reads, map links, expense entry, packing and chat. Associate events with the selected trip; activity on an unrelated future trip does not count for an ongoing trip. Multiple concurrent trips are classified separately.

These metrics establish usage during scheduled travel dates, not physical destination presence. GPS collection is outside this upgrade.

## Behavioral event contract

Maintain one typed, versioned registry. Every event declares purpose, owner, allowed properties, units, emitting boundary, consent category, retention and sampling. Define shared models in server/src/types.ts; validate client input with strict Zod schemas.

Required envelope: event_id, schema_version, event_name, occurred_at, received_at, source, purpose, session_id where applicable, platform, app_version and environment. Server-derived fields include permitted analytics subject ID, tier/role, authorized trip reference and current consent revision. Event-specific fields include feature, action, outcome, operation_id, trip_phase, date/timezone version and allowlisted properties.

| Event family | Examples | Boundary |
|---|---|---|
| Session | session_started, engaged_session_summary | Client foreground/visibility, subject to consent |
| Views | feature_viewed, trip_reference_viewed | Client after actual visible rendering |
| Tasks | task_started, task_cancelled, task_failed | Client; correlation ID for the attempt |
| Confirmed outcomes | trip_created, item_saved, invite_accepted, import_completed | Server after confirmed business outcome, separately consent-filtered |
| AI value | itinerary_viewed, itinerary_edited, generation_requested | Client/server as appropriate; do not assume viewing means acceptance |
| Utility | map_link_opened, report_exported, packing_item_checked | Semantic action; omit link contents and item text |
| Operational ledger | provider_attempt_settled, shared_cost_allocated | Trusted server accounting, separate from optional behavior |

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

The server adds identity/authorization/consent fields; clients cannot assert them. A pseudonym remains personal data when linkage is possible.

Suggested session rule: a new foreground session after 30 minutes of inactivity. Track bounded active intervals rather than time while hidden; cap intervals after unexpected termination. Do not emit per-second heartbeats or every scroll/tap. Treat repeated renders, polling, prefetch and background workers separately from engagement.

Prohibit raw email/name, age/gender, home address, destination text, GPS, booking references, prompts, chat text, uploaded documents, financial transactions, full URLs/query strings and arbitrary exception messages in behavioral properties. Allow feature-only import success/count metadata after a restricted-data policy review; never copy Gmail/Plaid contents or content-derived profiles into general analytics.

## Privacy behavior

Provide Account > Privacy on web/iOS/Android, plus a public privacy-choices entry point. Separate optional product analytics from optional detailed diagnostics. Necessary service/security/billing/quota processing is explained rather than offered as a misleading disable switch.

Default optional collection off globally as the simplest conservative product policy. This is a design choice, not a claim that every jurisdiction mandates consent for every server metric. Unknown, unavailable or expired permission blocks optional collection. Privacy denial must not block requested travel features, billing metering or lawful security controls.

Accept, reject and customize must be equally accessible; no preselected optional switches, bundled terms acceptance or payment/feature penalty. Store minimal versioned consent evidence. Withdrawal immediately stops local collection, deletes queued optional events/identifiers, and rejects stale server submissions. Other devices fetch current settings on foreground; server enforcement remains authoritative while an old device is offline.

Existing frontend Sentry startup must be redesigned to avoid optional SDK initialization before permission, including automatic session/breadcrumb/network collection. Necessary server diagnostics need a documented narrow basis and minimized configuration. Legal consent, operating-system permissions and Apple ATT are independent controls.

Export/delete/restrict/object workflows must cover linked analytics, captures, logs where identifiable, vendor data, and attributable rollups. Removing a user_id while leaving trip linkage or JSON identity is insufficient. Small-group statistics are not automatically anonymous.

See the [implementation plan's privacy and policy requirements](implementation_plans/analytics-upgrade.md#privacy-policy-and-web-page-deliverables) for the release gates and source references.

## Additional analytics

| Area | Measures |
|---|---|
| Activation | Signup, first trip, first useful item, first collaborator; elapsed time/drop-off |
| Retention | Same-trip return and subsequent-trip planning; mature trip cohorts rather than daily retention alone |
| Collaboration | Invitation acceptance, contributing members, organizer-only versus shared participation |
| AI value | Views, edits, regeneration, explicit acceptance where supported, suggestions converted to planned items |
| Imports | Success, duplicates, user corrections and time to usable result |
| Monetization | Consented upgrade/checkout funnels, trials and conversion; necessary billing records separate |
| Notifications | Open and resulting action, where technically measurable; delivery is not engagement |
| Acquisition | Allowlisted campaign/referrer category after permission; no raw referrer queries or cross-site profiles |
| Data quality | Consent coverage, missing context, deduplication, dropped batches, unknown cost and job freshness |

## Ease of analysis and maintenance

Provide five initial admin views: feature adoption, cost, reliability, platform mix and trip-phase engagement. Each chart exposes definition, window/timezone, units, numerator/denominator, coverage, freshness and schema version. Support bounded date/platform/tier/feature filters and privacy-safe CSV export.

Use curated daily user/trip facts and additive aggregates, with explicit non-additive distinct-user logic. Do not sum daily distinct users to calculate monthly uniques, average averages or calculate p95 from averages. Store eligible-population history, consent state and feature availability as needed for defensible denominators; minimize retained linkage.

Keep operational, billing and behavioral datasets purpose-separated. Restrict individual cost drill-down to authorized finance/operations roles; routine product analysis uses aggregates with small-cohort suppression. Avoid unrestricted email lookup in product reports.

Prefer existing infrastructure for the initial bounded dataset. Do not add a new analytics vendor or warehouse until measured volume, query latency, regional controls or maintenance effort justify it. All defaults, retention periods and performance budgets are proposed in the implementation plan and must be verified before release.
