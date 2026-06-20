# Stripe Premium Integration Implementation Plan

Last reviewed: June 19, 2026

## Objective

Add Stripe Billing to WanderBunnies so authenticated users can purchase and manage a fixed-price Premium subscription while the backend remains the authority for entitlements.

Recommended launch architecture:

- Stripe-hosted Checkout for initial monthly or annual subscription signup
- Stripe Customer Portal for payment-method changes, invoices, cancellation, and monthly/annual switching
- Web checkout only for the initial release
- Verified Stripe webhooks as the source of paid subscription lifecycle changes
- Separate local billing records from the existing `user_tiers` history
- A single entitlement reconciliation service that maps billing state to the existing `premium` tier
- Existing administrator, `pro`, seeded, and intentional manual override behavior preserved

## Confirmed Product Decisions

1. **Launch platform**
   - Initial purchases are web checkout only.
   - iOS and Android consume Premium entitlements but do not display an external Stripe purchase action.
   - Subscription management from native apps can be added separately after storefront-policy review.

2. **Prices**
   - Monthly: USD $5.00.
   - Annual: USD $35.00.
   - Both are flat-rate recurring Prices under one `WanderBunnies Premium` Product.

3. **Free trial**
   - New subscriptions receive a 14-day trial.
   - Pricing and trial duration are configurable in the WanderBunnies admin interface.
   - Checkout should collect a payment method before the trial begins.

4. **Failed-payment grace period**
   - Premium remains active for one month after the first transition to `past_due`.
   - Proposed implementation definition: 30 days from the first failed invoice that begins the unresolved delinquency period.
   - A successful invoice resets the delinquency timestamp.

5. **Cancellation**
   - Customer Portal cancellation is at period end only.
   - Premium remains active through the paid period.

6. **Refunds and disputes**
   - Refunds immediately revoke Stripe-managed Premium.
   - Disputes immediately revoke Stripe-managed Premium.
   - Revocation does not affect protected seeded, manual, or administrator access.

7. **Manual and seeded access**
   - Seeded and manual Premium grants are independent of Stripe.
   - Stripe cancellation, refund, delinquency, or dispute events must not overwrite these grants.

8. **Tax and promotions**
   - Stripe Tax is enabled at launch.
   - Promotion codes are enabled at launch.

9. **Subscription ownership**
   - Premium is initially purchased per individual user.
   - The schema and entitlement service must support a future family-scoped subscription without a destructive migration.

10. **Plan switching**
    - Monthly and annual subscribers may switch between the approved Prices through the Customer Portal.
    - Monthly to annual switches immediately with Stripe-calculated proration.
    - Annual to monthly switches at the end of the current annual period.

11. **Past-due timing**
    - “One month” means exactly 30 elapsed days from the first unresolved failed invoice.

12. **Refund scope**
    - A full refund of the applicable subscription invoice immediately revokes Stripe-managed Premium.
    - A partial refund does not automatically revoke Premium; it creates an operator-visible audit/alert event.

13. **Dispute resolution**
    - A newly opened dispute immediately revokes Stripe-managed Premium.
    - If the dispute closes in WanderBunnies' favor, Premium restores automatically when the latest Subscription and Invoice state otherwise qualifies.
    - If the dispute is lost, Premium remains revoked.

14. **Promotion ownership**
    - Coupons and Promotion Codes are created and managed in Stripe Dashboard.
    - WanderBunnies admin configuration only controls whether approved Stripe promotion codes are accepted by Checkout.

15. **Future family capacity**
    - The initial schema supports family coverage.
    - A later product decision will define eligible relationships, maximum covered users, and whether covered family members require separate Stripe Customers.

## Phase 1: Billing Domain And Configuration

### Dependencies

- Add the official `stripe` Node package to `server/package.json`.
- Update both root and standalone server lockfiles consistently so Cloud Run `npm ci` succeeds.
- Do not add Stripe React Native SDK dependencies for the hosted Checkout approach.

### Environment configuration

Add typed accessors and validation for:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PREMIUM_PRODUCT_ID`
- `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` only if using API-created portal configurations
- `STRIPE_BILLING_ENABLED`
- `STRIPE_CHECKOUT_SUCCESS_URL`
- `STRIPE_CHECKOUT_CANCEL_URL`
- `STRIPE_PORTAL_RETURN_URL`

Files:

- `server/src/env.ts`
- `server/src/config/stripeBilling.ts` (new)
- `.env.example`
- deployment documentation
- `scripts/deploy-api.ps1` secret mappings/redaction behavior

Rules:

- Secret and webhook keys must come from Secret Manager in production.
- The Product ID and safe URLs can be normal environment variables.
- Active Price IDs, amounts, trial duration, grace duration, tax, and promotion settings belong in the database-managed billing configuration after initial bootstrap.
- Startup must fail clearly when billing is enabled but required settings are missing.
- Test and live keys/IDs must never be mixed. Validate that key and Price ID modes agree where practical.

### Stripe client wrapper

Create:

- `server/src/billing/stripeClient.ts`

Responsibilities:

- Construct one lazy Stripe client.
- Pin the API version intentionally.
- Expose a test seam for a fake Stripe client.
- Prevent Stripe initialization when billing is disabled.
- Centralize Stripe error normalization and safe logging.

## Phase 2: Persistent Billing Model

Stripe state must be stored separately from `user_tiers`. Do not use the current tier row as the subscription ledger.

### Recommended records

#### `billing_customers`

- `user_id` (unique)
- `stripe_customer_id` (unique)
- `email_snapshot`
- `livemode`
- `created_at`
- `updated_at`

#### `billing_subscriptions`

- `stripe_subscription_id` (unique)
- `user_id`
- `subscription_scope` (`individual` initially; reserved `family`)
- `scope_owner_id` (the user ID initially; future family/group owner ID)
- `stripe_customer_id`
- `stripe_price_id`
- `plan_key` (`premium_monthly` or `premium_annual`)
- `status`
- `livemode`
- `cancel_at_period_end`
- `cancel_at`
- `current_period_start`
- `current_period_end`
- `trial_end`
- `ended_at`
- `latest_invoice_id`
- `past_due_since`
- `access_revoked_at`
- `access_revocation_reason`
- `dispute_id`
- `refunded_at`
- `last_stripe_event_created`
- `last_synced_at`
- `created_at`
- `updated_at`

#### `billing_plan_config`

- `plan_key` (`premium_monthly`, `premium_annual`)
- `stripe_product_id`
- `active_stripe_price_id`
- `unit_amount_cents`
- `currency`
- `interval`
- `trial_days`
- `past_due_grace_days`
- `automatic_tax_enabled`
- `promotion_codes_enabled`
- `is_checkout_enabled`
- `livemode`
- `version`
- `updated_by`
- `updated_at`

Initial values:

- `premium_monthly`: 500 cents, monthly, 14 trial days
- `premium_annual`: 3500 cents, yearly, 14 trial days
- past-due grace: 30 days
- automatic tax: enabled
- promotion codes: enabled

#### `billing_price_history`

- `stripe_price_id` (unique)
- `plan_key`
- `stripe_product_id`
- `unit_amount_cents`
- `currency`
- `interval`
- `livemode`
- `active_for_new_checkout`
- `created_by`
- `created_at`
- `retired_at`

Historical Price records are required because Stripe Prices are immutable and existing subscriptions or delayed events can continue referencing retired Prices.

#### `billing_subscription_members`

Future-family plumbing:

- `stripe_subscription_id`
- `covered_user_id`
- `relationship` (`owner` initially; future `family_member`)
- `effective_from`
- `effective_to`
- unique active membership per subscription/user

For individual launch subscriptions, create one owner membership. This lets entitlement resolution later expand to family members without changing the Stripe subscription model.

#### `stripe_webhook_events`

- `stripe_event_id` (unique)
- `event_type`
- `stripe_object_id`
- `livemode`
- `event_created`
- `processing_status` (`pending`, `processed`, `ignored`, `failed`)
- `attempt_count`
- `last_error`
- `received_at`
- `processed_at`

Do not store complete webhook payloads indefinitely unless there is a defined retention and privacy policy. Store only the fields needed for diagnostics, or retain encrypted payloads for a short period.

### Database implementation

Add matching operations to:

- `server/src/db.postgres.ts`
- `server/src/db.firebase.ts`
- `server/src/db.memory.ts`
- `server/src/db.ts`
- `server/src/types.ts`

Add SQL migrations and rollback files under `server/migrations/`.

Update:

- migration drift guards
- account export behavior
- account deletion behavior
- Firestore indexes if queries require them
- test database seed/reset helpers

Required repository operations:

- get/create billing customer by user ID
- get billing customer by Stripe customer ID
- upsert subscription from Stripe snapshot
- list active/current subscriptions for a user
- list covered users for a subscription
- add/end subscription coverage
- get/update billing plan configuration
- register and retire Stripe Price history
- claim webhook event idempotently
- mark event processed/failed
- list stale subscriptions for reconciliation

All adapters must enforce the same uniqueness and idempotency behavior.

## Phase 3: Entitlement Precedence And Reconciliation

Create:

- `server/src/billing/subscriptionEntitlementService.ts`

This must be the only billing code allowed to change a user's tier.

### Recommended precedence

1. Admin role forces `pro`.
2. Explicit admin override remains authoritative.
3. Permanent seeded/manual grants remain authoritative if that policy is confirmed.
4. Eligible Stripe subscription grants `premium`.
5. Otherwise the user is `free`.

Because `user_tiers` currently allows one active row and closes the old row in `setUserTier`, add a method that can inspect the current tier source before applying a billing transition.

Recommended new operation:

```ts
reconcileUserTierFromBilling(userId, billingDecision, context)
```

It should:

- be transactional
- no-op if the effective tier is already correct
- never downgrade an admin
- never overwrite a protected manual override
- write `source = 'billing'` for Stripe-controlled transitions
- write an audit-log record containing old tier, new tier, Stripe subscription ID, event ID, and reason
- avoid logging secrets or full Stripe payloads

### Subscription status mapping

Proposed initial mapping:

| Stripe status | Premium access |
|---|---|
| `trialing` | Yes, only if trials are enabled |
| `active` | Yes |
| `past_due` | Yes for 30 days from `past_due_since`, then no |
| `incomplete` | No |
| `incomplete_expired` | No |
| `unpaid` | No |
| `paused` | No |
| `canceled` | No after the effective access end |

For cancellation at period end, an `active` subscription with `cancel_at_period_end = true` remains Premium until it actually becomes canceled.

Refund/dispute overrides:

- A full refund of the applicable subscription invoice sets `access_revoked_at` immediately and overrides an otherwise `active` or `trialing` Stripe status.
- A partial refund records an audit/alert event but does not automatically change entitlement.
- An opened dispute sets `access_revoked_at` immediately and overrides an otherwise eligible Stripe status.
- A dispute won by WanderBunnies clears the dispute override and automatically restores Premium if the latest Subscription and Invoice state is eligible.
- A lost dispute keeps the dispute override and Premium remains revoked.
- Protected manual, seeded, and administrator grants remain effective.
- Refund reversals must retrieve current Charge, Invoice, and Subscription state before restoring access.

## Phase 4: Billing Service

Create:

- `server/src/billing/billingService.ts`
- `server/src/billing/billingDtos.ts`

Responsibilities:

### Customer creation/reuse

- Find the local Stripe Customer ID for the authenticated user.
- If absent, create a Stripe Customer with:
  - verified/current email
  - WanderBunnies `userId` metadata
  - environment metadata
- Persist the mapping.
- If concurrent requests race, retain one local mapping and safely handle the extra Stripe Customer.

### Checkout Session creation

Inputs:

- authenticated user
- approved plan key, not an arbitrary client Price ID
- client-generated idempotency key
- validated return context

Behavior:

- Resolve plan key to a server-configured Price ID.
- Reject unsupported or inactive plans.
- Check local billing state, then retrieve current Stripe state if needed.
- If an active/trialing/past-due subscription already exists, return a portal URL or a structured `SUBSCRIPTION_ALREADY_EXISTS` response instead of creating a duplicate.
- Reuse the stored Stripe Customer.
- Create a Checkout Session with:
  - `mode: 'subscription'`
  - approved Price ID and quantity 1
  - customer ID
  - `client_reference_id = userId`
  - Session metadata with `userId` and `planKey`
  - Subscription metadata with `userId` and `planKey`
  - controlled success/cancel URLs
  - `subscription_data.trial_period_days` from the active admin billing configuration (initially 14)
  - payment method collection before trial start
  - `automatic_tax.enabled = true`
  - `allow_promotion_codes = true`
- Return only the hosted Session URL and safe metadata.

Never trust:

- client amount
- client currency
- client Product ID
- arbitrary return URL
- client-supplied user ID

### Customer Portal Session creation

- Require authentication.
- Look up the caller's Stripe Customer ID.
- Create an ephemeral portal session with a controlled return URL.
- Return the portal URL.
- Never accept a Stripe Customer ID from the client.

### Billing status

Expose a normalized status DTO:

- effective tier
- billing-managed boolean
- plan (`monthly`, `annual`, or null)
- subscription status
- current period end
- cancel-at-period-end
- grace-period state
- whether checkout is available on this platform/storefront
- whether portal management is available

## Phase 5: HTTP Routes

Create:

- `server/src/routes/billingRoutes.ts`
- `server/src/routes/stripeWebhookRoutes.ts`

### Authenticated billing routes

- `GET /api/billing/status`
- `GET /api/billing/plans`
- `POST /api/billing/checkout-session`
- `POST /api/billing/portal-session`
- Optional: `POST /api/billing/refresh` for an explicit Stripe reconciliation after returning from Checkout

Use:

- existing `authenticate`
- Zod DTO parsing
- rate limiting
- request IDs
- structured error codes
- no secret-bearing responses

Mount authenticated routes after normal JSON parsing.

### Webhook route

- `POST /api/billing/webhooks/stripe`

Mount this route before `express.json()` in `server/src/app.ts`, like the Mailgun route, using `express.raw({ type: 'application/json' })`.

The webhook endpoint must:

1. Read the raw body.
2. Verify `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`.
3. Reject invalid signatures.
4. Claim the Event ID idempotently.
5. Dispatch only supported event types.
6. Retrieve the latest Subscription from Stripe before applying state when event ordering could matter.
7. Upsert the local subscription snapshot.
8. Reconcile the user's tier.
9. Mark the event processed or failed.

### Initial event set

Required:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`

Optional based on product decisions:

- `customer.subscription.trial_will_end`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

### Processing model

Recommended production design:

- Verify and persist/claim the event synchronously.
- Enqueue processing in a durable Cloud Tasks or Pub/Sub-backed worker.
- Return `2xx` quickly.
- Retry failed processing with bounded backoff and dead-letter visibility.

Pragmatic first milestone:

- Process the small subscription update synchronously after idempotent claim.
- Keep the handler bounded and return non-`2xx` on transient failures so Stripe retries.
- Add the durable queue before significant production volume.

Do not rely on Cloud Run continuing arbitrary background work after the response.

## Phase 6: Reconciliation And Operational Recovery

Add:

- `server/src/billing/subscriptionReconciliationService.ts`
- an authenticated internal route or scheduled job entry point

Behavior:

- Query local subscriptions not synced recently.
- Retrieve current Stripe Subscription state.
- Repair local records and entitlements.
- Detect Stripe subscriptions with missing local user mappings.
- Detect multiple active subscriptions for one user.
- Produce structured metrics and audit records.

Recommended schedule:

- Daily full reconciliation
- More frequent reconciliation for `past_due`, `incomplete`, or recently changed subscriptions

Add admin visibility for:

- subscription status
- plan
- current period end
- cancel-at-period-end
- last sync
- last webhook error
- duplicate/orphan warnings

Avoid exposing full payment details in WanderBunnies.

### Admin billing configuration

Add authenticated admin-only routes:

- `GET /api/admin/billing/config`
- `PATCH /api/admin/billing/config`
- `POST /api/admin/billing/plans/:planKey/price`
- `GET /api/admin/billing/prices`
- `POST /api/admin/billing/reconcile/:userId`

Admin capabilities:

- edit trial length
- edit past-due grace days
- toggle Checkout availability
- toggle automatic tax
- toggle acceptance of Stripe Dashboard-managed promotion codes
- set a proposed monthly or annual amount
- publish a new Stripe Price for the selected plan
- view active and historical Price IDs
- view whether configuration belongs to test or live mode

Price update workflow:

1. Admin enters a new amount.
2. Server validates currency, interval, minimum amount, permissions, and current Stripe mode.
3. Server creates a new recurring Stripe Price under the configured Premium Product.
4. Server writes `billing_price_history`.
5. Server atomically marks the new Price active for future Checkout Sessions.
6. The previous Price is retained in history and may optionally be made inactive in Stripe for new purchases.
7. Existing subscriptions remain on the old Price unless changed through the Customer Portal or a separately approved migration.
8. Audit log records before/after values and Stripe Price IDs.

Trial changes apply only to newly created subscriptions. Existing trials must not be silently modified.

The Customer Portal configuration must implement:

- monthly to annual: immediate switch with Stripe-calculated proration
- annual to monthly: scheduled change at current period end
- cancellation: current period end only

Admin UI must show this consequence before publishing:

- price changes do not automatically migrate existing subscribers
- trial changes affect new subscriptions only
- portal plan switching uses the currently approved monthly/annual Price catalog

## Phase 7: Client Integration

Create:

- `app/hooks/useBillingStatus.ts`
- `app/utils/billing.ts`
- `app/components/PremiumSubscriptionPanel.tsx`

Extend account/profile state with normalized billing status rather than inferring billing from `costTracking`.

### Account UI

Add a Billing or Premium section showing:

- current plan
- subscription status
- renewal/access end date
- cancellation-pending state
- payment problem state
- Premium benefits

Actions:

- `Upgrade to Premium`
- monthly/annual selector if both exist
- `Manage subscription`
- `Fix payment method`
- retry/refresh status after returning from Stripe

Web-only purchase behavior:

- Render `Upgrade to Premium` and the monthly/annual selector on web.
- Native apps may show current Premium status and benefits but must not show the Stripe Checkout purchase button in the initial release.
- The server must still reject Checkout Session creation from unsupported client contexts when practical; UI hiding alone is not a policy control.

### URL opening

- Web: navigate to the Stripe hosted URL.
- Native: open Checkout/Portal in the external browser using the approved Expo browser/linking flow.
- Do not render external purchase calls to action where store policy does not allow them.
- Return through controlled HTTPS universal/app links, with a web fallback page.
- Refresh billing status when the app becomes active again.

### Checkout result pages

Add web routes/screens for:

- checkout success/pending
- checkout canceled
- portal return

These pages may poll/refresh billing status but must never grant Premium themselves.

### Mobile storefront policy

Add a purchase-availability decision layer:

- platform
- storefront/region where available
- remote feature flag
- app build channel

This keeps purchase presentation separate from entitlement consumption. Users who bought Premium on web should still receive Premium in the app even when the app cannot show a Stripe purchase link.

## Phase 8: Account Lifecycle And Privacy

### Account export

Include safe billing information:

- Stripe Customer ID, if policy permits
- subscription ID
- plan
- status
- period dates
- cancellation state

Do not export payment method details or webhook secrets.

### Account deletion

Define and implement one policy:

- cancel Stripe subscription immediately, then delete/anonymize local billing records; or
- schedule cancellation at period end and delay full account deletion

Recommended: require confirmation, cancel immediately, then delete/anonymize local identifiers while retaining legally required financial records in Stripe.

Handle Stripe API failure without leaving a silently active paid subscription.

### Email changes

- Keep Stripe Customer email synchronized after verified primary-email changes.
- Do not use email as the durable subscription identity; use local user ID metadata and persisted Stripe IDs.

## Phase 9: Security, Logging, And Metrics

Add metrics for:

- Checkout Session creation success/failure
- portal session creation success/failure
- webhook signature failure
- duplicate webhook
- webhook processing failure
- entitlement grant/revoke
- reconciliation repair
- duplicate active subscriptions
- orphaned Stripe customers/subscriptions

Security requirements:

- server-only secret key
- raw-body signature verification
- no arbitrary Price IDs or return URLs
- authentication on all customer/portal routes
- rate limits on session creation
- event idempotency
- audit records for entitlement changes
- redact Stripe request/response objects from logs
- no card/payment method data in WanderBunnies storage

Add Sentry context using IDs and event type only, never sensitive payload content.

## Phase 10: Tests

### Unit tests

- environment validation
- plan-key to active database Price mapping
- initial monthly amount is 500 cents
- initial annual amount is 3500 cents
- initial trial length is 14 days
- initial past-due grace is 30 days
- admin Price publication creates a new immutable Stripe Price
- old Prices remain recognized but are unavailable for new Checkout
- trial/config changes apply only to new subscriptions
- Stripe status to Premium decision
- `past_due` retains Premium before day 30
- unresolved `past_due` loses Premium at day 30
- successful payment clears `past_due_since`
- refund revokes Stripe-managed Premium immediately
- partial refund does not revoke Premium
- dispute revokes Stripe-managed Premium immediately
- won dispute restores otherwise-eligible Premium automatically
- lost dispute keeps Premium revoked
- protected seeded/manual access survives refund, dispute, and cancellation
- entitlement precedence
- duplicate subscription prevention
- Checkout parameter construction
- portal parameter construction
- Stripe error mapping
- webhook event dispatch
- out-of-order event handling
- protected admin/manual/seeded tiers

### Route tests

- authentication required
- invalid plan rejected
- arbitrary Price ID rejected
- Checkout URL returned
- web client context accepted
- native purchase context rejected or marked unavailable
- existing subscriber redirected to management flow
- portal session belongs only to authenticated user
- raw webhook body preserved
- invalid signature rejected
- duplicate Event ID is a no-op
- supported events update billing state
- unsupported events are acknowledged and ignored

### Database contract tests

Run the same billing repository behavior against:

- Postgres/pg-mem
- Firebase emulator/fake adapter
- memory adapter

Cover unique customer/subscription IDs, event claiming, concurrent updates, and current-subscription queries.

### Lifecycle integration tests

Using Stripe sandbox, Stripe CLI, and Test Clocks:

- new monthly signup
- new annual signup
- duplicate Checkout request
- successful renewal
- failed renewal
- payment authentication required
- payment method fixed through portal
- cancel at period end
- cancellation reversal
- monthly/annual switch and proration
- trial start/end if enabled
- webhook duplicate delivery
- webhook out-of-order delivery
- full refund
- partial refund
- dispute
- dispute won automatic restoration
- dispute lost continued revocation
- account deletion
- reconciliation repairs missing webhooks

### Client tests

- free user sees appropriate upgrade UI
- web user sees `$5/month` and `$35/year` from server configuration
- native user does not see the Stripe purchase action
- Premium user sees management UI
- cancellation-pending messaging
- payment-failure messaging
- platform/storefront purchase availability
- web/native URL opening
- status refresh on app foreground
- no client code contains Stripe secret configuration
- admin can edit trial and grace days
- admin publishing a price requires confirmation
- admin UI never sends floating-point currency values
- historical Prices remain visible after a new Price is published

## Phase 11: Deployment And Rollout

### Feature flags

Add:

- `stripe_billing`
- `stripe_checkout`
- `stripe_customer_portal`

Suggested rollout:

1. Deploy schema and disabled backend code.
2. Configure sandbox secrets and Prices.
3. Register sandbox webhook.
4. Run lifecycle tests.
5. Enable billing for admin/test accounts.
6. Enable web checkout for a small cohort.
7. Monitor webhook failures and reconciliation drift.
8. Configure live Stripe objects and secrets.
9. Run an authorized live subscription/refund test.
10. Enable production web checkout.
11. Keep native checkout disabled for the initial release.

### Required documentation

- local Stripe CLI setup
- sandbox test instructions
- Cloud Run secret setup
- Stripe Dashboard webhook setup
- incident runbook for webhook failures
- duplicate subscription cleanup
- manual reconciliation procedure
- refund/cancellation support procedure
- Price migration procedure

## Suggested File Map

New server files:

- `server/src/config/stripeBilling.ts`
- `server/src/billing/stripeClient.ts`
- `server/src/billing/billingDtos.ts`
- `server/src/billing/billingService.ts`
- `server/src/billing/subscriptionEntitlementService.ts`
- `server/src/billing/subscriptionReconciliationService.ts`
- `server/src/routes/billingRoutes.ts`
- `server/src/routes/stripeWebhookRoutes.ts`
- `server/__tests__/billing*.test.ts`
- `server/migrations/*_add_stripe_billing.sql`
- matching rollback migration

Modified server files:

- `server/src/app.ts`
- `server/src/db.ts`
- `server/src/db.postgres.ts`
- `server/src/db.firebase.ts`
- `server/src/db.memory.ts`
- `server/src/types.ts`
- `server/src/env.ts`
- `server/src/services/entitlementService.ts`
- account export/deletion modules
- admin routes/DTOs if billing status is shown
- `server/package.json`
- lockfiles

New app files:

- `app/hooks/useBillingStatus.ts`
- `app/utils/billing.ts`
- `app/components/PremiumSubscriptionPanel.tsx`
- focused billing tests

Modified app files:

- `app/App.tsx`
- `app/tabs/account.tsx`
- `app/tabs/AccountProfileManagement.tsx`
- account profile/status types
- deep-link and app-foreground handling
- optional admin billing views

### Admin UI

Add a Billing configuration section to `AdminTab`:

- monthly amount input, initialized to `$5.00`
- annual amount input, initialized to `$35.00`
- trial-days numeric input, initialized to `14`
- past-due grace-days numeric input, initialized to `30`
- automatic-tax toggle, enabled
- promotion-code toggle, enabled
- Checkout-enabled toggle
- active Stripe Product and Price IDs
- explicit `Publish new Price` confirmation
- historical Price list
- warning that existing subscriptions do not automatically move to new Prices
- sandbox/live environment badge

Use integer cents in the API and database. Do not use floating-point currency values.

Deployment/config files:

- `.env.example`
- `scripts/deploy-api.ps1`
- Cloud Run Secret Manager configuration
- feature flag YAML/seeds
- operational documentation

## Definition Of Done

- Stripe Checkout can create exactly one Premium subscription per user.
- Web Checkout launches with the current admin-configured monthly or annual Price.
- Initial catalog values are `$5/month`, `$35/year`, and a 14-day trial.
- Pricing changes create new Stripe Prices and preserve historical mappings.
- Verified webhooks grant, retain, and revoke Premium correctly.
- `past_due` retains Premium for 30 days and then revokes it if unresolved.
- Full refunds and opened disputes immediately revoke Stripe-managed Premium.
- Partial refunds do not automatically revoke Premium.
- Won disputes automatically restore Premium when the current subscription state is otherwise eligible.
- Admin, `pro`, seeded, and protected manual access cannot be accidentally downgraded.
- Customer Portal supports the approved management actions.
- Customer Portal permits switching between current monthly and annual Prices and only period-end cancellation.
- Stripe Tax and promotion codes are enabled.
- Duplicate and out-of-order events are safe.
- Missed events are repaired by reconciliation.
- Account export/deletion behavior is defined and tested.
- Web, Android, and iOS present policy-compliant subscription UI.
- Initial Stripe purchase actions appear on web only.
- Individual subscription records include forward-compatible family coverage plumbing.
- Stripe sandbox lifecycle tests and one authorized live test pass.
- Secrets are only server-side and managed through Secret Manager.
- Metrics, alerts, audit logs, and support runbooks are available.

## Primary References

- Stripe subscriptions: https://docs.stripe.com/billing/subscriptions/build-subscriptions
- Stripe subscription webhooks: https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe webhook security and idempotency: https://docs.stripe.com/webhooks
- Stripe Customer Portal: https://docs.stripe.com/customer-management/configure-portal
- Stripe Billing testing: https://docs.stripe.com/billing/testing
- Stripe Test Clocks: https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage
- Stripe mobile digital goods: https://docs.stripe.com/mobile/digital-goods
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play payments policy: https://support.google.com/googleplay/android-developer/answer/10281818
