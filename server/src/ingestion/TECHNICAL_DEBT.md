# Ingestion Technical Debt

## Intent

This file records conservative assumptions and known rollout gaps for the ingestion feature so that future phases do not treat current behavior as fully complete production scope.

## Current assumptions

- Phase 1 is the only end-to-end production-ready path today. Manual upload, review, assignment, deletion, item-level dedupe, and admin observability are implemented.
- Phase 2 forwarded-mailbox ingestion and Phase 3 Gmail import are scaffolded, not production-complete.
- `import_job` is the source of truth for pipeline execution and must remain the only state machine that drives ingest progress.
- The `NEW` review state exists in the type system but is not used in the current pipeline. Items enter review as `LOW_CONFIDENCE`, `READY_FOR_REVIEW`, or `DUPLICATE_FLAGGED`. This is intentional — items are classified on creation, not after a separate triage step.

## Resolved items

### Worker execution (resolved)
- Intake routes now create `PENDING` jobs, persist `import_job_payloads`, enqueue work through `JobQueue.enqueue(jobId)`, and return HTTP 202 without running normalization or extraction inline.
- An in-process queue adapter is used for local/test and a Cloud Run HTTP worker adapter is wired for production-style deployments.

### Webhook hardening (resolved)
- The Mailgun webhook endpoint, signature validation, and replay-token storage are implemented.
- Retry policy is now persisted in `ingestion_retry_config` and exposed through the admin UI/backend as editable `maxAttempts`, `baseDelaySeconds`, `maxDelaySeconds`, and `alertThresholdPercent`.
- An authenticated retry worker endpoint can re-submit eligible dead-letter jobs by provider using the configured backoff policy.
- Admin-triggered dead-letter re-drive is exposed through the ingestion admin surface and moves matching jobs back to `PENDING` before re-enqueueing them.

### Document normalization quality (resolved)
- Normalization now persists `normalization_quality`, marks fallback byte decoding as `FALLBACK_DECODE`, and logs the low-quality path for admin observability.
- Item detail review now surfaces document normalization quality so low-confidence parsing is explainable to the user.

### Virus scan production blocking (resolved)
- The local virus scan stub is explicitly blocked when `APP_ENV=production`.
- Scan provider selection is centralized so production can switch between cloud-native and sidecar-backed providers without changing intake code.

### Timezone inference (resolved)
- A `TimezoneResolver` utility now exists in `shared/timezoneResolver.ts` implementing the full priority chain: explicit IANA timezone > IATA code lookup > city name lookup > UNKNOWN.
- Bundled static IATA-to-timezone and city-to-timezone lookup tables are included (no runtime API calls).
- The lookup bundle logs a warning on startup if the data is older than the configurable max age.
- `timezone_status` (`RESOLVED`, `INFERRED`, `UNKNOWN`) and `raw_datetime_string` fields are now stored on `parsed_item` records.
- Items with unknown timezone display an explicit "timezone unknown" marker with the raw datetime string visible in the UI.

### Logging compliance (resolved)
- Removed `console.error` from `ingestionRoutes.ts` — all server logging now uses `logError`/`logInfo` from `logger.ts`.

### Review queue filtering (resolved)
- Date and confidence filters are now supported in both the backend `/api/ingestion/review-items` endpoint and the frontend filter UI.

### Concurrency/idempotency test coverage (resolved)
- Added test suite `ingestion.concurrency.test.ts` covering: same file uploaded twice concurrently, same message received twice concurrently, Gmail import rerun on same mailbox window, atomic assignment under concurrent submit, and duplicate badge behavior when existing assigned item matches.

### Gmail token refresh failure handling (resolved)
- Token refresh failures now mark `provider_connection.status = AUTH_EXPIRED`, stop further authenticated reuse of that connection, and surface reconnect messaging in the UI.

### Bulk review actions (resolved)
- Multi-select checkboxes and a bulk action bar are now exposed on the ingestion review queue.
- `POST /api/ingestion/review-items/bulk-delete` and `POST /api/ingestion/review-items/bulk-assign` accept up to 100 ids per call, dedupe input, and report per-id failure reasons in a 207 response when any items fail without aborting the rest of the batch.
- Cross-user isolation, partial-failure reporting, validation rejection, free-tier denial, and idempotency-on-resubmit are integration-tested in `ingestion.bulk-actions.test.ts`.

### Gmail data deletion on disconnect (resolved)
- `POST /api/ingestion/gmail/disconnect` now cascades: `deleteUserIngestionDataForProvider(userId, 'gmail')` removes every `ingestion_source`, `import_job`, `import_job_payload`, `ingested_document`, and `parsed_item` scoped to `source_type = 'GMAIL_IMPORT'` before the `provider_connection` row is removed. The cascade runs first so a mid-flight failure leaves the connection intact and retryable.
- Manual-upload and forwarded-mailbox records are untouched — scoping is by `(user_id, source_type)`.
- Response body includes `deletion: { parsedItemsDeleted, documentsDeleted, jobsDeleted, sourcesDeleted }` for audit.
- Integration tested in `ingestion.gmail-disconnect-cascade.test.ts`.
- Full queued background deletion job flow (for very large inboxes where synchronous delete would time out) is still future scope but the synchronous path covers ordinary inbox volumes.

## Known gaps

### Worker adapter extensibility
- If the deployment needs first-party Cloud Tasks instead of the current Cloud Run worker hop, that adapter can be added behind the same interface without changing business logic.

### Admin alerting workflow
- There is not yet a richer admin alerting/dashboard workflow for provider outage spikes beyond the retry configuration and observability widgets.

### Gmail scheduled polling
- Scheduled inbox polling every 4 hours (Pro) / daily (Premium) is still not implemented as a production scheduler-backed sync loop.
- Currently Gmail import is manual-trigger only. A production scheduler must be implemented before Phase 3 is marked complete.

### Gmail data deletion automation — queue/observability layer
- Synchronous cascade on disconnect is now implemented (see "resolved" section above).
- Still outstanding: a queued background deletion flow for very large mailboxes where synchronous delete would exceed HTTP timeouts, plus admin observability for in-progress/failed cascades.

### Auth-expiry spike alerting
- Auth-expiry is visible operationally through status counts, but there is not yet a standalone admin alert object/workflow for rolling-window thresholds.

### Production virus scanning
- The production malware scanning provider is still a stubbed pass-through and must be backed by a real ClamAV/cloud-native integration before mailbox scale-up.
- Recommendation: use cloud-native API (Google Cloud Web Risk or equivalent) if monthly scan volume < 10,000 files; ClamAV sidecar above that threshold.

### Formal migration framework
- The repository currently bootstraps ingestion schema at runtime for PostgreSQL and mirrors it for Firebase/in-memory.
- Formal migration files with tested up/down migrations and migration-specific CI coverage are still needed.
- Firestore structural changes should be documented in a `firestore_schema_changelog.md` alongside migration files.

### PDF structural extraction (resolved)
- `normalization/index.ts` now performs real structural PDF text extraction via `pdf-parse`, falling back to `pdfjs-dist` page-by-page text content extraction if `pdf-parse` fails or produces non-text-like output. Byte decoding is only used as a last resort when both structural extractors fail.
- The `STRUCTURAL_EXTRACT` quality level reflects a genuine structural extraction success (from either library), not a byte-decode heuristic.

### Production OCR
- Image normalization now attempts OCR with Tesseract before any byte-decode fallback.
- Byte decoding remains only as a low-quality fallback path for malformed fixtures or OCR initialization/runtime failures.
- If OCR quality or throughput becomes insufficient at higher volume, a managed OCR provider (Google Cloud Vision or AWS Textract) may still be warranted.

### No automatic trip creation
- The system does not automatically create trips from imported items. Users must create a trip first, then assign parsed items to it. This is intentional for the initial version.

### No automatic assignment
- Items are never auto-assigned to trips without explicit user confirmation. This is intentional.

### No shared/team ingestion
- Per-user aliasing and shared mailbox ingestion are future scope.

### No background sync older than 3 months
- Gmail import lookback is capped at 90 days (Pro) / 30 days (Premium). No support for deeper historical import.

## Deferred UX items

### Duplicate conflict detail (side-by-side diff)
- **Capability name:** duplicate diff view
- **Why deferred:** the current badge/link behavior covers conflict awareness, but a side-by-side diff needs a purpose-built comparison UI.
- **Current constraint:** operators can see duplicate metadata today, but not a structured field-level comparison of the new item vs. the assigned match.
- **Rough effort estimate:** medium.

### Sort/filter persistence
- **Capability name:** persisted review filters
- **Why deferred:** filter/search correctness was prioritized over local persistence and navigation restoration.
- **Current constraint:** filter state resets on refresh/navigation.
- **Rough effort estimate:** small.

## Ambiguous decisions documented

### Virus scan provider selection
- **Assumption:** Cloud-native API for < 10,000 monthly scans; ClamAV sidecar above that threshold or for air-gapped deployments.
- **Rationale:** Cloud-native requires no infrastructure management at low volume; ClamAV is lower per-scan cost at scale but requires container orchestration.

### Mail ingest provider selection
- **Primary recommendation:** Mailgun Inbound Routes (already implemented).
- **Fallback recommendation:** AWS SES Inbound.
- **Rationale at 100 users:** Mailgun is simplest to set up, has built-in attachment handling and webhook support, handles spam filtering, and has a generous free tier.
- **Rationale at 10,000 users:** Mailgun scales well with predictable per-message pricing. SES is cheaper at very high volume but requires more infrastructure (S3, Lambda triggers).
- **Score comparison:**
  - Cost: SES wins at scale, Mailgun wins at small scale
  - Reliability: Both high
  - Ease of implementation: Mailgun wins (webhook-first design)
  - Attachment support: Both good
  - Spam handling: Mailgun wins (built-in filtering)
  - Webhook support: Mailgun wins (native)
  - Security: Both support HMAC/DKIM
  - Maintainability: Mailgun wins (fewer moving parts)

### Retention policy
- Raw source files are retained only until parse completion and scan success, then the raw content reference is marked deleted.
- Normalized text is retained for review/debug until the user deletes the item or their account.
- OAuth tokens and full Gmail body content are deleted on disconnect or account deletion.

### Generic notes
- Generic itinerary notes are not structured trip entities. Assignment creates a system-generated message in the trip message feed with source reference and confidence metadata.
- Users can edit the message text before it is posted to the trip.
