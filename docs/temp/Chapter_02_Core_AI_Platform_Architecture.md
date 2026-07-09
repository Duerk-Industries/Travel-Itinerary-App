# Chapter 2 --- Core AI Platform Architecture

**Evaluation note:** structurally sound; the one substantive gap is that
"Authorization & Rate Limits" (§2, §3) reads as if the registry owns new
limiting logic. It does not — it owns a single orchestration call into
two systems that already exist and are already independently tested.
That correction is applied in §3 below.

## 1. Overview

This chapter defines the core architecture that every AI-powered feature
must use. The objective is to eliminate duplicated infrastructure by
routing all AI interactions through a common platform.

## 2. Architectural Principles

Every AI request must pass through the following pipeline:

``` text
Application Feature
        │
        ▼
AI Registry
        │
        ├── Provider Selection
        ├── Authorization & Rate Limits
        ├── Budget Tracking
        ├── Capture
        ├── Evaluation Hooks
        ├── Metrics
        ▼
Provider Adapter
        ▼
External AI Provider
```

Application features must never communicate directly with OpenAI,
Anthropic, Gemini, Z.ai, or any future provider.

## 3. AI Registry

The registry is the single entry point for all AI requests.

Responsibilities include:

-   Resolve provider and model from configuration.
-   Enforce user entitlements.
-   Enforce provider budgets.
-   Invoke the selected provider.
-   Record capture metadata.
-   Emit telemetry.
-   Provide correlation IDs.
-   Expose hooks for shadow execution and evaluation.

No business logic should exist in the registry.

**"Enforce user entitlements" and "Enforce provider budgets" are two
existing, independent systems, composed, not replaced.** This codebase
already has `entitlementService.ts` (per-user, per-tier monthly
generation counts, idempotent reserve/finalize) and `usageLimiter.ts`
(per-provider, per-caller windowed counters, YAML-configured). Merging
their internals risks breaking the idempotency semantics
`entitlementService` depends on for job retry/finalize. The registry
instead calls one new orchestration function,
`authorizeAiCall(ctx)` in `server/src/services/aiInvocationGuard.ts`,
before every dispatch:

``` ts
async function authorizeAiCall(ctx: AiCallContext): Promise<AiCallAuthorization> {
  const [tierResult, providerResult] = await Promise.allSettled([
    entitlementService.reserveGenerationUsage(ctx.userId, ctx.windowKey, ctx.role),
    usageLimiter.reserveApiUsageOrThrow(ctx.provider, ctx.callerId),
  ]);

  if (tierResult.status === 'rejected') {
    throw tierResult.reason;                       // EntitlementError → HTTP 402
  }
  if (providerResult.status === 'rejected') {
    await entitlementService.failGenerationUsage(ctx.userId, ctx.windowKey, 'provider_limit_exceeded');
    throw providerResult.reason;                    // vendor throttling → HTTP 429
  }
  return { tierReservation: tierResult.value, providerReservation: providerResult.value };
}
```

Both checks run concurrently (`Promise.allSettled`, not `Promise.all` —
both outcomes are needed even if one rejects, so the other can be rolled
back). If the tier reservation succeeds but the provider check fails,
the tier reservation must be released — this rollback is the only
genuinely new logic here; everything else is calling existing functions
in the right order. On success, both reservations stay open until the
provider call itself resolves, at which point the registry calls
`finalizeGenerationUsage` or `failGenerationUsage` — mirroring the
pattern already used in `itineraryAsyncService.ts::runJob`.

## 4. Request Lifecycle

1.  Application constructs an `AiChatRequest`.
2.  Registry loads provider configuration.
3.  Authorization and rate limits are evaluated.
4.  Correlation identifiers are created.
5.  Request is dispatched to the selected provider adapter.
6.  Response is validated and normalized.
7.  User response is returned.
8.  Capture, evaluation, and analytics execute asynchronously.

## 5. Provider Adapters

Each provider adapter is responsible only for translating the normalized
request into the provider-specific API and returning a normalized
response.

Adapters must not contain application logic, capture logic, budgeting,
or rate limiting.

Keep the normalized `AiChatRequest`/`AiChatResponse` shape close to
OpenAI's existing chat-completions format rather than designing a
vendor-neutral prompt DSL — that's the shape the majority of existing
prompt-building code (`itineraryPromptPlanService.ts`) already assumes,
and it's cheaper to have each adapter absorb translation cost than to
push a new abstraction onto every caller.

## 6. Core Data Objects

Core objects include:

-   AiChatRequest
-   AiChatResponse
-   AiCallContext
-   AiProvider
-   CaptureRecord
-   EvaluationResult

These objects form the stable contract between the application and AI
platform.

## 7. Correlation IDs

Every request shall include:

-   correlationId
-   requestId
-   jobId (if applicable)
-   featureKey
-   anonymousUserId
-   provider
-   model

These identifiers must flow through logs, capture records, metrics, and
replay.

## 8. Error Handling

Provider failures are isolated from platform failures.

Platform subsystems such as capture, evaluation, analytics, and shadow
execution must never prevent successful user responses.

Retries should be limited to idempotent operations.

## 9. Extensibility

Future providers require only:

1.  Implement the provider interface.
2.  Register the adapter.
3.  Add configuration metadata.
4.  Pass provider contract tests.

No application feature should require modification when adding a new
provider.

## 10. Design Constraints

The platform shall support:

-   multiple concurrent providers
-   multiple prompt versions
-   multiple parser versions
-   A/B testing
-   replay
-   shadow execution
-   long-term analytics

without architectural redesign.
