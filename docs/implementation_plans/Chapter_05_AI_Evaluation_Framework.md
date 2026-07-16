# Chapter 5 --- AI Evaluation Framework

## 1. Purpose

The AI Evaluation Framework measures the quality, completeness,
correctness, and operational performance of AI-generated outputs. It
transforms capture data into actionable quality metrics that drive
prompt tuning, parser improvements, provider comparisons, and long-term
analytics.

Evaluation is entirely independent of production execution and must
never affect user-facing results.

------------------------------------------------------------------------

# 2. Objectives

The framework shall:

-   Evaluate every captured AI interaction.
-   Compare production parsers to AI parsers.
-   Compare both against manually labeled ground truth.
-   Generate quantitative quality scores.
-   Detect regressions automatically.
-   Feed dashboards and long-term analytics.
-   Support replay and human review.

------------------------------------------------------------------------

# 3. Evaluation Pipeline

``` text
Capture
   ↓
Normalization
   ↓
Validation
   ↓
Rule Evaluation
   ↓
Ground Truth Comparison
   ↓
Quality Scoring
   ↓
Analytics
   ↓
Dashboards
```

Evaluation runs asynchronously after capture persistence.

------------------------------------------------------------------------

# 4. Evaluation Inputs

Each evaluation consumes:

-   Capture record
-   Normalized output
-   Travel field specification
-   Prompt version
-   Parser version
-   Provider/model metadata
-   Ground-truth dataset (when available)
-   Production parser output
-   Shadow AI parser output

------------------------------------------------------------------------

# 5. Evaluation Modes

### Production Evaluation

Evaluate parser quality and validation results for every production
capture.

### Shadow Evaluation

Compare:

1.  Production parser
2.  AI parser
3.  Ground truth

Shadow output never replaces production output.

### Replay Evaluation

Re-run historical captures through current or alternate providers/models
for comparison without modifying original captures.

------------------------------------------------------------------------

# 6. Validation Rules

Validation rules are defined in:

-   `docs/travel-field-spec.md`
-   `server/config/travel-field-spec.json`

**These two files already exist and are checked into the repository**
— this is not new work. They cover Flight/Rail/Ferry-Bus Transfer,
Hotel, Car Rental, and Activity/Tour, keyed by `ParsedItemType`
(`server/src/ingestion/contracts/index.ts`), and are loaded once at
startup the same way `server/config/api-limits.yaml` is loaded (a small
`travelFieldSpec.ts` loader, no per-evaluation file I/O). The evaluator
described in this chapter should be built directly against the existing
JSON, not a new or parallel ruleset.

Each field specifies:

-   required/optional
-   expected format
-   validation expression
-   confidence threshold
-   typical availability
-   normalization rules

Unknown fields are ignored until explicitly added to the specification.
Fields with no universal real-world format standard (hotel/car-rental
confirmation numbers, names, addresses) are intentionally *not*
regex-validated in the existing spec — they use presence/blank-rate
tracking only. Don't add stricter format validation to those fields;
false "invalid" flags on unvalidatable fields erode trust in the
resulting quality dashboard (Chapter 8 §7).

------------------------------------------------------------------------

# 7. Field-Level Metrics

Track metrics for every field:

-   Presence rate
-   Blank rate
-   Validation pass rate
-   Normalization success
-   Confidence
-   Production accuracy
-   AI accuracy
-   Ground-truth agreement

These metrics accumulate historically.

------------------------------------------------------------------------

# 8. Quality Scores

Produce standardized scores including:

-   Parse Quality Score
-   Completeness Score
-   Validation Score
-   Ground Truth Accuracy
-   AI Agreement Score
-   Production Agreement Score

All scores range from 0--100.

Weights shall be configurable by field importance.

------------------------------------------------------------------------

# 9. Confidence Scoring

Each extracted field records:

-   extraction confidence
-   validation confidence
-   normalization confidence

Overall confidence is computed from weighted field confidence rather
than simple averages.

------------------------------------------------------------------------

# 10. Blank Field Assessment

Measure:

-   required fields missing
-   optional fields missing
-   unexpectedly blank fields
-   blank rate by parser
-   blank rate by provider
-   blank rate by prompt version

Blank-rate trends are included in long-term analytics.

------------------------------------------------------------------------

# 11. Regression Detection

Automatically compare current rolling averages against historical
baselines.

Generate alerts when configurable thresholds are exceeded for:

-   latency
-   quality score
-   blank rate
-   validation failures
-   parser accuracy
-   provider agreement
-   ground-truth agreement
-   estimated cost

Alerts should distinguish isolated failures from systemic degradation.

------------------------------------------------------------------------

# 12. Human Review

Administrators may review captures flagged for:

-   low confidence
-   high disagreement
-   failed validation
-   unexpected parser differences

Reviewers may attach corrected ground-truth outputs that become part of
the regression dataset.

Original captures remain immutable.

------------------------------------------------------------------------

# 13. Replay Evaluation

Replay supports:

-   alternate provider
-   alternate model
-   alternate prompt version
-   alternate parser version

Replay outputs are stored separately and evaluated using the same
scoring pipeline.

Replays are idempotent and never overwrite production artifacts.

------------------------------------------------------------------------

# 14. Analytics Integration

Evaluation exports aggregated metrics to the analytics subsystem rather
than querying raw captures directly.

Metrics include:

-   provider quality
-   parser quality
-   prompt quality
-   field quality
-   cost efficiency
-   latency
-   replay improvements

------------------------------------------------------------------------

# 15. Testability

Evaluation components shall support deterministic unit tests.

**Test the evaluator, not just the parser.** These are easy to conflate
but measure different things: a parser test asserts the extraction logic
produces the right fields; an evaluator test asserts the field-quality
ruleset itself behaves correctly (e.g. a known-bad airport code fails
validation, a known-good PNR passes). Both are needed, as separate test
targets.

Regression suites shall include manually labeled fixtures covering:

-   flights
-   hotels
-   rental cars
-   rail
-   cruises
-   activities
-   multi-document itineraries

Known-good outputs are version-controlled. Extend the existing golden-
fixture convention already used in this codebase
(`ingestion.non-llm-fixtures.test.ts`,
`ingestion.normalization.golden.test.ts`) rather than building a
separate fixture framework.

------------------------------------------------------------------------

# 16. Serviceability

Every evaluation record includes:

-   evaluationId
-   captureId
-   correlationId
-   featureKey
-   provider
-   model
-   parserVersion
-   promptVersion
-   evaluationVersion

Evaluation failures are logged, retriable, and visible in AI Operations
dashboards.

------------------------------------------------------------------------

# 17. Success Criteria

The framework is considered complete when it can:

-   quantify parser quality objectively
-   compare providers fairly
-   compare prompt versions
-   compare parser versions
-   compare against ground truth
-   detect regressions automatically
-   support replay
-   feed long-term analytics
-   operate independently from production execution
