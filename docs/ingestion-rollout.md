# Email Ingestion Rollout

## Goals

This feature ingests travel confirmations from manual uploads, forwarded mailbox traffic, and Gmail import, then places parsed items into a review queue before a user assigns or deletes them.

Priority order:

1. Data integrity
2. Idempotency
3. User-safe review before assignment
4. Cost control
5. UI polish

`import_job` is the source of truth for pipeline execution. UI state, retry behavior, and observability must derive from the job state machine rather than ad hoc per-step booleans.

## Rollout stages

| Stage | Feature flag | Scope | Status |
|---|---|---|---|
| Phase 1 | `feature_ingest_manual_upload` | Manual upload, parsing, review queue, assignment, soft delete | Implemented |
| Phase 2 | `feature_ingest_forwarded_mailbox` | Forwarded mailbox ingestion via inbound provider/webhook | Scaffolded, docs-first |
| Phase 3 | `feature_ingest_gmail_import` | Gmail OAuth connect, inbox search/import, dry run, scheduled sync | Scaffolded, docs-first |
| Admin ops | `feature_ingest_admin_observability` | Ingestion metrics and dashboard widgets | Implemented |
| Local dev scan stub | `feature_ingest_local_virus_scan_stub` | Skip real virus scanning in local/test environments | Implemented |

Disabled flags must be enforced in both UI and backend. Current backend behavior returns HTTP `403` for disabled ingestion routes.

## Tiering and quotas

Manual upload and the ingest/review experience are Premium-and-up features.

| Tier | Manual uploads/month | Gmail lookback window | LLM escalation |
|---|---:|---:|---|
| Free | 0 | 0 days | none |
| Premium | 50 | 30 days | small model only |
| Pro | 500 | 90 days | large model allowed |

Quota failures return HTTP `429` and include a `Retry-After` header.

## Capability modules

Shared contracts live in `server/src/ingestion/contracts/`.

| Capability | Module | Responsibility | Public entry points |
|---|---|---|---|
| Intake | `server/src/ingestion/intake/` | Convert uploads and inbound messages into `IngestionPayload` | `manualUploadMiddleware`, `buildManualUploadPayloads`, `buildWebhookPayload` |
| Normalization | `server/src/ingestion/normalization/` | Convert raw bytes into `NormalizedDocument` | `normalizeIngestionPayload` |
| Extraction | `server/src/ingestion/extraction/` | Extract `ParsedItemCandidate[]` through strategy chain and cache | `extractCandidates`, `ExtractionStrategy` |
| Review Queue | `server/src/ingestion/review_queue/` | Persist parsed items, dedupe at item level, surface duplicate dispositions | `persistReviewQueueItems` |
| Assignment/Deletion | `server/src/ingestion/assignment/` | Edit, assign atomically, or soft-delete review items | `assignReviewItemToTrip`, `updateReviewItemEdits`, `deleteReviewItem` |
| Orchestration | `server/src/ingestion/orchestrator.ts` | Own job creation and `import_job` state transitions only | `runIngestionPipeline` |

Reusable shared modules live under `server/src/ingestion/shared/`:

- hashing
- quota enforcement
- parser selection
- virus scan wrapper/stub
- audit and failure-code mapping
- temp storage
- repository and schema access

## Core contracts

`IngestionPayload` is the transport contract between Intake and Normalization. It must include:

- `source_type`
- `source_id`
- `user_id`
- `external_message_id`
- `received_at`
- `original_filename`
- `mime_type`
- `content_bytes_ref`
- `content_hash`
- `metadata`
- `correlation_id`
- `dry_run`
- `virus_scan_status`

`ExtractionResult` is the extraction contract and contains:

- `parsedItems: ParsedItemCandidate[]`
- `usageMetrics`
- `metadata`

## State machines

### `import_job`

- `PENDING`
- `RECEIVED`
- `NORMALIZING`
- `NORMALIZED`
- `EXTRACTING`
- `AWAITING_REVIEW`
- `COMPLETED`
- `FAILED`
- `DEAD_LETTERED`
- `DUPLICATE_IGNORED`

### `parsed_item.review_status`

- `NEW`
- `LOW_CONFIDENCE`
- `READY_FOR_REVIEW`
- `ASSIGNED`
- `DELETED`
- `DUPLICATE_FLAGGED`

## Cost strategy

The extraction chain is intentionally conservative:

1. `RegexExtractor`
2. `SmallLLMExtractor`
3. `LargeLLMExtractor`

Rules:

- Prefer deterministic parsing first.
- Only OCR when direct text extraction is unavailable.
- Reuse extraction cache by `content_hash + logic_version`.
- Skip LLM if regex confidence is above the configured high-confidence threshold.
- Escalate from small to large model only for Pro users.
- Abort the job if estimated token spend crosses the per-job token budget constant.

All thresholds and limits live in `server/src/ingestion/config.ts`. There are no ingestion magic numbers outside config/constants.

## Deduplication and idempotency

There are two independent protections:

### Job-level idempotency

- Mailbox or Gmail: `SHA-256(source_type + message_id + user_id)`
- Manual upload: `SHA-256(source_type + content_hash + user_id + original_filename)`

### Document and item dedupe

- Document-level dedupe uses normalized content hash on `ingested_document`
- Item-level dedupe uses a parsed-item fingerprint built from item type, provider, confirmation number, travelers, dates, and route details
- Soft-deleted items still participate in duplicate detection so the same document does not reappear indefinitely

Current database behavior is conservative:

- same source payload replay reuses the same job instead of creating a second job
- same normalized content across distinct jobs becomes `DUPLICATE_IGNORED`
- same parsed item fingerprint becomes `DUPLICATE_FLAGGED`

## Review queue and assignment rules

- Items stay in review until assigned or deleted.
- A parsed item can be assigned to exactly one existing trip.
- Assignment is atomic. If trip persistence fails, the parsed item remains in review.
- Soft delete sets status to `DELETED`.
- Duplicate matches against deleted items are surfaced as `PREVIOUSLY_DELETED`.
- Assignment preserves original extracted fields and stores user changes in `edited_fields`.
- Generic notes are posted into the trip message feed instead of creating a structured trip entity.

## Schema summary

The ingestion repository currently bootstraps provider-specific schema for:

- `ingestion_sources`
- `import_jobs`
- `ingested_documents`
- `parsed_items`
- `parsed_item_assignments`
- `provider_connections`
- `usage_metering`
- `parse_attempts`
- `parse_stage_logs`
- `extraction_cache`

The implementation supports Firebase, PostgreSQL, and the in-memory adapter, with Firebase remaining the default app database and test target outside the targeted ingestion tests.

## Security and privacy

- Supported types are text, HTML, PDF, and image, capped at 10 MB.
- Local and test environments use the virus-scan stub when the stub feature flag is enabled.
- Raw source files are deleted after parse completion in the current Phase 1 flow.
- Signed review-document URLs are short-lived and fetched on demand, not embedded in list responses.
- Gmail scope is limited to `https://www.googleapis.com/auth/gmail.readonly`.
- Gmail dry run is intended for subject/date validation without ingesting content.
- Failure strings shown to users come from ingestion error templates, not raw exception messages.

## Retry and dead-letter baseline

Recommended default admin-managed policy:

- max attempts: 5
- backoff: exponential with jitter
- base delay: 30 seconds
- max delay: 30 minutes
- retry only transient failures
- dead-letter after final retry or explicit permanent failure

Current implementation exposes `FAILED` and `DEAD_LETTERED` states and the admin snapshot, but provider-driven retry workers for Phase 2 and Phase 3 are still future work.

## UI shape

The current UI adds:

- Ingest tab
- manual upload entry point
- review queue list
- item edit panel
- assign-to-trip flow
- soft delete flow
- forwarding info card
- Gmail dry-run scaffold
- admin ingestion metrics section

The initial UI intentionally favors clear states and traceability over polish.
