# Chapter 12 --- Deployment, Versioning, Schema Evolution, and Maintenance

## 1. Purpose

This chapter defines how the AI platform is deployed, versioned,
upgraded, and maintained over time. The objective is to allow continuous
evolution of prompts, parsers, providers, schemas, and infrastructure
without disrupting production or invalidating historical analytics.

------------------------------------------------------------------------

# 2. Deployment Principles

The deployment strategy shall:

-   Prefer incremental releases over large migrations.
-   Minimize production risk.
-   Preserve backward compatibility.
-   Allow rapid rollback.
-   Use feature flags for all significant capabilities.

------------------------------------------------------------------------

# 3. Progressive Deployment Strategy

Recommended deployment phases:

1.  Provider Registry
2.  OpenAI Adapter
3.  Capture Framework
4.  Privacy and Redaction
5.  Evaluation Framework
6.  Shadow Parsing
7.  Analytics
8.  Additional Providers
9.  A/B Testing

Each phase must be independently deployable and reversible.

------------------------------------------------------------------------

# 4. Feature Flags

Protect new functionality with runtime feature flags.

Examples:

-   ai_capture_enabled
-   ai_shadow_enabled
-   ai_replay_enabled
-   ai_provider_switching_enabled
-   ai_ab_testing_enabled

Feature flags should support gradual rollout by percentage, user tier,
or environment.

------------------------------------------------------------------------

# 5. Versioning Strategy

Version independently:

-   Prompt templates
-   Parser logic
-   Provider adapters
-   Capture schema
-   Evaluation schema
-   Analytics schema
-   Travel field specification
-   Runtime configuration
-   Application version

Each capture shall record all relevant versions.

------------------------------------------------------------------------

# 6. Backward Compatibility

Historical captures must remain readable.

Guidelines:

-   Additive schema changes are preferred.
-   Avoid removing fields.
-   Default missing values where practical.
-   Readers should support multiple schema versions simultaneously.

Never rewrite historical captures solely to satisfy new schema versions.

------------------------------------------------------------------------

# 7. Schema Evolution

Define explicit migration paths for:

-   Database schemas
-   Capture schemas
-   Evaluation schemas
-   Analytics tables

Schema changes should be documented with rationale, migration steps,
rollback instructions, and compatibility notes.

------------------------------------------------------------------------

# 8. Database Migrations

All schema changes must:

-   Be idempotent where possible.
-   Be reversible when practical.
-   Include automated migration tests.
-   Maintain adapter parity across supported database implementations.

Deployment should fail if required migrations cannot be applied safely.

Concretely, "supported database implementations" means all three
adapters this codebase maintains — `db.postgres.ts` (the canonical
implementation, source of the inferred `DatabaseAdapter` type),
`db.firebase.ts` (production on Cloud Run), and `db.memory.ts` (pg-mem,
used in tests). A new table implemented in Postgres only will pass
locally and in CI (if CI runs against Postgres) but silently break on
Firebase in production, or vice versa — this has to be caught at review
time, since nothing enforces it automatically today beyond the shared
`DatabaseAdapter` interface.

------------------------------------------------------------------------

# 9. Rollback Strategy

Every release shall include a rollback plan.

Rollback considerations:

-   Feature flags
-   Provider configuration
-   Database migrations
-   Runtime settings
-   Prompt versions

Rollback should preserve captured data and analytics.

------------------------------------------------------------------------

# 10. Maintenance Practices

Routine maintenance includes:

-   Reviewing prompt performance
-   Retiring obsolete prompt versions
-   Retiring deprecated providers
-   Refreshing ground-truth datasets
-   Updating validation rules
-   Reviewing storage growth
-   Verifying retention policies

Document maintenance frequency and ownership.

------------------------------------------------------------------------

# 11. Deprecation Policy

Deprecating a provider, parser, or prompt requires:

1.  Mark as deprecated.
2.  Notify administrators.
3.  Prevent new assignments.
4.  Preserve historical replay compatibility.
5.  Remove only after the defined deprecation period.

Historical analytics must remain available after deprecation.

------------------------------------------------------------------------

# 12. Technical Debt Management

Track debt items such as:

-   Temporary provider workarounds
-   Legacy prompt formats
-   Duplicate parser logic
-   Deprecated schemas

Review quarterly and prioritize based on operational impact.

------------------------------------------------------------------------

# 13. Extensibility

Future AI capabilities should require:

-   New provider adapter or feature module
-   Configuration updates
-   Contract tests
-   Minimal platform changes

Existing services should not require redesign to support new AI-powered
features.

------------------------------------------------------------------------

# 14. Documentation

Maintain documentation for:

-   Architecture
-   APIs
-   Schemas
-   Runtime settings
-   Operational runbooks
-   Deployment procedures
-   Migration history

Documentation should be version-controlled alongside source code.

------------------------------------------------------------------------

# 15. Success Criteria

The platform lifecycle is considered mature when:

-   New providers can be added without modifying application features.
-   Historical captures remain readable.
-   Rollbacks are predictable.
-   Feature rollouts are controlled by configuration.
-   Schema evolution is documented and testable.
-   Maintenance activities are routine rather than reactive.
