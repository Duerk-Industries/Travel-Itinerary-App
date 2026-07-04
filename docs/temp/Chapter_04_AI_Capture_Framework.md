# Chapter 4 --- AI Capture Framework

**Evaluation note:** the privacy model in §8 (structural allowlist) is
correct and should not be softened — see Chapter 7 for the full
rationale. The one architectural gap is cost/performance: §6 and §13, if
implemented literally as "one file per stage" and "retry, backoff, drop"
on every individual write, produce more storage operations and more
background-worker machinery than current traffic justifies. §6 and §13
are corrected below to batch per job instead of per stage, which cuts
write volume roughly 5x for itinerary capture at no loss of data
granularity.

## 1. Purpose

The AI Capture Framework provides a standardized mechanism for recording
AI interactions for debugging, evaluation, replay, regression testing,
and continuous improvement.

Capture is an operational telemetry system---not part of the user
transaction. It must never block or fail a production request.

------------------------------------------------------------------------

# 2. Objectives

The framework shall:

-   Capture sufficient information to reproduce AI behavior.
-   Support prompt and parser improvement.
-   Enable replay using historical requests.
-   Provide high-quality evaluation datasets.
-   Feed long-term analytics.
-   Protect user privacy.
-   Minimize storage and runtime costs.

------------------------------------------------------------------------

# 3. Capture Architecture

Every AI request flows through the capture pipeline.

``` text
Application
    ↓
AI Registry
    ↓
Provider Adapter
    ↓
Response Returned to User
    ↓
Asynchronous Capture
    ├── Storage
    ├── Evaluation Queue
    ├── Analytics
    └── Replay Index
```

Capture occurs after the response is available to the application.

------------------------------------------------------------------------

# 4. Capture Types

Supported capture categories:

-   Itinerary generation
-   Email parsing
-   PDF parsing
-   Shadow parsing
-   Replay executions
-   Future AI features

Each capture includes a `featureKey` identifying its origin.

------------------------------------------------------------------------

# 5. Capture Record

Each record shall include:

-   captureId
-   correlationId
-   requestId
-   jobId (if applicable)
-   featureKey
-   provider
-   model
-   promptVersion
-   parserVersion
-   applicationVersion
-   captureSchemaVersion
-   anonymousUserId
-   request timestamp
-   completion timestamp
-   latency
-   token usage
-   estimated cost
-   outcome
-   validation summary

Every field must be versioned to support future schema evolution.

------------------------------------------------------------------------

# 6. Itinerary Capture

Capture each pipeline stage independently (P0--Pn) — a multi-stage
pipeline's final output is frequently correct even when an intermediate
stage silently degraded (e.g. a bad city-order decision early on that
later stages just build on top of), so per-stage granularity is required
for debugging, not optional detail.

For each stage record:

-   prompt messages
-   request parameters
-   provider metadata
-   raw provider response (development/testing only)
-   normalized JSON output
-   validation results
-   stage latency
-   retry count
-   errors
-   cost

Partial failures shall still persist completed stages.

**Write granularity: one object per job, not one object per stage.**
Itinerary generation already runs as an async job
(`itineraryAsyncService.ts`). Accumulate each stage's record in the
job's own execution context as it completes, and persist a single write
— all stages together — when the job reaches a terminal state (success,
failure, timeout). This uses the job as the natural batching unit
instead of requiring a separate queue/batching subsystem, and cuts
storage write operations roughly 5x versus one file per stage (see
Chapter 6 §10 for the cost math). Partial failures still work under this
model: whatever stages completed before the terminal state are included
in the single write.

------------------------------------------------------------------------

# 7. Parsing Capture

Capture:

Development/Test: - original uploaded document - extracted text - parser
outputs - AI outputs

Production: - redacted extracted text only - normalized fields -
evaluation artifacts - comparison results

Original uploaded production documents shall never be duplicated into AI
capture storage.

------------------------------------------------------------------------

# 8. Production Privacy

Production capture is anonymized by default.

Allowed:

-   anonymousUserId
-   provider
-   model
-   latency
-   cost
-   quality metrics
-   normalized allowlisted fields

Prohibited:

-   names
-   emails
-   phone numbers
-   addresses
-   passport numbers
-   payment data
-   authentication headers
-   cookies
-   raw prompts containing PII
-   original uploaded documents

All serialization passes through a structural allowlist before
persistence.

------------------------------------------------------------------------

# 9. Local Development

When `ENABLE_RAW_AI_CAPTURE=true` developers may capture:

-   original uploads
-   raw prompts
-   raw AI responses
-   extracted text

This mode is intended solely for debugging and test environments.

------------------------------------------------------------------------

# 10. Storage Layout

Development:

``` text
server/data/ai-capture/
```

Production:

``` text
gs://AI_CAPTURE_BUCKET/

    production/
    admin/
    testing/
    replay/
    analytics/
```

Separate prefixes allow independent IAM and lifecycle policies.

Within `production/itinerary/YYYY-MM-DD/`, use one object per job
(`<jobId>.json`, containing all captured stages), not one object per
stage — see §6. Within `production/parsing/YYYY-MM-DD/`, use one object
per intake, keyed by the ingestion pipeline's existing `intakeId`
rather than minting a new identifier.

`AI_CAPTURE_BUCKET` should be read via `getEnvValue()` (never
`process.env` directly, per this codebase's environment-variable
convention), and the local `Storage()` client should reuse the lazy
singleton pattern already established in `image-service.ts` rather than
introducing a second GCS client pattern.

------------------------------------------------------------------------

# 11. Retention

  Prefix       Default Retention
  ------------ -------------------
  production   30 days
  admin        Indefinite
  testing      Indefinite
  replay       Configurable
  analytics    Indefinite

Administrative tools shall support selective purge by:

-   provider
-   feature
-   date range
-   user
-   capture ID

Every purge action must be audit logged.

------------------------------------------------------------------------

# 12. Download Policy

Development/Test:

Administrators may download:

-   original documents
-   raw prompts
-   raw responses

Production:

Administrators may download only:

-   redacted extracted text
-   evaluation reports
-   comparison reports
-   normalized JSON

Original production documents are never downloadable through AI
Operations.

------------------------------------------------------------------------

# 13. Performance Requirements

Capture shall:

-   execute asynchronously
-   never block user responses
-   batch writes where practical
-   compress large payloads
-   avoid duplicate storage

If capture persistence fails:

1.  Retry immediately.
2.  Retry using short exponential backoff.
3.  Emit warning metric.
4.  Drop capture.

User-facing functionality must remain unaffected.

**Do not build a standalone in-memory queue, batching layer, or
background-worker pool for this ahead of need.** "Batch writes where
practical" is satisfied by the per-job/per-intake batching in §6/§7/§10
— itinerary generation is already an async job and parsing is already a
single request, so each has a natural, already-existing unit to batch
around. Add a genuinely separate queueing subsystem only if real
write-volume or cost data (tracked via Chapter 6 §11 capacity planning)
shows it's needed; building it up front is speculative infrastructure
for traffic levels this platform doesn't have yet. The 2-retry-then-drop
behavior above is still correct and cheap to implement directly in
`captureService.ts` without a queue.

------------------------------------------------------------------------

# 14. Replay Compatibility

Capture records shall contain sufficient information to reproduce
execution.

Replay metadata includes:

-   replayId
-   originalCaptureId
-   replayProvider
-   replayModel
-   replayTimestamp
-   replayUser
-   replayPromptVersion

Replay results are stored independently and never overwrite original
captures.

------------------------------------------------------------------------

# 15. Capture Versioning

Every capture stores:

-   captureSchemaVersion
-   promptVersion
-   parserVersion
-   providerAdapterVersion
-   applicationVersion

Historical captures are immutable.

Readers must support older schema versions without migration whenever
practical.

------------------------------------------------------------------------

# 16. Diagnostics

Every capture shall be searchable by:

-   captureId
-   correlationId
-   jobId
-   provider
-   model
-   feature
-   anonymousUserId
-   outcome
-   date range

These indices support replay, debugging, and analytics without requiring
direct cloud storage access.

If this index is backed by a database table (rather than derived purely
from GCS object naming/prefixes), it must be implemented across all
three DB adapters (`db.postgres.ts`, `db.firebase.ts`, `db.memory.ts`)
like any other new table in this codebase — not just Postgres.

------------------------------------------------------------------------

# 17. Implementation Notes

Capture logic shall exist only within the AI platform.

Application features must never write capture records directly.

All capture creation flows through the AI Registry, ensuring consistent
metadata, privacy enforcement, versioning, and observability across
every AI-powered feature.
