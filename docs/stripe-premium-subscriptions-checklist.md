# WanderBunnies Stripe Premium Subscription Checklist

Last reviewed: June 20, 2026

## Important Before Launch

- [x] Stripe purchases are web-only at launch.
  - Web subscriptions can use Stripe Checkout normally.
  - iOS digital subscriptions may use external Stripe Checkout for eligible storefronts, including the United States, but App Store rules and storefront detection still apply.
  - Google Play generally requires Play Billing for in-app digital subscriptions unless WanderBunnies enrolls in an applicable alternative-billing or external-links program.
- [x] Offer monthly and annual Premium.
- [x] Launch at USD $5/month and $35/year with a 14-day payment-method-required trial, period-end cancellation, and immediate revocation for full refunds.
- [ ] Confirm the legal business name, support email, website, privacy policy, and terms URL.
- [ ] Do not use live mode until Stripe test mode has completed the full subscription lifecycle checklist below.

## Stripe Account

- [ ] Activate the Stripe account and complete business verification.
- [ ] Add the public business details customers should see:
  - [ ] WanderBunnies business/display name
  - [ ] Support email
  - [ ] Support URL
  - [ ] Business website
  - [ ] Business address and phone, where required
- [ ] Configure the statement descriptor so charges are recognizable, for example `WANDERBUNNIES`.
- [ ] Add the payout bank account.
- [ ] Review payout timing and payout notifications.
- [ ] Enable two-step authentication for every Stripe team member.
- [ ] Give team members the minimum Stripe roles they need.
- [ ] Add WanderBunnies branding under Branding:
  - [ ] Logo/icon
  - [ ] Brand color
  - [ ] Accent color

## Product Catalog

Complete this once in test mode, then recreate or promote the equivalent configuration in live mode.

- [ ] Create one product named `WanderBunnies Premium`.
- [ ] Add a clear customer-facing description of Premium benefits.
- [ ] Assign the appropriate Stripe Tax product tax code for a SaaS/digital service after confirming it with a tax professional.
- [ ] Create an immutable recurring monthly Price:
  - [ ] Recurring interval: monthly
  - [ ] Currency: USD, unless another launch currency is required
  - [ ] Pricing model: flat rate
  - [ ] Usage type: licensed, not metered
  - [ ] Save the test Price ID
  - [ ] Save the live Price ID
- [ ] If offering annual billing, create a separate immutable annual Price:
  - [ ] Recurring interval: yearly
  - [ ] Save the test Price ID
  - [ ] Save the live Price ID
- [ ] Add a lookup key to each Price, such as:
  - [ ] `wanderbunnies_premium_monthly`
  - [ ] `wanderbunnies_premium_annual`
- [ ] Do not edit pricing assumptions in code by amount. The server should accept only approved Stripe Price IDs or lookup keys.
- [ ] Archive old Prices instead of reusing them when the amount changes.

## Checkout

- [ ] Use Stripe-hosted Checkout in `subscription` mode.
- [ ] Require the server to create Checkout Sessions. Never create subscriptions using a secret key in the Expo app.
- [ ] Configure Checkout to collect:
  - [ ] Customer email
  - [ ] Billing address if required for tax
  - [ ] Customer name if needed for receipts or tax
  - [ ] Promotion codes only if WanderBunnies intends to support them
- [ ] Configure a success URL on a controlled WanderBunnies HTTPS domain.
- [ ] Configure a cancellation URL on a controlled WanderBunnies HTTPS domain.
- [ ] Put the WanderBunnies internal user ID in `client_reference_id` and/or metadata.
- [ ] Add metadata that remains stable and non-sensitive:
  - [ ] `userId`
  - [ ] `tierKey=premium`
  - [ ] `environment=test|production`
- [ ] Do not put passwords, auth tokens, payment data, or sensitive profile data in Stripe metadata.
- [ ] Prevent duplicate active Premium subscriptions for the same WanderBunnies user.
- [ ] Reuse the existing Stripe Customer for returning users.
- [ ] Decide whether trials are enabled.
  - [ ] If enabled, choose the trial length.
  - [ ] Decide whether a payment method is required up front.
  - [ ] Decide whether a trial without a payment method should cancel or pause at trial end.

## Payment Methods

- [ ] Enable Cards.
- [ ] Enable Apple Pay and Google Pay where supported by the chosen Checkout flow.
- [ ] Review Stripe's dynamically offered payment methods rather than enabling every method indiscriminately.
- [ ] Confirm each enabled payment method supports recurring payments in the countries WanderBunnies serves.
- [ ] Disable delayed-notification payment methods unless the entitlement flow correctly handles pending payments.
- [ ] Verify the public WanderBunnies web domain for Apple Pay if the selected integration requires domain registration.

## Customer Portal

- [ ] Activate and configure the Stripe Customer Portal in test mode and live mode.
- [ ] Enable payment-method updates.
- [ ] Enable invoice-history viewing.
- [ ] Enable subscription cancellation.
- [ ] Prefer cancellation at the end of the current billing period unless the refund policy requires immediate cancellation.
- [ ] Collect cancellation reasons.
- [x] Customers may switch between monthly and annual Prices.
- [ ] If plan switching is enabled:
  - [ ] Add only approved WanderBunnies Premium Prices.
  - [ ] Choose and test proration behavior.
- [ ] Set the portal return URL to a controlled WanderBunnies HTTPS page.
- [ ] Confirm that the application creates portal sessions server-side for the authenticated user's Stripe Customer only.

## Webhook Destination

- [ ] Implement the production HTTPS endpoint before adding it in Stripe.
- [ ] The webhook route must receive the raw request body before JSON parsing.
- [ ] Verify every webhook using the Stripe signature and endpoint signing secret.
- [ ] Reject invalid signatures.
- [ ] Store processed Stripe Event IDs and make processing idempotent.
- [ ] Return a successful response quickly, then process longer work asynchronously if necessary.
- [ ] Do not rely on the Checkout success page to grant Premium.
- [ ] Add a test-mode webhook destination.
- [ ] Add a separate live-mode webhook destination.
- [ ] Subscribe only to required events, including:
  - [ ] `checkout.session.completed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
  - [ ] `invoice.paid`
  - [ ] `invoice.payment_failed`
  - [ ] `invoice.payment_action_required`
- [ ] Consider subscribing to:
  - [ ] `checkout.session.async_payment_succeeded` if delayed payment methods are enabled
  - [ ] `checkout.session.async_payment_failed` if delayed payment methods are enabled
  - [ ] `charge.refunded` if refunds should immediately affect entitlement
  - [ ] `charge.dispute.created` for operational alerts
- [ ] Store the test webhook signing secret separately from the live secret.
- [ ] Use Stripe Workbench/Event Destinations to confirm recent deliveries and retries.

## WanderBunnies Entitlement Mapping

These items are application requirements, not Stripe Dashboard settings.

- [ ] Add Stripe fields to the WanderBunnies user/billing model:
  - [ ] Stripe Customer ID
  - [ ] Stripe Subscription ID
  - [ ] Stripe Price ID
  - [ ] Subscription status
  - [ ] Current period end
  - [ ] Cancel-at-period-end state
  - [ ] Last processed Stripe Event ID or a separate event ledger
- [ ] Grant database tier `premium` only from verified server-side Stripe state.
- [ ] Keep `premium` while the subscription is in an explicitly supported state.
- [ ] Define behavior for each Stripe status:
  - [ ] `trialing`
  - [ ] `active`
  - [ ] `past_due`
  - [ ] `unpaid`
  - [ ] `paused`
  - [ ] `canceled`
  - [ ] `incomplete`
  - [ ] `incomplete_expired`
- [x] Keep Premium for exactly 30 elapsed days from the first unresolved failed invoice.
- [ ] Downgrade to `free` when access should end.
- [ ] Preserve the existing admin and seeded-tier behavior intentionally; Stripe synchronization must not accidentally downgrade administrators or manually granted accounts.
- [ ] Add a reconciliation job that periodically compares local subscription state with Stripe.
- [ ] Make webhook processing safe when events arrive more than once or out of order.

## Billing Emails And Recovery

- [ ] Enable successful-payment receipts if desired.
- [ ] Enable failed-payment emails.
- [ ] Enable upcoming-renewal emails if required by the business or applicable law.
- [ ] Configure Smart Retries for failed recurring payments.
- [ ] Configure the final action after all retries fail:
  - [ ] Cancel subscription, or
  - [ ] Mark subscription unpaid
- [ ] Make the final Stripe action match WanderBunnies entitlement downgrade behavior.
- [ ] Configure customer emails for expiring cards and payment authentication where available.
- [ ] Review invoice and receipt branding and support information.

## Tax

- [ ] Ask a qualified tax professional where WanderBunnies has registration obligations.
- [ ] Decide whether to use Stripe Tax.
- [ ] If using Stripe Tax:
  - [ ] Complete the business origin address.
  - [ ] Select the correct product tax code.
  - [ ] Add registrations only for jurisdictions where WanderBunnies is registered.
  - [ ] Enable automatic tax when creating Checkout Sessions/subscriptions.
  - [ ] Collect the customer address needed to calculate tax.
  - [ ] Test US sales-tax and international VAT/GST scenarios.
- [ ] Decide whether displayed prices include or exclude tax in each supported market.

## Fraud, Refunds, And Disputes

- [ ] Review Radar's default rules.
- [ ] Do not add broad custom blocking rules until test data shows they are needed.
- [ ] Configure dispute notifications.
- [ ] Document who handles disputes and what subscription access does during a dispute.
- [ ] Create and publish a refund policy.
- [x] A full refund immediately revokes Stripe-managed Premium; partial refunds do not.
- [ ] Test refunds from the Dashboard and verify the local entitlement result.

## API Keys And Secrets

- [ ] Keep the Stripe secret key only in the Cloud Run server environment or Secret Manager.
- [ ] Never place a Stripe secret key in `EXPO_PUBLIC_*`, Expo config, client JavaScript, logs, or source control.
- [ ] Store separately:
  - [ ] Test secret key
  - [ ] Live secret key
  - [ ] Test publishable key, if needed
  - [ ] Live publishable key, if needed
  - [ ] Test webhook signing secret
  - [ ] Live webhook signing secret
  - [ ] Test monthly/annual Price IDs
  - [ ] Live monthly/annual Price IDs
- [ ] Use restricted keys for supporting systems when a full secret key is unnecessary.
- [ ] Rotate any key that has been exposed.
- [ ] Pin and deliberately upgrade the Stripe API version used by the server.

## Test Mode Acceptance

- [ ] New user completes monthly Premium Checkout.
- [ ] The webhook grants `premium`.
- [ ] Returning user cannot accidentally create a duplicate subscription.
- [ ] Premium survives app logout/login and a server restart.
- [ ] Customer updates an expired card in the portal.
- [ ] Customer changes monthly to annual, if supported.
- [ ] Customer cancels at period end and remains Premium until that date.
- [ ] Customer cancels immediately, if supported, and receives the expected access/refund result.
- [ ] Renewal payment succeeds and extends the local period end.
- [ ] Renewal payment fails and follows the configured grace-period behavior.
- [ ] Payment requiring authentication is handled correctly.
- [ ] Webhook delivery is retried without duplicate tier changes.
- [ ] Out-of-order webhook events do not incorrectly downgrade an active user.
- [ ] Refund behavior matches policy.
- [ ] Dispute behavior matches policy.
- [ ] Portal access is impossible for another user's Stripe Customer.
- [ ] Test-mode IDs and secrets are absent from production configuration.

## Live Launch

- [ ] Recreate or verify the Product and Prices in live mode.
- [ ] Configure the live Customer Portal.
- [ ] Configure the live webhook destination and copy its live signing secret.
- [ ] Configure live billing emails and recovery behavior.
- [ ] Configure live tax registrations and automatic-tax behavior, if used.
- [ ] Verify live branding, statement descriptor, support details, and payout account.
- [ ] Deploy live keys and Price IDs through Secret Manager/environment configuration.
- [ ] Run one real low-cost subscription with an authorized account.
- [ ] Confirm Checkout, webhook delivery, Premium entitlement, portal access, cancellation, and refund behavior.
- [ ] Add alerts for webhook failures, payment failures, disputes, and entitlement synchronization errors.

## Current WanderBunnies Status

As of June 20, 2026, the repository includes the Stripe server dependency, Checkout and Portal endpoints, raw-body verified webhooks, Postgres and Firestore billing persistence, entitlement reconciliation, subscription status UI, web-only purchase controls, admin billing configuration, and automated billing tests.

Remaining launch items:

- [ ] Complete Stripe Dashboard test and live configuration in this checklist.
- [ ] Configure and verify Customer Portal asymmetric plan-switch behavior.
- [ ] Run the full sandbox lifecycle, including refunds, disputes, failed payments, and webhook retries.
- [ ] Add operational alerts and finish the support/runbook documentation.
- [ ] Run one authorized live low-cost end-to-end subscription before general availability.

Optional real Stripe test-mode smoke test:

```powershell
$env:STRIPE_SANDBOX_TEST='1'
$env:STRIPE_SECRET_KEY='sk_test_...'
$env:STRIPE_PREMIUM_MONTHLY_PRICE_ID='price_...'
npm --prefix server test -- --runInBand __tests__/billing-stripe-sandbox.test.ts
```

## References

- Stripe subscriptions: https://docs.stripe.com/billing/subscriptions/build-subscriptions
- Stripe Checkout subscriptions: https://docs.stripe.com/payments/checkout/build-subscriptions
- Stripe webhooks: https://docs.stripe.com/webhooks
- Subscription webhook events: https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe Customer Portal: https://docs.stripe.com/customer-management/configure-portal
- Stripe Tax setup: https://docs.stripe.com/tax/set-up
- Stripe Tax for subscriptions: https://docs.stripe.com/tax/subscriptions
- Stripe mobile digital goods: https://docs.stripe.com/mobile/digital-goods
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play payments policy: https://support.google.com/googleplay/android-developer/answer/10281818
