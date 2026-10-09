# Data Protection Impact Assessment: Analytics Upgrade

Status: **DRAFT for controller review and signature.** Not approved until the sign-off section is completed.
Prepared: October 8, 2026, from the [Phase 0 record](../analytics-phase-0.md), the [design](../analytics-upgrade.md) and the [implementation plan](../implementation-plans/analytics-upgrade.md).
Controller: Tristan Duerk, operating WanderBunnies (to be replaced by the registered entity once Duerk Industries is formed).
Privacy contact: support@wander-bunnies.com.

This draft follows the structure of GDPR Art. 35(7). It records engineering facts and proposed mitigations. Legal conclusions marked **[Counsel]** need a qualified reviewer's confirmation.

## 1. Why a DPIA is needed

The Phase 0 screening concluded that a full DPIA is required before optional collection, because the program:

- follows an individual's feature use over time (systematic observation of behavior within the service);
- joins behavior to trip dates, which can reveal travel patterns, absence from home, and who travels with whom;
- links records to a reversible pseudonym held by the service;
- involves group trips, where content can relate to companions who are not account holders and never consented;
- transfers data to US-based processors (Google Cloud `us-east5` / `US`, Sentry, AI providers).

No automated decisions with legal or similarly significant effects, no advertising profiles, and no special-category data are intended.

## 2. Description of the processing

| Element | Description |
|---|---|
| Nature | First-party event collection from web, iOS and Android clients and from server outcomes. Events are validated against a fixed registry, stored in Firestore (`us-east5`), aggregated daily into rollups, and shown to admins as aggregate dashboards with cohorts under 10 suppressed. Client diagnostics go to Sentry only with separate opt-in. |
| Scope: data | Pseudonymous subject ID, session ID, platform/app version/browser family, feature and task enums, outcome codes, trip pseudonym, trip phase (pre/during/post/unknown), coarse timing. **Excluded:** names, email, location/GPS, destination text, message/chat text, prompts, booking references, financial transactions, Gmail/Plaid content, full URLs. |
| Scope: subjects | Account holders aged 16+ (age gate enforced at sign-in) who opt in. Non-account companions and minors are never analytics subjects. |
| Scope: volume | Illustrative: 1,000 consenting monthly users × 8 sessions × 25 events ≈ 200,000 events/month. Production peak traffic was 4,061 requests/hour (Phase 0 baseline). |
| Scope: retention | Raw events 90 days; linked daily facts 13 months; client diagnostics 30 days; assessed anonymous aggregates 25 months; consent evidence for the account lifetime + 3 years. |
| Context | Consumer travel-planning app used by families and friend groups. Users reasonably expect the service to store their trips, but not necessarily to have their app usage measured, so analytics is opt-in and off by default. Users include EU/EEA and UK residents. |
| Purposes | (1) Learn which features deliver value. (2) Measure cost per user/trip. (3) Measure app performance and task completion. (4) Compare native and web use. (5) Measure use during scheduled trip dates. |
| Processors | Google Cloud / Firebase (hosting, Firestore, Cloud Storage, Logging), Sentry (optional client diagnostics; necessary server errors). No new analytics vendor. |

## 3. Consultation

- Internal: product, backend and frontend owners via the implementation plan reviews (revisions 1–5).
- Data subjects: no formal consultation. **Proposed:** in-app notice and changelog at launch, plus the canary cohort's feedback channel.
- Processors: DPAs and subprocessor lists to be collected (see section 6, measure M9).
- Supervisory authority: prior consultation (Art. 36) only if residual risk stays high after mitigation. Not expected; see section 7. **[Counsel]**

## 4. Necessity and proportionality

| Test | Assessment |
|---|---|
| Lawful basis | Optional product analytics and client diagnostics: **consent** (Art. 6(1)(a)), separate for each purpose, default off, withdrawable at any time. Security logs and quota/cost metering: **legitimate interests** (Art. 6(1)(f)) — see Appendix A — or contract (Art. 6(1)(b)) where the metering enforces plan limits. **[Counsel]** |
| ePrivacy / PECR | Client storage for analytics (session ID, queue) is written only after consent. The consent record itself is stored as strictly necessary. |
| Purpose limitation | Analytics data is not used for advertising, profiling individuals, credit, pricing, or any decision about a user. Operational and billing records are not repurposed as behavioral analytics. |
| Minimization | Enum-only properties validated server-side; prohibited-field list; no location; pseudonym instead of user ID; trip phase from dates rather than location. |
| Accuracy | Not used for decisions about individuals; data-quality metrics (consent coverage, fallback levels) are shown with every report. |
| Storage limitation | Schedules above, enforced by Firestore TTL, purge jobs and Cloud Storage lifecycle rules. The AI capture bucket's 30-day lifecycle rule was applied on 2026-10-08. |
| Rights | Export (schema v2), "Delete my analytics data", account deletion cascade, withdrawal, objection via the privacy contact; responses within one month. |
| Transfers | US processing. Mechanism per processor (EU–US Data Privacy Framework certification, or SCCs) to be confirmed. **[Counsel]** |

## 5. Risks to individuals

Likelihood and severity are rated before mitigation (L = low, M = medium, H = high).

| # | Risk | Likelihood | Severity | Inherent |
|---|---|---|---|---|
| R1 | Trip-phase data reveals when a user is away from home (burglary or stalking risk if leaked or misused internally) | M | H | **High** |
| R2 | Re-identification of pseudonymous users through small cohorts or filter differencing in reports or exports | M | M | Medium |
| R3 | Companions or minors in group trips indirectly observed without consent | M | M | Medium |
| R4 | Consent not freely given (dark patterns) or not respected after withdrawal (stale devices, queued events, SDK auto-start) | M | M | Medium |
| R5 | Over-collection through free-text properties, URLs, or exception messages leaking content | M | M | Medium |
| R6 | Excessive retention or incomplete deletion (captures, logs, backups, vendor copies) | M | M | Medium |
| R7 | US transfer and processor access to pseudonymous behavior and diagnostics | M | L | Medium |
| R8 | Internal misuse: admins looking up an individual's activity | L | M | Low–Medium |
| R9 | Security breach of the event store | L | H | Medium |

## 6. Measures to reduce risk

| Measure | Addresses | Status |
|---|---|---|
| M1 Default-off, separate opt-ins with equal Accept/Reject/Customize; GPC/DNT honored; server-enforced consent epochs | R4 | Planned (Phase 1) |
| M2 Trip phase stored only as an enum; no dates of absence exported; no location; individual-level drill-down restricted and audited | R1, R8 | Planned (Phases 2, 5) |
| M3 Small-cohort suppression (<10) in UI and CSV; differencing guard on filters; aggregates only for routine analysis | R2 | Planned (Phase 5) |
| M4 Companions and minors never analytics subjects; events carry only the consenting actor's pseudonym; 16+ age gate at sign-in | R3 | Age gate implemented (not yet deployed); rest planned |
| M5 Strict registry with enum-only properties; server rejects unknown fields; prohibited-field tests; URL query stripping in logs | R5 | Planned (Phase 2) |
| M6 TTL/purge jobs, deletion cascade incl. pseudonym map and captures, tombstones on restore; 30-day capture lifecycle | R6 | Capture lifecycle **applied 2026-10-08**; rest planned (Phase 4) |
| M7 Client Sentry off until diagnostics opt-in; pseudonym only; scrubbing; 30-day retention | R4, R7 | Planned (Phase 1) |
| M8 Restricted access to pseudonym mapping; admin RBAC; audit log of exports and drill-downs | R8, R9 | Planned (Phase 5) |
| M9 DPAs, transfer mechanism and subprocessor list for Google Cloud, Sentry, AI providers | R7 | **Open**: collect and record |
| M10 Kill switch `analytics_collection_enabled` (fail-closed); canary rollout | R4, R9 | Planned (Phase 1) |
| M11 Encryption in transit and at rest (Google Cloud default); no raw payloads in logs | R9 | Platform default; verify in Phase 2 |

## 7. Residual risk and conclusion

With M1–M11 in place, R1 drops from high to **low–medium**: trip phase is an enum, individual drill-down is restricted, and data is pseudonymous and opt-in. All other risks are assessed **low**. No residual high risk remains, so prior consultation with a supervisory authority is not proposed. **[Counsel]**

**Conditions:**
- Optional collection must not start until M1, M2, M3, M5, M7, M9 and M10 are implemented and verified.
- The DPIA is reviewed again before adding any new purpose, data category, or third-party analytics vendor, and at least annually.

## 8. Sign-off

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| Controller | Tristan Duerk | ☐ Approve ☐ Approve with conditions ☐ Reject | | |
| Privacy owner / reviewer | | | | |
| Counsel (items marked [Counsel]) | | | | |
| Engineering owner | Bryan Duerk | | | |

## Appendix A: Legitimate-interests assessment (necessary processing)

Applies to security/request logs, server error monitoring, and quota/cost metering. It does **not** cover optional analytics, which relies on consent.

| Step | Assessment |
|---|---|
| Purpose | Keep the service secure and available, enforce rate limits and plan quotas, and administer provider costs. |
| Necessity | Requires status, duration, request ID, limited user linkage for abuse and quota handling, and provider units/cost per attempt. Full URLs with query values, prompt content, and long user-linked histories are **not** necessary and are removed or minimized: query values stripped, cost-ledger user linkage removed after 13 months, logs kept 30 days in `_Default`. The `_Required` bucket's 400 days is Google's fixed audit-log retention, and its contents must be confirmed. |
| Balancing | Users expect a service to keep security logs and enforce plan limits. The impact is low because data is minimized, access restricted, retention short, and nothing is reused for behavioral profiling. Users can object through the privacy contact; objections are assessed case by case, recognizing that security and quota records are generally overriding. |
| Outcome | Legitimate interests is an appropriate basis for these records, subject to the minimization above. **[Counsel]** |

| Role | Name | Date | Signature |
|---|---|---|---|
| Controller | Tristan Duerk | | |
