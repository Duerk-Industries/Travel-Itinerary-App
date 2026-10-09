# Analytics and Privacy Runbook

Operational procedures for the analytics upgrade. Design: [analytics-upgrade.md](analytics-upgrade.md). Engineering record: [implementation plan](implementation-plans/analytics-upgrade.md). Open sign-offs: [manual follow-ups](analytics-manual-followups.md) and the [sign-off packet](legal/analytics-signoff-packet.md).

## Controls at a glance

| Control | Where | Effect | Speed |
|---|---|---|---|
| `analytics_collection_enabled` flag | Admin → Feature Flags | **Kill switch** for product analytics. Off: the app stops sending, ingest refuses everything (403), and server events are dropped. Consent changes, export and deletion keep working. | ≤ 60 s (flag cache) |
| `diagnostics_user_linked_enabled` flag | Admin → Feature Flags | Kill switch for detailed diagnostics. Off: the client Sentry SDK isn't started for anyone. | ≤ 60 s, then next app start or foreground |
| Rollout (per purpose) | Admin → Analytics → Rollout | Who is offered collection while the flag is on: `off`, `internal` (admins and canary accounts, the default), `percentage` (stable hash), or `all`. **Exclude Europe** keeps European and unknown device time zones out. | ≤ 60 s (rollout cache) |
| `age_gate_enforcement` flag | Admin → Feature Flags | Blocks accounts without a 16+ confirmation (403 `AGE_VERIFICATION_REQUIRED`). Turn on only once the oldest supported app build has the prompt. | ≤ 60 s |

Every change to a flag or rollout is recorded in the audit log. Always give a reason.

## Before any rollout step

1. `npm run check:analytics-release` must pass. With `--strict`, it also lists the open manual sign-offs.
2. For staging, run `BASE_URL=… USER_TOKEN=<dedicated test account> ADMIN_TOKEN=… npm run smoke:analytics -- --confirm`. All 7 steps must pass. Use a dedicated internal test account: the last step erases its analytics data.
3. Confirm the Cloud Billing budget alert exists (see follow-ups §3).

## Rollout ladder

Keep **Exclude Europe** on throughout until counsel signs off the EU/UK representative question.

| Step | Setting | Stay at least | Move on when |
|---|---|---|---|
| 0 | Flags off (default) | — | Release gate passes; manual §0–4 closed |
| 1 | Flag on, rollout `internal` | 7 days | Ingest rejection rate < 5% (excluding `region_excluded`), no `analytics.server_event_failed`, report freshness under 1 day, no consent complaints |
| 2 | `percentage` 5 | 7 days | Same, plus a reasonable opt-in rate and cost within budget |
| 3 | `percentage` 25 | 14 days | Same |
| 4 | `all` | — | — |

Repeat the ladder separately for detailed diagnostics. Diagnostics cost scales with Sentry quota, so check the quota before each step.

## What to watch

| Signal | Where | Meaning |
|---|---|---|
| `analytics.events_rejected{reason=…}` | `/metrics`, Admin → Metrics | `invalid` or `unknown_event` usually means the client registry is out of date. `clock_out_of_range` points to bad device clocks. `region_excluded` is expected while Europe is excluded. |
| `analytics.server_event_failed` / `_dropped` | `/metrics` | Server outcome events failing, or the in-process queue overflowing (more than 1,000 pending). |
| HTTP 429 `ANALYTICS_RATE_LIMITED` | access logs | A client flushing too often: check for a tracking loop. |
| Report `truncated: true` | Admin → Analytics | Over 50,000 events in a window. Plan the move to daily rollups. |
| `cost_ledger.settlement_failed` | `/metrics` | Cost ledger writes failing. Budgets still count the spend, but per-user attribution has gaps. |
| `privacy.erasure_job_exhausted` | `/metrics`; `GET /api/admin/privacy/erasure-jobs?status=failed` | A deletion failed 5 times. **Act within days**: there is a legal deadline. |
| Rights requests `overdueCount` | `GET /api/admin/privacy/rights-requests` | Statutory deadline passed. |
| Billing budget alert at 80% or 100% | email | See "Cost overrun" below. |

## Incidents

### Something is collected that shouldn't be

Examples: free text in an event, collection without consent, the wrong population.

1. Turn **`analytics_collection_enabled` off** immediately. For a diagnostics problem, turn off `diagnostics_user_linked_enabled`.
2. Find the scope: which event, from when, and how many pseudonyms. Use the database console on `analytics_events`; don't copy rows anywhere.
3. Delete the affected rows. A whole-store purge is acceptable: the data is optional. Record what you removed.
4. Assess whether it's a personal-data breach. Under GDPR it is notifiable within **72 hours** of becoming aware, unless unlikely to result in risk. Record the decision either way.
5. Fix, add a regression test, and re-run the release gate before turning the flag back on.

### A consent change isn't respected

1. Kill switch off.
2. Check `GET /api/account/privacy-preferences` for the account, and compare the client's `productAnalyticsAllowed` with the server's.
3. The server is authoritative, so ingest refuses anything the server hasn't consented to. If events were stored without consent, delete them, then follow the breach assessment above.

### A deletion request fails

1. Admin → Privacy Requests → **Erasure jobs**, filtered to *failed*, shows which step failed and why (the API is `GET /api/admin/privacy/erasure-jobs?status=failed`).
2. Fix the cause. The daily retention tick retries it, up to 5 attempts.
3. If attempts are exhausted, resolve it manually and record what you did on a rights request in Admin → Privacy Requests. Deadlines: GDPR one month, CCPA 45 days.

## Privacy rights requests

Requests made in the app are self-service: export (Account → Privacy → Export account data), analytics deletion and account deletion create their own records and erasure jobs. Anything received another way, such as an email to support@wander-bunnies.com, a web form or a letter, is logged in **Admin → Privacy Requests**:

1. **Record it on the day it arrives.** Choose **Record request**, then set the type, jurisdiction (GDPR, UK GDPR, CCPA, another US state, or other), channel and the date received. The due date is calculated for you: GDPR and UK GDPR one month, CCPA and US states 45 days, anything else 30 days. A reason is required, and every change is audited.
2. **Keep identity out of the register.** Don't enter the requester's name or email. They stay in the support mailbox thread. If the requester has an account, paste its user ID, and only a pseudonymous hash is stored.
3. **Verify identity** proportionately: reply from the support mailbox to the account's email address. Set the status to *verifying*.
4. **Act on the request**, and set *in progress*:
   - Access or portability: have the user run Export account data, or run it for them and send it securely.
   - Erasure: ask the user to use **Delete Account** or **Delete analytics data** in the app. If they can't, an engineer starts the erasure job for them. There is no admin button for this yet.
   - Rectification: edit the record.
   - Objection, restriction or opt-out: turn off the relevant optional purposes and note what else applies.
5. **Need more time?** Apply the one-time statutory extension in the request's editor (GDPR/UK: +2 months; CCPA/US states: +45 days). Tell the requester, with the reason, **before the original due date**.
6. **Close it** as *completed* or *rejected*, noting what was done (without personal details). For a rejection, tell the requester why and how to appeal or complain to a supervisory authority.

The list shows overdue requests first, with a banner. Check it weekly (see Routine).

### Cost overrun

1. Look at the Cost view in Admin → Analytics for the provider and feature driving the spend.
2. For analytics storage cost, lower the rollout percentage or turn off the kill switch. Required cost accounting and budgets keep working.
3. For provider spend, use the existing API limits and budgets (Admin → API Limits).

### Rolling back

- Turning off a flag or rollout stops collection without losing data.
- Code rollback is safe: collection flags default off, and the stores are additive.
- Never restore an analytics or privacy table from a backup without re-running pending erasures. Deletion tombstones and erasure jobs must be re-applied before serving restored data.

## Routine

| Cadence | Task |
|---|---|
| Daily, automatic | Retention tick: purge expired events, unlink old ledger and telemetry rows, purge old consent evidence, retry erasures, write CSV exports if `ANALYTICS_EXPORT_BUCKET` is set. The result is in the `RETENTION_TICK_RUN` audit entry. |
| Weekly | Admin → Privacy Requests: check overdue rights requests and failed erasure jobs. |
| Monthly | Enter provider invoices (`PUT /api/admin/costs/invoices/:provider/:month`) and review reconciliation. Price any unknown-priced providers. |
| Each release | Release gate. Update store disclosures if the registry gained a consent category. |
| Each SDK upgrade | Recheck Sentry and Expo SDK network behavior before and after consent, and the iOS privacy report. |
| Annually | Review the DPIA, retention schedule and processor list. |
