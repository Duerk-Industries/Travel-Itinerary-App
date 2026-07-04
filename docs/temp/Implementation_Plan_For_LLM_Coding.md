# AI Platform — Implementation Plan for LLM Coding

**Source specs:** `AI_Capture_Evaluation_Improvement_Plan_Full.md` +
`Chapter_01`–`Chapter_14` in this directory (as revised).

**How to use this document:** each task below is scoped to be a single,
mergeable unit of work — implement it, add its tests, verify its exit
criteria, then move to the next task. Do not skip ahead to a later
phase's task before its dependencies land. Do not build anything marked
**Deferred** unless explicitly asked. Tasks assume familiarity with this
repo's `CLAUDE.md` conventions (`getEnvValue()`/`getEnvFlag()` for env
vars, `logInfo`/`logError` for logging, DB changes implemented across
`db.postgres.ts`/`db.firebase.ts`/`db.memory.ts`, admin routes behind
`requireAdmin` with `audit_log` writes).

---

## Phase 0 — Scaffolding (no behavior change)

**Goal:** create the module boundary everything else lands in.

| Task | Files | Detail |
|---|---|---|
| 0.1 | `server/src/ai/` (new dir tree) | Create `providers/`, `registry/`, `capture/`, `evaluation/`, `replay/`, `analytics/`, `prompts/`, `parsers/`, `config/`, `types/`, `testing/`, `utils/` — empty except `.gitkeep` or an index barrel. All new AI-platform code lives under this tree (Chapter 14 §2). |
| 0.2 | `server/src/ai/types/aiChat.ts` | Define `AiChatRequest`, `AiChatResponse`, `AiCallContext` types. Keep `AiChatRequest` shape close to OpenAI's chat-completions format (system/user messages, JSON-mode hint, max tokens, temperature) — do not design a vendor-neutral DSL (Chapter 2 §5). |
| 0.3 | `server/src/ai/types/aiChat.ts` | `AiCallContext = { correlationId, requestId, jobId?, featureKey, userId, anonymousUserId, tier, role, provider, model, callerId }`. |

**Exit criteria:** compiles, no existing code touched, no tests needed beyond type-checking.

---

## Phase 1 — AI Registry & OpenAI Adapter (Chapter 13 Phases 1–2)

**Goal:** wrap the existing single OpenAI chokepoint behind the new
interface with **zero behavior change**, so every later phase has
something real to build on.

**Current state to preserve:** all OpenAI calls today go through
`postOpenAiChatCompletion` (`server/src/apis/openaiApi.ts`), with model
hardcoded there and, separately, in
`server/src/ingestion/extraction/llmExtractor.ts`.

| Task | Files | Detail |
|---|---|---|
| 1.1 | `server/src/ai/providers/AiChatProvider.ts` | Define the interface: `{ id: string; supportedModels: string[]; chatCompletion(req, ctx): Promise<AiChatResponse> }`. |
| 1.2 | `server/src/ai/providers/openaiProvider.ts` | Implement `AiChatProvider` by calling the **existing** `postOpenAiChatCompletion` internally. Pure translation — no new HTTP logic. This is the reference adapter every other adapter is compared against. |
| 1.3 | `server/src/ai/testing/testAiProvider.ts` | In-repo `TestAiProvider`: no network, deterministic canned responses keyed off input, and injectable failure modes (`simulateLatency`, `simulateMalformedJson`, `simulateThrottle`, `simulateTimeout`). Every later test uses this, not live OpenAI. |
| 1.4 | `server/src/ai/registry/aiProviderRegistry.ts` | `resolveProvider(featureKey, callerId): AiChatProvider`. Hardcoded `openai` fallback if config unset (Phase 5 adds real config lookup — until then, always resolves to `openaiProvider`). |
| 1.5 | `server/src/ai/registry/correlation.ts` | `createAiCallContext(...)` — generates `correlationId`/`requestId`, computes `anonymousUserId = sha256(userId + AI_HASH_SALT)` (salt via `getEnvValue('AI_HASH_SALT')`). |
| 1.6 | `server/__tests__/ai/providerContract.test.ts` | Shared contract-test suite. Run it against both `openaiProvider` (using a fetch mock) and `TestAiProvider`. Assert: request normalization, response normalization, token-usage shape, error-mapping shape. New providers in later phases must pass this same suite. |
| 1.7 | `itineraryPromptPlanService.ts`, `llmExtractor.ts` | Route through `aiProviderRegistry.resolveProvider(...).chatCompletion(...)` instead of calling `postOpenAiChatCompletion`/hardcoded model directly. **No behavior change** — same model, same prompts, same output. |

**Exit criteria:** existing itinerary-generation and mail-parsing integration tests pass unmodified. `grep` confirms no caller invokes `postOpenAiChatCompletion` directly outside `openaiProvider.ts`.

---

## Phase 2 — Rate-Limit Composition (folded into Registry responsibilities, Chapter 2 §3)

**Goal:** the registry enforces both existing limiting systems through one call, without modifying either system's internals.

| Task | Files | Detail |
|---|---|---|
| 2.1 | `server/src/services/aiInvocationGuard.ts` | Implement `authorizeAiCall(ctx: AiCallContext): Promise<AiCallAuthorization>` exactly as specified in Chapter 2 §3 — `Promise.allSettled([entitlementService.reserveGenerationUsage(...), usageLimiter.reserveApiUsageOrThrow(...)])`, with `failGenerationUsage` rollback when the provider-side check rejects after the tier-side succeeded. |
| 2.2 | `server/config/api-limits.yaml` | Add `ANTHROPIC`/`GEMINI`/`ZAI` provider blocks (same caller set as `OPENAI`) and a new `LLM_SHADOW_PARSE` caller. Config-only change, no `usageLimiter.ts` code changes needed. |
| 2.3 | `server/src/ai/registry/aiProviderRegistry.ts` | Call `authorizeAiCall` immediately before `provider.chatCompletion(...)`; call `entitlementService.finalizeGenerationUsage`/`failGenerationUsage` after the provider call resolves/rejects. |
| 2.4 | `server/__tests__/ai/aiInvocationGuard.test.ts` | Cover: both succeed → both reservations returned; tier rejects → provider never reserved, `EntitlementError` thrown; provider rejects after tier succeeds → `failGenerationUsage` called exactly once, original provider error re-thrown. |

**Exit criteria:** a forced `usageLimiter` rejection in a test provably releases the tier reservation (assert `failGenerationUsage` called with the right args) — this is the one piece of genuinely new logic in the whole phase; test it directly, not just through the happy path.

---

## Phase 3 — Capture Framework (Chapter 4, Chapter 13 Phase 3)

**Goal:** start collecting real capture data for all OpenAI traffic without adding latency risk.

| Task | Files | Detail |
|---|---|---|
| 3.1 | `server/src/ai/types/captureRecord.ts` | `CaptureRecord` type per Chapter 4 §5, with `captureSchemaVersion` field from day one. |
| 3.2 | `server/src/ai/capture/captureService.ts` | `captureAiInteraction(record)`: local disk write to `server/data/ai-capture/<feature>/YYYY-MM-DD/<id>.json` (dev) or GCS (`gs://<AI_CAPTURE_BUCKET>/...`, prod), gzip-compressed. Fire-and-forget: caller never `await`s completion on the response path. On failure: 1 immediate retry, 1 short-backoff retry, then log a warning metric and drop. No queue/batching subsystem — see 3.4/3.5 for the actual batching mechanism. |
| 3.3 | `server/src/ai/capture/gcsClient.ts` | Lazy `Storage()` singleton, same pattern as `image-service.ts:100`. Bucket name via `getEnvValue('AI_CAPTURE_BUCKET')`, falling back to the existing photo bucket + `ai-capture/` prefix only if unset. |
| 3.4 | `server/src/ai/capture/itineraryCapture.ts` | Accumulate each P0–Pn stage's capture record in the job's own execution context inside `itineraryAsyncService.ts` as each stage completes. On terminal state (success/failure/timeout), call `captureAiInteraction` **once** with all stages in a single object — `<jobId>.json`, not one file per stage. |
| 3.5 | `server/src/ai/capture/parsingCapture.ts` | One capture write per intake (keyed by the ingestion pipeline's existing `intakeId`, not a new ID), fire-and-forget after the HTTP response has started. Capture per-strategy output (`hotelFieldExtractors`/`learnedExtractor`/`llmExtractor`) from the existing `ParsedItemCandidate`/`ExtractionResult` types. |
| 3.6 | `server/__tests__/ai/captureNeverBlocks.test.ts` | Force `captureAiInteraction` to throw; assert itinerary-generation job still completes successfully and returns the correct result. This is the single most important test in the phase — do not skip it. |

**Exit criteria:** every OpenAI itinerary/parsing call produces exactly one capture object; capture-storage failure (simulated) never fails or delays the user-facing job/response.

---

## Phase 4 — Privacy & Redaction (Chapter 4 §8–9, Chapter 7 §5–6, Chapter 13 Phase 4)

**Goal:** production capture contains no raw PII, enforced structurally.

| Task | Files | Detail |
|---|---|---|
| 4.1 | `server/src/ai/capture/allowlistSerializer.ts` | `serializeForProduction(record, allowlist)` — only fields explicitly named in a per-capture-type allowlist ever reach the object written in prod. Freeform fields (traveler notes, raw email bodies, raw extracted text, raw prompts) are **excluded by construction**, not filtered after inclusion. |
| 4.2 | `server/src/ai/capture/anonymize.ts` | `anonymousUserId = sha256(userId + getEnvValue('AI_HASH_SALT'))`. Salt via `_FILE` suffix convention too (`AI_HASH_SALT_FILE`). |
| 4.3 | `server/src/ai/capture/redact.ts` | Best-effort regex redaction (emails, phone numbers, common ID shapes) applied only to the narrow set of already-allowlisted free-text fragments (e.g. a short extracted-text excerpt). Every record gets `redactionApplied: true/false`. Document in a code comment that this is best-effort, not a compliance guarantee — the allowlist in 4.1 is the actual enforcement. |
| 4.4 | `server/src/env.ts` usage | `ENABLE_RAW_AI_CAPTURE` read via `getEnvFlag()`, default `false`. When `true` **and** `isLocalEnv()`, `captureService.ts` skips the allowlist/redaction path entirely and stores raw records. In production this flag is never honored regardless of its value — hardcode the production branch to always use the allowlist path. |
| 4.5 | `server/__tests__/ai/allowlistSerializer.test.ts` | Fixture with every known PII field type populated (name, email, phone, address, passport number, payment token, cookie, auth header). Assert every one of them is absent from the serialized production output. This is a security-critical test — treat a failure here as a release blocker, not a flaky test to retry. |

**Exit criteria:** the fixture test in 4.5 passes, and a manual review confirms no code path can reach `captureAiInteraction` in production with an un-allowlisted field.

---

## Phase 5 — Provider Configuration & Admin (Chapter 3 §5, Chapter 8 §5, Chapter 13 Phase 7 partial)

**Goal:** admins can choose provider/model per feature at runtime; the choice is cached and validated.

| Task | Files | Detail |
|---|---|---|
| 5.1 | `server/src/db.postgres.ts`, `db.firebase.ts`, `db.memory.ts` | Add `ai_provider_config` table/collection: `feature_key PK, provider, model, enabled, updated_by, updated_at`. Implement `getAiProviderConfig`, `setAiProviderConfig` in **all three** adapters. `db.memory.ts` gets it via the existing `...postgresAdapter` spread if no divergent behavior is needed. |
| 5.2 | same three files | Add generic `admin_settings` table/collection (`key PK, value TEXT, updated_by, updated_at`) with `getAdminSetting`/`setAdminSetting`. This is the standard mechanism for future runtime-adjustable scalars, not just this feature's two settings (shadow sample rate, shadow budget — used starting Phase 7). |
| 5.3 | `server/src/services/aiProviderConfigService.ts` | `getActiveAiProvider(featureKey)` — 60s in-process TTL cache, DB row wins over hardcoded `openai` default, same shape as the existing `isFeatureEnabled` cache. |
| 5.4 | `server/src/ai/registry/aiProviderRegistry.ts` | Update `resolveProvider` to call `getActiveAiProvider(featureKey)` instead of always returning `openaiProvider`. |
| 5.5 | `server/src/routes/adminRoutes.ts` | `GET /api/admin/ai-config` (returns all feature configs + `configured: boolean` per registered provider, derived from env-var presence, never the key itself) and `PATCH /api/admin/ai-config/:featureKey` (writes row, writes `audit_log`, invalidates cache). Both behind `requireAdmin`. |
| 5.6 | `app/tabs/AdminTab.tsx` | New "AI Operations → Provider Config" section: per-feature provider/model dropdowns (disabled + tooltip if `configured: false`), last-changed-by/at line. |
| 5.7 | `server/__tests__/ai/aiProviderConfigService.test.ts` | Cache TTL behavior, fail-open to `openai` default when row missing, audit_log write on mutation. |

**Exit criteria:** switching a feature's provider in the admin UI changes which adapter the registry resolves within 60 seconds, with an audit trail, and the UI cannot select an unconfigured provider.

---

## Phase 6 — Evaluation Framework (Chapter 5, Chapter 13 Phase 5)

**Goal:** turn captures into quality metrics using the field spec that already exists.

**Do not recreate the spec** — `docs/travel-field-spec.md` and
`server/config/travel-field-spec.json` are already written and checked
in. This phase builds the evaluator that consumes them.

| Task | Files | Detail |
|---|---|---|
| 6.1 | `server/src/ai/config/travelFieldSpec.ts` | Loader parsing `server/config/travel-field-spec.json` once at startup, same convention as the existing `apiLimits.ts` loading `api-limits.yaml`. |
| 6.2 | `server/src/ai/evaluation/fieldEvaluator.ts` | For a given `ParsedItemType` + extracted fields: compute presence, blank rate, format-valid (regex from spec), cross-field checks (e.g. `check_out_date > check_in_date`). Fields with `format: null` never fail format validation — presence-only. |
| 6.3 | `server/src/ai/evaluation/qualityScore.ts` | Roll field-level results into `EvaluationResult` (Parse Quality Score, Completeness Score, Validation Score, all 0–100). |
| 6.4 | `server/src/ai/capture/captureService.ts` hook | After a parsing capture (3.5) persists, asynchronously run the evaluator and persist the `EvaluationResult` alongside it. Failure here must not affect the parsing response either. |
| 6.5 | `server/__tests__/ai/fieldEvaluator.test.ts` | **Test the evaluator, not the parser.** Feed it known-good and known-bad values per field type (e.g. `bookingReference: "ABC123"` passes PNR format, `"not-a-pnr!"` fails) and assert the evaluator's verdict — independent of any real parser output. |
| 6.6 | existing fixture suites | Extend `ingestion.non-llm-fixtures.test.ts` / `ingestion.normalization.golden.test.ts` with evaluator assertions rather than building a new fixture framework. |

**Exit criteria:** every parsing capture produces a field-quality report automatically; the evaluator's own unit tests are green independent of parser correctness.

---

## Phase 7 — Shadow Parsing (Chapter 4 full-plan §14, Chapter 13 Phase 6)

**Goal:** compare the AI parser against the production parser on sampled traffic, in production, without ever affecting the real response.

**Current gap:** `llmExtractor.canHandle` today gates LLM extraction to
local-dev only (`isLocalEnv() && NODE_ENV !== 'test'`). Shadow mode
needs a **separate**, explicit prod-enabled path — not a relaxation of
that gate for the real response path.

| Task | Files | Detail |
|---|---|---|
| 7.1 | `server/src/ai/services/shadowParseService.ts` | `maybeRunShadowParse(intakeId, extractedText)` — reads `shadow_parse_sample_rate_percent` from `admin_settings` (default 10 via seed row), decides sampling, and if sampled, invokes `llmExtractor` **after** the real production-parser result has already been used to build the response. Structural guard: this function's return type/signature must make it impossible for its result to flow into the assignment/response code path — e.g. it returns `void` and only writes to capture/comparison storage internally. |
| 7.2 | `server/src/services/providerBudgeting.ts` | Generalize `estimateOpenAiCostMicros` → `estimateAiCostMicros(provider, model, tokens)`. Add `ANTHROPIC`/`GEMINI`/`ZAI` budgeting blocks to `api-limits.yaml` mirroring `OPENAI`'s shape. |
| 7.3 | `shadowParseService.ts` | Before invoking, check budget via `getCurrentApiBudgetStatus('shadow_parse')` against `shadow_parse_monthly_budget_usd` (`admin_settings`, default 20). If exhausted, skip silently (log once at the transition, not per-skip) — shadow mode fails open into "skipped," never throws. |
| 7.4 | `server/src/ai/evaluation/comparisonEngine.ts` | Field-level diff: `same | production_only | llm_only | both_different(valA, valB)` between production-parser output and shadow-AI output. Roll up an agreement rate per field per item type. |
| 7.5 | `server/src/routes/adminRoutes.ts` | `POST /api/admin/parsing-eval/replay` — accepts `intakeId` or a date-range batch, replays through the LLM path using the durably-stored capture from Phase 3. Dry-run by default; never overwrites the original capture. |
| 7.6 | `server/__tests__/ai/shadowParseService.test.ts` | Assert: shadow result never appears in the function's return value or any caller-visible object; budget exhaustion skips without throwing; sampling rate respects the admin-configured percentage (statistically, over N calls with a fixed rate). |

**Exit criteria:** with shadow parsing enabled at 10%, production parsing behavior and latency are provably unchanged (existing parsing tests unaffected), and a comparison report is produced for sampled intakes.

---

## Phase 8 — AI Operations UI, Analytics Rollups, Observability (Chapter 8, Chapter 9 §3–13, Chapter 11, Chapter 13 Phases 7–8)

**Goal:** administrators can see and act on everything Phases 1–7 now produce, and long-term trends are computed from aggregates, not raw captures.

| Task | Files | Detail |
|---|---|---|
| 8.1 | `db.*.ts` (3 adapters) | Analytics tables: `ai_daily_metrics`, `ai_provider_metrics`, `ai_prompt_metrics`, `ai_parser_metrics`, `ai_field_metrics`, `ai_cost_metrics`. Aggregated rows must remain queryable after raw-capture retention (30 days) expires. |
| 8.2 | `server/src/ai/analytics/aggregationJob.ts` | Scheduled daily job (reuse whatever cron/scheduled-job convention exists, otherwise a startup-sync-style pattern like `attractionsCatalogService`). Idempotent — safe to rerun after a bug fix. Produces daily rollups; weekly/monthly/quarterly are rollups-of-rollups, not separate raw scans. |
| 8.3 | `server/src/ai/analytics/regressionDetector.ts` | Compare current rolling window against historical baseline per metric (latency, quality score, blank rate, validation failures, cost). Alert via `logError` with a structured tag when a configurable threshold is exceeded — reuse the existing `alertThresholdPercent` pattern, don't build a second alerting mechanism. |
| 8.4 | `app/tabs/AdminTab.tsx` | Add: Capture Browser (search by `captureId`/`correlationId`/`jobId`/`anonymousUserId`/provider/model/date/outcome), Parser Evaluation dashboard (blank-rate/format-valid trend charts), Shadow/Comparison dashboard (agreement-rate table + replay button), Runtime Settings (shadow sample rate, monthly budget — writes via the `admin_settings` API from Phase 5.2). |
| 8.5 | `server/src/routes/adminRoutes.ts` | `GET /api/admin/ai-captures?...` (search per 8.4), `GET /api/admin/analytics`, `GET/PATCH /api/admin/runtime-settings`. All `requireAdmin`, all mutations audit-logged. |
| 8.6 | logging | Add `correlationId`, `captureId`, `jobId`, `featureKey`, `provider`, `model`, `outcome`, `latencyMs`, `estimatedCost` to every relevant `logInfo`/`logError` call site introduced in Phases 1–7. |
| 8.7 | tracing | Do not stand up a separate OTel collector. `server/src/instrument.ts` already bootstraps `@sentry/node`, which is itself OTel-based — extend existing Sentry spans for the registry → provider → capture → evaluation path. If a `/metrics` endpoint is genuinely needed for counters/gauges, scope it as new infrastructure explicitly rather than assuming it exists. |

**Exit criteria:** an admin can, without direct DB or GCS console access, find why a specific itinerary job failed, see 30-day blank-rate trends per field, and see shadow-parse agreement rates.

---

## Phase 9 — Additional Providers (Chapter 13 Phase 9)

**Goal:** prove the abstraction from Phase 1 actually decouples vendors, by adding three more.

| Task | Detail |
|---|---|
| 9.1 | `server/src/ai/providers/anthropicProvider.ts` — Messages API; system prompt as top-level field; JSON via tool-forcing or prompt-enforced JSON + parse-retry (no native JSON mode). Must pass the Phase 1.6 contract suite. |
| 9.2 | `server/src/ai/providers/geminiProvider.ts` — **public Generative Language API key, not Vertex** (keeps auth symmetric with every other provider via `getEnvValue()`). |
| 9.3 | `server/src/ai/providers/zaiProvider.ts` — OpenAI-compatible endpoint; likely reuses `openaiProvider.ts`'s wire-format logic with a different base URL/key rather than a bespoke implementation. |
| 9.4 | Add `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`ZAI_API_KEY` to env docs; each read via `getEnvValue()`. |
| 9.5 | Each new provider must pass Phase 1.6's contract tests before being selectable in the admin UI (Phase 5.6's `configured` check naturally blocks it until the env var + registration both exist). |

**Exit criteria:** an admin can switch `itinerary_generation` to Anthropic in the UI and generation succeeds with no code change elsewhere.

---

## Deferred — Not part of this implementation plan

Per the Chapter 9 evaluation note, do **not** build these alongside Phases 0–9. Revisit only after Phases 0–9 have been stable in production for a meaningful period:

- **A/B testing infrastructure** (traffic-split experimentation across providers/prompts/parsers). Shadow parsing (Phase 7) and manual replay already provide comparison without live traffic splitting.
- **Automated recommendation engine** (auto-suggesting provider/prompt/parser changes). Ship the underlying metrics (Phase 8) first; an automated layer on top needs a track record of which thresholds actually correlate with a change being worth making.
- **Executive dashboard** as a separate deliverable — treat it as an optional rollup view over Phase 8's data, not new design work.

---

## Cross-cutting rules that apply to every phase above

1. Every new DB table is implemented in `db.postgres.ts`, `db.firebase.ts`, and `db.memory.ts` — no exceptions, no "Postgres only for now."
2. Every new env var is read via `getEnvValue()`/`getEnvFlag()` (with `_FILE` suffix support), never `process.env` directly.
3. Every new log line uses `logInfo`/`logError` from `server/src/logger.ts`, never `console.log`.
4. Every admin route uses `requireAdmin` and writes to the existing `audit_log` table on mutation.
5. Every capture-path failure (write, redact, evaluate, aggregate) is caught and logged — never thrown into a user-facing request or job.
6. No phase merges or reimplements `entitlementService.ts` or `usageLimiter.ts` internals — only `aiInvocationGuard.ts` (Phase 2.1) composes them.
7. Every new provider adapter passes the Phase 1.6 contract suite before it can be enabled in the admin UI.
