# Chapter 11 --- Serviceability, Monitoring, and Operations

## 1. Purpose

This chapter defines how the AI platform is monitored, operated,
diagnosed, and maintained in production. The objective is to ensure
operational excellence by providing visibility into system health,
predictable incident response, and tooling that allows engineers to
diagnose problems without direct database or storage access.

------------------------------------------------------------------------

# 2. Operational Objectives

The platform shall:

-   Detect failures quickly.
-   Provide actionable diagnostics.
-   Minimize mean time to detect (MTTD).
-   Minimize mean time to recover (MTTR).
-   Support proactive maintenance.
-   Expose meaningful operational metrics.
-   Enable safe production troubleshooting.

------------------------------------------------------------------------

# 3. Observability Architecture

``` text
Application
      ↓
AI Registry
      ↓
Structured Logs
      ↓
Metrics
      ↓
Distributed Traces
      ↓
Alerting
      ↓
Dashboards
```

All AI requests should generate correlated logs, metrics, and traces
using a common correlation ID.

**Grounding:** this codebase already has an OpenTelemetry-based
observability stack — `@sentry/node`, bootstrapped in
`server/src/instrument.ts` as the very first import in `index.ts` so its
OTel auto-instrumentation can patch `http`/`express` before anything
else runs. There is no separate Prometheus/OTel-collector dependency
today. Two consequences for this chapter: (1) distributed tracing (§6)
should extend the existing Sentry spans rather than standing up a
second tracing pipeline; (2) the counters/histograms/gauges in §5 need
either Sentry custom metrics or a lightweight in-process counter exposed
via a new `/metrics` endpoint — treat that endpoint as new
infrastructure to scope explicitly, not something already in place.
Where a simple structured `logInfo`/`logError` line with the right
fields is enough (e.g. a per-request outcome+latency line), prefer that
over introducing a new metrics dependency purely for this platform.

------------------------------------------------------------------------

# 4. Structured Logging

All production logs should use structured JSON.

Every AI interaction should include:

-   timestamp
-   correlationId
-   captureId
-   requestId
-   jobId (if applicable)
-   featureKey
-   provider
-   model
-   promptVersion
-   parserVersion
-   outcome
-   latencyMs
-   estimatedCost
-   retryCount

Sensitive information must never appear in logs.

Use the existing `logInfo`/`logError` helpers from `server/src/logger.ts`
for all server-side logging — never `console.log` — consistent with the
rest of this codebase.

------------------------------------------------------------------------

# 5. Metrics

Expose metrics compatible with OpenTelemetry.

### Counters

-   ai_requests_total
-   ai_failures_total
-   capture_failures_total
-   replay_requests_total
-   replay_failures_total
-   evaluation_failures_total
-   shadow_requests_total

### Histograms

-   ai_latency_ms
-   provider_latency_ms
-   capture_write_duration_ms
-   evaluation_duration_ms
-   replay_duration_ms

### Gauges

-   monthly_ai_cost
-   provider_budget_remaining
-   shadow_budget_remaining
-   storage_utilization
-   active_replay_jobs

------------------------------------------------------------------------

# 6. Distributed Tracing

Every request should generate a trace spanning:

-   Registry
-   Provider Adapter
-   Rate Limiter
-   Capture
-   Evaluation
-   Analytics

Tracing should allow engineers to identify latency bottlenecks and
failure points.

------------------------------------------------------------------------

# 7. Health Checks

Each subsystem shall expose health information.

Monitor:

-   Provider connectivity
-   Database availability
-   Storage availability
-   Replay queue
-   Analytics jobs
-   Capture persistence
-   Runtime configuration

Health endpoints should expose readiness, liveness, and degraded status.

------------------------------------------------------------------------

# 8. Alerting

Generate alerts for:

-   Provider outage
-   Elevated latency
-   Increased timeout rate
-   Capture failure rate
-   Evaluation failures
-   Budget exhaustion
-   Replay failures
-   Regression detection
-   Storage failures
-   Authentication failures

Alerts should include links to relevant dashboards and affected
correlation IDs when possible.

------------------------------------------------------------------------

# 9. Dashboards

Operational dashboards should include:

### Platform Overview

-   Request volume
-   Success rate
-   Latency
-   Monthly cost
-   Active alerts

### Provider Dashboard

-   Provider health
-   Cost
-   Latency
-   Error rate
-   Timeout rate

### Capture Dashboard

-   Capture success
-   Capture failures
-   Storage growth
-   Compression savings

### Evaluation Dashboard

-   Quality score
-   Blank rate
-   Validation failures
-   Ground-truth agreement

------------------------------------------------------------------------

# 10. Incident Response

Create runbooks for:

-   Provider outage
-   Budget exhaustion
-   Capture persistence failure
-   Storage outage
-   Replay backlog
-   Analytics failure
-   Elevated parser disagreement
-   Security incident

Every runbook should define:

1.  Detection
2.  Diagnosis
3.  Containment
4.  Recovery
5.  Verification
6.  Postmortem

------------------------------------------------------------------------

# 11. Capacity Management

Track long-term trends for:

-   Requests/day
-   Tokens/day
-   Storage/day
-   Replay volume
-   Analytics growth
-   Monthly cost

Review capacity quarterly and adjust infrastructure proactively.

------------------------------------------------------------------------

# 12. Backup and Recovery

Back up:

-   Runtime configuration
-   Provider configuration
-   Analytics database
-   Ground-truth datasets
-   Evaluation rules

Recovery procedures should be documented and periodically tested.

Raw production captures should not be backed up beyond their configured
retention policy.

------------------------------------------------------------------------

# 13. Operational Maintenance

Routine maintenance includes:

-   Reviewing provider performance
-   Cleaning obsolete replay artifacts
-   Verifying retention policies
-   Rotating secrets
-   Updating provider models
-   Reviewing alert thresholds
-   Auditing administrative actions

Maintenance tasks should be scheduled and tracked.

------------------------------------------------------------------------

# 14. Diagnostics

Administrators should diagnose issues using:

-   Correlation ID
-   Capture ID
-   Replay history
-   Provider history
-   Prompt version
-   Parser version

The platform should make direct cloud storage inspection unnecessary for
routine support.

------------------------------------------------------------------------

# 15. Disaster Recovery

Document procedures for:

-   Region outage
-   Provider outage
-   Database failure
-   Storage corruption
-   Configuration loss

Recovery objectives should align with organizational RTO and RPO
requirements.

------------------------------------------------------------------------

# 16. Success Criteria

The operational platform is complete when engineers can detect,
diagnose, and resolve AI platform issues using standardized logs,
metrics, traces, dashboards, and runbooks without impacting production
users.
