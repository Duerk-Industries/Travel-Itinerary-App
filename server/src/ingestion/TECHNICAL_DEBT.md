# Ingestion Technical Debt

## Intent

This file records conservative assumptions and known rollout gaps for the ingestion feature so that future phases do not treat current behavior as fully complete production scope.

## Current assumptions

- Phase 1 is the only end-to-end production-ready path today. Manual upload, review, assignment, deletion, item-level dedupe, and admin observability are implemented.
- Phase 2 forwarded-mailbox ingestion and Phase 3 Gmail import are scaffolded, not production-complete.
- `import_job` is the source of truth for pipeline execution and must remain the only state machine that drives ingest progress.

## Known gaps

### Worker execution

- Resolved: intake routes now create `PENDING` jobs, persist `import_job_payloads`, enqueue work through `JobQueue.enqueue(jobId)`, and return HTTP 202 without running normalization or extraction inline.
- Resolved: an in-process queue adapter is used for local/test and a Cloud Run HTTP worker adapter is wired for production-style deployments.
- Remaining: if the deployment needs first-party Cloud Tasks instead of the current Cloud Run worker hop, that adapter can be added behind the same interface without changing business logic.

### Webhook hardening

- The Mailgun webhook endpoint, signature validation, and replay-token storage are implemented.
- Resolved: retry policy is now persisted in `ingestion_retry_config` and exposed through the admin UI/backend as editable `maxAttempts`, `baseDelaySeconds`, `maxDelaySeconds`, and `alertThresholdPercent`.
- Resolved: an authenticated retry worker endpoint can re-submit eligible dead-letter jobs by provider using the configured backoff policy.
- Resolved: admin-triggered dead-letter re-drive is exposed through the ingestion admin surface and moves matching jobs back to `PENDING` before re-enqueueing them.
- Remaining: there is not yet a richer admin alerting/dashboard workflow for provider outage spikes beyond the retry configuration and observability widgets.

### Gmail integration

- Gmail OAuth connect, encrypted token storage, token refresh, manual dry run, manual import, and disconnect are implemented.
- Resolved: token refresh failures now mark `provider_connection.status = AUTH_EXPIRED`, stop further authenticated reuse of that connection, and surface reconnect messaging in the UI.
- Remaining: scheduled inbox polling every 4 hours / daily is still not implemented as a production scheduler-backed sync loop.
- Remaining: full queued mailbox data-deletion automation for Gmail disconnect/account deletion still needs a dedicated deletion job flow and admin observability.
- Remaining: auth-expiry spike alerting is visible operationally through status counts, but there is not yet a standalone admin alert object/workflow for rolling-window thresholds.

### Virus scanning

- Resolved: the local virus scan stub is explicitly blocked when `APP_ENV=production`.
- Resolved: scan provider selection is centralized so production can switch between cloud-native and sidecar-backed providers without changing intake code.
- Remaining: the production malware scanning provider is still a stubbed pass-through and must be backed by a real ClamAV/cloud-native integration before mailbox scale-up.

### Migrations

- The repository currently bootstraps ingestion schema at runtime for PostgreSQL and mirrors it for Firebase/in-memory.
- Formal migration files, tested down migrations, and migration-specific CI coverage are still needed if the project adopts a first-class migration framework.

### Document parsing quality

- Resolved: normalization now persists `normalization_quality`, marks fallback byte decoding as `FALLBACK_DECODE`, and logs the low-quality path for admin observability.
- Resolved: item detail review now surfaces document normalization quality so low-confidence parsing is explainable to the user.
- Remaining: PDF structural extraction and production OCR are still not implemented; mailbox-scale parsing quality still needs a real document pipeline.

### Timezone inference

- The current implementation stores UTC and preserves raw timezone-related fields when available, but robust item-local timezone inference from route geography is still incomplete.

### Review UX

- The UI favors correctness and traceability over polish.
- Deferred: Bulk actions.
  Capability name: bulk review actions.
  Why deferred: correctness and atomic single-item assignment/delete took precedence over multi-select workflow complexity.
  Current constraint: the data model supports this later, but the current UI only acts on one parsed item at a time.
  Rough effort estimate: medium.
- Deferred: richer duplicate conflict detail.
  Capability name: duplicate diff view.
  Why deferred: the current badge/link behavior covers conflict awareness, but a side-by-side diff needs a purpose-built comparison UI.
  Current constraint: operators can see duplicate metadata today, but not a structured field-level comparison of the new item vs. the assigned match.
  Rough effort estimate: medium.
- Deferred: sort/filter persistence.
  Capability name: persisted review filters.
  Why deferred: filter/search correctness was prioritized over local persistence and navigation restoration.
  Current constraint: filter state resets on refresh/navigation.
  Rough effort estimate: small.
