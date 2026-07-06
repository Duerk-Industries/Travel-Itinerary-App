# AI Platform — Implementation Plan for LLM Coding

**Source specs:** `AI_Capture_Evaluation_Improvement_Plan_Full.md` +
`Chapter_01`–`Chapter_16` in this directory (as revised).

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

## Phase 10 — Experimentation, Recommendations, and Executive Dashboard (Chapter 15)

**Goal:** move from manual observation to admin-controlled optimization,
without ever letting an automated action apply itself. Broken into four
sub-phases exactly as Chapter 15 §12 specifies — each independently
shippable, each with its own exit criteria, and **10a must land before
10b–10d's UI work begins** (retrofitting a flat `case 'ai-ops':` block
into a nested router once it already contains Experiments/Recommendations
UI is strictly more work than building new sections into the
already-correct shape).

Depends on Phases 0–9 being stable in production. Does not depend on
Phase 11 (Chapter 16) — the two can proceed in parallel.

### Phase 10a — AI Operations Information Architecture Refactor

**Goal:** stable navigational and component homes for every AI Operations
surface, including deep-linking parity with the top-level `AdminSection`,
before Experiments/Recommendations/Executive have any real content.

**Current state to preserve:** `app/tabs/AdminTab.tsx` (3,248 lines)
today has a flat `AdminSection` union and a single `case 'ai-ops':` block
rendering one screen ("pick provider per feature"). `'ai-ops'` itself is
*not* in `App.tsx`'s React Navigation `linking` config today — only
`overview`, `users`, `tiers`, `features`, `user-data`, `audit-log`, and
`billing` have a dedicated screen + URL (`RootStackParamList` /
`adminScreenBySection` / `linking.config.screens`).

| Task | Files | Detail |
|---|---|---|
| 10a.1 | `app/tabs/AdminTab.tsx` | Define `AiOpsSection` union: `'overview' \| 'providers' \| 'experiments' \| 'recommendations' \| 'captures' \| 'parser-quality' \| 'shadow-replay' \| 'executive' \| 'runtime-settings' \| 'ai-audit-log'` (Chapter 15 §5.1). |
| 10a.2 | `app/tabs/AdminTab.tsx` | Replace the flat `case 'ai-ops':` block with a thin router over `AiOpsSection`, using the exact same `useState` + `goTo`-style navigation pattern already at `AdminTab.tsx:2868-2876` — do not invent a second navigation idiom. The existing "pick provider per feature" screen becomes the `'providers'` sub-section, unchanged in behavior. |
| 10a.3 | `app/App.tsx` | Add 10 new `RootStackParamList` entries + `linking.config.screens` paths, one per `AiOpsSection` value, named/pathed exactly like the existing seven: `AdminAiOpsOverview: 'admin/ai-ops'`, `AdminAiOpsProviders: 'admin/ai-ops/providers'`, `AdminAiOpsExperiments: 'admin/ai-ops/experiments'`, `AdminAiOpsRecommendations: 'admin/ai-ops/recommendations'`, `AdminAiOpsCaptures: 'admin/ai-ops/captures'`, `AdminAiOpsParserQuality: 'admin/ai-ops/parser-quality'`, `AdminAiOpsShadowReplay: 'admin/ai-ops/shadow-replay'`, `AdminAiOpsExecutive: 'admin/ai-ops/executive'`, `AdminAiOpsRuntimeSettings: 'admin/ai-ops/runtime-settings'`, `AdminAiOpsAiAuditLog: 'admin/ai-ops/ai-audit-log'`. Flat entries, no nested-route parameter machinery. |
| 10a.4 | `app/App.tsx` | Add `aiOpsScreenBySection`/`aiOpsSectionByScreen` maps mirroring `adminScreenBySection`/`adminSectionByScreen`; add `openAiOpsSection` mirroring `openAdminSection`; thread an `onAiOpsSectionChange` callback into `AdminTab`'s `'ai-ops'` case the same way `onSectionChange` already threads into `renderAdminScreen`. |
| 10a.5 | `app/components/admin/aiOps/` (new dir) | One component file per `AiOpsSection` value except `'providers'` (already exists, just relocated per 10a.2). Each shows an explicit empty state with a call to action for this phase (e.g. "No experiments running — Create one") — real content lands in 10b–10d. Fetch logic co-located with each component, per this codebase's "tab files own their API fetch logic" convention extended one level down. |
| 10a.6 | `app/components/admin/aiOps/shared/` (new dir, created on demand) | Not created in this phase — extract shared primitives (summary card, trend chart, filter bar) the moment a *second* `AiOpsSection` component needs one, not before. |
| 10a.7 | `app/__tests__` (or equivalent) | Deep-link round-trip test: navigating to each `AiOpsSection` URL resolves `initialSection: 'ai-ops'` + the correct nested section; navigating within the app updates the URL to match, and back. |

**Exit criteria:** every `AiOpsSection` value is reachable both by in-app click-through and by direct URL (`https://duerk.org/admin/ai-ops/executive` works exactly like `https://duerk.org/admin/billing` does today); the existing provider/model-pick behavior is preserved with zero regression inside the `'providers'` sub-section.

### Phase 10b — Ingestion Parser Experimentation

**Goal:** admin-controlled, safety-isolated comparison of the non-LLM
parser against the LLM parser on real ingestion traffic — the first and
only experiment type in this release (Chapter 15 §1 resolved decision 2).

**Critical architectural constraint, verified against the actual repo:**
the initial `shadow_compare` experiment kind must **extend the existing
`shadowParseService.ts`/`maybeRunShadowParse` mechanism (Phase 7)**, not
duplicate it. That mechanism already samples traffic, runs the LLM
extractor in parallel, records a comparison via `comparisonEngine.ts`,
and enforces its own budget cap — every property `shadow_compare` needs.
`ai_experiments` becomes the config/lifecycle layer on top of that
existing execution engine.

| Task | Files | Detail |
|---|---|---|
| 10b.1 | `db.postgres.ts`, `db.firebase.ts`, `db.memory.ts` | `ai_experiments` table: `experiment_id PK DEFAULT gen_random_uuid()`, `feature_key`, `experiment_kind TEXT DEFAULT 'shadow_compare'` (`shadow_compare \| traffic_split`), `name`, `status DEFAULT 'draft'` (`draft \| running \| paused \| completed`), `variants JSONB`, `control_variant_id`, `min_sample_size DEFAULT 200`, `max_duration_days DEFAULT 30`, `started_at`, `ends_at`, `winning_variant_id`, `created_by`, `created_at`, `updated_at`. **No `per_experiment_salt` column** — `experiment_id`'s own randomness already decorrelates cohort assignment across experiments (a second random value adds no entropy `gen_random_uuid()` doesn't already provide). `experiment_kind` is immutable once an experiment leaves `draft`. |
| 10b.2 | same 3 files | `ai_experiment_assignments` table: `assignment_key`, `experiment_id FK`, `variant_id`, `original_variant_id` (nullable, set only on auto-pause reassignment), `assigned_at`, `reassigned_at` (nullable), `PRIMARY KEY (assignment_key, experiment_id)`. `getOrCreateExperimentAssignment`, `reassignExperimentAssignmentToControl` functions. |
| 10b.3 | same 3 files | `ai_ab_test_metrics` daily aggregation table (already named in Chapter 14 §3), grouped by `(experiment_id, variant_id, day)`: request count, success rate, avg quality score, avg cost, avg latency, ground-truth agreement + which ground-truth signal backed it (10b.12). Populated by extending the existing Phase 8.2 aggregation job — not a new job. |
| 10b.4 | `server/src/ai/experiments/assignment.ts` (new) | `resolveExperimentVariant(assignmentKey, experiment)`: `bucket = hash(assignmentKey + experimentId) % 100`; lay out variants over `[0,100)` by `trafficPercent`; uncovered percentage maps to control. Pure, deterministic, unit-testable without a DB. |
| 10b.5 | `server/src/ai/experiments/experimentConfigService.ts` (new) | `getRunningExperiment(featureKey, experimentKind)` — 60s in-process TTL cache, same pattern as `getActiveAiProvider` (Phase 5.3). |
| 10b.6 | `server/src/ai/services/shadowParseService.ts` | Extend `maybeRunShadowParse`: **before** reading `shadow_parse_sample_rate_percent` from `admin_settings`, call `getRunningExperiment('ingestion_llm_extract', 'shadow_compare')`. If found: resolve/create the assignment (10b.4/10b.5), use the experiment's variant traffic-percent instead of the global rate, and tag the resulting capture record (already written by the existing `captureAiInteraction` call) with `experimentId`/`variantId`. **If no running experiment: behavior is byte-for-byte identical to today.** The existing shared `shadow_parse_monthly_budget_usd` cap applies regardless of whether an experiment is driving sampling — an experiment gets no separate or larger budget. |
| 10b.7 | `server/src/ai/experiments/circuitBreaker.ts` (new) | Rolling error-rate counter per `(experiment_id, variant_id)`, same atomic-counter approach as `usageLimiter.ts` — not a new counting mechanism. Default threshold 25% over a minimum 20-request window. On trip: update every `ai_experiment_assignments` row currently pointing at that `(experiment_id, variant_id)` in place (`variant_id` → control, `original_variant_id` ← the paused variant, `reassigned_at` ← now); fire `event: 'ai_experiment_variant_autopaused'` (reusing the existing alerting pattern). For `shadow_compare`, a trip has no user-facing traffic to redistribute — it stops further shadow-LLM calls for already-assigned users, protecting the shared budget cap and comparison-data quality, not production safety (which was never at risk). |
| 10b.8 | `shadowParseService.ts` | Wire the circuit-breaker check (10b.7) into the `shadow_compare` sampling decision — verify a variant hasn't tripped before invoking it. |
| 10b.9 | `server/src/ai/registry/aiProviderRegistry.ts` | Add the **`traffic_split`-only** branch (future scope — itinerary generation or a later parser rollout, not the initial ingestion experiments): before the existing `ai_provider_config` lookup (Phase 5.3), check for a running `traffic_split` experiment for this `featureKey`; if found, resolve/create the assignment and use the assigned variant's provider/model instead of the configured default. Zero change when no `traffic_split` experiment is running. This is a *separate* integration point from 10b.6 — `shadow_compare` experiments never touch `aiProviderRegistry` at all. |
| 10b.10 | `server/src/ai/experiments/certification.ts` (new) | `isProviderCertified(providerId)`: true only if the provider is registered (`getRegisteredAiProviders()`) **and** has passed the Phase 1.6 contract suite — tracked as a distinct gate from Phase 5's `configured` (env-var-presence) check. An experiment must not include a merely-configured-but-uncertified provider (Chapter 15 §1 resolved decision 3). |
| 10b.11 | `server/scripts/syntheticIngestionLoadHarness.ts` (new) | Synthetic ingestion load generator against a running experiment, with an injectable failure rate — so the circuit breaker (10b.7) can be validated meaningfully before any live production experiment. Staging traffic alone won't produce enough failures fast enough. |
| 10b.12 | `server/src/ai/experiments/groundTruth.ts` (new) | Per-item ground-truth signal from three sources, priority order: (a) **admin review-queue accept/reject/edit decisions** — primary/authoritative, already captured, no new UI; (b) **user edits after import** — secondary, for items no admin reviewed; (c) **golden-fixture corpus labels** — supplementary/offline, feeds confidence accounting rather than standing alone. Tag which signal backed each `ai_ab_test_metrics` row. |
| 10b.13 | `server/src/routes/adminRoutes.ts` | `POST/PATCH /api/admin/experiments/*` (create/start/pause/resume/end), `requireAdmin` + `audit_log`. Admin UI may lag slightly (experiments creatable via a direct DB row initially is acceptable for an internal-only first cut per Chapter 15 §12), **but the circuit breaker (10b.7–10b.8) must exist before any live experiment ships — that ordering is not negotiable.** |
| 10b.14 | `app/components/admin/aiOps/AiOpsExperiments.tsx` | Create/start/pause/resume/promote-winner/end-without-promoting UI. Confirmation-prompt pattern (Chapter 8 §2) for dangerous actions. Confidence/sample-size caveats visible directly in UI copy (e.g. "Confidence: low (42 requests)"), not just present in underlying data. |
| 10b.15 | `AiOpsExperiments.tsx` "promote winner" action | Routes through the **existing** `PATCH /api/admin/ai-config/:featureKey` endpoint (Phase 5.5) — no new privileged write path to production config. |
| 10b.16 | `admin_settings` seed rows | `ingestion_parsing_promotion_quality_delta_min`, `ingestion_parsing_promotion_validation_error_max` — the first promotion threshold (Chapter 15 §1 resolved decision 6: positive quality-score delta AND non-worse validation-error rate, both past `min_sample_size`; cost is shown but does not gate, since ingestion spend is already bounded by the shared shadow budget). Admin-adjustable, not hardcoded. |
| 10b.17 | `server/__tests__/ai/experimentAssignment.test.ts` | Assignment determinism (fixed `assignmentKey`+`experimentId` → same variant repeatedly); traffic-split accuracy over a large synthetic sample matches configured `trafficPercent`s within tolerance. |
| 10b.18 | `server/__tests__/ai/circuitBreaker.test.ts` | Inject a `TestAiProvider`-backed variant configured to fail 100%; assert auto-pause within the configured window, reassignment to control, zero impact on other variants' requests. |
| 10b.19 | `server/__tests__/ai/shadowCompareExtension.test.ts` | With a running `shadow_compare` experiment: assert `maybeRunShadowParse` reads the experiment's variant traffic-percent, not the global `admin_settings` rate. **With no running experiment: assert behavior is identical to the existing `shadowParseService.test.ts` suite** — this is the direct test of "zero change when nothing is active." Assert the shared budget cap still applies when an experiment is driving sampling. |
| 10b.20 | aggregation job (Phase 8.2) or equivalent scheduled check | `max_duration_days` auto-transitions a `running` experiment to `completed` (never deleted) if an admin never acts. |
| 10b.21 | `db.postgres.ts`, `db.firebase.ts`, `db.memory.ts` | `EXPERIMENT_ASSIGNMENT_RETENTION_DAYS` (default 90, `admin_settings`-configurable) cleanup job: delete raw `ai_experiment_assignments` rows for `completed` experiments past the retention window. `ai_ab_test_metrics` (aggregates) retained indefinitely, unaffected by this cleanup. |

**Exit criteria:** an admin can create a `shadow_compare` ingestion experiment (even via a direct DB row for this first cut), see per-variant agreement/quality/cost metrics roll up daily, watch a deliberately-broken `TestAiProvider` variant auto-pause with zero change to production parsing behavior, and promote a winner through the existing provider-config endpoint with a full audit trail — while a feature with no running experiment behaves byte-for-byte as it does today.

### Phase 10c — Automated Recommendation Engine

**Goal:** turn Phase 10b's (and Chapters 5/9's) metrics into concrete,
advisory, cost-aware suggestions an admin reviews and applies through
existing config-mutation paths — never auto-applied.

| Task | Files | Detail |
|---|---|---|
| 10c.1 | `db.postgres.ts`, `db.firebase.ts`, `db.memory.ts` | `ai_recommendations` table per Chapter 15 §4.2: `recommendation_id`, `recommendation_type` (`switch_provider \| promote_prompt \| retire_parser \| reduce_shadow_sampling \| cost_anomaly`), `feature_key`, `subject_current`/`subject_proposed JSONB`, `rationale TEXT`, `quality_delta_estimate`, `cost_delta_estimate_usd_monthly`, `confidence` (`low \| medium \| high`), `supporting_evidence_ref`, `supporting_evidence_query JSONB`, `engine_version`, `status DEFAULT 'proposed'`, `created_at`, `responded_by`, `responded_at`, `outcome_measured_at`, `outcome_quality_delta`, `outcome_cost_delta_usd_monthly`. |
| 10c.2 | `server/src/ai/recommendations/computeRecommendationValue.ts` (new) | `value(variant) = w_quality * normalizedQuality(variant) - w_cost * normalizedCost(variant)`, where **`normalizedCost(variant) = projectedMonthlyCost(variant) / projectedMonthlyCost(current)`** — relative to current spend, not an absolute dollar figure (Chapter 15 §4.3: this is what keeps the formula's weights meaning the same thing across features of wildly different spend). Pure function; `engine_version` constant bumped whenever the logic changes, never edited in place silently. |
| 10c.3 | `server/src/ai/recommendations/rationaleTemplates.ts` (new) | One fixed string template per `recommendation_type`, interpolated with concrete numbers (e.g. `switch_provider`: `"{proposed.provider} scored {qualityDelta} points higher... (confidence: {confidence})."`). `renderRecommendationRationale(type, metrics)` — **pure; never an LLM call, never a capture/cost record** (Chapter 15 §4.3 resolved decision — this is load-bearing, not a convenience default). |
| 10c.4 | `server/src/ai/analytics/aggregationJob.ts` | Add a recommendation-scoring step as a downstream stage of the existing daily aggregation job — reads only `ai_*_metrics`/`ai_ab_test_metrics` aggregates, never raw captures. Failure logs and retries next scheduled run; no new always-on process. |
| 10c.5 | `admin_settings` seed rows | `recommendation_weight_quality_<feature>` / `recommendation_weight_cost_<feature>` (default 0.7/0.3), `recommendation_min_delta_threshold`. |
| 10c.6 | `server/src/routes/adminRoutes.ts` | `GET /api/admin/recommendations`, `PATCH /api/admin/recommendations/:id` (`apply \| dismiss`). "Apply" pre-fills the existing Phase 5.5 provider-config form (or 10b.15's promotion action) with the proposed change — no new write path to production config. |
| 10c.7 | `server/src/ai/recommendations/feedbackLoop.ts` (new) | N days (default 14) after a recommendation is applied, diff the relevant `ai_*_metrics` aggregates before/after; write `outcome_measured_at`/`outcome_quality_delta`/`outcome_cost_delta_usd_monthly`. Scheduled alongside the daily aggregation job. |
| 10c.8 | `app/components/admin/aiOps/AiOpsRecommendations.tsx` | Proposed/applied/dismissed/expired review list; confidence + sample-size caveats visible in copy; drill-down via `supporting_evidence_ref`/`supporting_evidence_query` into the underlying comparison data. |
| 10c.9 | `server/__tests__/ai/computeRecommendationValue.test.ts` | Pure-function tests over synthetic `ai_*_metrics` fixtures: weight configurations, minimum-delta threshold behavior, confidence-level derivation from sample size. |
| 10c.10 | `server/__tests__/ai/rationaleTemplates.test.ts` | Assert correct rendering for all five `recommendation_type`s against fixture metrics; assert structurally (no AI-provider-registry import, no capture/cost-record calls anywhere in the module's call graph) that this stays incapable of becoming an LLM call. |
| 10c.11 | `server/__tests__/ai/recommendationLifecycle.test.ts` | "Apply" routes through the existing Phase 5.5 endpoint — assert the same `audit_log` entry shape it already produces, not a new write path needing its own security test suite. |

**Exit criteria:** the nightly batch produces at least one cost-and-quality-justified recommendation from real Phase 10b experiment data; an admin applies or dismisses it through the review UI; 14 days later its outcome fields are populated from measured metrics; rationale text is provably incapable of an AI provider call.

### Phase 10d — Executive Dashboard

**Goal:** a narrative, aggregate-only view of AI spend and quality a
non-engineer can act on without learning operational vocabulary.

| Task | Files | Detail |
|---|---|---|
| 10d.1 | `server/src/ai/analytics/executiveSummary.ts` (new) | Read-only aggregation over `ai_cost_metrics`/`ai_daily_metrics`/`ai_ab_test_metrics`/`ai_recommendations`: spend vs. budget (feature+provider breakdown, prior-month comparison), 6-month quality trend with plain-language regression annotations (reusing Chapter 9 §12's regression detector), cost per completed itinerary/parse, provider mix, recommendation track record (proposed/applied/dismissed counts + 10c.7's feedback-loop delivery rate). |
| 10d.2 | `server/src/routes/adminRoutes.ts` | `GET /api/admin/ai-ops/executive?range=...` — `requireAdmin`, aggregate-only. **No separate `requireCaptureAccess` gate in this release** (Chapter 15 §8 resolved: every current admin already has full capture access, so a second check has nothing to differentiate yet — the aggregate-only data layer is the real privacy control; introduce a distinct permission check only when a non-admin executive/analyst role is actually built). |
| 10d.3 | `app/components/admin/aiOps/AiOpsExecutiveDashboard.tsx` | Narrative tone per Chapter 15 §5.2's Executive-vs-Operational distinction. CSV + print-friendly export. Explicitly never renders raw capture data, per-request detail, or PII of any kind. |
| 10d.4 | `AiOpsExecutiveDashboard.tsx` | Cross-navigation: every summary card links into the relevant operational screen pre-filtered to the same time range (quality-trend annotation → Parser Quality; provider-mix segment → Experiments). |
| 10d.5 | `server/__tests__/ai/executiveSummary.test.ts` | Component/data-fetching tests against fixture aggregate rows only — no capture fixtures, no PII-redaction test surface (itself a signal the aggregate-only design is working). |

**Exit criteria:** a non-engineer opens the Executive Dashboard, understands this month's AI spend and quality trend without assistance, and drills into any anomaly without leaving the admin panel — all from aggregate tables only.

---

## Phase 11 — Test Deployment, Production Cutover, and Rollback (Chapter 16)

**Goal:** a durable, scriptable staging environment and a one-command,
digest-exact production promotion with a tested rollback net. This is
**infrastructure work independent of the AI platform** — it can be built
in parallel with Phases 0–10, though the AI-specific isolation checks
(11.7.3's environment-isolation and secret-divergence assertions) only
become meaningful once `AI_CAPTURE_BUCKET` and vendor API keys exist as
real configuration (Phase 3–4).

**Grounding (verified against the actual repo, not assumed):** backend
is Cloud Run service `travel-itinerary-app` (region `us-east5`, deployed
via `gcloud run deploy --source server`); frontend is Firebase Hosting
serving `dist/`, custom domain `duerk.org`; database is Firestore, named
database `travel-itinerary-app-database`; IAM already has three service
accounts (deployer/Cloud Build/runtime) via `scripts/configure-gcp-iam.sh`.
The existing PR-preview mechanism (`.github/workflows/firebase-hosting-pull-request.yml`)
is a separate, ephemeral thing sharing production's backend/Firestore —
not what this phase builds.

### Phase 11.1 — Build Pipeline

| Task | Files | Detail |
|---|---|---|
| 11.1.1 | `scripts/build-release.sh` (new) | Build the backend image once (git-SHA tag, push to Artifact Registry), export the frontend once, write an immutable **release manifest** JSON: `gitSha`, `backendImageDigest`, `frontendArtifact` reference + `frontendSha256`, `firestoreIndexesSha256`, `builtAt`. Frontend artifact stored as a **GitHub Actions build artifact** (Chapter 16 §1 resolved decision 1 — GitHub's 90-day default retention has wide margin over `ROLLBACK_RETENTION_DAYS`'s 7-day default; revisit GCS only if a rollback need ever exceeds 90 days old). |
| 11.1.2 | `scripts/deploy.config.example` (new, checked in); `scripts/deploy.config` (git-ignored) | `TEST_*`/`PROD_*` service/region/hosting-site/domain/Firestore-database-ID/runtime-service-account/AI-capture-bucket values, `ARTIFACT_REGISTRY_REPO`, `ROLLBACK_RETENTION_DAYS` (default 7). Every script fails fast if a required key is blank. |
| 11.1.3 | `scripts/firebase.hosting.test.template.json` (new, checked in) | `{{TEST_DOMAIN}}`-templated Hosting config (rewrites + CSP), rendered at deploy time — the test subdomain lives in exactly one place (`deploy.config`), never hand-duplicated into a second static JSON file. |
| 11.1.4 | `scripts/lib/deploy-common.sh` (new) | Env-file parsing / secret-mapping logic factored out of the existing `deploy-api.sh`, parameterized by `TEST_*`/`PROD_*` rather than forked into two divergent scripts. |

**Exit criteria:** `build-release.sh` produces one release manifest consumed identically by both the test deploy and cutover paths — nothing downstream ever rebuilds from source.

### Phase 11.2 — Test Environment

| Task | Files | Detail |
|---|---|---|
| 11.2.1 | GCP setup (manual, one-time, per Chapter 16 §4.2) | Second named Firestore database (`travel-itinerary-app-test-database`); new `travel-itinerary-app-test` Cloud Run service; second Firebase Hosting site mapped to `test.duerk.org` (DNS + Firebase-console domain connection); a **fourth, test-scoped runtime service account** (extending `scripts/configure-gcp-iam.sh`), least-privilege to test's database/bucket/secrets only; separate low-budget vendor API keys via the existing Secret Manager + `configure-run-env.sh` mechanism. |
| 11.2.2 | `scripts/deploy-test.sh` (new) | Run `build-release.sh` (or accept `--release-manifest`); `gcloud run deploy` with the test service account/env vars/`WEB_URL=https://test.duerk.org`; unpack + checksum-verify the manifest's frontend artifact, render the templated Hosting config (11.1.3), deploy it; run `deploy-firestore-indexes.sh` against the test database; seed synthetic fixture data (`--reseed`); run `smoke-test.sh` and fail loudly on any failure. |
| 11.2.3 | `scripts/smoke-test.sh` (new) | Health check returns 200; synthetic login succeeds; one itinerary-generation round trip (`TestAiProvider` or a capped real key) returns a valid result; one parsing round trip against a fixture succeeds; Socket.IO connects; **environment-isolation assertion** — resolved Firestore database ID and `AI_CAPTURE_BUCKET` do not match the *other* environment's configured values. |
| 11.2.4 | `scripts/current-state.sh` (new) | Prints, for both environments: currently-serving revision, image digest, git SHA, traffic split, age — the one command an on-call engineer runs first. |

**Exit criteria:** a developer deploys any commit to test with one command and gets a working, fully isolated environment (own backend, own Firestore database, own vendor keys, own bucket).

### Phase 11.3 — Direct-Production Deploy (Exception Path)

| Task | Files | Detail |
|---|---|---|
| 11.3.1 | `scripts/lib/require-github-actor.sh` (new) | Shared authorization check: refuse to proceed if `github.actor` is unset (not running inside a GitHub Actions workflow) or not in the Bryan/Tristan allowlist (Chapter 16 §1 resolved decision 2). Sourced by every production-affecting script (11.3.2, 11.4.1, 11.5.1, 11.5.2) — **not** `gcloud auth list` or the Cloud Build service-account identity, neither of which distinguishes which human triggered the run. This means these scripts are only invocable through the GitHub Actions workflow, never as a bare local run; `--dry-run` remains fine locally since it has no side effects. |
| 11.3.2 | `scripts/deploy-prod.sh` (new) | Formalizes today's `deploy-api.sh` + `deploy-hosting.sh` flow, targeting `PROD_*` config, bypassing test entirely — for emergency hotfixes/config-only changes. Requires `--reason`; sources 11.3.1; prints a bypass warning; records reason/operator/git-SHA/release-manifest/target-service to the same deployment audit trail cutover uses (11.4.1 step 9). Does not touch the test environment. |

**Exit criteria:** `deploy-prod.sh` cannot run without an authorized `github.actor` and an explicit `--reason`, and every use is auditable as a deliberate bypass, not indistinguishable from normal promotion.

### Phase 11.4 — Cutover

| Task | Files | Detail |
|---|---|---|
| 11.4.1 | `scripts/cutover-test-to-prod.sh` (new) | **Step 1:** verify `--release-manifest`'s backend digest matches what's live in test and its frontend checksum matches the tested artifact; refuse otherwise. **Step 2:** deploy that exact digest to prod as a `--no-traffic`, `--tag candidate` revision. **Step 3:** run `smoke-test.sh` against the candidate's own revision URL, against production's real database — the ingestion/parsing canary check runs through **`TestAiProvider`, not a real provider key** (Chapter 16 §1 resolved decision 3: deterministic, zero per-cutover vendor spend; real-adapter correctness is the provider contract suite's job, exercised separately), plus a small write against the permanent, `is_internal_canary`-flagged canary account (11.4.2). **Step 4:** no separate migration-application step — production runs on Firestore, which has no versioned migration-file system (verified: `db.firebase.ts::initDb()` never calls the Postgres-only `runMigrations`); confirm the candidate's own idempotent seed/backfill blocks completed successfully as part of step 3's smoke test instead. **Step 5:** shift 100% traffic (`--staged 10,50,100` optional, off by default per Chapter 16 §1 resolved decision 4). **Step 6:** deploy the release manifest's frontend artifact to prod Hosting. **Step 7:** `smoke-test.sh` against the real public domain. **Step 8:** delete every record the step-3 canary write created, unconditionally — even if step 7 failed — logged but never blocking (§6/§9.13 cleanup requirement). **Step 9:** record the cutover to `audit_log`. Sources 11.3.1 for authorization. |
| 11.4.2 | `db.firebase.ts` (users collection) | `is_internal_canary: true` flag support; create the permanent canary-account fixture (one-time). |
| 11.4.3 | `server/src/middleware/canarySafeMode.ts` (new) | Intercept side-effect-heavy actions (real email send, Stripe charge, push notification) for any account with `is_internal_canary: true`, redirecting to a mock/log-only sink. **Must exist and pass its own test (11.7.3) before the production canary write is ever exercised for real.** |
| 11.4.4 | Executive Dashboard (10d.1), analytics rollups (Phase 8), any "all users" feature | Exclude the canary account explicitly — reviewed as a checklist item whenever a new "all users" feature is added. |

**Exit criteria:** a promotion to production executes with one command that provably deploys the exact artifact validated in test, completes end-to-end in under 5 minutes (Chapter 16 §1 resolved decision 6), and never disrupts production data or the public URL.

### Phase 11.5 — Rollback & Teardown

| Task | Files | Detail |
|---|---|---|
| 11.5.1 | `scripts/rollback.sh` (new, unified) | Shift 100% Cloud Run traffic back to the previous revision; **deploy that revision's own release-manifest-paired frontend artifact explicitly — do not call bare `firebase hosting:rollback`**, which has no awareness of backend/frontend pairing and could resolve to a mismatched pair if a `deploy-prod.sh` bypass (11.3.2) happened between cutovers; validate via `smoke-test.sh`. Sources 11.3.1. |
| 11.5.2 | `scripts/teardown-old-production.sh` (new) | Lists Cloud Run revisions older than `ROLLBACK_RETENTION_DAYS` at 0% traffic; requires typed confirmation; **hard refusal to delete anything at nonzero traffic**. Sources 11.3.1. |
| 11.5.3 | Alerting config (reuses Chapter 11 §8 pattern) | Post-cutover elevated-error-rate watch: for a configurable window (default 30 min) after any traffic shift, lower the alert threshold for the production service. |

**Exit criteria:** a bad promotion is revertible with one command, paired (frontend + backend) and correct even after an intervening bypass deploy, in under 60 seconds; the previous production revision and the canary account's data are never left to accumulate indefinitely except through an explicit, confirmed, audited teardown.

### Phase 11.6 — Tests

| Task | Files | Detail |
|---|---|---|
| 11.6.1 | existing `npm run validate:app` / `validate:server` | Gate at the top of `deploy-test.sh`/`deploy-prod.sh` — reused as-is. |
| 11.6.2 | migration/backfill lint | SQL path (only relevant if Postgres-backed): no destructive op in a staged migration unless flagged contract-phase. Firestore path (production today): PR-review checklist item — new code must tolerate a missing field with a default, since there's no migration file to lint against. |
| 11.6.3 | `server/__tests__` / script test harness | Release-manifest integrity (digest/checksum mismatch refuses cutover); direct-prod bypass audit (refuses without `--reason`); app-owner authorization (refuses when `github.actor` absent or not allowlisted); expired-artifact refusal; canary exclusion check; **canary data-cleanup** (record count returns to baseline after N simulated cutovers, cleanup runs even when the preceding smoke test failed); **rollback-pairing correctness after a bypass deploy** (rollback.sh deploys the manifest-paired frontend, not "one Hosting release back"); **Canary Safe Mode interception** (email/Stripe/push all redirected for the flagged account, tested per side-effect category); teardown safety check (refuses nonzero-traffic deletion, refuses without confirmation); cutover-duration SLO (5 min end-to-end, golden-fixture gate budgeted separately at 10 min). |
| 11.6.4 | CI job invoked from `cutover-test-to-prod.sh` | Chapter 10's golden-fixture regression suite runs against the tagged candidate revision's URL, blocking before the traffic shift — not just pre-merge CI against a local build. |
| 11.6.5 | game-day exercise (quarterly) | Rollback drill against test's own two-revision setup first, then confirmed available in production. |

**Exit criteria:** every safety property this phase depends on (manifest integrity, authorization, canary isolation, rollback pairing) has a real, passing test — not just a documented intention.

---

## Cross-cutting rules that apply to every phase above

1. Every new DB table is implemented in `db.postgres.ts`, `db.firebase.ts`, and `db.memory.ts` — no exceptions, no "Postgres only for now."
2. Every new env var is read via `getEnvValue()`/`getEnvFlag()` (with `_FILE` suffix support), never `process.env` directly.
3. Every new log line uses `logInfo`/`logError` from `server/src/logger.ts`, never `console.log`.
4. Every admin route uses `requireAdmin` and writes to the existing `audit_log` table on mutation.
5. Every capture-path failure (write, redact, evaluate, aggregate) is caught and logged — never thrown into a user-facing request or job.
6. No phase merges or reimplements `entitlementService.ts` or `usageLimiter.ts` internals — only `aiInvocationGuard.ts` (Phase 2.1) composes them.
7. Every new provider adapter passes the Phase 1.6 contract suite before it can be enabled in the admin UI.
8. Phase 10's `shadow_compare` experiments extend `shadowParseService.ts` (Phase 7) — no phase builds a second shadow-execution engine for the same use case. `traffic_split` experiments are the only kind that touch `aiProviderRegistry`.
9. Every mutating action in Phase 11's production-affecting scripts (`deploy-prod.sh`, `cutover-test-to-prod.sh`, `rollback.sh`, `teardown-old-production.sh`) requires an authorized `github.actor` (11.3.1) — none of them gain a `gcloud`-identity or other fallback authorization path that would reintroduce the identity-source ambiguity Phase 11's design explicitly closed.
