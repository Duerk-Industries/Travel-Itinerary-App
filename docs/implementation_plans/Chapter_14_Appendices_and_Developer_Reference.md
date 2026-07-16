# Chapter 14 --- Appendices and Developer Reference

## 1. Purpose

This chapter serves as the technical reference manual for implementing,
operating, and extending the AI Platform. It complements the
architectural chapters by consolidating implementation standards,
reference schemas, conventions, and examples into a single location.

------------------------------------------------------------------------

# 2. Recommended Project Structure

``` text
server/
└── src/
    └── ai/
        ├── providers/
        ├── registry/
        ├── capture/
        ├── evaluation/
        ├── replay/
        ├── analytics/
        ├── prompts/
        ├── parsers/
        ├── config/
        ├── types/
        ├── testing/
        └── utils/
```

All AI-specific functionality should reside under a common `ai` module
to avoid duplication.

------------------------------------------------------------------------

# 3. Database Objects

Core tables (or equivalent collections):

-   ai_provider_config
-   admin_settings
-   ai_daily_metrics
-   ai_provider_metrics
-   ai_prompt_metrics
-   ai_parser_metrics
-   ai_field_metrics
-   ai_cost_metrics
-   ai_ab_test_metrics (deferred — see Chapter 9 §11)
-   audit_log (existing table — reuse, do not create a new one)

Historical captures should remain in object storage rather than
relational tables whenever practical.

Every new table above must be implemented across all three DB adapters
(`db.postgres.ts`, `db.firebase.ts`, `db.memory.ts`) — see Chapter 12 §8
and Chapter 7 §10. The field-quality ruleset these analytics tables
consume is already defined and checked into the repo at
`docs/travel-field-spec.md` / `server/config/travel-field-spec.json` —
reference it, don't recreate it.

------------------------------------------------------------------------

# 4. Core APIs

Administrative endpoints:

-   GET /api/admin/ai-config
-   PATCH /api/admin/ai-config/{feature}
-   GET /api/admin/captures
-   POST /api/admin/replay
-   GET /api/admin/analytics
-   GET /api/admin/runtime-settings
-   PATCH /api/admin/runtime-settings

Operational endpoints:

-   GET /health
-   GET /ready
-   GET /metrics

------------------------------------------------------------------------

# 5. Configuration

Representative runtime settings:

-   shadow_parse_sample_rate_percent
-   shadow_parse_monthly_budget_usd
-   capture_compression_threshold
-   capture_max_size_mb
-   replay_max_concurrency
-   provider_retry_limit

Settings should be cached with a short TTL and audited on modification.

------------------------------------------------------------------------

# 6. Environment Variables

Examples:

-   AI_CAPTURE_BUCKET
-   ENABLE_RAW_AI_CAPTURE
-   OPENAI_API_KEY
-   ANTHROPIC_API_KEY
-   GEMINI_API_KEY
-   ZAI_API_KEY
-   AI_HASH_SALT

Secrets must be supplied through the platform's secure configuration
mechanism.

Concretely: read every one of these through `getEnvValue()` /
`getEnvFlag()` from `server/src/env.ts`, never `process.env` directly.
Both helpers already support the `_FILE` suffix convention (e.g.
`AI_HASH_SALT_FILE=/run/secrets/ai_hash_salt`) for Docker/Cloud Run
secrets — reuse that rather than adding a second secret-loading
mechanism for this platform.

------------------------------------------------------------------------

# 7. Capture Schema (Representative)

Every capture should include:

-   captureId
-   correlationId
-   featureKey
-   provider
-   model
-   promptVersion
-   parserVersion
-   captureSchemaVersion
-   anonymousUserId
-   latency
-   tokenUsage
-   estimatedCost
-   validationSummary
-   outcome

Production captures must exclude raw PII.

------------------------------------------------------------------------

# 8. Evaluation Schema

Representative fields:

-   evaluationId
-   captureId
-   qualityScore
-   completenessScore
-   validationScore
-   groundTruthAgreement
-   productionAgreement
-   evaluationVersion

------------------------------------------------------------------------

# 9. Coding Standards

-   Favor composition over inheritance.
-   Keep provider adapters thin.
-   Avoid feature-specific AI code outside the platform.
-   Prefer immutable data structures.
-   Use structured logging via `logInfo`/`logError` from
    `server/src/logger.ts` — never `console.log` in server code.
-   Version all externally persisted schemas.

------------------------------------------------------------------------

# 10. Naming Conventions

Examples:

-   AiChatProvider
-   AiRegistry
-   CaptureRecord
-   EvaluationResult
-   ReplayJob
-   PromptVersion
-   ParserVersion

Names should clearly distinguish runtime objects from persisted records.

------------------------------------------------------------------------

# 11. Error Handling

Normalize provider-specific failures into common categories:

-   ValidationError
-   ProviderUnavailable
-   Timeout
-   RateLimited
-   AuthenticationFailure
-   BudgetExceeded
-   InternalError

Expose consistent error codes to callers.

------------------------------------------------------------------------

# 12. Example Lifecycle

``` text
User Request
   ↓
Registry
   ↓
Provider Adapter
   ↓
Response
   ↓
Capture
   ↓
Evaluation
   ↓
Analytics
   ↓
Recommendation
```

------------------------------------------------------------------------

# 13. Glossary

-   AI Registry --- Central orchestration layer.
-   Capture --- Persisted telemetry describing an AI interaction.
-   Evaluation --- Quality assessment of captured output.
-   Replay --- Re-execution of a historical capture.
-   Shadow Parsing --- AI execution used only for comparison.
-   Ground Truth --- Manually validated expected output.
-   Prompt Version --- Versioned prompt template.
-   Parser Version --- Versioned parser implementation.

------------------------------------------------------------------------

# 14. Guidance for LLM Implementation

The implementation should proceed incrementally and preserve existing
functionality after each phase.

Priority order:

1.  Maintain production stability.
2.  Preserve privacy guarantees.
3.  Keep AI infrastructure reusable.
4.  Avoid duplicated logic.
5.  Maintain backward compatibility.
6.  Prefer measurable improvements over assumptions.

When multiple implementation approaches satisfy the requirements, prefer
the solution that minimizes operational complexity while preserving
extensibility.

------------------------------------------------------------------------

# 15. Final Success Criteria

The AI platform is complete when:

-   Every AI feature routes through the shared platform.
-   Providers are interchangeable through configuration.
-   Production capture is redacted and anonymized.
-   Evaluation and analytics operate automatically.
-   Administrators can configure, monitor, replay, and improve AI
    behavior from the AI Operations console.
-   Long-term analytics support evidence-based optimization.
-   New AI capabilities inherit platform services with minimal
    additional implementation.
