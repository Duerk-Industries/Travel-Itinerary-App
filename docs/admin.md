# Admin

## Access model

- Admin APIs live under `/api/admin/*`.
- Admin UI lives under `/admin/*` on web and is only shown to admin users.
- UI visibility is not authorization. Every admin API still requires server-side RBAC.

Bootstrap admins are granted automatically on first signup/login for:

- `bryan.duerk@gmail.com`
- `tristan.duerk@gmail.com`

Email matching is case-insensitive and normalized before comparison.

## Admin pages

| Page | Route | API responsibilities |
|---|---|---|
| Users | `/admin/users` | Search by email, name, or user ID; grant/revoke admin; change tiers with reason |
| Tiers | `/admin/tiers` | View and edit tier limits and feature entitlements |
| Features | `/admin/features` | Toggle feature flags with reason |
| User Data | `/admin/user-data` | Aggregate user counts, trip counts, AI usage, token usage, and API-call summaries |
| Audit Log | `/admin/audit-log` | Review who changed what and when |
| Billing | `/admin/billing` | Manage Premium pricing, trial, grace period, tax, promotion codes, and checkout |
| Ingestion Ops | `/admin/ingestion` | Review ingestion volume, stage outcomes, duplicate rate, retries, and estimated LLM cost |

## Admin bypass rules

Admins bypass:

- active-trip limits
- traveler limits
- AI usage limits
- past-trip end-date restrictions

Admins do not bypass:

- feature flags
- JWT authentication
- `/api/admin/*` RBAC

## Audit logging

The following mutations must write audit log entries:

- admin bootstrap grants
- user tier changes
- admin role changes
- tier limit edits
- tier entitlement edits
- feature flag edits

Each audit row stores actor, target, before state, after state, reason, and timestamp.

## User data reporting

The admin user-data API supports:

- `window=7d`
- `window=30d`
- `window=all-time`

Metrics currently exposed per user:

- current tier
- total trips visible to the user
- trip creations
- successful itinerary generations
- tokens used
- API-call summary keyed from `api-limits.yaml`

## Ingestion observability

When `feature_ingest_admin_observability` is enabled, the admin UI exposes ingestion widgets for:

- ingestion volume by source and tier
- parse success and failure rate by stage
- duplicate rate
- low-confidence rate
- average processing latency by stage
- retry count and dead-letter count
- LLM token usage and estimated cost by model/provider
- quota consumption by user and tier
- Gmail auth failure count
- webhook signature failure count
- cost per user

Use pagination for large result sets.

## Cost ledger and invoice reconciliation

Provider spend is settled per attempt in `provider_cost_ledger` (see the [analytics plan, Phase 3](implementation-plans/analytics-upgrade.md#phase-3-cost-metering-performance-monitoring-and-metricsts-fixes)).

- `GET /api/admin/costs/ledger?month=YYYY-MM` returns an aggregate monthly report:
  - totals by provider and by feature;
  - attribution and pricing coverage;
  - median/p95 direct cost per user;
  - reconciliation against any recorded invoices.

  Add `sharedCostUsd` (and optionally `activeAccounts`) to include the `allocation_v1` shared-cost split. No user IDs are returned.
- `PUT /api/admin/costs/invoices/:provider/:month` with `{ invoicedAmount, creditsAmount?, currency?, fxRateToUsd?, notes?, reason }` records a provider invoice and writes a `PROVIDER_INVOICE_RECORDED` audit entry. Amounts are in the invoice currency; `fxRateToUsd` must be 1 for USD.
- Unknown-priced attempts are counted separately and never treated as $0. Fix them by adding the provider or model price to `server/config/api-limits.yaml`.
- `GET /api/admin/metrics` now also returns `counterSeries` (per-label counters) and `timings` (latency histograms with p50/p95). `/metrics` exports the same data as Prometheus counters and histograms.
