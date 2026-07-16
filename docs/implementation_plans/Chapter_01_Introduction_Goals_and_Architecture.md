# Chapter 1 --- Introduction, Goals, Guiding Principles, and Architecture Overview

**Evaluation note:** This chapter is directionally sound and requires no
structural changes. The corrections applied below are grounding notes:
this plan is additive to work that already exists in this codebase, not
a green-field build. Two reference documents already exist and should be
treated as the concrete implementation of Goal 3 / Chapter 5, not
duplicated: [`docs/travel-field-spec.md`](../travel-field-spec.md) and
[`server/config/travel-field-spec.json`](../../server/config/travel-field-spec.json).
A companion implementation-detail document,
[`docs/ai-capture-eval-plan.md`](../ai-capture-eval-plan.md), maps
several of these goals directly onto specific files and functions in
this codebase and should be read alongside this chapter set.

## 1. Purpose

This document defines the architecture and implementation plan for an AI
platform that supports itinerary generation, travel document parsing,
evaluation, continuous improvement, and future AI-powered capabilities
within the WanderBunnies platform.

This is not simply a logging system. It is intended to become a reusable
AI platform that provides:

-   Provider independence
-   Evaluation and benchmarking
-   Continuous quality improvement
-   Cost visibility
-   Operational monitoring
-   Production-safe experimentation
-   Long-term analytics
-   Enterprise-grade security and privacy

The platform should allow new AI-powered features to inherit these
capabilities automatically instead of requiring each feature to
implement them independently.

# 2. Project Goals

## Goal 1 -- Decouple AI Providers

Every AI request should pass through a common provider abstraction.

Benefits include: - easier provider replacement - centralized rate
limiting - centralized cost tracking - centralized logging - centralized
security

**Current state:** today there is no provider abstraction. All OpenAI
calls funnel through one function, `postOpenAiChatCompletion`
(`server/src/apis/openaiApi.ts`), and the model/vendor is hardcoded
there and, independently, in `server/src/ingestion/extraction/llmExtractor.ts`.
Decoupling means wrapping this existing chokepoint as the first provider
adapter with zero behavior change, then routing both callers through the
registry — not designing a provider interface against a blank slate.

## Goal 2 -- Capture AI Interactions

Capture enough information to improve prompts, reproduce failures,
benchmark providers, compare prompt versions, and support replay while
never storing raw PII in production.

## Goal 3 -- Evaluate AI Quality

Continuously evaluate parser quality, itinerary quality, field
completeness, validation accuracy, comparison against production
parsers, manually labeled ground truth, and historical trends.

## Goal 4 -- Continuous Improvement

Use captured data to improve prompts, parser logic, provider selection,
models, normalization, and validation rules through measurable outcomes.

## Goal 5 -- Operational Visibility

Provide dashboards for quality, cost, failures, provider comparison,
prompt performance, and long-term trends.

## Goal 6 -- Minimize Production Risk

Failures in capture, analytics, replay, evaluation, or shadow execution
must never affect user-facing functionality.

# 3. Guiding Principles

-   User experience always takes precedence.
-   Production privacy is enforced through allowlists rather than
    best-effort detection.
-   Capture is disposable telemetry.
-   Evaluation is independent of production execution.
-   Shadow execution is invisible to users.
-   Decisions should be evidence-based.
-   Reuse existing platform services instead of building parallel ones.
    This codebase already has two independently-tested rate/usage
    limiting systems (`entitlementService.ts` for per-tier limits,
    `usageLimiter.ts` for per-provider limits), a feature-flag-style
    admin config pattern (DB row wins over default, 60s TTL cache), an
    `audit_log` table, and `requireAdmin` middleware. The AI platform
    composes these, it does not reimplement them (see Chapter 2 §3 and
    Chapter 6 §7).

# 4. Non-Functional Requirements

## Performance

Capture must execute asynchronously and never materially increase
request latency.

## Reliability

Capture, evaluation, analytics, and replay failures must degrade
gracefully.

## Security

Production AI capture shall never contain raw PII.

## Maintainability

Centralize provider routing, budgeting, capture, evaluation, replay,
analytics, and rate limiting. Centralize means "one composition point
in front of existing systems," not "one new system replacing existing
systems" — see the reuse principle in Chapter 1 §3.

## Testability

All provider adapters must support deterministic testing using a local
mock provider.

## Observability

Every AI request shall include sufficient metadata to reconstruct
execution, cost, latency, quality, and provider information.

# 5. Scope

Initial scope: - AI itinerary generation - Email parsing - PDF parsing -
Provider abstraction - Capture - Replay - Evaluation - Long-term
analytics - Administrative tooling

Future scope: - OCR - Vision - Voice - Recommendations - AI search -
Additional AI-powered features

# 6. Success Criteria

The platform succeeds when provider selection is configurable,
production captures are redacted and anonymized, quality is measurable,
replay is available, and capture/evaluation failures never impact users.

# 7. Architectural Vision

Every AI feature should inherit provider abstraction, capture,
evaluation, analytics, replay, observability, budgeting, security, and
experimentation from a shared platform rather than implementing them
independently.
