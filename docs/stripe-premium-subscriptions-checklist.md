# WanderBunnies Stripe Premium Launch Runbook

Last reviewed: June 22, 2026

This runbook matches the implemented billing flow:

- Stripe-hosted Checkout for web purchases
- Stripe Customer Portal for payment methods, invoices, cancellation, and plan switching
- server-verified snapshot webhooks
- monthly and annual Prices under one Product
- 14-day payment-method-required trial
- Stripe Tax and promotion codes controlled from the WanderBunnies Admin Billing page
- 30 elapsed days of Premium access after the first unresolved failed invoice
- immediate revocation for a full refund or opened dispute
- restoration when a full refund fails/reverses or a dispute is won

Complete every sandbox step before repeating it in live mode.

## 1. Apply And Verify The Application

From the repository root in PowerShell:

```powershell
npm --prefix server run typecheck
npm --prefix app run typecheck
npm --prefix server test -- --runInBand `
  __tests__/billing-routes.test.ts `
  __tests__/billing-webhook-workflows.test.ts `
  __tests__/billing-reconciliation.test.ts `
  __tests__/admin-billing-routes.test.ts `
  __tests__/billing-entitlement.test.ts `
  __tests__/stripe-billing-config.test.ts
npm --prefix app test -- --runInBand `
  tests/adminTab.billing.test.tsx `
  tests/premiumSubscriptionPanel.test.tsx `
  tests/billing.utils.test.ts `
  tests/useBillingStatus.test.tsx
```

For Postgres, apply migrations:

```powershell
npm --prefix server run migrate
```

Confirm these migrations are recorded:

- `20260620_add_stripe_billing.sql`
- `20260620_add_billing_plan_config.sql`
- `20260622_add_billing_checkout_claims.sql`

Firestore requires no schema migration. The billing collections are created on first write.

## 2. Activate And Secure The Stripe Account

In Stripe Dashboard:

1. Open **Settings → Business → Business details**.
2. Complete legal business name, business type, address, phone, website, and support information.
3. Open **Settings → Business → Public details**.
4. Set:
   - Public name: `WanderBunnies`
   - Support email
   - Support URL
   - Privacy-policy URL
   - Terms-of-service URL
5. Set the statement descriptor to `WANDERBUNNIES` or another Stripe-valid recognizable value.
6. Open **Settings → Branding** and upload the WanderBunnies icon/logo and set brand colors.
7. Open **Settings → Bank accounts and scheduling** and add the payout account.
8. Open **Settings → Team and security**:
   - Require two-step authentication.
   - Grant each user the minimum required role.

Do these separately for any sandbox-specific customer-facing configuration and live mode.

## 3. Create The Premium Product

Use sandbox/test mode first.

1. Open **Product catalog → Products**.
2. Click **Add product**.
3. Enter:
   - Name: `WanderBunnies Premium`
   - Description: customer-facing Premium benefits
4. Select the appropriate Stripe Tax code for a digital service/SaaS product. Confirm the classification with a tax professional.
5. Save the Product.
6. Copy its `prod_...` ID from the Product details page.

Set that value as:

```text
STRIPE_PREMIUM_PRODUCT_ID=prod_...
```

Both monthly and annual Prices must remain under this same Product. Stripe Portal can only schedule a downgrade at period end between Prices on the same Product.

## 4. Create Or Publish Monthly And Annual Prices

Preferred flow after deploying the server:

1. Sign in to WanderBunnies as an administrator.
2. Open **Admin → Billing**.
3. For **Premium Monthly**, enter `500` cents and click **Save**.
4. For **Premium Annual**, enter `3500` cents and click **Save**.
5. Confirm each card displays an active `price_...` ID in the correct Stripe mode.

The Admin page creates immutable Stripe Prices and records them in `billing_price_history`. Changing an amount publishes a new Price; it does not mutate an existing Price.

Manual Stripe fallback:

1. Open **Product catalog → Products → WanderBunnies Premium**.
2. Click **Add another price**.
3. Create the monthly Price:
   - Pricing model: Standard/flat rate
   - Amount: `$5.00 USD`
   - Recurring: Monthly
   - Usage: Licensed, not metered
   - Tax behavior: explicitly choose inclusive or exclusive; use the business-approved policy
4. Create the annual Price:
   - Amount: `$35.00 USD`
   - Recurring: Yearly
   - Same remaining settings
5. Copy both `price_...` IDs.

Optional lookup keys:

```text
wanderbunnies_premium_monthly
wanderbunnies_premium_annual
```

The application currently resolves by Price ID, not lookup key.

When using manually created Prices, set:

```text
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...
```

Archive old Prices rather than editing or reusing them.

## 5. Configure Stripe Tax

1. Open **Settings → Tax**.
2. Set the head-office/origin address.
3. Set an appropriate default product tax code.
4. Return to **Product catalog → WanderBunnies Premium** and verify its specific tax code.
5. Verify the monthly and annual Price tax behavior.
6. Add tax registrations only where the business is legally registered to collect tax.
7. In **Admin → Billing**, leave **Stripe Tax** enabled for both plans.

Checkout sends `automatic_tax.enabled=true`. Stripe still needs a usable customer location even when no tax is ultimately collected.

Test at minimum:

- an address in the business’s home state
- a US state without a registration
- an EU address
- an invalid or incomplete address

## 6. Configure Payment Methods

1. Open **Settings → Payment methods**.
2. Enable Cards.
3. Leave Stripe’s compatible wallet presentation enabled for Apple Pay and Google Pay.
4. Disable delayed-notification recurring methods such as ACH debit or SEPA debit for launch.

The application does not currently handle `checkout.session.async_payment_succeeded` or `checkout.session.async_payment_failed`, so delayed methods must remain disabled.

No publishable Stripe key is required for the current hosted Checkout integration.

## 7. Configure Promotion Codes

1. Open **Product catalog → Coupons** and create any approved coupon.
2. Create customer-facing Promotion Codes from that coupon.
3. Set redemption limits, expiration, and first-time-customer restrictions as required.
4. In **Admin → Billing**, enable **Promotion codes** for each plan.

Do not create unrestricted production promotion codes merely to test Checkout. Use sandbox codes first.

## 8. Configure The Customer Portal

Open **Settings → Billing → Customer portal** in sandbox mode.

Enable:

- Payment-method updates
- Invoice history
- Billing-address updates
- Subscription cancellation
- Cancellation at the end of the billing period
- Cancellation-reason collection
- Subscription switching

Configure the subscription catalog:

1. Add only `WanderBunnies Premium`.
2. Select only the approved monthly and annual Prices.
3. Disable quantity changes.
4. Enable immediate proration for subscription updates.
5. Enable scheduled downgrades at period end.
6. Keep trials active when changing plans.

This implements:

- monthly → annual immediately with Stripe-calculated proration
- annual → monthly at the annual period end

Set the default return URL to:

```text
https://YOUR-WEB-DOMAIN/
```

If using the default portal configuration, leave `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` unset.

If you create a separate API-managed configuration, copy its `bpc_...` ID and set:

```text
STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=bpc_...
```

Whenever a new Price is published, return to the Portal configuration and add the new Price to the approved catalog.

## 9. Configure Billing Emails And Revenue Recovery

1. Open **Settings → Billing → Revenue recovery**.
2. Enable Smart Retries.
3. Choose retry attempts and a maximum retry duration that does not end before the application’s 30-day entitlement grace period.
4. Enable failed-payment emails.
5. Enable expiring-card and authentication-required emails where available.
6. Choose a final subscription action deliberately:
   - `cancel`, or
   - `mark unpaid`

The application retains Premium for exactly 30 elapsed days from the first unresolved `invoice.payment_failed`, even if Stripe changes the subscription to `unpaid` or `canceled` during that window. A successful `invoice.paid` clears the clock.

Do not configure Stripe to pause collection without separately testing the resulting subscription state.

## 10. Create The Webhook Event Destination

Deploy the API to a public HTTPS URL first.

The exact endpoint is:

```text
https://YOUR-API-DOMAIN/api/billing/webhooks/stripe
```

In Stripe:

1. Open **Workbench → Webhooks**.
2. Click **Create an event destination**.
3. Select **Your account**.
4. Select **Snapshot events**.
5. Select API version `2025-02-24.acacia`.
6. Select exactly these events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
invoice.payment_action_required
charge.refunded
refund.updated
charge.dispute.created
charge.dispute.closed
```

7. Select **Webhook endpoint**.
8. Enter the endpoint URL above.
9. Create the destination.
10. Open the destination and reveal its signing secret.
11. Copy the `whsec_...` value into Secret Manager as `STRIPE_WEBHOOK_SECRET`.

Create independent sandbox and live destinations. Never reuse a sandbox signing secret in live mode.

Local Stripe CLI forwarding:

```powershell
stripe login
stripe listen `
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required,charge.refunded,refund.updated,charge.dispute.created,charge.dispute.closed `
  --forward-to http://localhost:4000/api/billing/webhooks/stripe
```

Copy the CLI’s temporary `whsec_...` value into the local `server/.env`. It differs from the Dashboard endpoint secret.

## 11. Configure Local Environment

Copy the example:

```powershell
Copy-Item server/.env.example server/.env
```

Set:

```text
STRIPE_BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PREMIUM_PRODUCT_ID=prod_...
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...
STRIPE_CHECKOUT_SUCCESS_URL=http://localhost:19006/?billing=success
STRIPE_CHECKOUT_CANCEL_URL=http://localhost:19006/?billing=cancel
STRIPE_PORTAL_RETURN_URL=http://localhost:19006/
BILLING_RECONCILE_ENABLED=true
BILLING_RECONCILE_INTERVAL_MS=86400000
```

Start the API and web client:

```powershell
npm --prefix server run dev
npm --prefix app run web
```

Startup now fails if billing is enabled but a required Stripe setting is missing.

## 12. Configure Google Secret Manager And Cloud Run

PowerShell variables:

```powershell
$ProjectId = 'YOUR_GCP_PROJECT_ID'
$Region = 'us-east5'
$Service = 'travel-itinerary-app'
gcloud config set project $ProjectId
```

Create the two secrets without placing values in shell history:

```powershell
$StripeSecret = Read-Host 'Stripe secret key' -AsSecureString
$StripeSecretPlain = [System.Net.NetworkCredential]::new('', $StripeSecret).Password
$StripeSecretPlain | gcloud secrets create STRIPE_SECRET_KEY --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
  $StripeSecretPlain | gcloud secrets versions add STRIPE_SECRET_KEY --data-file=-
}

$WebhookSecret = Read-Host 'Stripe webhook signing secret' -AsSecureString
$WebhookSecretPlain = [System.Net.NetworkCredential]::new('', $WebhookSecret).Password
$WebhookSecretPlain | gcloud secrets create STRIPE_WEBHOOK_SECRET --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
  $WebhookSecretPlain | gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=-
}

Remove-Variable StripeSecretPlain,WebhookSecretPlain
```

Grant the Cloud Run runtime service account access:

```powershell
$RuntimeServiceAccount = gcloud run services describe $Service `
  --region $Region `
  --format='value(spec.template.spec.serviceAccountName)'

gcloud secrets add-iam-policy-binding STRIPE_SECRET_KEY `
  --member "serviceAccount:$RuntimeServiceAccount" `
  --role roles/secretmanager.secretAccessor

gcloud secrets add-iam-policy-binding STRIPE_WEBHOOK_SECRET `
  --member "serviceAccount:$RuntimeServiceAccount" `
  --role roles/secretmanager.secretAccessor
```

Create `server/.secrets` mappings:

```text
STRIPE_SECRET_KEY=STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET
```

Put non-secret Stripe configuration in `server/.env`:

```text
STRIPE_BILLING_ENABLED=true
STRIPE_PREMIUM_PRODUCT_ID=prod_...
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...
STRIPE_CHECKOUT_SUCCESS_URL=https://YOUR-WEB-DOMAIN/?billing=success
STRIPE_CHECKOUT_CANCEL_URL=https://YOUR-WEB-DOMAIN/?billing=cancel
STRIPE_PORTAL_RETURN_URL=https://YOUR-WEB-DOMAIN/
BILLING_RECONCILE_ENABLED=true
BILLING_RECONCILE_INTERVAL_MS=86400000
```

Deploy:

```powershell
$env:ENV_FILE = 'server/.env'
$env:SECRETS_FILE = 'server/.secrets'
$env:SERVICE_NAME = $Service
$env:REGION = $Region
.\scripts\deploy-api.ps1
```

Verify bindings without printing secret values:

```powershell
gcloud run services describe $Service `
  --region $Region `
  --format='yaml(spec.template.spec.containers[0].env)'
```

## 13. Run The Real Stripe Sandbox Smoke Test

Set sandbox variables in the current shell:

```powershell
$env:STRIPE_SANDBOX_TEST='1'
$env:STRIPE_SECRET_KEY='sk_test_...'
$env:STRIPE_WEBHOOK_SECRET='whsec_...'
$env:STRIPE_PREMIUM_PRODUCT_ID='prod_...'
$env:STRIPE_PREMIUM_MONTHLY_PRICE_ID='price_...'
$env:STRIPE_PREMIUM_ANNUAL_PRICE_ID='price_...'
$env:STRIPE_CHECKOUT_SUCCESS_URL='https://example.test/?billing=success'
$env:STRIPE_CHECKOUT_CANCEL_URL='https://example.test/?billing=cancel'
$env:STRIPE_PORTAL_RETURN_URL='https://example.test/'

npm --prefix server test -- --runInBand __tests__/billing-stripe-sandbox.test.ts
```

Remove shell secrets afterward:

```powershell
Remove-Item Env:STRIPE_SANDBOX_TEST
Remove-Item Env:STRIPE_SECRET_KEY
Remove-Item Env:STRIPE_WEBHOOK_SECRET
```

## 14. Manual Sandbox Acceptance

Use Stripe test card `4242 4242 4242 4242`, any future expiry, and any CVC.

Verify:

- New monthly Checkout grants Premium through verified webhooks.
- New annual Checkout grants Premium.
- Checkout requires a payment method before starting the trial.
- Two simultaneous upgrade clicks create only one Checkout Session.
- Returning to `/?billing=success` synchronizes current Stripe subscriptions and refreshes access.
- Portal monthly → annual is immediate and prorated.
- Portal annual → monthly is scheduled at period end.
- Period-end cancellation retains Premium until entitlement should end.
- Failed payment starts one 30-day grace clock.
- Successful payment clears the grace clock.
- Full refund revokes Premium.
- Partial refund does not revoke Premium.
- Failed or reversed full refund restores Premium when the remaining refunded amount is no longer full.
- Opened dispute revokes Premium.
- Won dispute restores Premium; lost dispute does not.
- Replayed webhook events do not duplicate tier changes.
- A different authenticated user cannot open another customer’s Portal.

Use **Workbench → Webhooks → Event deliveries** to confirm `2xx` responses and inspect retries.

## 15. Repeat In Live Mode

Stripe sandbox and live objects are separate. Repeat:

1. Business/public details and branding verification.
2. Product creation.
3. Monthly and annual Price creation/publication.
4. Tax setup and registrations.
5. Customer Portal configuration and Price catalog.
6. Billing emails and revenue recovery.
7. Webhook destination creation.
8. Secret Manager values and Cloud Run configuration.

Before general availability:

1. Keep **New checkout** disabled in **Admin → Billing**.
2. Deploy live configuration.
3. Enable one plan temporarily for an authorized account.
4. Complete one real subscription.
5. Verify Checkout, webhook delivery, Premium access, Portal access, cancellation, and refund.
6. Enable both launch plans only after the complete flow passes.

## Official References

- [Stripe Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Customer Portal configuration](https://docs.stripe.com/customer-management/configure-portal)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe Tax setup](https://docs.stripe.com/tax/set-up)
- [Stripe Tax subscriptions](https://docs.stripe.com/tax/subscriptions)
- [Revenue recovery and Smart Retries](https://docs.stripe.com/billing/revenue-recovery)
