# Chapter 6 --- Performance, Scalability, and Cost Optimization

## 1. Purpose

This chapter defines the operational characteristics of the AI platform.
The primary objective is to ensure that AI capabilities remain
responsive, cost-effective, and reliable as usage grows while
guaranteeing that production user experience is never degraded by
platform telemetry, evaluation, or experimentation.

------------------------------------------------------------------------

# 2. Performance Objectives

The platform shall satisfy the following principles:

-   AI infrastructure must not materially increase end-user latency.
-   Capture, evaluation, analytics, and replay execute outside the
    critical request path.
-   Background failures must never impact user-visible results.
-   Performance should degrade gracefully under load.

------------------------------------------------------------------------

# 3. Service Level Objectives (SLOs)

  Metric                       Target
  ------------------------ ----------
  AI Availability              ≥99.9%
  Capture Success              ≥99.5%
  Evaluation Completion          ≥99%
  Shadow Completion              ≥95%
  Replay Success                 ≥99%
  Async Capture Overhead     \<250 ms
  Admin API Availability       ≥99.5%

Breaches generate operational alerts and are visible in AI Operations.

------------------------------------------------------------------------

# 4. Execution Model

## Critical Path

``` text
User Request
   ↓
AI Registry
   ↓
Provider
   ↓
Validation
   ↓
Return Response
```

## Asynchronous Path

``` text
Capture
   ↓
Evaluation
   ↓
Analytics
   ↓
Storage
```

Only the critical path contributes to user latency.

------------------------------------------------------------------------

# 5. Concurrency

The platform shall support concurrent AI requests without shared mutable
state.

Requirements:

-   Stateless provider adapters
-   Thread-safe rate limiting
-   Atomic budget updates
-   Idempotent replay operations

Long-running jobs must be isolated from interactive requests.

------------------------------------------------------------------------

# 6. Scalability

Design for horizontal scaling.

Application instances should remain stateless.

State belongs in:

-   Database
-   Cloud storage
-   Shared cache
-   Metrics platform

Avoid node-local assumptions except for transient in-memory request
state.

------------------------------------------------------------------------

# 7. Rate Limiting

Reuse existing entitlement and provider limiting infrastructure.

Limits exist independently for:

-   User tier
-   Provider
-   Feature
-   Shadow execution

Reservations must be rolled back if provider execution fails before
completion.

Concretely: this is `entitlementService.ts` (per-tier) and
`usageLimiter.ts` (per-provider) composed by one new orchestration
function, `authorizeAiCall`, called once per request from the registry
— see Chapter 2 §3 for the implementation. Both checks run concurrently
via `Promise.allSettled` (not sequential `await`s) so the composition
adds one round-trip's latency, not two, on top of an already
multi-second LLM call.

------------------------------------------------------------------------

# 8. Retry Strategy

Retry only idempotent operations.

Provider requests:

-   Respect Retry-After headers.
-   Use exponential backoff.
-   Limit retry attempts.

Capture persistence:

1.  Immediate retry.
2.  Exponential backoff retry.
3.  Emit warning metric.
4.  Drop capture.

Evaluation jobs may be retried independently without affecting
production.

------------------------------------------------------------------------

# 9. Cost Management

Track cost at:

-   Request level
-   Feature level
-   Provider level
-   User tier
-   Monthly aggregate

Metrics:

-   Prompt tokens
-   Completion tokens
-   Estimated cost
-   Actual billed cost (when available)

Shadow parsing defaults:

-   10% sample rate
-   \$20/month budget
-   Configurable through Admin UI

Budget exhaustion disables shadow execution without affecting
production.

------------------------------------------------------------------------

# 10. Storage Optimization

Apply gzip compression for large JSON artifacts.

Avoid duplicate storage of:

-   Uploaded documents
-   Extracted text
-   Replay artifacts

Reference existing assets rather than copying where practical.

Store analytics separately from raw captures.

**Batch writes per logical unit of work, not per sub-step, to control
write-operation cost.** GCS write operations cost roughly $0.005 per
1,000 ops (Class A). Writing one object per itinerary-generation stage
(5 stages per job) versus one object per job is a 5x difference in
operation count for identical data — at low-to-moderate volume this is
cents either way, but batching per job (see Chapter 4 §6) costs nothing
extra to implement since the job already holds all stage data in memory
before it completes. Prefer that over building a dedicated batching/
queue subsystem (see Chapter 4 §13) — the natural batching unit
(the job, the intake) already exists for both itinerary generation and
parsing; a persistent queue is only worth adding if capacity-planning
data (§11) shows write volume has grown enough to matter.

------------------------------------------------------------------------

# 11. Capacity Planning

Track:

-   Requests/day
-   Tokens/day
-   Capture volume
-   Storage growth
-   Replay usage
-   Analytics growth

Review trends quarterly to adjust storage, budgets, and retention
policies.

------------------------------------------------------------------------

# 12. Performance Testing

Required test categories:

-   Single request latency
-   Sustained throughput
-   Burst traffic
-   Provider throttling
-   Storage outage
-   High replay volume
-   Background evaluation load

Performance tests should verify SLO compliance.

------------------------------------------------------------------------

# 13. Failure Isolation

Failures in:

-   Capture
-   Evaluation
-   Analytics
-   Replay
-   Shadow execution

must never:

-   Fail the user request
-   Corrupt production data
-   Delay production responses

Subsystems communicate through well-defined interfaces and recover
independently.

------------------------------------------------------------------------

# 14. Operational Tuning

Expose runtime settings through AI Operations:

-   Shadow sample rate
-   Monthly shadow budget
-   Retry limits
-   Capture size limits
-   Compression threshold

Settings changes should not require redeployment.

------------------------------------------------------------------------

# 15. Success Criteria

The platform is considered operationally complete when it:

-   Meets defined SLOs.
-   Scales horizontally.
-   Keeps telemetry off the critical path.
-   Maintains predictable costs.
-   Degrades gracefully during failures.
-   Supports runtime tuning without code changes.
