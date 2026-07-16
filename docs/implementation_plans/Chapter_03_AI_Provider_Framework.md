# Chapter 3 --- AI Provider Framework

## 1. Purpose

This chapter defines the provider framework that enables the platform to
support multiple LLM vendors through a single, stable interface.

Goals:

-   Eliminate vendor lock-in
-   Minimize feature-specific AI code
-   Support runtime provider switching
-   Provide deterministic testing
-   Standardize monitoring and cost tracking

## 2. Supported Providers

Initial providers:

-   OpenAI — existing; becomes the reference adapter. No wire-format
    translation needed since it's already wired via
    `postOpenAiChatCompletion`.
-   Anthropic — new; Messages API. System prompt is a top-level field
    (not a message), and there is no native JSON mode — use tool-forcing
    or prompt-enforced JSON with a parse-retry.
-   Google Gemini — new; **use the public Generative Language API key,
    not Vertex AI.** This keeps auth symmetric with every other provider
    via the same `getEnvValue()`/`_FILE` convention used everywhere
    else in this codebase. Vertex's service-account auth path would be
    the one provider that works differently, complicating the
    registry's "configured" check (§5) for no benefit at this scale.
    Revisit only if Gemini volume grows enough to justify GCP-native
    billing/quota consolidation.
-   Z.ai — new; OpenAI-compatible `chat/completions` endpoint. This
    adapter can likely reuse the OpenAI adapter's wire format with a
    different base URL/API key rather than a bespoke implementation —
    the cheapest of the three new providers to ship.
-   Test Provider (local only)

Future providers must integrate through the same interface.

## 3. Provider Interface

``` ts
export interface AiChatProvider {
  readonly id: string;
  readonly supportedModels: string[];

  chatCompletion(
      request: AiChatRequest,
      context: AiCallContext
  ): Promise<AiChatResponse>;
}
```

Provider implementations must only translate requests and responses.
They must not implement business logic, rate limiting, capture, or
analytics.

## 4. Registry

The provider registry owns:

-   provider discovery
-   adapter registration
-   configuration lookup
-   provider resolution
-   dependency injection

Example flow:

``` text
Feature
  ↓
AI Registry
  ↓
Configured Provider
  ↓
Provider Adapter
  ↓
External API
```

## 5. Runtime Configuration

Administrators configure providers by feature.

Examples:

-   itinerary_generation
-   email_parsing
-   pdf_parsing

Configuration includes:

-   provider
-   model
-   enabled
-   updated by
-   updated timestamp

End users never choose providers.

Persist this as `ai_provider_config(feature_key TEXT PRIMARY KEY,
provider, model, enabled, updated_by, updated_at)`, implemented across
all three DB adapters (`db.postgres.ts`, `db.firebase.ts`,
`db.memory.ts`) per this repo's adapter-parity convention. Read it
through the same 60-second in-process TTL cache already used for
feature flags (`isFeatureEnabled`) so config lookups don't add a DB
round-trip to every generation stage — config changes are rare and
admin-only, so a short cache is free. `GET /api/admin/ai-config` must
return a `configured: boolean` per provider (derived from whether that
provider's API key env var is present, never the key itself) so the
admin UI can't select a provider that would fail at runtime — nothing
today validates that a chosen provider is actually usable before an
admin switches to it.

## 6. Adapter Requirements

Every adapter shall:

-   support JSON responses
-   normalize provider errors
-   return standardized token usage
-   return standardized latency
-   expose model metadata
-   implement health checks

## 7. Cost Tracking

Each adapter returns:

-   prompt tokens
-   completion tokens
-   total tokens
-   estimated request cost

Cost estimation logic is centralized and versioned independently from
adapters.

## 8. Health Monitoring

Track:

-   availability
-   latency
-   timeout rate
-   error rate
-   throttling
-   JSON compliance

Health metrics feed the AI Operations dashboard.

## 9. Provider Certification

Before production enablement each provider must pass:

-   interface contract tests
-   JSON compliance tests
-   latency benchmarks
-   cost validation
-   replay compatibility
-   regression comparisons
-   security review

Only certified providers may be enabled by administrators.

## 10. Failover

Automatic failover is disabled by default because providers may generate
materially different outputs.

Optional failover may be enabled per feature after explicit validation.

## 11. Test Provider

Provide an in-repository Test Provider that:

-   requires no network
-   returns deterministic responses
-   supports injected failures
-   supports latency simulation
-   supports malformed JSON simulation

All automated tests should use this provider unless explicitly
validating vendor integration.

## 12. Extensibility

Adding a provider requires:

1.  Implement adapter
2.  Register adapter
3.  Configure environment variables
4.  Pass certification
5.  Enable in admin UI

No application feature should require code changes.

## 13. Security

Provider credentials:

-   retrieved using existing environment configuration
-   never logged
-   never returned to clients
-   validated during startup

The admin UI displays only provider readiness, never secret values.
