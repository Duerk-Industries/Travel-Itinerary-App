# Chapter 15 — Experimentation, Automated Recommendations, and Executive Reporting

## 1. Purpose and Scope

This chapter designs the three capabilities explicitly deferred out of
the core platform in Chapter 9 and the implementation plan's "Deferred"
section:

1. **A/B testing infrastructure** — traffic-split experimentation across
   providers, prompts, and parsers.
2. **Automated recommendation engine** — auto-suggesting provider/prompt/
   parser changes, weighing cost and accuracy together.
3. **Executive dashboard** — a genuinely separate deliverable from the
   operational "AI Operations" surfaces in Chapter 8, with the admin
   panel's navigation redesigned so these new sections are a coherent
   information architecture, not three tabs bolted onto the side.

They were deferred, not rejected: Chapters 1–14 and the accompanying
implementation plan must be stable in production first, because all
three of these capabilities are *consumers* of that platform (capture,
evaluation, cost tracking, analytics rollups) rather than replacements
for any part of it. This chapter assumes Phases 0–9 of
`Implementation_Plan_For_LLM_Coding.md` are complete.

### Principal Architect Review Notes

This chapter is directionally sound: it keeps experimentation,
recommendations, and executive reporting downstream of the existing AI
platform instead of letting them become a second platform. The main
architecture improvements are about sequencing, ownership boundaries,
and explicit decision gates:

- **Ship the AI Operations information architecture refactor before
  experiments or recommendations.** Treat the nested `AiOpsSection`
  split as enabling infrastructure, not dashboard polish.
- **Keep the hot path brutally narrow.** Experiment resolution may enter
  `aiProviderRegistry`, but recommendation scoring, experiment analysis,
  executive reporting, and most dashboard computation must remain batch
  or aggregate-read work.
- **Make every automated action reversible and explainable.** Circuit
  breakers may auto-pause a variant because that is failure isolation,
  but no variant promotion, recommendation application, prompt switch,
  or parser retirement should ever auto-apply.
- **Do not make statistical language stronger than traffic supports.**
  The UI and docs should consistently use "directional evidence" unless
  a metric has crossed the configured sample-size threshold and still
  explain the remaining uncertainty.

Resolved owner decisions for the first implementation pass:

1. Provider/prompt/parser promotion may be approved by either an
   engineering admin or the product owner. The UI and audit log should
   record which role/person made the decision, but the platform does not
   require both approvals for the first release.
2. Initial experimentation is **ingestion/parsing only**, not itinerary
   generation. The first experiment compares the existing non-LLM parser
   output against the LLM parser output for the same normalized document.
   This keeps the blast radius low because production assignment still
   uses the non-LLM result unless an explicit later promotion changes
   that behavior.
3. An experiment must not include a provider whose vendor API key is
   merely present but whose adapter has not passed the current provider
   contract suite. "Configured" and "certified" are separate gates.
4. Executive reporting remains admin-only for now, and there is
   deliberately **no distinct permission check beyond `requireAdmin`** in
   this release — every current admin already has full capture access,
   so a separate `requireCaptureAccess` gate would have nothing real to
   differentiate yet (see the corrected §8 note). Product-owner approval
   (decision 1) is likewise represented as the same `admin` role for now,
   not a new distinct role — introduce a real product-owner /
   read-only-analyst role only when someone who is *not* a full
   engineering admin actually needs one of these capabilities. Keep the
   data layer aggregate-only (already true by design) so that a future
   role split doesn't require re-auditing for PII exposure — the
   groundwork is in place without building the role itself prematurely.
5. **Ground truth for judging LLM-vs-non-LLM parse quality is a
   three-signal combination, not a single source**, in priority order:
   (a) **admin review-queue decisions** (accept/reject/edit on a parsed
   item) as the primary, authoritative signal — already captured by the
   existing review-queue flow, reflects an actual human judgment on that
   specific extraction, no new UI needed; (b) **user edits after
   import** as a secondary signal for items an admin never reviewed
   (most items, in practice) — a field the user changed after
   assignment is treated as evidence the parse was wrong for that field,
   weighted lower than an explicit review decision since it conflates
   parse error with the user simply changing their mind; (c) **the
   existing golden-fixture corpus** (extended with field-evaluator
   assertions earlier in this platform's build-out) as a supplementary,
   *offline* signal — precise and cheap to compute, but only covers
   documents already in the fixture set, so it feeds the recommendation
   engine's confidence/sample-size accounting rather than standing alone
   as ground truth for live traffic. `ai_ab_test_metrics`' "ground-truth
   agreement where available" column (§3.2) should track which of the
   three signals backed each aggregated data point, so confidence
   labeling (§3.6) can reflect signal quality, not just sample size.
6. **First promotion threshold for ingestion parsing** is a combination,
   not a single metric: a proposed variant must show (i) a positive
   Parse Quality Score delta using the ground-truth combination above,
   AND (ii) a non-worse validation-error rate (the field-format-valid
   rate from the existing evaluator, Chapter 5) — cost is surfaced
   (§4.3's composite score) but does **not** gate promotion for this
   first release, since ingestion LLM spend is already bounded
   separately by the existing shadow-parse budget cap (§3.4a). Both
   conditions must clear `min_sample_size` (§3.6) before a promotion
   action is even offered in the UI. This is a default, not a hardcoded
   rule — expose the two thresholds via `admin_settings` so they can be
   tightened or loosened without a code change once the team has real
   data to calibrate against.

Remaining recommendation before implementation: add a synthetic
ingestion load harness for 10b so the circuit breaker can be tested
meaningfully before any live production experiment. Staging traffic
alone is unlikely to produce enough failures quickly enough to validate
auto-pause behavior.

**Experiment data retention** (resolved): `ai_experiment_assignments`
(raw, per-user rows) are retained for `EXPERIMENT_ASSIGNMENT_RETENTION_DAYS`
(default 90, `admin_settings`-configurable) after an experiment reaches
`completed` — long enough to answer "why did this specific user get this
variant" during any post-hoc review, short enough not to accumulate
indefinitely at the per-user grain. `ai_ab_test_metrics` (the daily
aggregate table) is retained **indefinitely**, like every other
analytics rollup in this platform (Chapter 9) — it's small (one row per
experiment/variant/day, not per user) and is exactly what the Executive
Dashboard's historical trend view and any future audit of a past
promotion decision need. Deleting the raw assignment rows after the
retention window does not affect the aggregate history at all, since
the aggregation job (Phase 8.2) has already rolled them up by the time
they'd be deleted.

**Grounding check performed before writing this chapter:** the admin
panel already has a real information-architecture pattern to extend —
`app/tabs/AdminTab.tsx` (3,248 lines today) defines an `AdminSection`
union type with a card-based Overview screen that routes into named
sections (`'ai-ops'`, `'tiers'`, `'features'`, `'billing'`, etc.), each
rendered by a `case` in a switch. The existing `'ai-ops'` section is
currently a single flat screen ("Select providers and models per AI
feature"). Bolting three more large surfaces onto that one `case` block,
or onto the file overall, is the concrete failure mode this chapter's
§5 is designed to avoid.

---

## 2. Relationship to the Existing Platform — What's Reused, What's New

| Existing (do not duplicate) | New in this chapter |
|---|---|
| `aiProviderRegistry` (resolves provider per feature) | Experiment-aware resolution for `traffic_split` experiments only (§3.4) — checks for an active experiment before falling back to `ai_provider_config` |
| `shadowParseService.ts` / `maybeRunShadowParse` (Phase 7's existing shadow-parse mechanism) | Extended, not duplicated, for `shadow_compare` experiments (§3.4a) — `ai_experiments` is the config/lifecycle layer on top of this existing execution engine |
| `admin_settings` (generic scalar KV table) | Experiment/recommendation config values stored here where scalar (e.g. `recommendation_min_sample_size`); structured entities get their own tables (§3.2, §4.2) |
| `ai_provider_config`, feature-flag-style 60s TTL cache | Same cache pattern reused for experiment-config lookups |
| `providerBudgeting.ts`, `estimateAiCostMicros`, `api_cost_counters` | Recommendation engine's cost half reads from these, does not recompute cost independently |
| `ai_daily_metrics` / `ai_provider_metrics` / `ai_prompt_metrics` / `ai_parser_metrics` / `ai_field_metrics` / `ai_cost_metrics` (Chapter 9 §4, Phase 8) | Recommendation engine and A/B analysis both read these aggregates, never raw captures |
| `requireAdmin`, `audit_log` | Every new route and mutation in this chapter |
| `app/tabs/AdminTab.tsx`, `AdminSection` navigation pattern, and `App.tsx`'s React Navigation `linking` config | Extended with a nested `AiOpsSection` sub-navigation (§5.1) that is *also* deep-linkable via the same `RootStackParamList`/`linking.config.screens` mechanism, not a parallel navigation system — and `ai-ops` itself gains a URL for the first time as part of this (§5.1 point 5) |
| `db.postgres.ts` / `db.firebase.ts` / `db.memory.ts` adapter triad | `ai_experiments`, `ai_experiment_assignments`, `ai_ab_test_metrics`, `ai_recommendations` all implemented across all three |

---

## 3. A/B Testing Infrastructure

### 3.1 Goals

Support configurable traffic allocation across variants (a variant =
provider + model + prompt version + parser version) for a given
feature, with automatic metric collection through the existing
evaluation/analytics pipeline, and administrator-controlled promotion —
never fully automatic promotion.

**Initial scope:** ingestion/parsing experiments only. The first
experiment family compares non-LLM parser output against LLM parser
output for the same normalized document. It is not a user-facing
traffic split in the itinerary-generation sense; it is a controlled
parse-quality comparison where the non-LLM result remains the production
response until an admin/product-owner promotion explicitly changes the
parser strategy.

### 3.2 Data Model

```sql
CREATE TABLE ai_experiments (
  experiment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- itself provides per-experiment decorrelation; see §3.3
  feature_key       TEXT NOT NULL,             -- 'itinerary_generation' | 'mail_parsing' | ...
  experiment_kind   TEXT NOT NULL DEFAULT 'shadow_compare', -- shadow_compare | traffic_split
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',  -- draft | running | paused | completed
  variants          JSONB NOT NULL,            -- [{ variantId, provider, model, promptVersion, parserVersion, trafficPercent }]
  control_variant_id TEXT,                     -- null = control is whatever ai_provider_config currently resolves to
  min_sample_size   INTEGER NOT NULL DEFAULT 200,
  max_duration_days INTEGER NOT NULL DEFAULT 30,
  started_at        TIMESTAMP,
  ends_at           TIMESTAMP,
  winning_variant_id TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_experiment_assignments (
  assignment_key         TEXT NOT NULL,   -- e.g. anonymousUserId, scoped to featureKey
  experiment_id          UUID NOT NULL REFERENCES ai_experiments(experiment_id),
  variant_id             TEXT NOT NULL,   -- currently-active variant; becomes control after a §3.5 auto-pause reassignment
  original_variant_id    TEXT,            -- set only on reassignment: the variant this row pointed to before its auto-pause
  assigned_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  reassigned_at          TIMESTAMP,       -- set only on reassignment (§3.5) — null for assignments never touched by a circuit-breaker pause
  PRIMARY KEY (assignment_key, experiment_id)
);
```

One row per `(assignment_key, experiment_id)` — a §3.5 auto-pause reassignment **updates** the existing row (`variant_id` → control, `original_variant_id` ← the paused variant, `reassigned_at` ← now) rather than inserting a second row, since the primary key already enforces exactly one active assignment per participant per experiment. `original_variant_id`/`reassigned_at` preserve enough history to explain a gap in `ai_ab_test_metrics` for the paused variant without needing a second table.

`experiment_kind` is load-bearing:

- `shadow_compare` means the treatment parser/model is evaluated in
  parallel and recorded for comparison, but its output **must not** be
  used as the production result. This is the only kind allowed for the
  first ingestion/parsing rollout.
- `traffic_split` means the assigned variant can affect the production
  response path. It is future scope for itinerary generation or a later
  parser rollout after shadow comparison has produced enough evidence.

An experiment cannot change `experiment_kind` after leaving `draft`.
That would collapse two materially different risk profiles into one
metrics history and make the results uninterpretable.

`ai_ab_test_metrics` (already named as a future table in Chapter 14 §3)
is a **daily aggregation table**, populated by the existing nightly
aggregation job (Phase 8.2), grouped by `(experiment_id, variant_id,
day)`: request count, success rate, avg quality score, avg cost, avg
latency, ground-truth agreement where available. It is not queried live
per-request — only the assignment tables are on the hot path.

All four tables implemented across `db.postgres.ts`, `db.firebase.ts`,
`db.memory.ts`.

### 3.3 Assignment — Deterministic, Not Random-Per-Request

A given entity (the `anonymousUserId` for itinerary generation; the
`intakeId`'s owning user for parsing) must get the **same variant for
the life of the experiment**, not a coin-flip per request — otherwise a
single user could get inconsistent itinerary quality across
regenerations, which is confusing and also invalidates per-user quality
comparisons.

Assignment algorithm: `bucket = hash(assignmentKey + experimentId) % 100`.
**Architect's call: `per_experiment_salt` (an earlier draft's extra
column) is redundant and has been dropped.** Its stated purpose — make
sure a user in the "10% treatment group" for one experiment isn't
automatically in the 10% group for the next, decorrelating cohorts
across experiments — is already fully provided by `experimentId` itself:
since `ai_experiments.experiment_id` is `gen_random_uuid()`, it's already
a uniformly random, independent value per experiment, so
`hash(assignmentKey + experimentId)` for two different experiments is
exactly as decorrelated as it would be with an additional random salt
layered on top. A second random value doesn't add entropy or
independence beyond what the first already provides — it would only
matter if `experimentId` were predictable/sequential, which
`gen_random_uuid()` rules out by construction. Removed the column from
§3.2's schema to avoid carrying a field with no actual effect.
Variants are laid out over `[0, 100)` in the order defined in
`ai_experiments.variants`, each occupying a range sized by its
`trafficPercent`. Any percentage not covered by explicit variants
implicitly maps to **control** (whatever `ai_provider_config` currently
resolves to for that feature) — an experiment is an incremental slice of
traffic, never a wholesale replacement of default behavior. The
resulting assignment is written once to `ai_experiment_assignments` on
first sight of that `assignmentKey` for that experiment, and read
(cached) thereafter — this makes the assignment auditable and replayable,
not just a stateless hash recomputed differently if the algorithm ever
changes.

For `shadow_compare` ingestion experiments, assignment controls which
comparison path is run and how metrics are bucketed; it does **not**
authorize the treatment result to become the persisted production parse.
That promotion remains a separate admin/product-owner action after
reviewing aggregate quality and cost data.

**Operational rule: `AI_HASH_SALT` must not rotate while any experiment
is `running`.** `anonymousUserId` (Chapter 4 §5) is `sha256(userId +
AI_HASH_SALT)` — rotating the salt silently changes every user's
`anonymousUserId`, which would reshuffle every running experiment's
bucket assignment mid-flight (a user's `hash(assignmentKey +
experimentId)` changes the moment their `assignmentKey` does) and
invalidate whatever data had been collected so far, without any error
or visible signal that it happened. Enforce this the same way other
"must not happen while X is active" rules in this platform are enforced
— a startup/rotation-time check: before honoring a salt rotation
(however that's triggered operationally), query `ai_experiments` for any
`status = 'running'` row and refuse/warn if one exists. This is cheap
(one query) and needs no schema change; it just needs to actually be
wired into whatever process performs salt rotation, not merely
documented as a rule operators are expected to remember.

### 3.4 Registry Integration — `traffic_split` Only

This integration point is for **`traffic_split` experiments** — future
scope (itinerary generation, or a parser rollout after shadow
comparison has produced enough evidence), not the initial ingestion
experiments, which integrate at a different point entirely (§3.4a).

`aiProviderRegistry.resolveProvider(featureKey, ctx)` gains one step,
inserted **before** the existing `ai_provider_config` lookup (Phase 5.3):

1. Is there a `running`, `experiment_kind = 'traffic_split'` experiment
   for this `featureKey`? (60s-cached lookup, same pattern as
   `getActiveAiProvider`.)
2. If yes, resolve/create the assignment (§3.3), tag `ctx.experimentId`
   / `ctx.variantId`, and use the assigned variant's
   provider/model/prompt version/parser version instead of the
   configured default.
3. If no running `traffic_split` experiment, behavior is identical to
   Phase 5 — zero change for features with no active experiment.

`experimentId`/`variantId` flow through to `AiCallContext`, and from
there into capture records (Chapter 4 §5) and evaluation results
(Chapter 5) exactly like `provider`/`model` already do — no new
plumbing path, just two more fields on structures that already exist.

### 3.4a `shadow_compare` Integration — Extends `shadowParseService.ts`, Does Not Duplicate It

**This is the integration point the initial ingestion/parsing
experiments actually use**, and it is deliberately *not* the registry
path above. Grounding: the platform already has a working shadow-parse
mechanism (Phase 7) — `maybeRunShadowParse()` in
`server/src/ai/services/shadowParseService.ts`, invoked directly from
the ingestion orchestrator (`server/src/ingestion/orchestrator.ts`)
after the real production parse completes. It already samples a
configurable percentage of traffic, runs the LLM extractor in parallel,
records a comparison via the existing `comparisonEngine.ts`, and
enforces its own monthly budget cap (`shadow_parse_monthly_budget_usd`,
recorded under the shared `SHADOW_PARSE` cost bucket) — every property
`experiment_kind = 'shadow_compare'` was specified to have. Building a
second implementation of the same mechanism through the AI provider
registry would mean two independently-maintained shadow-execution code
paths for the same underlying behavior. Instead:

1. `maybeRunShadowParse()` gains one additional lookup, before it reads
   the global `shadow_parse_sample_rate_percent` from `admin_settings`:
   is there a `running`, `experiment_kind = 'shadow_compare'` experiment
   for `feature_key = 'ingestion_llm_extract'` (the same feature key
   Phase 5's `ai_provider_config` already uses for this feature)? 60s
   cached, same pattern as every other admin-config lookup in this
   platform.
2. **If yes:** resolve/create the assignment (§3.3) for the intake's
   owning user, and use the experiment's own variant traffic-percent
   allocation to decide whether *this* intake is sampled — in place of,
   not in addition to, the global rate. Tag the resulting capture record
   (already written by `maybeRunShadowParse`'s existing
   `captureAiInteraction` call) with `experimentId`/`variantId`, the
   same way `provider`/`model` are already tagged.
3. **If no running `shadow_compare` experiment:** behavior is
   byte-for-byte identical to today — the existing global-rate sampling
   from `admin_settings` applies, unchanged. This is the same "zero
   change when nothing is active" guarantee every other integration
   point in this chapter provides.
4. **The shared budget cap is not bypassed by an experiment.** An
   active `shadow_compare` experiment does not get its own separate or
   larger budget — `shadow_parse_monthly_budget_usd` remains the one
   ceiling for all shadow-mode LLM spend, experiment-driven or not. If
   the shared budget is exhausted, shadow calls skip silently regardless
   of whether an experiment is currently sampling, exactly as they do
   today.
5. **No new comparison or metrics logic.** `ai_ab_test_metrics`'s daily
   rollup for `shadow_compare` experiments is populated by the *same*
   nightly aggregation job (Phase 8.2) reading the *same* capture
   records `maybeRunShadowParse` already writes (now with
   `experimentId`/`variantId` attached) — not a new metrics pipeline.
   "Ground-truth agreement where available" (§3.2) is computed by the
   *same* `compareExtractionResults`/`comparisonEngine.ts` this platform
   already built and tested — not a second comparison engine.

Net effect: `ai_experiments` becomes the **config and lifecycle layer**
(named, time-boxed, admin-created, with `min_sample_size`/
`max_duration_days`/promotion workflow) sitting on top of the
**existing execution engine** (`shadowParseService.ts`), rather than a
competing implementation of shadow parsing. The circuit breaker (§3.5)
and statistical discipline (§3.6) apply here exactly as written; only
the sampling-decision source (experiment-driven vs. global-rate) and
the fact that shadow experiments never touch `aiProviderRegistry` at
all are specific to this integration point.

### 3.5 Safety: Per-Variant Circuit Breaker

An experiment must not turn into an incident. Track a rolling error
rate per `(experiment_id, variant_id)` using the same rolling-window
approach as Chapter 6/9's regression detection. If a variant's error
rate exceeds a configurable threshold (default 25% over a minimum
20-request window), **that variant is automatically paused** — its
traffic share is redistributed to control, not to the other variants —
and an alert fires (reusing the existing alerting pattern, Chapter 6
§7 / Chapter 11 §8). The experiment as a whole is not paused unless an
admin does so; a single bad variant failing safe is the point of having
per-variant isolation.

**Auto-pause reassigns existing users, deliberately breaking §3.3's
sticky-assignment guarantee for this one case.** §3.3 makes assignment
sticky specifically so a user's itinerary quality doesn't fluctuate
across regenerations — but that guarantee assumes the assigned variant
is *working*. A variant that just tripped the circuit breaker has, by
definition, failed that assumption, so honoring stickiness for users
already assigned to it would mean the safety mechanism doesn't actually
stop the bleeding for anyone already caught by it — only for requests
that hadn't been assigned yet. On auto-pause: for every existing
`ai_experiment_assignments` row currently pointing at that
`(experiment_id, variant_id)`, update it in place — `variant_id` becomes
control, `original_variant_id` records the paused variant, `reassigned_at`
is set to now (§3.2's schema) — so the next request for that
`assignmentKey` resolves to control without a new DB row. This means `ai_ab_test_metrics`
for that variant may include a mix of "used it while healthy" and "used
it right up to the pause" data — acceptable, since a variant that
tripped the breaker was already disqualified from being a credible
comparison candidate for that period regardless of what its assignment
table says.

**For `shadow_compare` experiments specifically** (§3.4a), "traffic
share is redistributed to control" has no user-facing production
traffic to redistribute — the shadow path's output was never serving
real responses in the first place. Auto-pause here means: the
experiment stops sampling that variant (assignments reassign to
control the same way, so no further shadow-LLM calls are attempted for
already-assigned users), which mainly protects the shared budget cap
(§3.4a point 4) and comparison-data quality from a variant that's
producing garbage — not user-facing safety, which was never at risk for
a shadow comparison to begin with. This is a real difference in *what*
the circuit breaker is protecting between the two `experiment_kind`
values, worth keeping explicit rather than implying identical stakes
for both.

### 3.6 Statistical Approach — Deliberately Conservative

This platform's traffic volume (a travel-itinerary app, not a
high-QPS consumer product) means sample sizes per variant will often be
small. Do not build a full frequentist significance-testing pipeline
that implies more statistical confidence than the data supports.
Instead:

- Report raw aggregates and simple confidence intervals (e.g. Wilson
  score interval on success/quality proportions) as *directional
  evidence*, labeled as such in the UI — not a binary "winner"
  declaration.
- `min_sample_size` (default 200 requests per variant) gates whether a
  "declare winner" action is even offered in the UI — below threshold,
  the UI shows "insufficient data" rather than a misleading comparison.
- **Promotion is always an explicit administrator action.** Nothing in
  this system auto-promotes a variant to become the new default in
  `ai_provider_config`, regardless of how favorable the numbers look.
  This mirrors the "advisory, not automatic" rule already established
  for recommendations (§4) and keeps the two systems' guarantees
  consistent.

### 3.7 Lifecycle and Admin Operations

`draft → running → (paused ↔ running) → completed`. Deliverables in the
admin UI (§5): create (pick feature, variants, traffic split, min
sample size, max duration), start, pause/resume, promote-winner
(applies the winning variant's config via the *existing* `PATCH
/api/admin/ai-config/:featureKey` endpoint from Phase 5.5 — the
experiment system does not get its own privileged write path to
provider config), and end-without-promoting. `max_duration_days`
auto-transitions a `running` experiment to `completed` (not deleted;
history stays queryable) if an admin never acts — an experiment must
never run forever by omission.

---

## 4. Automated Recommendation Engine

### 4.1 Goals

Turn the metrics Chapters 5/9 and §3 above already produce into
concrete, advisory, cost-aware suggestions — without ever auto-applying
a change or claiming more confidence than the underlying sample
supports.

### 4.2 Data Model

```sql
CREATE TABLE ai_recommendations (
  recommendation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_type TEXT NOT NULL,   -- switch_provider | promote_prompt | retire_parser | reduce_shadow_sampling | cost_anomaly
  feature_key          TEXT NOT NULL,
  subject_current      JSONB NOT NULL, -- e.g. { provider, model, promptVersion }
  subject_proposed      JSONB NOT NULL,
  rationale             TEXT NOT NULL, -- template-rendered, never LLM-generated — see §4.3
  quality_delta_estimate NUMERIC,      -- proposed.qualityScore - current.qualityScore
  cost_delta_estimate_usd_monthly NUMERIC,  -- projected monthly cost delta, not per-request
  confidence            TEXT NOT NULL, -- low | medium | high, derived from sample size, never a false-precision percentage
  supporting_evidence_ref TEXT,        -- link to the ai_ab_test_metrics row / shadow comparison / ai_provider_metrics window backing this
  engine_version        TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'proposed', -- proposed | applied | dismissed | expired
  supporting_evidence_query JSONB,             -- NEW: Stores the exact filter params (date range, feature, variants) used to generate this
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  responded_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  responded_at          TIMESTAMP,
  outcome_measured_at    TIMESTAMP,
  outcome_quality_delta  NUMERIC,      -- measured, filled in N days after applying
  outcome_cost_delta_usd_monthly NUMERIC
);
```

Implemented across all three DB adapters.

### 4.3 Cost + Quality: One Composite Score, Configurable Weighting

The requirement that suggestions weigh cost *and* accuracy together is
implemented as a single scoring function, not two separate scores an
admin has to reconcile mentally:

```
value(variant) = w_quality * normalizedQuality(variant)
               - w_cost    * normalizedCost(variant)
```

- `normalizedQuality` is the existing 0–100 Parse/Itinerary Quality
  Score (Chapter 5 §8) rescaled to 0–1.
- `normalizedCost` is **relative to the feature's current spend**, not
  an absolute dollar figure — `normalizedCost(variant) =
  projectedMonthlyCost(variant) / projectedMonthlyCost(current)`. This
  is what makes the formula scale-invariant: a $2,000/month feature and
  a $20/month feature both express "proposed costs 1.3x what we
  currently spend" on the same footing, so the same `w_cost` weight
  means the same thing across features of wildly different spend —
  without this, a fixed weight would implicitly matter far more for a
  low-spend feature than a high-spend one, which isn't what an admin
  configuring `w_cost` would expect. `projectedMonthlyCost` itself is
  still computed as historical average token usage for that feature ×
  the target provider/model's cost table in `api-limits.yaml`'s
  budgeting block (Chapter 3 §7 / Chapter 6 §9), scaled to current
  request volume — only the final normalization step changed. The
  recommendation UI still shows the absolute monthly-dollar figure as
  the primary number (that's what an admin actually decides from), with
  the normalized ratio as the value the scoring formula itself consumes
  internally — a `normalizedCost` of 1.3 is not something to surface
  directly in the UI copy, "30% more than current spend" is.
- `w_quality` / `w_cost` are admin-configurable per feature via the
  existing generic `admin_settings` mechanism (e.g.
  `recommendation_weight_quality_itinerary_generation`,
  `recommendation_weight_cost_itinerary_generation`, default 0.7/0.3) —
  a team that cares more about controlling spend on a high-volume
  feature than squeezing out marginal quality gains should be able to
  say so without a code change.
- A recommendation is only generated when `value(proposed) -
  value(current)` exceeds a configurable minimum delta threshold — this
  avoids a noisy stream of marginal, not-actually-actionable
  suggestions.
- **`rationale` is rendered from a fixed string template per
  `recommendation_type`, never generated by an LLM call.** Each of the
  five `recommendation_type` values (§4.2) has exactly one template,
  interpolated with the concrete numbers that triggered it — e.g.
  `switch_provider`: `"{proposed.provider} scored {qualityDelta} points
  higher than {current.provider} over {sampleSize} requests, at
  {costDeltaPercent}% {more/less} monthly cost (confidence:
  {confidence})."` This is a deliberate, load-bearing constraint, not
  an implementation-convenience default: an LLM-generated rationale
  would mean the recommendation engine itself becomes an AI feature —
  needing its own capture, cost tracking, rate limiting, and the
  allowlist/redaction discipline from Chapter 7 §2 — which defeats the
  purpose of this engine being a pure downstream *consumer* of the
  platform's metrics (§4.5's "no new always-on process" guarantee would
  also no longer hold). If natural-language rationale generation is
  ever wanted, it should be scoped and designed as its own AI feature
  end-to-end through this same platform, not slipped in as a detail of
  `computeRecommendationValue()`.

### 4.4 Recommendation Lifecycle and Feedback Loop

`proposed → (applied | dismissed | expired)`. "Applied" does not mean
the recommendation engine writes to `ai_provider_config` directly — it
means the admin UI pre-fills the existing Phase 5 provider-config form
(or the existing prompt/parser-version admin action, once those exist)
with the proposed change, and the admin confirms through that
already-audited path. The recommendation engine never gets write access
to production configuration on its own.

**Feedback loop:** `outcome_measured_at` / `outcome_quality_delta` /
`outcome_cost_delta_usd_monthly` are filled in by a follow-up batch step
N days (default 14) after a recommendation is applied, by diffing the
relevant `ai_*_metrics` aggregates before/after. This is what lets the
engine's own track record be evaluated later (e.g. "of the last 20
applied recommendations, how many delivered the estimated quality/cost
delta?") rather than trusting its estimates on faith. Surface this
track record in the admin UI (§5.3) — an engine whose past
recommendations didn't pan out should visibly lose the admin's trust,
not silently keep suggesting.

### 4.5 Batch Architecture — Nightly, Fully Decoupled

The recommendation engine runs as a downstream step of the existing
daily aggregation job (Phase 8.2), reading only aggregated tables
(§4.1). It is not a service in the request path and cannot affect
production latency or availability by construction — a failure here
logs and retries on the next scheduled run, full stop. No new always-on
process is introduced.

### 4.6 Guardrails

- Same `min_sample_size` discipline as §3.6 — no recommendation is
  generated from a comparison with too little data; the recommendation
  itself carries a `confidence` field (`low`/`medium`/`high`) derived
  from sample size, not a spuriously precise percentage.
- `engine_version` is recorded on every row so a future change to the
  scoring formula doesn't retroactively make historical recommendations
  uninterpretable — this follows the same versioning discipline as
  prompt/parser/capture-schema versions elsewhere in this plan (Chapter
  12 §5).
- Recommendations reference their `supporting_evidence_ref` so an admin
  can drill from "why is this being suggested" straight into the
  underlying comparison data (§5.4) rather than trusting a one-line
  rationale blind.

---

## 5. Executive Dashboard and Admin Panel Information Architecture

### 5.1 Navigation Redesign

**The concrete problem:** `AdminTab.tsx` is already 3,248 lines with a
flat `AdminSection` union and one `case 'ai-ops':` block that today
renders a single "pick provider per feature" screen. Adding Experiments,
Recommendations, and an Executive Dashboard as more entries in that same
flat structure — or more content in that same `case` — is how admin
panels turn into unmaintainable junk drawers. Fix the structure, not
just the content:

1. Keep `'ai-ops'` as the single top-level `AdminSection` entry point
   from the Overview screen (no change to the outer navigation other
   apps/roles already rely on).
2. Inside the `'ai-ops'` case, introduce a **second-level nested
   section router** (`AiOpsSection`), the same pattern as
   `AdminSection` one level down:

```ts
type AiOpsSection =
  | 'overview'        // operational at-a-glance (Chapter 8 §4)
  | 'providers'        // config + health + certification (Chapter 3, 8 §5)
  | 'experiments'       // §3 above
  | 'recommendations'   // §4 above
  | 'captures'          // capture browser (Chapter 8 §6)
  | 'parser-quality'    // parser evaluation (Chapter 8 §7)
  | 'shadow-replay'      // shadow/comparison + replay (Chapter 8 §8)
  | 'executive'          // §5.2 below — deliberately separate from 'overview'
  | 'runtime-settings'   // Chapter 8 §10
  | 'ai-audit-log';      // AI-specific slice of the existing audit log view
```

3. Each `AiOpsSection` is its own component file under a new
   `app/components/admin/aiOps/` directory (e.g.
   `AiOpsExecutiveDashboard.tsx`, `AiOpsExperiments.tsx`,
   `AiOpsRecommendations.tsx`), not more inline JSX inside
   `AdminTab.tsx`. `AdminTab.tsx`'s `'ai-ops'` case becomes a thin
   router over these components — mirroring how the codebase already
   keeps tab-level fetch logic co-located with its component (per
   `CLAUDE.md`'s "each tab file owns its fetch logic" convention),
   just one level deeper for this specific section given its size.
4. Filters (date range, feature, provider) persist in the `ai-ops`
   sub-navigation's shared state across its own sub-tabs, per the
   existing cross-section filter-persistence requirement (Chapter 8
   §3) — switching from Parser Quality to Executive doesn't reset the
   date range.
5. **`AiOpsSection` must be deep-linkable/shareable using the exact
   same mechanism as the top-level `AdminSection` — not a new one.**
   Grounding correction to this chapter's original review: `'ai-ops'`
   itself is *not currently* in `App.tsx`'s React Navigation `linking`
   config (`RootStackParamList` / `adminScreenBySection` /
   `linking.config.screens`) — only `overview`, `users`, `tiers`,
   `features`, `user-data`, `audit-log`, and `billing` have a dedicated
   screen + URL today (`admin`, `admin/users`, `admin/tiers`, etc.);
   `ai-ops` (like `ingestion`, `api-limits`, `packing-defaults`,
   `metrics`) is reachable only via in-app click-through, with no URL of
   its own. Making the *nested* `AiOpsSection` shareable therefore means
   retrofitting `ai-ops` into this same mechanism first, then extending
   it one level further — both in one pass, following the established
   pattern exactly:
   - Add one `RootStackParamList` entry and one `linking.config.screens`
     path per `AiOpsSection` value, named and pathed the same way the
     existing seven are: `AdminAiOpsOverview: 'admin/ai-ops'`,
     `AdminAiOpsProviders: 'admin/ai-ops/providers'`,
     `AdminAiOpsExperiments: 'admin/ai-ops/experiments'`,
     `AdminAiOpsRecommendations: 'admin/ai-ops/recommendations'`,
     `AdminAiOpsCaptures: 'admin/ai-ops/captures'`,
     `AdminAiOpsParserQuality: 'admin/ai-ops/parser-quality'`,
     `AdminAiOpsShadowReplay: 'admin/ai-ops/shadow-replay'`,
     `AdminAiOpsExecutive: 'admin/ai-ops/executive'`,
     `AdminAiOpsRuntimeSettings: 'admin/ai-ops/runtime-settings'`,
     `AdminAiOpsAiAuditLog: 'admin/ai-ops/ai-audit-log'`. Ten new flat
     screen entries, exactly like the existing seven — no nested-route
     parameter machinery needed, since React Navigation's linking config
     doesn't require one screen to be a child of another just because
     their URLs share a prefix.
   - Extend `adminScreenBySection`/`adminSectionByScreen`'s pairing
     pattern with the equivalent `aiOpsScreenBySection`/
     `aiOpsSectionByScreen` maps, and extend the existing
     `onSectionChange` callback threading (`AdminTab.tsx` →
     `renderAdminScreen` → `openAdminSection`) one level deeper with an
     analogous `onAiOpsSectionChange` passed down into the `'ai-ops'`
     case, calling an `openAiOpsSection` that mirrors `openAdminSection`
     exactly.
   - Net result: a colleague can be sent
     `https://duerk.org/admin/ai-ops/executive` directly, exactly as
     `https://duerk.org/admin/billing` already works today — filtered
     state (point 4 above) is client-side UI state layered on top, not
     itself part of the shareable URL for this first pass, unless a
     follow-up wants query-string filter params too (a natural
     extension of the same mechanism, not a new one).

### 5.2 Executive Dashboard vs. Operational Overview — Different Audiences, Different Screens

These must not be the same page with more charts crammed on. They serve
different questions:

| | **Operational Overview** (`ai-ops/overview`) | **Executive Dashboard** (`ai-ops/executive`) |
|---|---|---|
| Audience | Engineer/support, checking system health right now | Whoever owns the business decision (cost, ROI, is this worth it) |
| Time frame | Today / last 24h, real-time-ish | Monthly / quarterly trend |
| Content | Requests today, success rate, provider latency, active alerts, capture success rate | Total AI spend vs. budget, cost per completed itinerary/parse, quality trend, provider mix, recommendation acceptance rate |
| Interaction | Drill into a specific failure/alert | Drill into a specific month/trend line |
| Tone | Diagnostic | Narrative — should read like a monthly report, not a Grafana panel |

### 5.3 Executive Dashboard — Content Specification

- **Spend summary:** total AI cost this month vs. configured budget,
  with prior-month comparison; broken down by feature and by provider.
  Pulled from `ai_cost_metrics`, never recomputed independently.
- **Quality trend:** average Parse/Itinerary Quality Score over the
  last 6 months, with a plain-language annotation on any regression
  detected (Chapter 9 §12) in that window — surface the *interpretation*
  ("quality dipped 8 points in March after switching to gpt-4o-mini"),
  not just a line chart.
- **Cost efficiency:** cost per completed itinerary generation, cost per
  parsed document — the metric that actually maps to "is this AI
  feature affordable at our scale," not raw dollar totals alone.
- **Provider mix:** share of traffic per provider per feature, useful
  for noticing e.g. "80% of spend is OpenAI, worth trying the Anthropic
  experiment" — this is the natural bridge from Executive into
  Experiments (§5.4).
- **Recommendation engine track record:** recommendations proposed vs.
  applied vs. dismissed this quarter, and — per §4.4's feedback loop —
  how many applied recommendations delivered their estimated
  quality/cost delta. This is what makes the recommendation engine
  self-auditing rather than a black box.
- **Export:** CSV and a print-friendly/PDF view, since this is the one
  screen in AI Operations likely to be shared outside the immediate
  engineering team.
- Explicitly **not** on this screen: raw capture data, per-request
  debugging detail, PII of any kind (even redacted) — this dashboard
  reads from aggregates only (§2 table), which structurally keeps it
  clean of the privacy concerns that apply to the Capture Browser.

### 5.4 Cross-Navigation and Drill-Down

Every summary card on the Executive Dashboard links into the relevant
operational screen filtered to the same time range — clicking the
quality-trend annotation for March jumps into Parser Quality
(`ai-ops/parser-quality`) pre-filtered to March; clicking the provider-mix
chart's "Anthropic: 12%" segment jumps into Experiments pre-filtered to
any Anthropic experiment for that feature. This is what makes "tabs and
flow" actually coherent rather than eight independent screens that
happen to share a nav bar — the IA is a single connected graph, and the
Executive Dashboard is the entry point into it for a non-engineer, not a
dead end.

### 5.5 Frontend Maintainability

- New nested routing state (`AiOpsSection`) lives in
  `app/tabs/AdminTab.tsx` alongside the existing `AdminSection` state,
  following the same `useState` + `goTo`-style navigation function
  pattern already established there (§1's grounding check found this
  exact pattern at `AdminTab.tsx:2868-2876`) — reuse it, don't invent a
  second navigation idiom for one section of one file.
- Each new `AiOpsSection` component owns its own data fetching (fetch
  helpers co-located with the component), consistent with this
  codebase's "tab files own their API fetch logic" convention extended
  one level down.
- Shared primitives (summary card, trend chart, filter bar) used by
  Overview, Executive, Experiments, and Recommendations screens should
  be extracted once into `app/components/admin/aiOps/shared/` the
  moment a second screen needs them — not duplicated per screen, and
  not over-abstracted into a generic "dashboard framework" before a
  second consumer exists either.

---

## 6. Performance and Scalability

- **Assignment lookups (§3.3) and experiment-config resolution are
  cached** with the same 60s TTL pattern as every other admin-config
  read in this platform — no new DB round-trip per generation stage
  beyond what Phase 5 already introduced.
- **The recommendation engine and experiment metric aggregation are
  batch jobs**, not request-path code — by construction they cannot add
  latency to a user-facing AI call, mirroring the isolation already
  established for analytics in Chapter 6 §13.
- **`ai_experiment_assignments` grows linearly with unique users ×
  concurrent experiments**, not with request volume — write once per
  `(assignmentKey, experimentId)`, read (cached) thereafter. This is
  small relative to capture-object volume and doesn't need the
  cost-conscious batching design applied to captures in Chapter 4/6.
- **The per-variant circuit breaker (§3.5)** must evaluate cheaply
  (rolling counters, not a full metrics-table scan) so it can run inline
  without adding meaningful latency wherever it's checked —
  `aiProviderRegistry`'s hot path for `traffic_split` experiments (§3.4),
  or `maybeRunShadowParse`'s existing call site for `shadow_compare`
  experiments (§3.4a), which is already off the production-response hot
  path by construction. Implement it as the same kind of atomic counter
  `usageLimiter.ts` already uses for windowed rate limits, not a new
  counting mechanism, regardless of which call site checks it.

## 7. Serviceability and Observability

- Every experiment/recommendation action (`created`, `started`,
  `paused`, `promoted`, `applied`, `dismissed`) is a structured
  `logInfo` line with `experimentId`/`recommendationId`, following the
  same field conventions as Chapter 11 §4.
- A variant auto-pause (§3.5) is a first-class alert
  (`event: 'ai_experiment_variant_autopaused'`), reusing the existing
  alerting pattern rather than introducing a separate one, and links
  directly to the affected experiment in the admin UI (Chapter 11 §8's
  "alerts link to affected records" requirement, applied here).
- Recommendation-engine batch-job failures are logged and retried on
  the next scheduled run (§4.5) — add them to the existing daily
  aggregation job's health check (Chapter 11 §7) rather than a separate
  health surface.

## 8. Security and Access Control

- All new routes (`/api/admin/experiments/*`,
  `/api/admin/recommendations/*`, `/api/admin/ai-ops/executive`) sit
  behind `requireAdmin`, no exceptions.
- **Corrected: no separate `requireCaptureAccess` gate for this
  release.** An earlier draft of this section proposed a secondary
  permission check for drill-down navigation from the Executive
  Dashboard into Captures/Parser Quality. Dropped as premature: every
  admin in this release already has full capture access, so a second
  check would have nothing to actually differentiate yet — it would be
  a permission gate that always passes, which is worse than no gate at
  all (it looks like a real boundary when it isn't one). `requireAdmin`
  on every route (above) is the real and only boundary today. The
  design that *does* matter — keeping the Executive Dashboard's data
  layer aggregate-only regardless of role checks — is covered below,
  and is what actually makes a future role split (e.g. a real read-only
  business-viewer role that should see spend trends but never drill
  into Captures) safe to add later without re-auditing PII exposure.
  Introduce `requireCaptureAccess` (or equivalent) only when that role
  is actually built, not ahead of it.
- Every mutating action — create/start/pause/promote an experiment;
  apply/dismiss a recommendation — writes to `audit_log` with the same
  `user/timestamp/action/target/result` shape as the rest of the
  platform (Chapter 7 §11).
- The Executive Dashboard's aggregate-only data source (§5.3) is itself
  a privacy control: because it never reads raw or per-record capture
  data, it structurally cannot leak PII even if it were ever exposed to
  a broader audience than full admins — a relevant property if a future
  "read-only analyst" or "executive" role (Chapter 8 §12, not built yet)
  is ever added. Design the route/permission check as
  `requireAdmin` today, but keep the data-access layer scoped to
  aggregates only so that loosening the role check later doesn't also
  require re-auditing for PII exposure.
- Recommendation `rationale` and `subject_current`/`subject_proposed`
  fields must themselves obey the structural-allowlist principle
  (Chapter 7 §2) — they describe configuration (providers, models,
  prompt versions), never user content, so this is naturally satisfied
  as long as no future recommendation type is added that quotes raw
  captured text directly into a rationale string.

## 9. Maintainability

- Every new table versioned and adapter-triad-complete per the
  cross-cutting rules already established (Chapter 12, Implementation
  Plan §"Cross-cutting rules").
- The composite scoring formula (§4.3) lives in exactly one function,
  `computeRecommendationValue()`, with `engine_version` bumped whenever
  its logic changes — never edited in place silently, since historical
  recommendations must remain interpretable against the version that
  produced them (§4.6).
- Experiment variant definitions are immutable once an experiment
  leaves `draft` — changing traffic percentages or swapping a variant
  in `running` state requires ending the current experiment and
  starting a new one. This keeps `ai_ab_test_metrics` rows unambiguous
  (a given `experiment_id` always means the same set of variants) at
  the cost of slightly more admin friction, which is the right
  trade-off for data integrity.
- Frontend: the `AiOpsSection` decomposition in §5.1/§5.5 is the
  concrete maintainability deliverable of this chapter — it exists
  specifically so the next AI-Ops feature after this one has an obvious
  place to go (a new `AiOpsSection` value and component file) instead of
  more lines in an already-3,000-line file.

## 10. Testability

- **Assignment determinism:** given a fixed `assignmentKey` and
  `experimentId`, `resolveExperimentVariant()` must return the same
  variant across repeated calls — a direct unit test, no mocking needed
  beyond the hash function.
- **Traffic split accuracy:** over a large synthetic sample of
  assignment keys, the observed variant distribution should statistically
  match configured `trafficPercent`s within a tolerance — this is the
  right place for a statistical assertion (large N, deterministic hash),
  unlike §3.6's explicit avoidance of statistical claims about *quality*
  from small production samples.
- **Circuit breaker:** inject a `TestAiProvider` configured to fail 100%
  of the time as one variant; assert it auto-pauses within the
  configured window and traffic reroutes to control, with zero impact
  on requests assigned to other variants.
- **`shadow_compare` extends, doesn't duplicate, `shadowParseService.ts`:**
  with a `running` `shadow_compare` experiment configured, assert
  `maybeRunShadowParse()` reads the experiment's variant traffic-percent
  instead of `shadow_parse_sample_rate_percent`; with no running
  experiment, assert behavior is byte-for-byte identical to the existing
  `shadowParseService.test.ts` suite (same test file, no new mocks
  needed for the "no experiment" case — this is the direct test of
  §3.4a's "zero change when nothing is active" guarantee). Also assert
  the shared `shadow_parse_monthly_budget_usd` cap still applies when an
  experiment is driving sampling — an active experiment must not bypass
  it.
- **Recommendation scoring:** `computeRecommendationValue()` is a pure
  function over synthetic `ai_*_metrics` fixtures — test weight
  configurations, threshold behavior, and confidence-level derivation
  entirely without a real experiment or real cost data.
- **Recommendation lifecycle:** a recommendation applied via the admin
  UI must route through the *existing* Phase 5 config-update endpoint
  (assert the same audit-log entry shape it already produces) — not a
  new write path that needs its own security test suite.
- **Executive Dashboard:** since it only reads aggregates, its tests are
  ordinary component/data-fetching tests against fixture aggregate rows
  — no capture fixtures, no PII-redaction test surface, which is itself
  a signal the design in §5.3 is doing its job.
- **Deep-link round-trip:** for every new `AiOpsSection` value, assert
  that navigating to its URL (e.g. `admin/ai-ops/executive`) resolves
  `initialSection: 'ai-ops'` + the correct nested `AiOpsSection`, and
  that navigating *within* the app to that section updates
  `window.location`/native URL to match (`onSectionChange` →
  `openAdminSection` → URL, and back) — a direct test of §5.1 point 5,
  cheap to write since it's the same test shape the existing seven
  `AdminSection` entries presumably already have (or should, if they
  don't yet).
- **Rationale is a pure template render:** `renderRecommendationRationale(type,
  metrics)` (§4.3) is a pure function over each `recommendation_type` —
  test it directly against fixture metrics for all five types, and
  assert nowhere in its call graph does anything resembling an AI
  provider call, capture, or cost record get invoked (a cheap
  "grep the function body / assert no provider registry import" check
  is enough — the point is this stays structurally incapable of
  becoming an LLM call, not just documented as one).

## 11. Usability

- Every new screen (Experiments, Recommendations, Executive) needs an
  explicit empty state with a call to action — "No experiments running
  — Create one," "No recommendations yet — check back after enough
  traffic has been captured" — per the existing UX requirement (Chapter
  8 §15) applied to genuinely new screen real estate rather than assumed
  to carry over.
- Dangerous actions (promote a variant to production default, apply a
  recommendation, end an experiment early) require the same
  confirmation-prompt pattern already used elsewhere in AI Operations
  (Chapter 8 §2) — no new dangerous-action idiom.
- Confidence and sample-size caveats (§3.6, §4.6) must be visible in the
  UI copy itself, not just present in the underlying data — e.g. a
  recommendation card shows "Confidence: low (42 requests)" plainly,
  rather than an admin having to infer statistical shakiness from a
  chart.
- The Executive/Operational split (§5.2) is itself the primary usability
  fix requested: an executive should never have to learn what a "P95
  provider latency" is to answer "are we spending the right amount for
  the quality we're getting," and an engineer debugging a failed job
  should never have to wade through monthly cost narrative to find a
  correlation ID.

---

## 12. Rollout / Phasing

This chapter's three capabilities become **Phase 10** of
`Implementation_Plan_For_LLM_Coding.md`, replacing that document's
placeholder "Deferred" note, broken into four sub-phases so each is
independently shippable:

- **10a — AI Operations IA refactor** (§5): land the `AiOpsSection`
  nested-router split and component decomposition first. This creates
  stable homes for Experiments, Recommendations, Executive, Captures,
  Parser Quality, Shadow Replay, Runtime Settings, and AI audit surfaces
  before those screens grow. It is acceptable for most sections to show
  empty states in this phase; the important output is the navigational
  skeleton and deep-linking contract.
- **10b — Ingestion parser experimentation** (§3): requires Phases 0–9
  stable and 10a's navigation/component structure in place. Ship the
  non-LLM-vs-LLM parse comparison path, certification gate, synthetic
  failure/load harness, and circuit breaker first. The admin UI for
  creating experiments can lag slightly behind (experiments creatable
  via a direct DB row initially, if needed, is acceptable for an
  internal-only first cut), but do not ship any live experiment path
  without the circuit breaker; that ordering is not negotiable.
- **10c — Recommendations** (§4): requires 10b's `ai_ab_test_metrics`
  and the existing Chapter 9 analytics tables. Ship the batch scoring
  job and admin review UI together — a recommendation with no way to
  review/apply/dismiss it is not a shippable increment.
- **10d — Executive Dashboard** (§5.2–§5.4): requires the aggregate
  metrics, recommendation track-record fields, and cross-navigation
  hooks from 10a–10c. Do not ship an executive screen that is only a
  thin wrapper over operational charts; it must answer the business
  questions in §5.2.

## 13. Success Criteria

This chapter's scope is complete when: an admin can run a genuine
provider-vs-provider experiment on live traffic with automatic
per-variant failure isolation and no risk of an experiment silently
running forever; the recommendation engine has proposed at least one
cost-and-quality-justified suggestion that was applied and later
confirmed (via the feedback loop) to have delivered its estimated
benefit; and a non-engineer can open the Executive Dashboard, understand
this month's AI spend and quality trend without assistance, and drill
into any anomaly without leaving the admin panel.
