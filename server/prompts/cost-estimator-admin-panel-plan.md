# Cost Estimator & Hosting Cost Admin Panel — Scoping Plan

Back to: [Prompt Assets README](README.md) · [Itinerary Improvement Plan](itinerary-improvement-plan.md)

This document scopes extending the cost estimator to non-token (per-request-priced) APIs and fixed
hosting costs, and adding an admin console tab that shows both the **projected estimate** and **actual
recorded spend by month**, with admin-editable estimate parameters. It closes with a phased
implementation + test plan written for an LLM implementer.

## 1. Current state (grounded in code)

- **Token-cost tracking exists, but only for 4 LLM providers.** `providerBudgeting.ts`'s
  `estimateAiCostMicros` computes $ from `promptTokens`/`completionTokens` × per-1M-token pricing in
  `api-limits.yaml`'s `budgeting` section (`OPENAI`, `ANTHROPIC`, `GEMINI`, `ZAI`, plus a flat
  `SHADOW_PARSE` budget cap). Recorded spend is persisted via `recordApiCost` into the
  `api_cost_counters` table (`db.postgres.ts:1246`) — `UNIQUE(provider, window_key)` where `window_key`
  is a **month** string (`getApiBudgetWindowKey`). Rows are never pruned, so **full monthly history
  already exists for these 4 providers** — it's just never surfaced beyond the current month in the UI.
- **Rate/quota tracking exists for ~12 providers, but computes no dollar figure.** `usageLimiter.ts`'s
  `reserveApiUsageOrThrow` (backed by `api-limits.yaml`'s `providers` section) now covers every external
  API in the codebase (AIRPORT_DATASET, FRANKFURTER, GOOGLE_ROUTES, LLM_PARSER, OPENAI, OPEN_METEO,
  SERPAPI, SMTP, UNSPLASH, WIKIMEDIA, COUNTRY_NOW, GEONAMES — the last two just added). None of the
  non-LLM ones record a $ amount anywhere.
- **The admin UI already has the exact interaction pattern to extend.** `AdminTab.tsx`'s
  `ApiLimitsSection` (`AdminTab.tsx:2087-2542`) already fetches `GET /api-limits`
  (`adminRoutes.ts:1214`), renders per-provider rate limits + current-month budget/spend + editable
  token-pricing forms, and saves via `PATCH /api-limits/:provider` (`adminRoutes.ts:1248`) with a
  required `reason` field and a `writeAuditLog` call on every save. This is the pattern the new tab
  should copy, not reinvent.
- **Nothing models fixed hosting costs or a distinct "projected estimate" today.** The manual estimate
  produced earlier in this conversation (10,000 users / 3% premium → ~$139/mo variable API + ~$150/mo
  hosting, ~63 break-even premium users) was done by hand in chat. This plan's goal is to make that
  calculation live, persisted, and admin-editable instead of a one-off exercise.
- **Config precedence pattern already established.** `feature-flags.yaml` seeds defaults; the
  `feature_flags` DB table wins at runtime once a row exists. `itineraryInstructionService.ts` uses the
  same seed-then-DB-override shape via the generic `admin_settings` key-value table
  (`getAdminSetting`/`setAdminSetting`). This plan reuses that exact mechanism rather than inventing a
  new one.

## 2. Scope

### In scope

1. Extend cost **recording** to non-token (per-request-priced) providers, reusing the existing
   `api_cost_counters` table and `recordApiCost` function — no new storage mechanism.
2. Admin-editable **per-request pricing** for each non-token provider (SerpAPI, Wikimedia, Google
   Routes, Unsplash, SMTP, CountryNow, GeoNames, Airport Dataset, Frankfurter, Open-Meteo). Default to
   $0 for the providers that are genuinely free today; editable so a plan/pricing change doesn't need a
   code deploy.
3. Admin-editable **fixed monthly hosting cost line items** (free-form name + amount rows — e.g. "Cloud
   Run", "Database", "Storage", "Misc/Domain/Monitoring") since this repo has no committed infra-sizing
   source to read real numbers from automatically.
4. Admin-editable **cost-estimation assumptions**: total user count, premium conversion %, free/premium
   generations-per-user-per-month, premium monthly price (with a DB override in case it needs to differ
   from the live Stripe price during modeling), Stripe fee % + fixed fee, and per-provider
   calls-per-user-per-month volume assumptions — the same category of inputs used in this session's
   manual estimate.
5. A **projected-monthly-cost calculator** (pure, unit-testable function) combining (2)+(3)+(4) into a
   structured breakdown (per-provider, hosting, total, and break-even premium-user count) — not just a
   single number, so the UI can render the same kind of table produced by hand this session.
6. A new **"Cost Estimate" admin tab** showing: (a) the projected estimate with editable assumption
   inputs, (b) actual recorded spend by month (last N months) per provider — both token- and
   request-priced, (c) hosting line items, (d) an estimate-vs-actual comparison.
7. Full audit logging on every PATCH, matching the existing convention exactly.

### Out of scope (explicitly deferred — note but do not build)

- Live integration with cloud billing APIs (GCP Billing, Stripe usage reporting) to auto-populate actual
  hosting spend. Hosting stays admin-entered/estimated in this phase.
- Per-user cost attribution or margin analysis for individual users.
- Alerting/notifications on estimate-vs-actual variance (reasonable future phase — note as a follow-up,
  don't implement).
- Changing how the 4 existing token-based LLM providers are priced/edited — already fully supported by
  `ApiLimitsSection`; this plan only adds the missing per-request and hosting pieces alongside it.

## 3. Data model additions

No new SQL migrations — this codebase consistently reuses generic storage for exactly this kind of
admin-configurable, infrequently-changing data (verified: `itinerary_plan_cache` and the attraction
catalog's `popularityScore`/`primaryTag` fields both reused existing generic tables/JSONB payloads
rather than adding migrations).

- Reuse `admin_settings` (`getAdminSetting`/`setAdminSetting`) for three new keys, following
  `itinerary_generation_instruction_documents`'s exact shape (JSON blob + `updatedAt`/`updatedBy`,
  audit-logged on write):
  - `cost_estimator_request_pricing` — `{ [provider]: costPerRequestUsd }`
  - `cost_estimator_hosting_line_items` — `[{ id, name, monthlyCostUsd }]`
  - `cost_estimator_assumptions` — `{ totalUsers, premiumConversionPercent, freeGenerationsPerMonth,
    premiumGenerationsPerMonth, premiumMonthlyPriceUsdOverride?, stripeFeePercent, stripeFeeFixedUsd,
    providerCallsPerUserPerMonth: { [provider]: number } }`
- Optionally seed defaults for `cost_estimator_request_pricing` in `api-limits.yaml` (a new
  `requestPricing` top-level section, parallel to the existing `budgeting`/`caching` sections) so a
  fresh environment has sane $0 defaults before an admin ever visits the panel — matching the
  `feature-flags.yaml` seed-then-DB-wins relationship.
- `api_cost_counters` needs **no schema change** — `provider`/`window_key`(month)/`amount_micros` is
  already generic enough to record a per-request cost the same way it records a per-token cost.

## 4. Backend implementation plan

- **`providerBudgeting.ts`**: add `estimateRequestCostMicros(costPerRequestUsd: number): number` next to
  the existing `estimateAiCostMicros`, and a `recordProviderRequestCost(provider: string,
  costPerRequestUsd: number)` helper that calls `recordApiCost` — no-op (skip the DB write entirely)
  when `costPerRequestUsd <= 0`, so genuinely free APIs don't generate empty rows every call.
- **Wire `recordProviderRequestCost` into each non-token call site** — this is a bounded, enumerable
  list from the API audit already done this session, not open-ended: `attractionsCatalogService.ts`
  (SerpAPI + 2 Wikimedia callers), `attractionDurationEstimationService.ts` (Wikimedia summary),
  `wikipediaGeocodingService.ts` / `wikipediaPageviewService.ts` (Wikimedia), `transferEstimationService.ts`
  (Google Routes), `unsplashApi.ts`, `smtpApi.ts`, `destinationLargeCityCoverage.ts` (CountryNow +
  GeoNames), `airportDatasetApi.ts`, `frankfurterApi.ts`, `openMeteoWeatherApi.ts`,
  `climatologyDaylightService.ts`. Call it right next to the existing `reserveApiUsageOrThrow` call at
  each site, reading the configured per-request price for that provider.
- **New service `costEstimatorService.ts`**:
  - `getCostEstimatorConfig()` / `updateCostEstimatorConfig(...)` — read/write the three `admin_settings`
    keys, mirroring `itineraryInstructionService.ts`'s get/update + audit-log pattern.
  - `computeProjectedMonthlyCost(config)` — pure function returning a structured breakdown: `{
    llmCostUsd, requestApiCostUsd, hostingCostUsd, totalCostUsd, breakEvenPremiumUsers,
    byProvider: [...] }`. Reuses the existing per-model LLM pricing config for the token portion (don't
    duplicate that pricing source) and the new per-request pricing + assumptions for the rest. Use
    Stripe's actual live price (`PLAN_DEFAULTS.premiumMonthlyAmountCents` from `stripeBilling.ts`) as the
    default for `premiumMonthlyPriceUsdOverride` when unset, rather than hardcoding $5 — if the price
    ever changes, the estimate should follow it automatically unless explicitly overridden.
  - `computeBreakEvenPremiumUsers(totalMonthlyCostUsd, netRevenuePerPremiumUserUsd)` — small separate
    pure function (net revenue = price − Stripe fee%×price − Stripe fixed fee), so it's independently
    testable against hand-verified numbers.
  - `getActualMonthlySpend(monthsBack: number)` — queries `listApiCostCounters()` grouped by provider and
    month; extend `listApiCostCounters` if needed to support a lookback window rather than returning
    every row unbounded.
- **New route file `adminCostEstimatorRoutes.ts`** (or add directly to `adminRoutes.ts` next to
  `/api-limits`, matching where that lives today):
  - `GET /api/admin/cost-estimate` → `{ assumptions, requestPricing, hostingLineItems, projected: {...},
    actual: { months: [...] } }`
  - `PATCH /api/admin/cost-estimate/assumptions` (reason required)
  - `PATCH /api/admin/cost-estimate/request-pricing` (reason required)
  - `PATCH /api/admin/cost-estimate/hosting` (reason required; full replace of the line-item list;
    validate non-negative amounts and non-empty names)
  Mirror the exact validation/audit shape of `PATCH /api-limits/:provider` (`adminRoutes.ts:1248-1389`)
  — required-reason check, numeric validation before any write, `writeAuditLog` with
  `actorUserId`/`action`/`afterState`/`reason`/`ipAddress`/`userAgent` on success.

## 5. Admin UI plan

- Add `'cost-estimate'` to the `AdminSection` union type (`AdminTab.tsx:15`).
- Add a nav card to the array in `OverviewSection` (`AdminTab.tsx:257-289`) — same array-of-cards shape
  as the existing entries, no new pattern.
- Add a new `CostEstimateSection` component, modeled directly on `ApiLimitsSection`
  (`AdminTab.tsx:2087-2542`) — same `load()` / `apiFetch()` / per-field form-state / "Save" with a
  required reason textbox pattern used there:
  - Top: projected-estimate summary cards — variable API total, hosting total, grand total, and
    break-even premium-user count (reuse this session's arithmetic as the reference implementation).
  - Editable assumptions form (users, premium %, generations/month, per-provider call-volume
    assumptions).
  - Editable hosting line items (add/remove/edit rows, client-side validated non-negative before Save).
  - Editable per-request pricing table — one row per non-token provider.
  - Actual-spend-by-month table (provider × month grid) sourced from `actual.months`, with a visible note
    for any provider/month predating this feature ("tracking started &lt;date&gt;") rather than a
    misleading $0.
- Wire the new section into the render switch (`AdminTab.tsx:2759` area, alongside `<ApiLimitsSection
  .../>`, `<MetricsSection ... />`, `<BillingSection ... />`) and the section-visibility check
  (`~2797` area, alongside `section === 'api-limits'`), following that exact `else if` chain.

## 6. Phased implementation & test plan (for an LLM implementer)

### Phase 1 — Backend cost recording for non-token providers — **implemented**
- Added `estimateRequestCostMicros`/`recordProviderRequestCost` to `providerBudgeting.ts`, reading the
  configured price via a new `getApiRequestPricingUsd(provider)` accessor in `apiLimits.ts` (design
  refinement vs. §3's original wording: pricing lives directly in `api-limits.yaml`'s new
  top-level `requestPricing:` section — the same file/mechanism the 4 LLM providers' token pricing
  already uses — rather than a separate `admin_settings` layer, since that's simpler and more consistent
  with the existing `budgeting`/`caching` sections' edit-in-place pattern. `admin_settings` remains the
  right choice for the genuinely-new concepts in Phase 2 (hosting line items, assumptions), which have no
  YAML precedent). Seeded all 10 non-token providers at `0` (free) by default.
- Wired `recordProviderRequestCost` into all **17** non-token call sites across 12 files (the plan's
  original count of "11 call sites" undercounted — several files have more than one reservation call,
  e.g. `attractionsCatalogService.ts` has 3, `openMeteoWeatherApi.ts` and `unsplashApi.ts` have 2 each).
  Every site places the cost-recording call immediately next to its existing `reserveApiUsageOrThrow`
  call, matching this codebase's established convention.
- **Tests:** `__tests__/providerBudgeting.requestCost.test.ts` covers `estimateRequestCostMicros`
  (rounding, negative clamp) and `recordProviderRequestCost` (no-op at $0, correct micros when priced,
  explicit-override precedence, provider-key normalization). `__tests__/apiRequestCostWiring.test.ts` is
  the table-driven audit covering all 17 call sites across all 12 files, including both branches
  (primary + fallback) of `attractionsCatalogService.ts`'s Wikipedia discovery.
- **Regression found and fixed while implementing:** two pre-existing test files
  (`frankfurterApi.test.ts`, `unsplashCallers.test.ts`) narrowly mocked `../src/config/apiLimits` with
  only the one export each test needed at the time, which silently broke once `providerBudgeting.ts`
  started requiring `getApiRequestPricingUsd`/`normalizeApiLimitKeyPart` from that same module. Fixed
  both to spread `jest.requireActual(...)` and override only the specific function under test, so this
  class of breakage can't recur when the module gains more exports later.

### Phase 2 — `costEstimatorService.ts` + `admin_settings` storage
- Implement `getCostEstimatorConfig`/`updateCostEstimatorConfig`/`computeProjectedMonthlyCost`/
  `computeBreakEvenPremiumUsers`/`getActualMonthlySpend`.
- **Tests:** `computeProjectedMonthlyCost` and `computeBreakEvenPremiumUsers` against fixtures built from
  this session's manual estimate (10,000 users / 3% premium / $5 premium price → ~$139 variable API +
  ~$150 hosting, ~63 break-even users) as a golden regression case — if the arithmetic in code diverges
  from that hand-verified reference, that's a bug, not a rounding nuance to wave away. Round-trip test for
  config get/update including the audit-log entry.

### Phase 3 — Admin routes
- Implement `GET`/`PATCH` endpoints per §4.
- **Tests:** admin-role-required (401/403 for non-admin), reason-required validation, numeric/shape
  validation rejects bad input before any write, successful PATCH writes an audit-log row, `GET` response
  shape matches what the UI expects.

### Phase 4 — Admin UI
- Implement `CostEstimateSection` and wire it into `AdminTab.tsx` per §5.
- **Tests:** no existing `AdminTab`/`ApiLimitsSection` component test file was found to extend — add a
  basic load/edit/save round-trip test for the new section (mock `apiFetch`), rather than assuming test
  coverage exists elsewhere for this file.
- **Manual verification required** (per this repo's CLAUDE.md convention — UI changes must be exercised
  in the running app, not just unit-tested): run `npm run web`, sign in as one of the bootstrap admin
  accounts, open the new Cost Estimate tab, edit each of the three forms, save, and confirm the values
  persist across a reload and the audit log records the change.

### Phase 5 — Historical-data caveat (documentation, not code)
- Actual per-request cost history only starts accumulating once Phase 1 ships — months before that will
  show $0 for the newly-tracked providers even though real usage occurred. Surface this explicitly in
  the UI (§5's "tracking started" note) so it isn't misread as "this API was free until now."

### Cross-cutting acceptance criteria
- No new SQL migration files — confirm every new field lands in the existing `admin_settings`/
  `api_cost_counters` generic storage, per §3.
- `db.postgres.ts` and `db.firebase.ts` stay in sync for any new DB facade functions (per this repo's
  DB-adapter convention), even though this plan doesn't require new tables.
- Every PATCH endpoint requires and logs a `reason`, matching `/api-limits/:provider` exactly — no new
  admin-mutation pattern introduced.
- The projected-estimate calculator must be a pure function with no DB/network access, so it stays cheap
  to unit test and cheap to recompute live in the UI as an admin edits assumptions (recompute-on-change
  in the client, not only on server round-trip, is a reasonable UX nicety but not required for v1).

## 7. Open questions for the admin/product owner (flag, don't guess)

- Exact per-request pricing for SerpAPI/GeoNames/CountryNow depends on which paid tier (if any) is
  actually subscribed to outside this codebase — default every new pricing field to $0 and let the admin
  fill in real numbers rather than guessing a plausible-looking price.
- Whether hosting costs should eventually pull from the GCP Billing API automatically — explicitly
  deferred in §2, but worth confirming now since it would change §3's data model (hosting would move from
  admin-entered line items to a synced read-only feed with an admin-entered fallback/override).
- Whether Stripe's platform/monthly fees (beyond the per-transaction rate already modeled in
  `computeBreakEvenPremiumUsers`) should be represented as another hosting-style line item — recommended
  default: yes, as a hosting line item, not a special case in the break-even formula.
