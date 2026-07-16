# Chapter 7 --- Security, Privacy, Compliance, and Retention

## 1. Purpose

This chapter defines the security architecture for the AI platform. The
objectives are to prevent disclosure of sensitive information, enforce
least-privilege access, ensure regulatory compliance, and provide
auditable operations while maintaining developer productivity.

------------------------------------------------------------------------

# 2. Security Principles

The platform shall follow these principles:

-   Privacy by design
-   Least privilege
-   Defense in depth
-   Secure defaults
-   Explicit allowlists over deny lists
-   Immutable audit trails
-   Separation of duties

------------------------------------------------------------------------

# 3. Threat Model

The platform must defend against:

-   Unauthorized access to AI captures
-   Exposure of raw PII
-   Prompt injection
-   Malicious uploaded documents
-   Credential leakage
-   Replay abuse
-   Cross-tenant data exposure
-   Privilege escalation
-   Accidental production data disclosure
-   Data exfiltration through logs

Every new AI feature should be evaluated against this threat model
before release.

------------------------------------------------------------------------

# 4. Authentication and Authorization

All AI Operations functionality requires administrator authorization.

Protected capabilities include:

-   Provider configuration
-   Capture browser
-   Replay
-   Analytics
-   Runtime settings
-   Capture download
-   Purge operations

Administrative actions shall use the existing `requireAdmin` middleware
and server-side authorization checks. Client-side restrictions alone are
insufficient.

------------------------------------------------------------------------

# 5. Production Privacy

Production AI capture must never contain raw PII.

Only allowlisted structured fields may be persisted.

Production capture stores:

-   anonymousUserId
-   correlation identifiers
-   provider/model metadata
-   latency
-   token usage
-   cost
-   validation results
-   quality metrics
-   normalized approved fields

Production capture must never store:

-   raw email bodies
-   raw PDFs
-   original uploaded files
-   passport numbers
-   payment information
-   authentication tokens
-   cookies
-   secrets
-   free-form traveler notes
-   raw prompts containing PII

------------------------------------------------------------------------

# 6. Redaction and Anonymization

Production serialization uses two layers:

1.  Structural allowlist
2.  Redaction pass for approved free-text fragments

User identifiers are replaced with stable salted hashes.

Hash salts shall be retrieved from secure configuration and never
hard-coded.

Changing the salt creates a deliberate re-anonymization boundary.

**The redaction pass in layer 2 is best-effort, not a compliance
guarantee, and must be documented as such.** Regex/heuristic PII
detection has real false-negative rates — it cannot reliably prove a
blob of free text contains no name, address, or similar. This is why
layer 1 (the structural allowlist) is the actual enforcement mechanism:
freeform fields that commonly carry PII (traveler notes, raw email
bodies, raw extracted text) are excluded from production capture by
construction, not included-then-redacted. Layer 2 only ever runs on the
narrow set of free-text fragments the allowlist already decided are
safe enough to capture in redacted form (e.g. a short extracted-text
excerpt for evaluation context) — it is a second safety net on already-
approved content, not the primary defense. If this data path ever needs
to meet a specific compliance bar (e.g. GDPR data-subject requests),
that requires an explicit follow-up decision before shipping, not an
assumption baked into this plan.

------------------------------------------------------------------------

# 7. Secrets Management

All credentials must be retrieved through the existing secure
configuration mechanism.

Requirements:

-   No secrets committed to source control
-   No secrets written to logs
-   No secrets returned through APIs
-   Provider health endpoints expose readiness only

Secret rotation should occur without code changes.

------------------------------------------------------------------------

# 8. Encryption

Data in transit:

-   HTTPS/TLS
-   Secure provider APIs
-   Signed URLs for downloads

Data at rest:

-   Cloud provider managed encryption
-   Database encryption
-   Private storage buckets

Administrative downloads should use short-lived signed URLs.

------------------------------------------------------------------------

# 9. Storage Isolation

Production storage shall use dedicated prefixes:

``` text
production/
admin/
testing/
replay/
analytics/
```

Separate prefixes enable independent:

-   IAM policies
-   Lifecycle rules
-   Audit controls
-   Retention policies

------------------------------------------------------------------------

# 10. Retention

Default policies:

  Data Class                Retention
  -------------------- --------------
  Production Capture          30 days
  Admin Capture            Indefinite
  Test Capture             Indefinite
  Replay                 Configurable
  Analytics                Indefinite

Administrative purge tools shall support deletion by:

-   feature
-   provider
-   date
-   user
-   capture ID

Every purge operation must create an immutable audit record.

Any new database table this platform introduces (`ai_provider_config`,
`admin_settings`, analytics tables in Chapter 9, etc.) must be
implemented across all three DB adapters this codebase supports
(`db.postgres.ts`, `db.firebase.ts`, `db.memory.ts`) — the
`DatabaseAdapter` interface inferred from `db.postgres.ts` is the source
of truth. A table that only exists in Postgres silently breaks on the
Firebase deployment target and in the in-memory test adapter.

------------------------------------------------------------------------

# 11. Audit Logging

Audit every administrative action including:

-   Provider changes
-   Runtime configuration
-   Replay execution
-   Capture downloads
-   Purges
-   Budget changes
-   Shadow configuration
-   Security setting changes

Audit records should include:

-   user
-   timestamp
-   action
-   target
-   result

Audit logs are append-only.

------------------------------------------------------------------------

# 12. Secure Replay

Replay uses captured metadata but never modifies production records.

Replay outputs are isolated from production storage.

Replay inherits current authorization and auditing requirements.

------------------------------------------------------------------------

# 13. Compliance Considerations

The platform should support future compliance initiatives by:

-   minimizing stored personal data
-   separating operational telemetry from user records
-   enforcing configurable retention
-   maintaining immutable audit logs
-   supporting secure deletion

Avoid storing information that is unnecessary for evaluation.

------------------------------------------------------------------------

# 14. Security Testing

Required testing includes:

-   Authorization tests
-   Privilege escalation tests
-   Secret leakage tests
-   Redaction validation
-   Anonymization verification
-   Signed URL validation
-   Replay authorization
-   Purge authorization
-   Prompt injection resilience
-   Malicious upload handling

Security tests should execute as part of continuous integration where
practical.

------------------------------------------------------------------------

# 15. Operational Runbooks

Document response procedures for:

-   Provider credential compromise
-   Storage bucket misconfiguration
-   Unexpected PII detection
-   Replay abuse
-   Excessive download activity
-   Budget exhaustion
-   Capture storage failures

Each runbook should define:

-   detection
-   immediate containment
-   recovery
-   verification
-   post-incident review

------------------------------------------------------------------------

# 16. Success Criteria

The security implementation is complete when:

-   Production AI capture contains no raw PII.
-   Administrative access is fully enforced server-side.
-   Every privileged action is audited.
-   Secrets never appear in logs or APIs.
-   Retention policies are automated.
-   Security failures are observable and actionable.
