# Ingestion Technical Debt

## Intent

This file records conservative assumptions and known rollout gaps for the ingestion feature so that future phases do not treat current behavior as fully complete production scope.

## Current assumptions

- Phase 1 is the only end-to-end production-ready path today. Manual upload, review, assignment, deletion, item-level dedupe, and admin observability are implemented.
- Phase 2 forwarded-mailbox ingestion and Phase 3 Gmail import are scaffolded, not production-complete.
- `import_job` is the source of truth for pipeline execution and must remain the only state machine that drives ingest progress.

## Known gaps

### Worker execution

- The business logic is shaped for an async worker model, but Phase 1 currently runs inline in the request path after upload.
- A Cloud Run or equivalent queue-backed adapter still needs to be wired for production mailbox and Gmail sync jobs.

### Webhook hardening

- The launch webhook payload contract exists, but production Mailgun or SES webhook endpoints, signature validation, replay storage, and provider-specific retry workers are still pending.
- Admin-managed retry-policy editing is documented but not yet exposed as a writable admin configuration surface.

### Gmail integration

- Gmail dry run is scaffolded.
- OAuth connect, encrypted token refresh lifecycle, inbox-only polling worker, disconnect UI, and mailbox data deletion automation need completion before Phase 3 can ship.

### Virus scanning

- Local and test environments intentionally use the stub path.
- Production ClamAV sidecar or cloud-native malware scanning integration still needs to be chosen and deployed.

### Migrations

- The repository currently bootstraps ingestion schema at runtime for PostgreSQL and mirrors it for Firebase/in-memory.
- Formal migration files, tested down migrations, and migration-specific CI coverage are still needed if the project adopts a first-class migration framework.

### Document parsing quality

- PDF and image normalization currently falls back to text-like byte decoding when richer OCR/document extraction is unavailable.
- This is acceptable for synthetic tests and Phase 1 scaffolding, but production quality will need a real OCR/document pipeline before mailbox scale-up.

### Timezone inference

- The current implementation stores UTC and preserves raw timezone-related fields when available, but robust item-local timezone inference from route geography is still incomplete.

### Review UX

- The UI favors correctness and traceability over polish.
- Bulk actions, richer duplicate conflict display, and stronger sort/filter UX are still future work.
