# Chapter 10 --- Testing Strategy and Quality Assurance

## 1. Purpose

This chapter defines the testing strategy for the AI platform. Its
objective is to ensure correctness, reliability, security, performance,
and backward compatibility while enabling rapid iteration on prompts,
parsers, providers, and evaluation logic.

Quality assurance applies to every layer of the platform and is a
release requirement, not an optional activity.

------------------------------------------------------------------------

# 2. Testing Principles

The testing strategy is based on the following principles:

-   Prefer deterministic tests over live provider calls.
-   Test each layer independently before testing integrated workflows.
-   Continuously validate historical behavior through regression suites.
-   Automate all repeatable testing.
-   Fail builds when critical quality gates are not met.

------------------------------------------------------------------------

# 3. Testing Pyramid

``` text
                End-to-End
           Integration Tests
             Component Tests
                Unit Tests
```

Lower layers should contain the majority of tests.

------------------------------------------------------------------------

# 4. Unit Testing

Every independently testable component shall have unit tests.

Required areas include:

-   Provider adapters
-   AI registry
-   Capture serialization
-   Redaction and anonymization
-   Validation rules
-   Evaluation scoring
-   Cost estimation
-   Runtime settings
-   Replay metadata
-   Analytics aggregation

A blanket 90% coverage target is a weak proxy here — it's easy to hit
with low-value tests and easy to miss the areas that actually matter.
Treat coverage as a secondary signal and require, without exception,
thorough tests for: the structural-allowlist/redaction boundary
(Chapter 7 §5–§6 — a false pass here is a privacy incident), the rate-
limit composition and rollback logic (Chapter 2 §3 — a false pass here
either overcharges a user or double-spends provider budget), and the
"capture failure never blocks the user response" guarantee (Chapter 4
§13) — an explicit test that asserts the user-facing flow still
succeeds when a capture write throws.

------------------------------------------------------------------------

# 5. Integration Testing

Validate interactions between components, including:

-   Registry → Provider Adapter
-   Registry → Rate Limiter
-   Registry → Capture
-   Capture → Evaluation
-   Evaluation → Analytics
-   Replay → Evaluation
-   Admin API → Database

Integration tests should use the local Test Provider instead of external
AI services.

------------------------------------------------------------------------

# 6. End-to-End Testing

Execute complete workflows including:

-   Itinerary generation
-   Email parsing
-   PDF parsing
-   Replay
-   Shadow execution
-   Provider switching
-   Runtime configuration changes

Verify both user-facing behavior and operational artifacts.

------------------------------------------------------------------------

# 7. Golden Dataset Regression Testing

Maintain version-controlled fixture libraries for:

-   Flights
-   Hotels
-   Rental Cars
-   Rail
-   Cruises
-   Activities
-   Multi-document itineraries

Each fixture includes:

-   Original source document
-   Expected normalized output
-   Validation expectations
-   Ground-truth labels

Every parser and prompt change must be evaluated against the full
regression suite.

Extend the golden-fixture conventions that already exist in this
codebase (`ingestion.non-llm-fixtures.test.ts`,
`ingestion.normalization.golden.test.ts`) rather than introducing a
parallel fixture framework.

------------------------------------------------------------------------

# 8. Provider Contract Testing

Every provider adapter must pass a common contract suite validating:

-   Request normalization
-   Response normalization
-   Error mapping
-   Token accounting
-   Timeout handling
-   Retry behavior
-   JSON compliance

New providers cannot be enabled until contract tests pass.

------------------------------------------------------------------------

# 9. Test Provider

The platform shall include an in-repository Test Provider that:

-   Requires no network connectivity
-   Produces deterministic responses
-   Simulates latency
-   Simulates throttling
-   Simulates malformed JSON
-   Simulates provider failures

All automated CI pipelines should use this provider unless specifically
testing vendor integrations.

------------------------------------------------------------------------

# 10. Performance Testing

Performance tests shall validate:

-   Single-request latency
-   Sustained throughput
-   Burst traffic
-   Background capture load
-   Replay load
-   Shadow execution overhead

Acceptance criteria should align with Chapter 6 SLOs.

------------------------------------------------------------------------

# 11. Chaos and Resiliency Testing

Inject controlled failures including:

-   Provider outage
-   Storage outage
-   Database outage
-   Malformed AI response
-   Capture persistence failure
-   Evaluation failure
-   Budget exhaustion

Verify graceful degradation and user isolation.

------------------------------------------------------------------------

# 12. Security and Privacy Testing

Security validation includes:

-   Authorization enforcement
-   Privilege escalation attempts
-   Redaction correctness
-   Anonymization correctness
-   Prompt injection resilience
-   Malicious upload handling
-   Secret leakage checks

Production capture fixtures must never contain raw PII.

------------------------------------------------------------------------

# 13. Replay Validation

Replay testing verifies:

-   Idempotency
-   Historical compatibility
-   Version handling
-   Alternate provider execution
-   Alternate prompt execution

Replay results must never overwrite original captures.

------------------------------------------------------------------------

# 14. CI/CD Quality Gates

The release pipeline should require successful completion of:

-   Unit tests
-   Integration tests
-   Regression suite
-   Security tests
-   Performance smoke tests
-   Provider contract tests
-   Static analysis
-   Linting

Production deployment should be blocked when mandatory gates fail.

------------------------------------------------------------------------

# 15. Acceptance Criteria

A release is considered production-ready when:

-   All required tests pass.
-   Regression scores meet defined thresholds.
-   No critical security findings remain open.
-   Performance SLOs are satisfied.
-   Provider certification requirements are met.
-   Capture, replay, and evaluation operate successfully.
-   Long-term analytics continue without regression.

------------------------------------------------------------------------

# 16. Continuous Quality Improvement

Testing results shall feed the analytics platform.

Track long-term trends for:

-   Defect escape rate
-   Regression frequency
-   Provider reliability
-   Prompt quality
-   Parser quality
-   Test execution duration
-   Coverage

Quality metrics should influence engineering priorities and release
readiness.
