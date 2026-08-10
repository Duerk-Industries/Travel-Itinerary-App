# Feature Flags

## Purpose

Feature flags are deployment controls. Tiers are entitlement controls. A flag can enable a code path globally, but a user still needs the correct tier entitlement and must remain within any configured limits.

## Precedence

Requests are evaluated in this order:

1. RBAC and authentication
2. Tier entitlement
3. Feature flag
4. Usage-limit check

For admin APIs, RBAC must always pass. For product features, the backend remains authoritative even if the UI hides or shows controls.

## Runtime model

- YAML files seed defaults only.
- Database rows are the runtime truth.
- Admin edits update the database, not YAML.
- Current flag scope is a single deployment-wide environment per database.

## Current flags

| Flag | Meaning |
|---|---|
| `ai_itinerary_generation` | AI itinerary generation |
| `csv_export` | CSV exports |
| `car_rentals` | Car rental tracking |
| `trip_sharing` | Trip sharing |
| `trip_following` | Trip following |
| `cost_tracking` | Expense tracking |
| `multiple_groups` | Multi-group support |
| `trip_creation` | Trip creation |
| `feature_ingest_manual_upload` | Phase 1 manual upload, parse, review, assign/delete |
| `feature_ingest_forwarded_mailbox` | Phase 2 forwarded mailbox ingestion |
| `feature_ingest_gmail_import` | Phase 3 Gmail OAuth search/import |
| `feature_ingest_admin_observability` | Admin ingestion metrics and dashboard widgets |
| `feature_ingest_local_virus_scan_stub` | Local/test virus-scan no-op path |
| `itinerary_reactions` | Up/down vote reactions on itinerary detail rows |
| `itinerary_item_kinds` | Typed itinerary detail rows (place / note / checklist) and the + menu UI |
| `merchant_category_lookup` | Merchant category lookup via Nominatim |
| `expense_import_plaid` | Master switch for optional Plaid bank-link and expense import |
| `expense_import_plaid_link` | Allow new connections through Plaid Link's React Native SDK |
| `expense_import_plaid_sync` | Allow manual and background Transactions synchronization |
| `expense_import_plaid_review_queue` | Show the per-user imported-transaction review queue |
| `expense_import_plaid_assignment` | Allow explicit assignment of a candidate to a WanderBunnies expense |
| `expense_import_plaid_webhooks` | Process normal Plaid sync webhooks; revocation/deletion handling remains mandatory |
| `expense_import_plaid_auto_category` | Show Plaid category suggestions for user confirmation |

## Ingestion note

The ingestion feature is rolled out in phases, and the review queue can remain available even when a specific intake path is disabled. Intake-path flags control how new documents enter the system. The backend remains authoritative and returns `403` when a disabled ingestion route is called.

## Important rule

Flags never grant access by themselves. If a flag is on but the user's tier disallows the feature, access is still denied.

### Financial-data flag safety

The `expense_import_plaid*` family is fail-closed: a missing database row is treated as disabled
by the Plaid integration, even though the general flag helper remains fail-open for backward
compatibility. Every flag is seeded `false`. Turning off sync, review, assignment, or the normal
webhook path must not disable authenticated disconnect, Plaid `/item/remove`, or required
revocation/account-deletion cleanup.
