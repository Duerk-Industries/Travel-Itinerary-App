# AI Capture, Evaluation, and Improvement Plan

**Status:** Final implementation specification

**Date:** 2026-07-04

This document defines the architecture, implementation strategy,
testing, security, operations, analytics, and long-term maintenance plan
for AI itinerary generation and document parsing.

# 1. Goals

Build a reusable AI platform supporting itinerary generation, email/PDF
parsing, replay, evaluation, analytics, provider abstraction, and
continuous improvement.

Objectives: - Never negatively impact production user latency. - Never
store raw PII in production AI capture. - Provide deterministic
testing. - Support multiple AI providers. - Collect evidence for
continuous improvement.

# 2. Architecture

Layers:

Application → AI Registry → Provider Adapter → Rate Limiter → Capture →
Evaluation → Analytics → Storage

Every AI feature must route through the registry.

# 3. Provider Abstraction

Implement a provider registry with adapters for: - OpenAI - Anthropic -
Gemini - Z.ai - Test Provider

Admin chooses provider per feature. End users never choose providers.

# 4. Capture

Capture: - Prompt version - Prompt - Provider/model - Tokens - Cost -
Latency - Response - Parsed output - Validation - Errors - Correlation
IDs

Capture is asynchronous. Failures never affect production requests.

# 5. Privacy and Security

Production: - Redact all PII. - Store anonymized identifiers only. - No
raw prompts containing PII. - No raw uploaded documents. - Downloads
limited to redacted content.

Development/testing may optionally capture raw artifacts.

# 6. Performance

No synchronous capture writes.

Retry capture writes twice with exponential backoff. If still
unsuccessful: - log warning - increment metrics - drop capture

Shadow parsing executes independently.

# 7. Parsing Evaluation

Compare: 1. Production parser 2. AI parser 3. Manually labeled expected
output

Compute: - accuracy - completeness - blank rate - validation failures -
confidence

# 8. Rate Limiting

Reuse existing entitlement and provider limiters. Support: - Basic -
Premium - Pro - Admin/Test

Track provider budgets independently.

# 9. Admin UI

Provide: - Provider configuration - Capture browser - Replay - Parser
evaluation - Shadow comparison - Analytics dashboard - Runtime settings

# 10. Retention

Storage prefixes:

-   production (30 days)
-   admin (indefinite)
-   testing (indefinite)
-   replay (configurable)
-   analytics (indefinite)

Provide purge tools with audit logging.

# 11. Long-Term Analytics

Aggregate daily metrics instead of querying raw captures.

Track: - provider latency - provider cost - prompt versions - parser
versions - field accuracy - blank rates - quality scores - user
regeneration requests - shadow agreement - ground truth agreement

Generate daily, weekly, monthly and quarterly trend reports.

Automatically detect regressions in: - latency - cost - quality -
completeness - parser accuracy

# 12. Continuous Improvement Lifecycle

User Request → AI Execution → Capture → Evaluation → Ground Truth
Comparison → Analytics → Regression Detection → Prompt/Parser Updates →
Redeployment → Measurement

# 13. Testing Strategy

Unit Tests: - adapters - evaluation - redaction

Integration: - registry - replay - rate limiting

End-to-End: - itinerary generation - parsing

Performance: - concurrency - latency

Chaos: - provider outage - storage outage - malformed JSON

Regression: - golden fixtures - manually labeled datasets

# 14. Versioning

Version independently: - prompt - parser - provider adapter - capture
schema - field specification - application version

Never overwrite historical captures.

# 15. Observability

Expose OpenTelemetry metrics.

Counters: - requests - failures - captures

Histograms: - latency - write time

Gauges: - monthly cost - storage

# 16. Deployment Strategy

Roll out in phases:

1.  Registry
2.  Capture
3.  Redaction
4.  Evaluation
5.  Shadow mode
6.  Analytics
7.  Additional providers

Each phase protected by feature flags.

# 17. A/B Testing

Support configurable rollout percentages by: - provider - prompt -
parser

Collect comparative metrics automatically.

# 18. Implementation Order

1.  Provider registry
2.  OpenAI adapter
3.  Capture
4.  Privacy
5.  Provider configuration
6.  Evaluation
7.  Shadow parsing
8.  Replay
9.  Analytics
10. Additional providers

# 19. Senior Developer Guidance

Treat this as a platform rather than a feature.

Avoid duplicate provider logic.

Keep AI code under server/src/ai.

Use deterministic tests.

Never allow telemetry failures to impact users.
