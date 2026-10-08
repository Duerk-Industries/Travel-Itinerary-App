# Analytics Upgrade Implementation Plan

Status: proposed; documentation only.
Created: October 8, 2026.
Design and collection inventory: [Analytics Upgrade](../analytics-upgrade.md).

## Outcome and delivery rules

Deliver reliable reporting for feature use, cost per user/trip, technical and task performance, native/web use, and engagement during scheduled trips. Implement privacy controls and matching public disclosures before optional collection starts.

This plan provides compliance capabilities and release evidence; it does not certify GDPR or app-store compliance. The privacy owner must resolve jurisdiction, controller, lawful-basis, provider-contract and retention questions against actual deployment. Recheck official rules before release because requirements change.

Use strict TypeScript, shared types in server/src/types.ts, Zod validation, the existing DB facade, getEnvValue/getEnvFlag and logInfo/logError. Implement Postgres and Firebase operations together, plus the memory adapter where applicable. Add migrations using the repository's existing server/migrations convention. Preserve existing quota accounting and API aliases.

No vendor selection, service provisioning, publishing or new SDK purchase is authorized by this documentation change. Initial delivery uses existing application infrastructure; a later architecture decision must justify additional services with observed costs and requirements.

## Findings that affect implementation

1. Existing usage_events and AI accounting are a useful foundation, but do not cover all provider attempts or user behavior. Avoid counting the same AI operation in both old accounting and a new ledger.
2. recordTiming in server/src/metrics.ts currently reaches a no-op emitter. Counters are keyed by name and lose labels; instance identity may be a revision shared by several replicas. Fix these before claiming percentile or instance-level reporting.
3. AI capture storage supports Cloud Storage, while the inspected aggregation job reads local files. A successful aggregation job may therefore miss production captures.
4. Frontend Sentry is initialized at entry before account preferences are known. Optional diagnostics cannot be controlled only by a settings switch added later.
5. server/src/services/userDataExport.ts currently exports account/trip/authored-item/billing data but has no analytics or consent section. Existing deletion cascades do not establish complete removal of captures, nested metrics, logs or external telemetry.
6. /privacy uses server/src/legal/privacyPolicyHtml.ts; account.tsx links /privacy.html from app/public/privacy.html. These disagree on operator/contact, minimum age, detail and effective date. docs/legal/privacy-policy.md follows the older disclosure. Resolve facts rather than silently choosing one.
7. The current cookie page promises required choices for optional technologies. An implemented and verified consent flow must back that promise.

## Architecture and storage

Separate three processing paths:

| Path | Purpose | Reliability and privacy rule |
|---|---|---|
| Optional behavioral events | Views, tasks, engagement and product funnels | Fail closed on unknown consent; collection failure must not break a travel action |
| Operational/accounting records | Service delivery, quotas, justified security and cost administration | Preserve existing required accounting; document basis and never silently repurpose as behavioral tracking |
| Optional detailed diagnostics | User-linked client performance/crash/session details | Permission-aware initialization and scrubbing; aggregate necessary reliability metrics remain narrowly scoped |

Proposed tables/collections:

- privacy_preferences: current product_analytics and optional_diagnostics choices, revision, notice version and timestamps; essential processing descriptions are not optional flags.
- privacy_choice_events: minimal consent/withdrawal evidence and notice versions, without behavioral payloads or unnecessary IP/device identifiers.
- analytics_subjects: random per-account pseudonym mapping in a restricted store; no email-hash pseudonyms. Delete/rotate as required and prevent stitching across withdrawal/regrant periods unless specifically justified.
- analytics_events: validated immutable envelopes and allowlisted properties, indexed by time/subject/event/feature; idempotent event ID. Optional trip pseudonyms and operation IDs remain restricted personal data.
- analytics_eligible_daily: minimal consented eligible-user/trip/access/feature facts for denominator calculations, treated as personal data and deletable.
- provider_cost_ledger: unique provider attempt, units, price version, user/trip/feature attribution, outcome, source, currency and reconciliation state.
- analytics_daily_facts / analytics_rollups: bounded query shapes, definitions and aggregation version. User/trip facts are personal; only assessed sufficiently anonymous aggregates qualify for longer retention.
- analytics_job_runs: durable cursor, lease, version, freshness, counts and errors; no raw payloads in job logs.

Use named numeric fields for frequent dimensions and bounded JSON for uncommon event properties. Postgres time indexes and Firebase composite indexes/query limits must be designed from the same supported admin queries. Firebase cannot rely on scanning all events for interactive reports; precompute required views. Avoid per-user/operation identifiers as metric labels.

Daily jobs must use durable leases/cursors and idempotent upserts across replicas. Aggregation retries replace or reconcile the same input period; they must not add counts twice. Process late events with a documented watermark and bounded recomputation. Expose partial coverage if data has expired.

## Phase 0: Inventory, definitions and privacy decisions

Owners: product lead, backend lead and privacy owner.

- Verify actual production DB provider, enabled Sentry/capture settings, existing volumes, SDK network traffic, vendor contracts, data regions and retention. Record facts without copying secrets.
- Inventory every outbound provider path, including AI registry/direct callers, Places/maps, photography, email, weather, imports and background jobs. Mark currently attributable, priced and billable-failure coverage.
- Approve an event/metric dictionary from the design, including eligibility, consent population, session rule, trip timezone behavior, outcome semantics and allowed dimensions.
- Maintain a processing register covering purpose, data, basis, recipients, retention, rights handling and transfers. Perform DPIA screening; conduct an assessment if the proposed processing meets the applicable high-risk criteria.
- Document necessary metering/security purposes and any legitimate-interests balancing. Do not label broad feature tracking necessary merely because it helps the business.
- Resolve controller/contact/minimum-age conflicts, territorial reach, EU/UK representative and DPO applicability, and legal-retention schedules. A policy statement of “not applicable” is not the assessment.
- Approve global default-off optional analytics/diagnostics and separate controls. If later relying on a regional analytics exemption, document its exact conditions and implement it as a reviewed exception.

Acceptance: signed-off dictionary, deployment inventory, coverage map, lawful-purpose register, retention proposal and policy gap list exist. Optional collection remains off.

## Phase 1: Privacy settings and enforcement

Owners: frontend/backend leads and privacy owner. Dependency: Phase 0.

- Add Account > Privacy, accessible consent UI on all three platforms, and public Privacy Choices access on web. Explain analytics, optional diagnostics, essential processing, withdrawal, export and deletion in plain language.
- Provide equally accessible accept optional, reject optional and customize choices; no preselected optional switches, repeated nagging or loss of core service after refusal.
- Add proposed GET/PATCH /api/account/privacy-preferences endpoints with authenticated ownership, optimistic revision checks, server timestamps and append-only minimal choice evidence. No admin can grant consent on another user's behalf.
- Resolve account versus device choices: account withdrawal applies everywhere; a device/session denial remains restrictive until explicit action changes it. A login, reinstall or new device must not convert absence of local permission into acceptance.
- Fetch current permission at bootstrap/foreground. Cache minimally for UI continuity, but the server checks authoritative state for every optional batch and optional server event. A stale allow cache must not admit events after withdrawal.
- Client states: unknown/off, granted, withdrawn and obsolete-notice. Unknown/off states neither initialize optional SDK collection nor create optional event queues.
- Regrant starts a new permission epoch. Reject old-epoch queued events even if the account is opted in again; do not replay pre-consent history.
- Withdrawal stops producers immediately, disables SDK integrations, clears optional storage/identifiers and cancels flushes/retries. Server admission and deletion workers prevent queued/in-flight events from recreating purged data.
- Redesign app/utils/sentry.ts and AppEntry.js so optional session/breadcrumb/performance collection waits for permission. Audit native auto-start behavior. On withdrawal, close/disable or replace the client and discard pending events; do not assume a UI flag stops an SDK.
- Review server/src/instrument.ts separately for narrowly necessary diagnostics: disable unnecessary user/IP/body capture, scrub query values and apply scoped retention. Do not force essential server protection to depend on a user's optional choice.
- Add explicit analytics collection flags and kill switches, default off when missing/unreadable. Existing entitlement fail-open behavior does not apply to privacy permission. Disabled collection must still permit consent updates and rights processing.

Acceptance: network/storage evidence shows zero optional data before permission and after withdrawal, including error paths, login changes and stale devices. Core trip, quota and billing behavior passes regression checks.

## Phase 2: Event pipeline and initial feature instrumentation

Owners: frontend/backend leads. Dependencies: Phase 1 and initial policy deliverables.

- Create a small client analytics utility/hook and shared registry. Keep API helpers co-located with owning features under repository conventions; analytics is a cross-cutting utility rather than a new centralized business API layer.
- Instrument app/App.tsx routing/trip selection and feature boundaries, avoiding duplicate render/effect events. Begin with trip references, itinerary, activities, lodging, transfers, expenses, packing, imports and collaboration.
- Mount proposed POST /api/analytics/events; require authenticated user for initial product collection. Defer anonymous acquisition tracking to a separate consent/storage design.
- Validate batch size, schema versions, event names, property types/lengths and timestamp bounds. Derive subject and consent from auth, verify trip access, normalize platform claims and reject spoofed identity fields.
- Proposed limits: 20 events per batch, 32 KiB request payload, flush after 30 seconds while active, maximum 100 queued events and 24-hour expiry. Use bounded retry/backoff, deduplication and explicit accepted/rejected counts. No retry loop for denied consent.
- Keep initial queue in memory to minimize storage/access complexity. If later adding durable offline queues, require encrypted appropriate storage, expiry, withdrawal purge and policy inventory first. Report lost offline events as coverage limitations.
- Use server completion events after a committed outcome; separate authoritative business records from consent-filtered product events. Analytics failure cannot roll back the business action.
- Capture trip phase through a reusable server utility with date/timezone-version context. Apply late-event permissions and access rules; do not rely on mutable current dates to rewrite historical phase silently.
- Use session summaries with bounded foreground intervals; never use API polls as active sessions. Mark admins, automated checks, prefetch and background workers for exclusion.

Acceptance: golden fixture journeys produce the expected deduplicated events/phase classifications and contain no prohibited properties. Consent-denied journeys produce no optional events.

## Phase 3: Cost attribution and performance

Owners: backend lead and finance/operations owner. Dependency: Phase 0; optional user-linked diagnostics also require Phase 1.

- Route all cost recording through one trusted settlement API. Include attempt ID, provider/model/caller, feature, initiating user, trip, units, cache status, failure/retry state and price version. Preserve budget/quota reservations separately from settled cost.
- Audit existing openaiApi and aiProviderRegistry accounting to prevent duplicate settlement and retain compatibility. Add uniqueness and durable recovery for accounting writes; report settlement failures instead of silently understating spend.
- Include calls without a user as system/unattributed. Classify background and shared-trip cost once, with an explicit allocation rule. Store adjustments rather than overwriting original estimates.
- Test units against invoices and rate configuration, including cached-token pricing and non-token request units where relevant. Unknown rates/usage get an unknown status. Forecasts, avoided cost and billed expense must remain distinct.
- Define allocation v1 (for example, monthly shared infrastructure divided by active service accounts) and show alternatives/sensitivity; finance approves the basis. Distinguish operational activity used for allocation from consented product engagement.
- Add monthly invoice reconciliation with provider credits, refunds, committed spend and currency conversion metadata. Publish direct-cost coverage and unexplained variance.
- Retain timings as bounded histograms or a verified exporter; preserve low-cardinality labels. Provide an actual unique process identity and prevent counter loss from masquerading as falling activity.
- Add screen/trip readiness spans and user task outcomes under permitted diagnostics/analytics categories. Use available browser performance APIs for web and native startup/frame evidence where supported; do not claim native p95 without measurements.
- Connect request/job IDs across logs and spans without exporting raw account/trip identifiers broadly. Protect /metrics from sensitive or unbounded dimensions.
- Correct AI aggregation to process the configured capture backend with durable cursors and permissions; do not duplicate expensive capture reads per instance.

Acceptance: synthetic successful/failed/retried/cached calls reconcile exactly; dashboards distinguish unknown, estimated and billed costs. Performance measurements are actually retained, bounded and explain their sampling.

## Phase 4: Rights, retention and policy delivery

Owners: backend lead and privacy owner. Dependency: new schemas and consent enforcement.

- Extend userDataExport.ts and export schema to include preferences/history, linked behavioral data, costs and diagnostic/AI metadata where applicable. Provide machine-readable exports with pagination or asynchronous delivery for large accounts and secure expiry on download links.
- Map access/correction/erasure/restriction/objection/portability requests to actual stores. Portability has legal scope distinct from general access. Do not expose other travelers' information through exports.
- Extend deletion to nested JSON identities, pseudonym mappings, trip-linked analytics, raw events, user/trip facts, captures, processor data and relevant logs. Verify Postgres and Firebase independently.
- Retain only genuinely necessary billing/security/consent evidence under documented exceptions, access controls and schedules. Shared-product content is a separate rights/store-policy review; retaining collaboration context does not justify retaining analytics linkage.
- Withdrawal stops new optional processing; it does not automatically mean every historic record is legally erased. Offer a clear separate delete-analytics/request-erasure action and implement the approved retention/basis decision.
- Suppress/rebuild attributable rollups after erasure. Retain aggregates only after re-identification assessment; proposed minimum cohort 10 is a guardrail, not proof of anonymity. Prevent drill-down/export filter differencing from revealing small groups.
- Use durable deletion jobs with retries, tombstones, provider confirmation and status. Guard event ingestion, settlement and rollup replay against deleted/restricted subjects; satisfy any lawful metering requirement without resurrecting analytics.
- Backups expire on a documented cycle. Restoration must reapply deletion/withdrawal tombstones before serving or reprocessing data. Logs/object storage/vendor data need lifecycle configuration, not only SQL cascades.
- Track rights deadlines and exceptions with identity verification proportional to the request. GDPR requests generally require a response within one month; implement escalation and valid-extension notices rather than treating a cron SLA as the legal deadline. [European Commission rights guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en)

Proposed engineering defaults, to approve against actual purposes/provider capabilities:

| Data | Proposed limit | Enforcement |
|---|---|---|
| In-memory optional queue | 24 hours or withdrawal/logout | Client expiry and purge |
| Raw behavioral events | 90 days | Daily deletion job plus DB TTL/lifecycle where available |
| Linked daily user/trip facts | 13 months | Scheduled purge and subject erasure |
| Minimized diagnostic logs/traces | 30 days | Cloud/vendor/local rotation and scrubbing |
| AI captures | At most 30 days for diagnostics; shorter where restricted-data terms require | Capture/object lifecycle plus subject deletion; no default extension for product analysis |
| Assessed anonymous aggregates | 25 months then review/purge | Aggregate lifecycle and disclosure-control review |
| Cost ledger, billing, consent evidence | Purpose-specific schedule approved in Phase 0 | Separate restricted stores and documented legal holds; no indefinite blanket retention |

These are proposed limits, not descriptions of existing retention or statutory defaults. Publish only schedules that have been configured and tested.

### Privacy policy and web page deliverables

Make policy updates a release dependency, not a follow-up task:

| Surface | Required change and verification |
|---|---|
| docs/legal/privacy-policy.md | Canonical reviewed notice: resolve controller/contact/age, then add analytics purposes, fields, basis, choices, recipients, retention, rights and transfers. Maintain version/effective date and change summary. |
| app/public/privacy.html | Render the canonical approved notice. Replace generic optional-analytics language with the actual collection/controls and precise retention. Preserve Gmail/Plaid restricted-use promises. |
| server/src/legal/privacyPolicyHtml.ts and /privacy | Generate from the same approved source or serve/redirect to the canonical page; eliminate contradictory embedded text. Test both routes in the production bundle. |
| app/public/cookies.html | Inventory analytics preference/session storage, SDK storage, duration, operator and purposes. Link a working manage-preferences control. Describe necessary storage separately from optional technologies. |
| app/public/privacy-choices.html (proposed) | Public explanation and working browser choices; account-wide settings require sign-in. Provide access/export/deletion routes and contact fallback. Page visitors must not generate optional analytics before permission. |
| app/public/delete-account.html (proposed) | Public deletion-request path identifying app/operator, verification, scope, retained exceptions and timing. Support requests without reinstalling; link directly in Play Console. |
| app/tabs/account.tsx and AccountProfileManagement.tsx | Add native/web Privacy settings and consistent notice, export and deletion links. Keep destructive confirmation proportional and do not require support contact for normal in-app deletion. |
| server/src/app.ts and deployment exports | Verify /privacy, /privacy.html, /cookies.html and new choice/deletion pages on deployed routes; provide stable aliases and avoid SPA fallback masking missing pages. |
| Store metadata and docs/app-store-review-packet.md | Update privacy/data-safety labels, policy/choices/deletion URLs, SDK inventory and reviewer steps/screenshots to match the built apps. |
| docs/sentry.md, docs/admin.md and docs/feature-flags.md | Document permission gating, diagnostic retention/sampling, metric definitions, coverage, controls and rollout flags. |

Required notice content: data categories and sources; optional feature/session/platform/trip-phase collection; pseudonymous linkage; direct/allocated cost metering; necessary versus optional purposes; consent/withdrawal; rights and complaint channels; retention; recipients and regions; lawful transfer safeguards; no GPS inference claim; no advertising IDs/fingerprinting/replay in this scope; how nonconsenting users affect reports. Do not promise anonymity, universal deletion or vendor behavior that implementation cannot demonstrate.

Publish a purpose/data/recipient matrix and appropriate processor agreements. Verify access to processors, subprocessor changes and international transfers; EU SCCs or another valid mechanism require assessment, not just naming them in a policy. [European Commission transfer guidance](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)

## Regulatory and mobile release requirements

### GDPR, ePrivacy and related laws

Use purpose limitation, minimization, retention and accountable access controls throughout. Record consent evidence and allow withdrawal without making core features conditional on optional tracking. Evaluate EU ePrivacy/national implementation and UK PECR storage/access rules independently from the personal-data processing basis; using localStorage or a native SDK instead of cookies is not an automatic exemption. This plan deliberately chooses opt-in globally, including where reviewed statistical exceptions might permit another approach. [EDPB consent guidance](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en), [ICO storage/access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)

Maintain a jurisdiction/applicability matrix for EU/EEA, UK, relevant US states and launch markets, including Canada's PIPEDA/provincial requirements and other applicable local laws. Validate age requirements without adding demographic analytics. Prohibit secondary behavioral profiling of non-account companions or minors from travel documents.

For applicable US state laws, support required access/correction/deletion/appeal and sale/sharing/targeted-advertising opt-outs, non-discrimination and recognized universal opt-out signals. This design includes no sale or targeted advertising; do not mislabel necessary service-provider processing as a sale or claim that every analytics toggle is a statutory sale opt-out. Honor GPC for its applicable legal purpose and, as a conservative product rule, keep optional analytics off when it is present unless a reviewed flow resolves the choice. [California Attorney General CCPA guidance](https://oag.ca.gov/privacy/ccpa)

Keep an incident-response and privacy-review process for new events, SDK upgrades and exports. Assess third-party Gmail/Plaid contractual restrictions separately: consent to product analytics does not authorize content reuse forbidden by API agreements.

### iPhone/iOS

Update App Store Connect disclosures for actual Product Interaction, User ID and diagnostics, purposes and linkage. Account pseudonyms are not automatically unlinked data. Include optional collection when required by Apple's disclosure criteria. Provide public policy and choices URLs. [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/)

The proposed first-party product analytics does not intentionally combine data with other companies' data for advertising or share with brokers. Validate all SDK behavior before deciding ATT is unnecessary; if tracking is introduced, gate it on ATT plus applicable legal permission. ATT is not GDPR consent. No IDFA access or fingerprinting is part of this plan. [Apple privacy and ATT guidance](https://developer.apple.com/app-store/user-privacy-and-data-use/)

Review app/app.config.ts, Expo generated native output and SDK versions for PrivacyInfo.xcprivacy, declared collection, required-reason API declarations and applicable SDK signatures. Validate the archived app/Xcode privacy report, not only the JavaScript configuration. [Apple SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)

Verify in-app initiation of complete account deletion, linked analytics removal and understandable retained exceptions; do not substitute deactivation or a support-only flow. [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)

### Android/Google Play

Update Data safety for actual app interactions, identifiers and diagnostics, purposes, linkage, collection/sharing classifications, optionality, security and deletion. Include SDK collection and validate any service-provider exceptions under Google's definitions. [Google Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)

Review all SDK permissions and remove unnecessary AD_ID/location permissions from the final merged manifest. Provide prominent in-app disclosure and consent when Google's policy requires it, independently of Android runtime permissions. Keep public privacy policy accurate and accessible. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)

Verify both in-app deletion and the external web deletion-request route and its Play Console URL. Disclose lawful retention exceptions. [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

Store labels, manifests and policy pages are complementary deliverables; none substitutes for actual permission enforcement or rights processing.

## Phase 5: Reporting, ease of analysis and access

Owners: product/backend/frontend leads. Dependencies: privacy/rights gates and validated collection.

- Extend AdminTab with aggregate feature adoption, cost, reliability, platform and trip-phase views. Reuse existing admin APIs/components with bounded, paginated endpoints and server RBAC.
- Show definition, units, date window/timezone, eligible population, consenting population, numerator/denominator, sampling, freshness and unknowns on every view. Consent-biased samples must not be labeled all users.
- Version metric calculations and curate query/read models; index frequently used filters. Support CSV with definition/version metadata and suppression consistent with the UI.
- Use consented eligible-population facts for feature/trip engagement denominators and appropriately justified operational populations for cost. Keep them purpose-separated.
- Apply least privilege: aggregate product views by default, restricted cost/user investigation, audited access/export, no public behavioral reports or direct database email joins.
- Do not sum daily unique users for month-level uniques, average p95s, or average rates without denominators. Use bounded histograms/sketches or raw permitted measures for percentiles; validate native and web coverage.
- Add activation, collaboration, next-trip retention, AI value and monetization views only after the initial reports are trusted.

Acceptance: fixture reports match independently calculated expected results, explain exclusions and enforce small-cohort/export controls.

## Performance, cost and maintainability budgets

Initial targets below are engineering acceptance budgets, not measured current behavior:

- Disabled analytics adds no optional network requests or persistent analytics writes.
- Foreground instrumentation: p95 below 2 ms per local event on supported reference devices; no synchronous network/storage in render paths.
- Product mutations: analytics adds at most 5 ms p95 synchronous work under representative load; optional persistence runs outside the response path.
- Ingest: p95 below 200 ms for the supported batch at forecast peak, tested separately on deployed Postgres/Firebase shapes.
- Admin reports: p95 below 2 seconds for supported 30-day views; no request scans the complete event collection.
- Daily jobs: freshness within 24 hours, explicit alerts on missed runs, durable coordination; dashboards state the actual lag.
- Behavior collection remains unsampled initially at a low event volume. If later sampled, document inclusion/weights and avoid biased funnel/unique-user calculations. Diagnostics starts with explicit low sampling, reviewed against error visibility.

Model monthly overhead from consenting MAU x sessions/user x events/session, batch writes, indexes, rollup reads, retention bytes, vendor event quotas, jobs, export/deletion, logging and egress. Include multiple Firebase writes/index overhead rather than assuming batching makes writes free.

Set a dollar cap with the operations owner from measured baseline and model sensitivity at 1x/5x/10x expected usage; alert at 80% and 100%. Degrade optional detail/sampling or disable optional collection if approved budgets are exceeded, while preserving privacy choices and required accounting. Do not log every event or copy payloads into exception output.

Maintain one registry and calculation layer, shared constants, adapter contract tests and explicit owners. Reject arbitrary auto-capture. Review new event proposals for product question, schema, permission, retention and expected volume. Add new infrastructure only after query/cost evidence establishes a need.

## Test coverage and validation

| Layer | Required meaningful cases |
|---|---|
| Pure utilities | Registry validation, session inactivity/foreground caps, timezone/DST/inclusive boundaries, invalid/missing dates, concurrent trips, arithmetic/units and unknown pricing |
| Client/Jest | Zero collection before permission, equal reject path, reload/account-switch behavior, consent sync errors, stale epoch/regrant, withdrawal during flush, bounded queue/offline expiry, duplicate renders and SDK shutdown |
| API/Supertest | Auth, user/trip spoofing, invalid schema/oversized batches, deduplication, denied/withdrawn consent, stale revisions, feature flags off/missing, deletion races and abuse limits |
| Adapter integration | Postgres/Firebase parity, index/query behavior, batch transactions, concurrent ingestion, leases/idempotent jobs, retention purge and nested-data erasure; memory tests alone do not establish Firebase behavior |
| Cost | Each provider path, retries/failures/cache/shared/system attribution, reservation versus settlement, double-record protection, known/unknown rates, credits and invoice fixtures |
| Reports | Golden journeys, zero/nonzero denominators, eligibility history, late events, distinct counts, weighted rates, percentile buckets, consent bias, suppressed cohort/differencing and export parity |
| Rights | Export scope and completeness, partial-provider deletion/retry, rollup rebuild, retained-exception separation, backup restore replay, tombstones, object captures and vendor confirmation |
| Web/E2E | Fresh browser accept/reject/customize/withdraw, no optional storage/network before permission, public policy aliases, working choices/deletion links, app usability after refusal |
| Native release | iOS/Android network and local-storage inspection, startup/background/resume/withdrawal, final manifests/SDK privacy report, deletion without reinstall and store disclosure reconciliation |
| Load and failure | Supported devices and DBs at forecast peak, DB/provider outage, queue limits, timeout/retry backoff, collector failure isolation, replica/restart behavior and measured monthly cost |

Run existing app/server suites and affected Playwright flows for implementation changes. Use current logger, usage-accounting, metrics, Sentry, admin and Firebase analytics tests as regression anchors. Add adversarial cases rather than tests that only restate schemas. CI must detect registry/disclosure drift and mismatched generated policy pages.

## Rollout and completion criteria

1. Merge reviewed schemas and privacy controls with collection flags off.
2. Deploy synchronized approved pages and verified rights workflows; prepare matching store artifacts before mobile release.
3. Exercise synthetic consenting staging journeys and privacy-denied journeys; confirm no production-user data is copied into fixtures.
4. Canary opt-in collection for a small cohort with full coverage indicators. Compare ledger accounting against existing counters without adding spend twice.
5. Monitor ingestion failures, consent enforcement, report freshness, latency and dollar budgets; expand only after acceptance evidence passes.

Kill switch stops optional producers/admission/SDK export. It leaves preference changes, erasure, exports, retention and necessary operational accounting functioning. Rollback must not drop ledger records or recreate withdrawn/deleted subject data.

Completion requires: five trusted dashboards; tested privacy controls on all platforms; canonical synchronized notices/routes; documented jurisdiction/basis/processor/transfer decisions; working rights/retention jobs; accurate store submissions; adapter parity and regression/load evidence; measured attribution/consent coverage; and owned runbooks for incidents, cost alerts, SDK upgrades and definition changes.

Open decisions for Phase 0: confirmed legal controller/contact/age; launch jurisdictions/representatives; approved retention schedules; shared-cost allocation; trip timezone fallback; reference-device/load baseline; required consent renewal triggers; processor deletion capabilities; and whether any later warehouse is justified. Missing decisions keep optional production collection disabled.
