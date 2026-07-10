# AI Capture, Evaluation & Improvement Plan

**Scope:** (1) AI itinerary generation — pluggable providers, per-provider/per-tier limits, prompt/response capture. (2) PDF/email parsing — capture, field-quality assessment, AI-vs-production-parser comparison testing.

**Status:** Draft for review. Grounded in current codebase (see "Current state" boxes per section) as of 2026-07.

---

## 0. Decisions already made (from clarifying questions)

| Question | Decision |
|---|---|
| Parsing feature status | Exists already (`server/src/ingestion/`) — this plan adds capture/eval on top, it does not build parsing from scratch |
| Retention/PII | Local/dev: capture everything indefinitely, no redaction. GCP/prod: redact PII before persisting, retention = **30 days** (see §7) |
| Provider scope | Multi-vendor, **per-feature** selection (itinerary and parsing choose independently). Initial roster: **OpenAI, Anthropic, Google Gemini (public API key, not Vertex), Z.ai** (see §1) |
| Comparison testing trigger | Both: automatic shadow-mode sampling (default **10%**, admin-adjustable at runtime) plus manual admin-triggered replay of historical captures (see §5e) |
| Rate-limit composition | Single orchestration function composes existing tier (`entitlementService`) and provider (`usageLimiter`) checks without merging their internals (see §3) |
| Shadow-mode budget | Hard **$20/month** cap, admin-settable at runtime, integrated with existing `providerBudgeting.ts` cost tracking (see §5e) |
| Runtime-adjustable admin settings | Generic `admin_settings` key/value table (see §5e) — adopted as the **standard mechanism** for future scalar admin settings, not just this feature's two |
| Travel field-quality spec | New reference docs: [`docs/travel-field-spec.md`](./travel-field-spec.md) (human-readable) and `server/config/travel-field-spec.json` (machine-consumed ruleset) — see §5c |

---

## 1. Architecture: Pluggable AI Provider

### Current state
All OpenAI calls funnel through one chokepoint, `postOpenAiChatCompletion` in `server/src/apis/openaiApi.ts:44-115`, but the model (`gpt-4o-mini`) and vendor are hardcoded there and independently in `ingestion/extraction/llmExtractor.ts:125`. There is no adapter interface — "pluggable" today means "grep and change a string in two places." `openaiCallers.ts` already names call sites as discrete **callers** (`OPENAI_CALLER_ITINERARY_PLAN_P0_NORM` … `P4_RENDER`), which is a naming convention worth keeping and generalizing.

### Proposed design

Introduce a provider-agnostic interface in `server/src/apis/aiProvider.ts`:

```ts
interface AiChatProvider {
  readonly id: string;              // 'openai' | 'anthropic' | ...
  readonly supportedModels: string[];
  chatCompletion(req: AiChatRequest, ctx: AiCallContext): Promise<AiChatResponse>;
}
```

- `AiChatRequest` = normalized shape: system/user messages, response-format hint (JSON mode), max tokens, temperature.
- `AiCallContext` = `{ callerId, userId, tier, jobId }` — carries through to rate limiting, budgeting, and capture logging (§3, §4) without each provider needing to know about them.
- Each vendor gets a thin adapter (`openaiProvider.ts`, `anthropicProvider.ts`) that translates the normalized request/response to/from that vendor's wire format. **Do not** try to build a universal prompt DSL — keep the normalized shape close to OpenAI's chat-completions shape since that's the majority of existing prompt-building code in `itineraryPromptPlanService.ts`, and have adapters do the translation work, not callers.
- A registry (`aiProviderRegistry.ts`) resolves `callerId + configured-provider → AiChatProvider instance`. Configured provider comes from admin settings (§2), with a hardcoded fallback (`openai`) if unset — consistent with the fail-open philosophy already used by `entitlementService`.

### Migration path (avoid a big-bang rewrite)
1. Extract the interface and wrap the existing OpenAI logic as the first provider — zero behavior change.
2. Route `itineraryPromptPlanService.ts` and `llmExtractor.ts` through the registry instead of calling `postOpenAiChatCompletion` directly.
3. Add Anthropic as the second provider once (1)+(2) are stable and captured logs (§4) exist to compare quality.

### Decision: per-feature provider selection
Confirmed — itinerary generation and mail parsing select providers **independently** (§2's admin UI already assumed this). This matches the fact both already have separate caller IDs in `openaiCallers.ts`/`api-limits.yaml`, so no additional plumbing is needed to key config by feature.

### Provider roster (initial)
Ship with **OpenAI (existing), Anthropic, Google Gemini, and Z.ai** — four providers from day one rather than the "start with 2" hedge in the original draft, since the interface work (§1 design above) is the same regardless of count; the only added cost is writing N adapters instead of 1.

| Provider | Adapter complexity | Notes |
|---|---|---|
| OpenAI | Existing — becomes the reference adapter | Already wired; no wire-format translation needed |
| Anthropic | New — Messages API | Different request/response shape (system prompt is a top-level field, not a message; no native "JSON mode" — use tool-forcing or prompt-enforced JSON + a parse-retry) |
| Google Gemini | New — Generative Language API (public API key) | **Decision: public Gemini API key, not Vertex AI.** Simpler auth model (same `getEnvValue()`/`_FILE` pattern as every other provider, one API key to manage) and keeps all four adapters symmetric — Vertex's service-account auth path would be the one provider that works differently, which complicates the registry and admin "configured" check (§2) for no benefit at this scale. Revisit only if Gemini volume grows enough that GCP-native billing/quota consolidation becomes worth the asymmetry. |
| Z.ai | New — OpenAI-compatible chat-completions endpoint | Z.ai's API is OpenAI-compatible (same request/response shape as `chat/completions`), so this adapter can likely **reuse the OpenAI adapter's wire format with a different base URL/key**, not a full bespoke adapter — lowest implementation cost of the three new providers |

Each adapter still goes through the same `AiCallContext`-based rate limiting (§3), capture logging (§4/§5), and budget tracking (§3/§5e) — none of that logic is provider-specific.

---

## 2. Admin Console: Provider & Model Selection

### Current state
`app/tabs/AdminTab.tsx` + `server/src/routes/adminRoutes.ts` already have a working pattern for admin-editable runtime config: feature flags (`getFeatureFlag`/`setFeatureFlag`, DB-backed, 60s TTL cache) and a read-only `/api-limits` view driven by YAML (`api-limits.yaml` via `getApiLimitProviderConfig`). Reuse the **feature-flag pattern** (DB row wins over YAML default) rather than inventing a third config mechanism.

### Proposed design
- New table `ai_provider_config(feature_key TEXT PRIMARY KEY, provider TEXT, model TEXT, updated_by, updated_at)` — `feature_key` is `'itinerary_generation'` or `'mail_parsing'` initially, extensible without migration for new features.
- `getActiveAiProvider(featureKey)` in `entitlementService.ts`-adjacent module, same 60s cache convention as `isFeatureEnabled`.
- Admin route `PATCH /api/admin/ai-config/:featureKey` — writes the row, writes `audit_log` (per CLAUDE.md convention: "All admin mutations write to audit_log"), invalidates cache.
- Admin route `GET /api/admin/ai-config` — returns current selection + which providers/models are registered (from the registry, so the dropdown can't select something not actually wired up).
- **UI**: a new section in `AdminTab.tsx` — two dropdowns (Itinerary Generation, Mail Parsing) each with Provider → Model cascade, a "last changed by / at" line (audit trail visible inline, not just in logs), and a **disabled state with tooltip** if a provider's API key isn't configured in env (call `GET /api/admin/ai-config` to include a `configured: boolean` per provider so the UI doesn't offer a switch that will 500 at runtime). This is a real gap today — nothing currently validates that a chosen provider is actually usable before someone flips to it.

### Security
- Restrict this route to `requireAdmin` (already standard per `app.ts`).
- Do not expose API keys or key-presence details beyond a boolean `configured` flag in the response.

---

## 3. Rate Limits: Per-Provider and Per-Tier

### Current state — two systems that don't compose yet
1. `usageLimiter.ts::reserveApiUsageOrThrow` — **per-provider, per-caller** limits (overall + per-caller, hourly/daily windows), DB-backed atomic counters, YAML-configured. Already generalized beyond OpenAI (also gates Unsplash calls).
2. `entitlementService.ts::assertAndIncrementGenerationCount` + `reserveGenerationUsage`/`finalizeGenerationUsage`/`failGenerationUsage` — **per-user, per-tier** monthly generation counts, idempotent reservation pattern, admin-tracked-but-uncapped.

These are orthogonal today: (1) protects the vendor relationship (don't blow through OpenAI's rate limit / burn budget), (2) protects the product (Basic users get N generations/month). The plan should **compose them, not merge them** — merging risks breaking the idempotency semantics `entitlementService` already depends on for job retry/finalize.

### Proposed design: a single composition point, not a merge

Do **not** change either `entitlementService.ts` or `usageLimiter.ts` internally — both have working, independently-tested semantics (idempotent reserve/finalize on one side, atomic windowed counters on the other) and merging their storage/logic risks breaking both. Instead, add **one new orchestration function** that both the itinerary job runner and the mail-parsing LLM path call before ever reaching a provider adapter:

```ts
// server/src/services/aiInvocationGuard.ts
async function authorizeAiCall(ctx: AiCallContext): Promise<AiCallAuthorization> {
  const [tierResult, providerResult] = await Promise.allSettled([
    entitlementService.reserveGenerationUsage(ctx.userId, ctx.windowKey, ctx.role),
    usageLimiter.reserveApiUsageOrThrow(ctx.provider, ctx.callerId),
  ]);

  if (tierResult.status === 'rejected') {
    // provider slot was never reserved — nothing to release
    throw tierResult.reason; // EntitlementError, → 402
  }
  if (providerResult.status === 'rejected') {
    // tier usage WAS reserved — must release it since the call never reached the provider
    await entitlementService.failGenerationUsage(ctx.userId, ctx.windowKey, 'provider_limit_exceeded');
    throw providerResult.reason; // vendor-side throttling, → 429
  }
  return { tierReservation: tierResult.value, providerReservation: providerResult.value };
}
```

Rules this encodes:

1. **Check order for cost, not correctness**: run both checks in parallel (`Promise.allSettled`, not `Promise.all` — you need both outcomes even if one rejects, to know whether to roll back the other). They're independent until both must pass, so there's no reason to serialize two DB round-trips on an already-multi-second LLM path.
2. **Tier reservation must always be released if the provider check fails.** This is the actual "composition" logic — `entitlementService`'s reserve/finalize pattern already supports exactly this rollback (`failGenerationUsage`), it's just never been wired to a *second* system's rejection before. This is the one piece of new logic; everything else is calling existing functions in the right order.
3. **On success**, both reservations are held open until the provider call itself resolves — the caller (registry wrapper from §1) is responsible for calling `entitlementService.finalizeGenerationUsage(...)` on provider success or `failGenerationUsage(...)` on provider failure (e.g. the vendor call itself errors after both limits passed). This mirrors the existing pattern in `itineraryAsyncService.ts::runJob` today — the new guard just adds a second gate before that pattern begins.
4. **Where this plugs in**: call `authorizeAiCall` once, inside the provider-registry wrapper (§1), immediately before dispatching to the resolved `AiChatProvider.chatCompletion(...)`. Every caller — itinerary stages P0–P4, mail-parsing LLM extraction, and shadow-mode comparison calls (§5e) — goes through the registry, so this is the single choke point; no caller needs to know both systems exist.

### Config schema changes needed
- `usageLimiter`/`api-limits.yaml` currently encodes provider identity into caller names (e.g. `ITINERARY_PLAN_P0_NORM` under the `OPENAI` provider block). Add the new providers (`ANTHROPIC`, `GEMINI`, `ZAI`) as sibling top-level blocks, each with the same caller set as `OPENAI` today (`ITINERARY_PLAN_P0_NORM`...`P4_RENDER`) plus a new `LLM_SHADOW_PARSE` caller (§5e) — this requires no code changes to `usageLimiter.ts` itself, only YAML additions, since it's already provider/caller/scope keyed.
- Add `budgeting.ANTHROPIC`, `budgeting.GEMINI`, `budgeting.ZAI` blocks to `api-limits.yaml` mirroring the existing `budgeting.OPENAI` shape (`alertThresholdPercent`, per-model `inputCostPer1MTokensUsd`/`outputCostPer1MTokensUsd`) — needed so `providerBudgeting.ts::estimateOpenAiCostMicros`-equivalent cost estimation works for the new vendors. Generalize that function's name away from "OpenAi" once it's multi-vendor (`estimateAiCostMicros(provider, model, ...)`).

### Alerting
Add a **combined 90%-threshold warning** (tier window OR provider window OR budget) — currently `providerBudgeting.ts` only has an `alertThresholdPercent` concept for USD budget (80%, YAML-configured), and `usageLimiter`/`entitlementService` have no alerting at all, just hard fail at the limit. Extend the existing budget-alert pattern (reuse `alertThresholdPercent`, don't invent a second alerting mechanism) to also fire from the request-count windows, not just the cost window, logged via `logError` with a distinct structured tag (e.g. `event: 'ai_limit_warning'`) so it's greppable/alertable in whatever log aggregation is in place.

### Performance note
Both limiters are DB-backed atomic counters. The `Promise.allSettled` composition above keeps this to one round-trip's worth of wall-clock latency (both queries run concurrently) rather than two sequential round-trips — small in absolute terms next to LLM latency, but free to get right.

---

## 4. Capture Logging: Itinerary Generation

### Current state
**No capture exists today.** Itinerary generation has no debug logging at all (unlike parsing, which has `INGESTION_DEBUG_LLM`). This is being built from scratch.

### What to capture
Per generation attempt (not per HTTP-level API call — per logical stage P0–P4 from `itineraryPromptPlanService.ts`, since each stage is a separate prompt/response and losing that granularity would make debugging a bad itinerary much harder):

```json
{
  "captureId": "uuid",
  "jobId": "...",
  "userId": "...",
  "tier": "premium",
  "stage": "P2_days",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "promptMessages": [...],
  "requestParams": { "temperature": 0, "responseFormat": "json" },
  "rawResponse": "...",
  "parsedOutput": { ... },
  "latencyMs": 1830,
  "tokenUsage": { "prompt": 1200, "completion": 340 },
  "estimatedCostUsd": 0.0021,
  "outcome": "success",
  "timestamp": "2026-07-03T..."
}
```

Note this deliberately captures **all 5 stages**, not just final output — the plan item said "capture the response that is used by the program," but a multi-stage pipeline's final output is frequently correct while an intermediate stage silently degrades quality (e.g. P1 route picks a bad city order and P2–P4 just build on top of it). Capturing only the final JSON would make root-causing bad itineraries much harder. **Recommend capturing all stages**, tagged by `stage`, with the final `parsedOutput` also stored at job level for quick access.

### Storage
| Environment | Location | Mechanism |
|---|---|---|
| Local (`isLocalEnv()`) | `server/logs/ai-capture/itinerary/YYYY-MM-DD/<jobId>/<stage>.json` | Local disk, `server/logs` is already `.gitignore`d and excluded from EAS/deploy per `.easignore` |
| GCP (`K_SERVICE` present) | `gs://<bucket>/ai-capture/itinerary/YYYY-MM-DD/<jobId>/<stage>.json` | `@google-cloud/storage`, reusing the exact pattern from `image-service.ts:100` (lazy `Storage()` singleton) |

- New env var `AI_CAPTURE_BUCKET` (falls back to `LOCATION_BUCKET`'s bucket with an `ai-capture/` prefix if unset, to avoid requiring new infra for a first deploy — but a **separate bucket is recommended** long-term so lifecycle/retention policies and IAM can differ from the location-photo bucket, which likely has different access needs).
- Write via a small `captureService.ts` with one function, `captureAiInteraction(record)`, called from the provider registry wrapper (§1) — this guarantees every provider/every stage is captured without each caller remembering to do it, and keeps capture logic out of prompt-building code.
- **PII redaction (GCP only, per your decision):** run a redaction pass before write — strip email addresses, phone numbers, passport numbers if present in traveler-preference prompts, frequent-flyer numbers. Use a small allowlist-based redactor (regex for common PII shapes) rather than trying to be exhaustive; log a `redactionApplied: true/false` flag on the record so you can audit whether it actually fired. **Flag for you:** regex PII redaction has known false-negative rates (e.g. names aren't reliably regex-matchable). If this data will ever be reviewed by anyone outside the immediate team, consider whether regex redaction is sufficient or whether you want an LLM-based redaction pass (with its own cost/latency) or simply exclude free-text traveler-preference fields from capture entirely on GCP and only capture structured fields (dates, destinations, budget).

### Performance
- Capture writes must be **fire-and-forget, off the request path** — `await` inside `.catch(logError)` with no blocking, or a lightweight in-process queue flushed async. A capture-storage outage (GCS hiccup) must never fail or delay itinerary generation. This should be a hard rule in the implementation, not an afterthought — add a test that asserts generation succeeds when the capture write throws.
- Batch small writes where possible (e.g. write all 5 stages for one job as one object per stage is fine; don't create per-token or per-chunk files).

### Serviceability
- Every capture record includes `jobId` so it's directly correlatable with existing job-tracking in `itineraryAsyncService.ts` and with `logInfo`/`logError` structured logs (include `captureId` in the job's log lines too, so ops can go log → capture file directly).
- Admin route `GET /api/admin/ai-captures/itinerary?jobId=` to fetch/download a capture bundle without needing GCS console access — useful for support/debugging without giving broader bucket access.

---

## 5. Capture Logging: PDF/Email Parsing

### Current state
The parsing pipeline (`server/src/ingestion/`) is more mature than itinerary gen: `ExtractionStrategy` interface with three implementations (`hotelFieldExtractors.ts` regex-based "production parser", `learnedExtractor.ts` auto-learned patterns, `llmExtractor.ts` LLM fallback). Debug logging exists but is **log-only** (`INGESTION_DEBUG_LLM` prints to logs, nothing persisted/queryable). Source attachments are written to **local temp disk only** (`ingestion/shared/tempStorage.ts`, `os.tmpdir()`) and deleted after processing — there is no durable corpus of source documents today. Critically, **`llmExtractor.canHandle` gates LLM extraction to local-dev only** (`isLocalEnv() && NODE_ENV !== 'test'`) — it does not run in production at all today.

### Proposed design

**5a. Persist original uploads.** Before processing, write the raw attachment (PDF/eml/image) to the same capture storage as §4 (`ai-capture/parsing/YYYY-MM-DD/<intakeId>/original.<ext>`), keyed by an `intakeId` that already exists in the ingestion pipeline. This replaces "delete after processing" with "delete from temp, keep in capture store" — temp disk usage doesn't change, durability does.

**5b. Persist extraction results per strategy.** For each of the 3 strategies (production/regex, learned, LLM), capture:
```json
{
  "intakeId": "...",
  "strategy": "hotelFieldExtractors" | "learnedExtractor" | "llmExtractor",
  "itemType": "flight",
  "extractedFields": { "airline": "DL", "flightNumber": "DL123", ... },
  "confidence": 0.92,
  "latencyMs": 210,
  "timestamp": "..."
}
```
This is largely already computable from existing types (`ParsedItemCandidate`/`ExtractionResult`) — the work is persisting rather than discarding.

**5c. Field-quality assessment (plan items 3–4: format validation + blank-field rate).**

The declarative ruleset is now a real, standalone spec rather than a placeholder — two new files:

- [`docs/travel-field-spec.md`](./travel-field-spec.md) — human-readable reference: every field across Flight/Transfer, Lodging, Activity, and Car Rental, with the real-world format standard it follows (IATA codes, PNR conventions, ISO dates, etc.), required vs. typically-present classification, and citations for where each standard comes from.
- `server/config/travel-field-spec.json` — the machine-consumed ruleset in the same shape/location convention as `server/config/api-limits.yaml`, keyed by `ParsedItemType` (matching `server/src/ingestion/contracts/index.ts`) so the evaluator can be driven directly off it with no hardcoded rules in application code.

Load it the same way `api-limits.yaml` is loaded (`server/src/config/apiLimits.ts` pattern) — a small `travelFieldSpec.ts` loader, parsed once at startup, no runtime file I/O per evaluation.

Run the ruleset against every capture (5b) to produce a `fieldQualityReport`: `{ fieldName, present, formatValid, expectedButMissing }[]`, rolled up per intake and aggregated over time (e.g. "airportCode format-valid rate: 97.3% over last 30 days, down from 99.1% last week" — this is the kind of trend that actually catches parser regressions).

**Note on your original example:** IATA *airport* codes are 3 letters (`JFK`), but you were right that a **6-character code** is standard in air travel — that's the **PNR / booking reference** (IATA Type A/Type B convention: 6 characters, alphanumeric, though airlines commonly restrict to letters + digits and avoid visually-ambiguous characters like `0`/`O`/`1`/`I`). The spec files use PNR (6-char alphanumeric) as the primary "6-letter-ish" validated field, and airport code (3-letter) as a separate, also-validated field — see `docs/travel-field-spec.md` for the full field-by-field breakdown across all four item types, including which fields have no universal standard (e.g. hotel/car-rental confirmation numbers are vendor-specific) and are handled with plausibility checks instead of strict regex.

**5d. Blank-field-rate assessment.** For each item type, define the "typically acquired" field set (a superset of `required: true` — e.g. seat number is rarely required but is "typically present" in a good extraction). Track `blankRate = missingCount / typicallyExpectedCount` per intake and in aggregate. Surface this in the admin UI (§6) as the primary parser-health metric — it's more actionable than raw accuracy since you don't need ground truth to compute it.

### 5e. AI-vs-production-parser comparison (plan item 5)

This is the one area needing real architectural decisions, since `llmExtractor` currently doesn't run in production at all.

- **Shadow mode (automatic):** sample a configurable percentage of production parse requests — **default 10%, admin-adjustable at runtime** (see "Runtime-adjustable settings" below). For sampled requests, also invoke `llmExtractor` **after** the production parser has already produced its result, using the same capture infrastructure (§5b) — tagged `mode: 'shadow'`. Critically: **the LLM output must never be used for the actual response** — enforce this at the call site with a type-level guard (the shadow-mode function should not return a value usable by the assignment/review-queue code path at all, not just "caller chooses not to use it" — make the mistake structurally impossible, e.g. shadow invocation happens in a fire-and-forget branch after the real response is already being sent).
- **Manual replay (admin-triggered):** admin route `POST /api/admin/parsing-eval/replay` accepting either an `intakeId` (replay a historical capture through the LLM path) or a batch/date-range. Since originals are now durably stored (§5a), replay doesn't need the original email/upload to still exist anywhere else.
- **Comparison, not correctness scoring** (per your framing — "compare the production parser to the AI, not differences in the output" — I read this as: the goal is measuring *agreement/disagreement between the two systems*, not asserting one is ground truth). Compute a **field-level diff**: for each field, `same | production_only | llm_only | both_different(valA, valB)`. Roll up to an agreement rate per field per item type. Where they disagree, that's a candidate for human review — this is the actual value: surfacing disagreement, not declaring a winner.

### Runtime-adjustable settings: shadow sample rate + hard budget cap

Neither `feature_flags` (boolean-only) nor YAML config (requires a deploy to change) fit "admin adjusts a number at runtime." Add one small, reusable table rather than two bespoke ones, since more numeric admin-tunable settings are likely to show up later:

**Decision: `admin_settings` is the standard, project-wide mechanism for this class of config going forward** — not an AI-specific table. It's more compact than adding a bespoke table per numeric setting, and generic enough (`TEXT` value, parsed by the caller) to cover future non-AI runtime-adjustable settings too, so this is the last time a "should this be a new table or reuse something" question needs asking for a simple scalar admin setting:

```sql
CREATE TABLE IF NOT EXISTS admin_settings (
  key         TEXT PRIMARY KEY,        -- e.g. 'shadow_parse_sample_rate_percent', 'shadow_parse_monthly_budget_usd'
  value       TEXT NOT NULL,           -- stored as text, parsed by the caller (number, bool, short string — not JSON blobs; those belong in a dedicated table)
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

- `getAdminSetting<T>(key, fallback, parse)` / `setAdminSetting(key, value, adminUserId)` follow the exact same shape as `getFeatureFlag`/`setFeatureFlag` (60s in-process TTL cache, DB row wins over hardcoded fallback, admin mutation writes `audit_log`) — same fail-open philosophy: a missing row uses the code-level default (10% sample rate, $20 cap) rather than erroring. `getAdminSetting` takes a small `parse: (raw: string) => T` function (e.g. `Number`, `parseBool`) so callers get a typed value back rather than juggling strings everywhere.
- Seed rows: `shadow_parse_sample_rate_percent = '10'`, `shadow_parse_monthly_budget_usd = '20'`.
- Admin UI (§6.5): two number inputs (sample rate %, monthly cap $) next to the shadow/comparison dashboard, same audit-line-visible pattern as §2's provider dropdowns.
- **Scope note:** `TEXT` (not `NUMERIC`/`JSONB`) is a deliberate choice — it keeps this table usable for simple strings and booleans too (not just the two numeric settings this plan needs), without over-fitting the schema to today's use case. If a future setting needs structured/nested config, that's a signal for a dedicated table, not a reason to add a `JSONB` column here — keep this table to scalar values only so `getAdminSetting`'s contract stays simple.

### Cost control: hard $20/month shadow-mode budget, integrated with existing cost monitoring

Shadow-mode calls are pure overhead (never used in a response), so they get a **separate, harder-enforced** budget than real-traffic providers, wired directly into the existing `providerBudgeting.ts` machinery rather than a parallel system:

- Shadow-mode LLM calls go through the same provider registry, rate limiter, and the `authorizeAiCall` composition (§3) — tagged with a distinct `callerId` (`LLM_CALLER_SHADOW_PARSE`) so spend is visible and capped separately from real usage in the same `api_cost_counters` table and `getApiBudgetSummary()` view that already powers the admin `/api-limits` dashboard. No new cost-tracking table — shadow-mode is just another row, filtered/grouped by caller.
- **Enforcement point**: before firing a shadow-mode call, check `getCurrentApiBudgetStatus('shadow_parse')` (a synthetic provider key scoped to the caller, or a `callerBudgetOverride` extension to `getApiBudgetProviderConfig` that layers a per-caller cap on top of the per-provider one — the latter is preferable since it reuses the existing per-provider budget-status function rather than adding a second one). If `estimatedSpendUsd >= 20`, skip the shadow call entirely for the rest of the month (log once at the transition, not on every skipped sample, to avoid log spam) rather than throwing — shadow mode failing open into "skipped" (not "error") is correct here since it's diagnostic tooling, not a user-facing feature.
- The **admin-settable $20 figure** (via `admin_settings` above) is read at check time, not baked into YAML — this is the one budget cap in the system that's runtime-adjustable rather than deploy-gated, which is intentional since shadow-mode spend is a knob you'll likely tune early (e.g. drop sample rate or raise/lower the cap after watching real agreement-rate data for a week or two).
- Because this reuses `estimateAiCostMicros`/`recordApiCost` (§3's generalized version of the OpenAI-only cost estimator) and `api_cost_counters`, shadow-mode spend shows up automatically in the existing admin cost dashboard alongside real-traffic spend — no separate reporting surface to build, just a filter/breakdown by `callerId`.

### Testability
Extend the existing golden-fixture convention (`ingestion.non-llm-fixtures.test.ts`, `ingestion.normalization.golden.test.ts`) with a new suite that runs recorded captures (or a checked-in fixture subset) through the field-quality ruleset (5c) and asserts the ruleset itself behaves correctly (e.g. a known-bad airport code fails validation) — this tests the *evaluator*, not the parser, which is easy to conflate and worth keeping as a separate test target.

---

## 6. Admin UI

Add an **"AI Operations"** section to `AdminTab.tsx` (new tab or sub-section, consistent with existing dense-table admin patterns already in that file):

1. **Provider Config** (§2): per-feature provider/model dropdowns, configured/not-configured indicator, last-changed audit line.
2. **Rate Limits & Budget** (§3): read-only dashboard extending the existing `/api-limits` view — current usage vs. limit per provider/caller/tier, with the new 90%-threshold warning surfaced as a visual badge, not just a log line.
3. **Itinerary Capture Browser** (§4): searchable by `jobId`/`userId`/date; view/download the 5-stage capture bundle for a job — critical for "why did this itinerary come out wrong" support requests.
4. **Parsing Quality Dashboard** (§5c/5d): trend charts (format-valid rate, blank-field rate) per item type per field, filterable by date range and intake source (Gmail vs. Mailgun).
5. **Shadow/Comparison Results** (§5e): agreement-rate table per field, sortable by disagreement rate (surfaces the fields where the parser most needs attention first), with a "replay" button per historical intake and a batch-replay form (date range + item-type filter).

All of these are **read/admin-only, no new end-user-facing UI** — keep it out of the traveler-facing tabs (`app/tabs/*`) entirely; this is an internal ops surface.

---

## 7. Security

- **Access control:** every new route under `requireAdmin` (existing middleware), no exceptions — capture data can include PII (pre-redaction on local, and even post-redaction on GCP there's residual risk) and provider config changes affect spend.
- **Secrets:** new provider API keys (Anthropic, etc.) follow existing `getEnvValue()`/`_FILE` suffix convention from `env.ts` — never hardcode, never log full key, and the "configured" boolean in the admin API (§2) must not leak key material or even a key prefix.
- **GCS bucket IAM:** capture bucket should be a distinct bucket (or distinct prefix with distinct IAM binding) from anything else in the app, with access limited to the server's service account and the specific admins who need download access — not the broad bucket permissions `image-service.ts` uses for location photos, since that data is far less sensitive.
- **Redaction is best-effort, not a compliance guarantee** — flag explicitly to stakeholders that regex-based PII redaction (§4) will have false negatives; if this data path needs to meet a specific compliance bar (GDPR data-subject requests, etc.), that needs a follow-up conversation before shipping, not an assumption baked into this plan.
- **Retention: 30 days on GCP.** Implement a scheduled cleanup (reuse cron/scheduled-job pattern if one exists, otherwise a daily job similar to `attractionsCatalogService`'s startup sync) that deletes GCS objects under `ai-capture/` older than 30 days. Prefer a **GCS Object Lifecycle Management rule** (`age: 30` on the `ai-capture/` prefix) over an app-level cron job where possible — it's enforced by the storage layer itself, survives app downtime, and needs no application code; fall back to an app-level daily sweep only if lifecycle rules can't be scoped to the prefix granularity needed. Local captures can be left indefinite per your decision, but should still be `.gitignore`d (confirm `server/logs/ai-capture/` is covered — `server/logs` already is, per `.easignore`).

---

## 8. Suggested Implementation Order

Ordered to de-risk the highest-uncertainty pieces first and to get *some* capture data flowing as early as possible (since evaluation work in §5c/5d/5e is data-hungry and should start collecting real samples immediately, even before the dashboards exist):

1. **Capture infrastructure** (§4, §5a/5b) — storage service, local/GCP branching, fire-and-forget writes. Wire into existing OpenAI-only call sites first, no provider abstraction yet. *Goal: start collecting data day one.*
2. **Provider abstraction** (§1) — extract interface, wrap existing OpenAI calls, zero behavior change, route through registry.
3. **Admin config for provider selection** (§2) — needs (2) to have something to select.
4. **Composed rate limits** (§3) — can happen in parallel with (2)/(3); mostly config/wiring on existing limiter code.
5. **Field-quality ruleset + dashboard** (§5c/5d) — needs a few days/weeks of (1)'s data to be useful; build the ruleset early, let it run against live data before building the dashboard UI.
6. **Second AI provider (Anthropic)** (§1 migration step 3) — only after (2) is proven stable.
7. **Shadow-mode comparison** (§5e) — last, since it depends on (1) capture infra, (2) provider abstraction (to call LLM extraction safely in prod), and (4) rate limits (to cap shadow-mode spend).
8. **Manual replay UI** (§5e, §6.5) — can ship alongside (7) or slightly after.

---

## 9. Open Questions for You

None outstanding — all decisions are resolved as of this revision (see §0). Gemini uses the public API key (§1), and `admin_settings` (§5e) is adopted as the standard reusable table for future runtime-adjustable admin scalars, not just this feature's two settings. This section is kept as a placeholder for whatever surfaces during implementation.
