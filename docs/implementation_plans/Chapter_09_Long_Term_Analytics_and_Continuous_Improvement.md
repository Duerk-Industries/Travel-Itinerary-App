# Chapter 9 --- Long-Term Analytics and Continuous Improvement

**Evaluation note — scope flag, not a correctness issue:** this chapter
is the single biggest scope expansion beyond the originally approved
plan (§10–11 of the full plan document: "aggregate daily metrics,"
"generate daily/weekly/monthly/quarterly trend reports," "detect
regressions"). As written, §11 (A/B Testing), §14 (Automated
Recommendations), and §15 (Executive Dashboard) describe a materially
larger system — traffic-split experimentation infrastructure, an
LLM-facing recommendation engine, and a second dashboard tier — than
anything in the approved plan or in Chapters 1–8. None of it is wrong in
isolation, but building it alongside the core capture/evaluation/shadow-
parsing work (Chapters 4–5, 13) risks exactly the kind of premature,
speculative infrastructure this codebase's own conventions warn against
building ahead of need.

**Recommendation:** keep §3–§10, §12–§13 (the daily/weekly rollup
tables, provider/prompt/parser/field/cost analytics, and the regression-
detection loop) as in-scope — they're direct extensions of Chapter 5's
evaluation output and are needed to make Chapter 8's dashboards useful.
Explicitly defer §11 (A/B Testing) and §14 (Automated Recommendations)
to a later phase gated on the core platform (Chapters 2–7) being stable
in production for a meaningful period first — see the deferral note
added to §11 and §14 below. Treat §15 (Executive Dashboard) as an
optional rollup view over data §3–§10 already produce, not a separate
deliverable with its own KPIs to design.

## 1. Purpose

The analytics platform transforms individual AI captures into long-term
operational intelligence. Rather than serving only as historical logs,
captures become measurable evidence used to improve prompts, parsers,
providers, models, and user experience over time.

------------------------------------------------------------------------

# 2. Objectives

The analytics platform shall:

-   Measure AI quality over time.
-   Benchmark providers, prompts, parsers, and models.
-   Detect regressions automatically.
-   Support A/B testing.
-   Identify optimization opportunities.
-   Feed executive and operational dashboards.
-   Enable evidence-based AI improvements.

------------------------------------------------------------------------

# 3. Analytics Architecture

``` text
AI Capture
    ↓
Evaluation
    ↓
Aggregation Jobs
    ↓
Analytics Tables
    ↓
Dashboards
    ↓
Recommendations
```

Raw capture data should not be queried directly by dashboards except for
drill-down workflows.

------------------------------------------------------------------------

# 4. Analytics Data Model

Maintain dedicated analytics tables (or equivalent collections):

-   ai_daily_metrics
-   ai_provider_metrics
-   ai_prompt_metrics
-   ai_parser_metrics
-   ai_field_metrics
-   ai_cost_metrics
-   ai_ab_test_metrics

Aggregated records remain available even after production capture
retention expires.

------------------------------------------------------------------------

# 5. Aggregation Pipeline

Run scheduled aggregation jobs at least daily.

Produce:

-   Daily rollups
-   Weekly summaries
-   Monthly summaries
-   Quarterly summaries

Aggregation jobs must be idempotent and support reruns after bug fixes.

------------------------------------------------------------------------

# 6. Provider Analytics

Track per provider/model:

-   Request count
-   Success rate
-   Average latency
-   P95 latency
-   Timeout rate
-   Error rate
-   JSON compliance
-   Average token usage
-   Average cost
-   Ground-truth accuracy
-   Parser agreement
-   User regeneration rate

Support side-by-side comparison over any selected time period.

------------------------------------------------------------------------

# 7. Prompt Analytics

Track prompt versions independently.

Metrics:

-   Completion rate
-   Average quality score
-   Validation failures
-   Average latency
-   Cost
-   User retries
-   Ground-truth agreement

Prompts should be promoted or retired based on measured performance
rather than subjective preference.

------------------------------------------------------------------------

# 8. Parser Analytics

Track parser versions:

-   Completeness
-   Blank rate
-   Validation rate
-   Confidence
-   False positives
-   False negatives
-   Ground-truth accuracy

Maintain historical trends to identify gradual degradation.

------------------------------------------------------------------------

# 9. Field-Level Analytics

Every supported travel field accumulates historical metrics:

-   Presence rate
-   Blank rate
-   Validation pass rate
-   Average confidence
-   Production accuracy
-   AI accuracy
-   Ground-truth agreement

Highlight consistently weak fields for engineering prioritization.

------------------------------------------------------------------------

# 10. Cost Analytics

Track cost by:

-   Provider
-   Model
-   Feature
-   User tier
-   Prompt version

Generate alerts for unexpected increases and display estimated monthly
spend against configured budgets.

------------------------------------------------------------------------

# 11. A/B Testing

**Deferred.** Do not build traffic-split experimentation infrastructure
in the same phase as the core platform. Provider/prompt/parser
comparison for the initial rollout is already served by shadow parsing
(Chapter 4, full-plan §14) and manual replay (Chapter 8 §8) — both
compare alternatives without needing live traffic splitting. Revisit
formal A/B testing only once the platform has months of shadow/replay
data showing it's actually needed, per Chapter 13's phased roadmap
(this belongs no earlier than Phase 10 there).

Support configurable traffic allocation across:

-   Providers
-   Models
-   Prompt versions
-   Parser versions

Track:

-   Quality
-   Latency
-   Cost
-   User regeneration requests
-   Ground-truth accuracy

A/B tests should support automatic expiration and
administrator-controlled promotion of winning variants.

------------------------------------------------------------------------

# 12. Regression Detection

Compare rolling windows against historical baselines.

Generate alerts when configurable thresholds are exceeded for:

-   Quality score decreases
-   Latency increases
-   Cost increases
-   Blank rate increases
-   Validation failures
-   Ground-truth agreement
-   Provider disagreement

Alerts should distinguish isolated events from sustained regressions.

------------------------------------------------------------------------

# 13. Continuous Improvement Lifecycle

``` text
Capture
   ↓
Evaluate
   ↓
Aggregate
   ↓
Detect Regression
   ↓
Recommend Improvements
   ↓
Implement Change
   ↓
A/B Test
   ↓
Measure
   ↓
Promote
```

Every production AI improvement should be supported by measurable
evidence.

------------------------------------------------------------------------

# 14. Automated Recommendations

**Deferred.** An automated-recommendation engine is a real feature with
its own design and evaluation burden (recommendations that turn out to
be wrong erode admin trust in the whole dashboard). Ship the underlying
metrics (§6–§10) and let administrators read them directly first;
consider an automated layer on top only after there's a track record of
which metric thresholds actually correlate with a change being worth
making.

The analytics engine should generate recommendations such as:

-   Switch provider for a feature.
-   Promote a prompt version.
-   Retire a parser version.
-   Increase validation coverage.
-   Expand ground-truth datasets.
-   Reduce shadow sampling after confidence is established.

Recommendations are advisory and require administrator approval.

------------------------------------------------------------------------

# 15. Executive Dashboard

Provide high-level KPIs:

-   Total AI requests
-   Monthly AI cost
-   Average quality score
-   Overall latency
-   Provider distribution
-   Top regressions
-   Top improvements
-   A/B test status

Support drill-down into operational dashboards.

------------------------------------------------------------------------

# 16. Success Criteria

The analytics platform is complete when administrators can objectively
evaluate AI performance, detect regressions, compare providers and
prompt versions, justify changes with measurable data, and continuously
improve the platform using historical evidence rather than anecdotal
observations.
