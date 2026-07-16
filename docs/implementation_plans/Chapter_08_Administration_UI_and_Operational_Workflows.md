# Chapter 8 --- Administration UI and Operational Workflows

## 1. Purpose

The AI Operations console is the administrative interface for
configuring, monitoring, evaluating, replaying, and improving every
AI-powered feature. It serves as the operational control center for the
platform and is accessible only to administrators.

**Implementation grounding:** this is a new section within the existing
`app/tabs/AdminTab.tsx`, following that file's existing dense-table
admin patterns — not a separate application or standalone admin
surface. Every route it calls uses the existing `requireAdmin`
middleware (`server/src/app.ts`), and every mutation writes to the
existing `audit_log` table, consistent with the rest of this codebase's
admin functionality (feature flags, tier entitlements, etc.).

------------------------------------------------------------------------

# 2. Design Principles

The UI shall:

-   Surface operational health first.
-   Minimize clicks for common workflows.
-   Support large datasets.
-   Be responsive on desktop and tablet.
-   Never expose raw production PII.
-   Default to safe operations (dry-run, confirmation prompts, read-only
    where appropriate).

------------------------------------------------------------------------

# 3. Navigation

Top-level sections:

1.  Overview
2.  Providers
3.  Capture Browser
4.  Parser Evaluation
5.  Replay Center
6.  Analytics
7.  Runtime Settings
8.  Audit Log

Each page shall preserve filters during navigation.

------------------------------------------------------------------------

# 4. Dashboard Overview

Display summary cards for:

-   AI requests today
-   Success rate
-   Provider latency
-   Estimated monthly cost
-   Shadow budget usage
-   Capture success rate
-   Replay queue
-   Active alerts

Include trend indicators and links to drill into details.

------------------------------------------------------------------------

# 5. Provider Management

Administrators can:

-   Assign provider by feature
-   Select model
-   Enable/disable provider
-   View provider readiness
-   View health history
-   Review certification status

Changes require confirmation and generate audit entries.

"Provider readiness" here is the `configured: boolean` flag described
in Chapter 3 §5 — derived from whether the provider's API key env var
is present, never the key or a prefix of it. The dropdown must not
offer a provider/model combination that isn't actually configured.

------------------------------------------------------------------------

# 6. Capture Browser

Search by:

-   Capture ID
-   Correlation ID
-   Job ID
-   Feature
-   Provider
-   Model
-   Date range
-   Outcome

Display:

-   Metadata
-   Redacted prompt
-   Redacted extracted text
-   Validation summary
-   Timing
-   Costs
-   Linked replay history

Production downloads are limited to redacted artifacts.

------------------------------------------------------------------------

# 7. Parser Evaluation

Provide:

-   Field-level quality
-   Blank-rate analysis
-   Validation failures
-   Confidence distribution
-   Production vs. AI comparison
-   AI vs. Ground Truth comparison

Support filtering by parser version, provider, feature, and time range.

------------------------------------------------------------------------

# 8. Replay Center

Replay supports:

-   Provider selection
-   Model selection
-   Prompt version
-   Parser version
-   Dry-run (default)
-   Batch replay

Replay jobs execute asynchronously and never overwrite production data.

------------------------------------------------------------------------

# 9. Analytics

Dashboards include:

-   Provider performance
-   Prompt performance
-   Parser performance
-   Cost trends
-   Latency trends
-   Quality trends
-   Regression alerts

Charts should support daily, weekly, monthly, quarterly, and custom
ranges.

------------------------------------------------------------------------

# 10. Runtime Settings

Configurable without deployment:

-   Shadow sample rate
-   Monthly shadow budget
-   Retry limits
-   Compression threshold
-   Capture size limits
-   Feature toggles

Settings are validated before persistence.

------------------------------------------------------------------------

# 11. Search and Bulk Operations

Support bulk:

-   Replay
-   Export
-   Purge
-   Tagging
-   Re-evaluation

Bulk operations require explicit confirmation and progress reporting.

------------------------------------------------------------------------

# 12. Role-Based Access

Administrators:

-   Full access

Future roles may include:

-   Read-only analyst
-   Support engineer
-   AI reviewer

Authorization is enforced server-side.

------------------------------------------------------------------------

# 13. Alerts

Display alerts for:

-   Provider outages
-   High latency
-   Budget exhaustion
-   Capture failures
-   Regression detection
-   Elevated disagreement rates
-   Failed evaluations

Alerts link directly to affected records.

------------------------------------------------------------------------

# 14. Operational Workflows

Document workflows for:

-   Switching providers
-   Investigating failed captures
-   Reviewing parser regressions
-   Running replay
-   Purging captures
-   Responding to provider outages
-   Adjusting runtime budgets

Each workflow should identify prerequisites, expected outcomes, and
rollback steps.

------------------------------------------------------------------------

# 15. UX Requirements

-   Tables support sorting, filtering, pagination, and export.
-   Long-running tasks provide progress indicators.
-   Dangerous actions require confirmation.
-   Empty states provide guidance.
-   Errors provide actionable remediation.

------------------------------------------------------------------------

# 16. Success Criteria

The AI Operations interface is complete when administrators can
configure providers, investigate failures, replay captures, monitor
costs and quality, review long-term analytics, adjust runtime settings,
and manage the platform without direct database or cloud storage access.
