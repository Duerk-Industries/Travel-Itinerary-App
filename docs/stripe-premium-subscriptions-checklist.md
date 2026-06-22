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
- restoration when a refund is reversed (before the refund settles) or a dispute is won

Complete every sandbox step before repeating it in live mode.

---

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
  __tests__/billing-entitlement-users.test.ts `
  __tests__/stripe-billing-config.test.ts
npm --prefix app test -- --runInBand `
  tests/adminTab.billing.test.tsx `
  tests/premiumSubscriptionPanel.test.tsx `
  tests/billing.utils.test.ts `
  tests/useBillingStatus.test.tsx
```

For Postgres, apply migrations in order:

```powershell
npm --prefix server run migrate
```

Confirm these three migrations are recorded in the migrations table:

- `20260620_add_stripe_billing.sql` — billing_customers, billing_subscriptions, stripe_webhook_events
- `20260620_add_billing_plan_config.sql` — billing_plan_config, billing_price_history
- `20260622_add_billing_checkout_claims.sql` — billing_checkout_claims

Firestore requires no schema migration; billing collections are created on first write.

---

## 2. Activate And Secure The Stripe Account

All paths below are in the Stripe Dashboard. Toggle between sandbox and live using the **Test mode** control in the top-left corner.

**Business and public details:**

1. Open **Settings → Business → Business details**.
2. Complete: legal business name, business type, address, phone number, website.
3. Open **Settings → Business → Public details**.
4. Set:
   - Public/display name: `WanderBunnies`
   - Support email: your support address
   - Support URL: your help or contact page
   - Privacy policy URL
   - Terms of service URL
5. Open **Settings → Business → Account details** (or **Settings → Account details**).
6. Set **Statement descriptor** to `WANDERBUNNIES` (max 22 characters, letters/numbers/spaces only).
   Set **Shortened descriptor** to `WANDERBUN` if prompted (used for card statements with limited space).

**Branding:**

7. Open **Settings → Branding**.
8. Upload the WanderBunnies logo/icon (PNG, minimum 128 × 128 px recommended).
9. Set **Brand color** and **Accent color** to the WanderBunnies palette.

**Payouts:**

10. Open **Settings → Bank accounts and scheduling** (or **Settings → Payouts**).
11. Add the business bank account.
12. Review payout timing and enable payout-failure notifications.

**Security:**

13. Open **Settings → Team and security**.
14. Under **Two-step authentication**, click **Enforce** for the whole team.
15. Review each team member's role and downgrade to the minimum necessary:
    - Developers need **Developer** role (API keys, webhooks).
    - Finance needs **Analyst** role.
    - Support needs **Support** role.

---

## 3. Create The Premium Product

**Do this in sandbox/test mode first.**

1. Open **Product catalog → Products** (left nav).
2. Click **Add product** (top right).
3. Enter:
   - **Name:** `WanderBunnies Premium`
   - **Description:** concise customer-facing description of Premium benefits
4. Under **Tax code**, select the appropriate digital-goods or SaaS code.
   Stripe tax codes for software typically include `txcd_10000000` (Software as a Service).
   Confirm the correct code with a tax professional before launch.
5. Click **Save product**.
6. On the Product detail page, copy the `prod_...` ID shown under the product name.

Set that value as:

```text
STRIPE_PREMIUM_PRODUCT_ID=prod_...
```

Both monthly and annual Prices must remain under this same Product. The Customer Portal can only present plan-switching options between Prices that share a Product.

---

## 4. Create Or Publish Monthly And Annual Prices

### Option A — WanderBunnies Admin UI (preferred for production)

After deploying the server with `STRIPE_BILLING_ENABLED=true`:

1. Sign in to WanderBunnies as an administrator.
2. Open **Admin → Billing**.
3. For **Premium Monthly**, enter `500` in the amount field and click **Save** (or **Publish Price**).
4. For **Premium Annual**, enter `3500` in the amount field and click **Save**.
5. Each plan card should show an active `price_...` ID in the correct Stripe mode (test or live).

The Admin page creates immutable Stripe Prices via the API and records them in `billing_price_history`. When you change an amount and save, a new Price is created and the old Price is retired — existing subscribers remain on the previous Price until they switch through the Portal.

Prices created via the Admin UI use `tax_behavior = exclusive` (tax added on top of the unit amount) by default. If your business policy requires inclusive pricing (tax baked into the displayed price), you must override the `taxBehavior` field in the API request body or change it manually in the Stripe Dashboard after creation.

Leave `STRIPE_PREMIUM_MONTHLY_PRICE_ID` and `STRIPE_PREMIUM_ANNUAL_PRICE_ID` unset when using this flow; the server reads active Price IDs from `billing_plan_config`.

### Option B — Stripe Dashboard (fallback for initial setup)

1. Open **Product catalog → Products → WanderBunnies Premium**.
2. Click **Add price** (or **Add another price**).
3. For the monthly Price, set:
   - **Pricing model:** Standard (flat rate)
   - **Amount:** `$5.00`
   - **Currency:** USD
   - **Billing period:** Monthly
   - **Usage type:** Licensed (not metered)
   - **Tax behavior:** Exclusive (tax added on top) or Inclusive — match your business policy
   - Under **Advanced**, add **Lookup key:** `wanderbunnies_premium_monthly`
4. Click **Save price**. Copy the `price_...` ID shown on the price row.
5. Repeat for the annual Price:
   - **Amount:** `$35.00`
   - **Billing period:** Yearly
   - **Lookup key:** `wanderbunnies_premium_annual`
6. Copy both `price_...` IDs.

The server resolves Price IDs in this order: env vars → `billing_plan_config` (active price) → `billing_price_history` (historical prices for existing subscriptions). Lookup keys are stored as metadata but the server does not resolve by lookup key at runtime — the `price_...` IDs are authoritative.

Set when using manually created Prices:

```text
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...
```

Never edit a Price's amount after creating it. Archive old Prices rather than reusing them.

---

## 5. Configure Stripe Tax

1. Open **Settings → Tax**.
2. Under **Tax settings**, set the business origin address (country, state/province, postal code).
3. Set **Default product tax code** to match the WanderBunnies Premium SaaS classification.
4. Return to **Product catalog → WanderBunnies Premium**. Confirm the product's own tax code overrides the default.
5. Confirm each Price's **Tax behavior** is set (Exclusive or Inclusive) consistently with the business policy.
6. Under **Tax registrations**, click **Add registration**. Add only jurisdictions where the business is legally registered to collect tax.
7. In **WanderBunnies Admin → Billing**, confirm the **Stripe Tax** toggle is enabled for both plans.

Checkout sessions are created with `automatic_tax.enabled = true`. Stripe calculates tax based on the customer's billing address. Test at minimum:

- A US address in a state where the business is registered
- A US address in a state without a registration (should produce $0 tax)
- A Canadian or EU address
- An incomplete or unrecognizable address — Stripe's Checkout will prompt the customer to correct the address before allowing payment to proceed; it does **not** silently skip tax or proceed with an invalid address

---

## 6. Configure Payment Methods

1. Open **Settings → Payment methods** (may appear under **Settings → Payment method types** in some accounts).
2. Under **Card**, toggle on **Card**.
3. Leave **Wallet** options (Apple Pay, Google Pay) enabled — Stripe presents them automatically in Checkout when the browser/device supports them.
4. Under **Bank debits** and **Bank transfers**, leave ACH debit, SEPA debit, and similar delayed-notification methods **disabled**.
   The server does not subscribe to `checkout.session.async_payment_succeeded` or `checkout.session.async_payment_failed`, so delayed methods must remain off for launch.

Apple Pay domain verification is **not required** for standard Stripe-hosted Checkout. Stripe manages its own payment domain for hosted Checkout sessions. Domain registration is only needed when using Stripe Elements or a custom payment domain — neither of which applies here.

No Stripe publishable key is needed for the current hosted Checkout integration.

---

## 7. Configure Promotion Codes

1. Open **Product catalog → Coupons** and click **Create coupon**.
2. Set the discount (percent-off or amount-off), duration, and redemption limits.
3. Click **Create coupon**.
4. On the coupon detail page, click **Create promotion code** to generate a customer-facing code string.
5. Set code-level limits: max redemptions, expiration date, first-time-customer restriction.
6. In **WanderBunnies Admin → Billing**, confirm the **Promotion codes** toggle is enabled for each plan.

The Checkout Session is created with `allow_promotion_codes = true`, which surfaces Stripe's coupon-entry field. Only codes with valid Stripe-managed restrictions are accepted.

Do not create unrestricted production promotion codes to test Checkout — use sandbox codes first.

---

## 8. Configure The Customer Portal

Open **Settings → Billing → Customer portal** in sandbox mode. Click **Activate portal** if it is not yet active.

### Features

Under **Features**, enable these toggles:

| Toggle | Setting |
|---|---|
| Update payment methods | On |
| View invoice history | On |
| Update billing address | On |

### Subscriptions

Under **Subscriptions**:

1. **Cancel subscriptions:** enable. Choose **At the end of the billing period** (not immediately). Enable cancellation-reason collection.
2. **Pause subscription collection:** leave **off** (paused state is not tested in the application).
3. **Switch plans:** enable. Click **Add product**. Select **WanderBunnies Premium**. Select both the monthly and annual Prices. Click **Done**.
   - Under the plan-switch product, set **Proration behavior** to **Always prorate** (for immediate monthly → annual switches).
   - Enable **Schedule subscription changes** (allows annual → monthly changes to be deferred to period end).
   - Find the **Keep trial when changing plan** toggle (may appear as "Keep trial on plan change"). **Enable it** to preserve remaining trial days when a customer switches plans via the Portal. If you leave it disabled, Stripe ends the trial immediately and charges the customer at the new rate.
4. Disable **Change quantities**.

The result:
- Monthly → annual: immediate with Stripe-calculated proration.
- Annual → monthly: deferred to the end of the current annual period.
- Cancellation: at period end only.
- Trial on plan switch: preserved (if the toggle above is enabled). If the toggle is off, the trial ends immediately and the customer is billed.

> **Verify the trial toggle:** After saving the Portal configuration, create a test subscription with a trial via the Test Clock workflow, then switch plans in the Portal. Check whether the subscription's `trial_end` date is preserved or cleared. Stripe's behavior for this toggle can be account-specific and has had historical inconsistencies — verify with an actual test before relying on it.

### Return URL

Set the **Default return URL** to:

```text
https://YOUR-WEB-DOMAIN/
```

This URL must match `STRIPE_PORTAL_RETURN_URL`.

### Portal Configuration ID

If you leave the portal in its default state (configured through the Dashboard), leave `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` unset — the server omits the `configuration` field from portal session creation and Stripe uses the account default.

If you create a separate API-managed configuration (e.g. for multi-tenant or A/B testing), copy its `bpc_...` ID:

```text
STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=bpc_...
```

**After publishing any new Price** (via the WanderBunnies Admin UI or manually), you must return to the Portal configuration and add the new Price to the approved plan catalog. This is a manual step — the Admin UI creates the Stripe Price but does not update the Portal. Customers on older Prices will not see the new Price as a switch target until it is added here.

---

## 9. Configure Billing Emails And Revenue Recovery

Open **Settings → Billing → Subscriptions and emails** (or **Settings → Billing → Revenue recovery** in newer Dashboard layouts).

### Revenue recovery

1. Enable **Smart Retries**. Leave Stripe's ML-based retry schedule in place.
2. Under **Failed payments**, set the final action after all retries fail to **Cancel subscription**.
   - Rationale: `customer.subscription.deleted` fires, the server receives it via webhook, and the user's tier is downgraded after the grace window. Choosing **Mark as unpaid** instead results in `unpaid` status with no `deleted` event — this is handled by `isSubscriptionPremiumEligible` (unpaid = no Premium) but requires explicit confirmation that the 30-day grace behavior is still correct.
3. Confirm the final-action timing is **not** earlier than 30 days from the first failed invoice. The server's grace period starts at the first `invoice.payment_failed` and lasts exactly 30 days regardless of Stripe's retry schedule.

### Email notifications

Enable all of these:

| Email | Toggle |
|---|---|
| Successful payment receipts | On |
| Failed payment notifications | On |
| Upcoming renewal reminders | On (if legally required or desired) |
| Expiring card alerts | On |
| Payment authentication reminders | On |

### Invoice and receipt branding

Open **Settings → Branding** (or the branding section within the invoice email preview). Set:

- **Support phone** (optional)
- **Support email** matching public business details
- **Logo** already uploaded in step 2

---

## 10. Create The Webhook Event Destination

Deploy the API to a public HTTPS URL before registering the destination. The endpoint must be live and return a valid response before Stripe can verify it.

**Endpoint URL:**

```text
https://YOUR-API-DOMAIN/api/billing/webhooks/stripe
```

### Dashboard setup

1. Open **Workbench → Webhooks** (or **Developers → Webhooks**).
2. Click **Create an event destination**.
3. Under **Listen to**, select **Events from your account** (not Connect events).
4. Under **Event delivery**, select **Webhook endpoint**.
5. Enter the endpoint URL above.
6. Under **Select events**, click **Select events manually** and enable exactly:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
invoice.payment_action_required
charge.refunded
refund.updated
refund.failed
charge.dispute.created
charge.dispute.closed
```

7. Under **API version**, pin to `2025-02-24.acacia` (the version the server's Stripe SDK is pinned to).
8. Click **Add endpoint** (or **Create destination**).
9. On the webhook detail page, click **Reveal signing secret**.
10. Copy the `whsec_...` value.

Store it as:

```text
STRIPE_WEBHOOK_SECRET=whsec_...
```

In production, add it to Secret Manager (see section 12). Do **not** commit it to source control.

Create independent sandbox and live destinations. The signing secret is different for each; never use a sandbox secret in live mode.

### Local development with Stripe CLI

Install the Stripe CLI (if not installed):

```powershell
winget install Stripe.StripeCLI
# or: scoop install stripe
```

Log in and forward events to the local server:

```powershell
stripe login

stripe listen `
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required,charge.refunded,refund.updated,refund.failed,charge.dispute.created,charge.dispute.closed `
  --forward-to http://localhost:4000/api/billing/webhooks/stripe
```

The CLI prints a temporary `whsec_...` value — copy it into `server/.env` as `STRIPE_WEBHOOK_SECRET`. This value differs from the Dashboard endpoint secret and is valid only while `stripe listen` is running.

### Verifying delivery

After any test action, open **Workbench → Webhooks → [your endpoint] → Event deliveries**. Each row shows the event type, the HTTP status code returned by the server, and the response body. A `200` with `{"received":true}` indicates successful processing. A `500` triggers Stripe's automatic retry schedule.

To resend any event manually:

```powershell
# Find the event ID in the Dashboard, then:
stripe events resend evt_...
```

---

## 11. Configure Local Environment

Copy the example file:

```powershell
Copy-Item server/.env.example server/.env
```

Add these values to `server/.env`:

```text
STRIPE_BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...          # from stripe listen output
STRIPE_PREMIUM_PRODUCT_ID=prod_...
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...
STRIPE_CHECKOUT_SUCCESS_URL=http://localhost:19006/?billing=success
STRIPE_CHECKOUT_CANCEL_URL=http://localhost:19006/?billing=cancel
STRIPE_PORTAL_RETURN_URL=http://localhost:19006/
BILLING_RECONCILE_ENABLED=true
BILLING_RECONCILE_INTERVAL_MS=86400000
```

Start the API and web client in separate terminals:

```powershell
npm --prefix server run dev
npm --prefix app run web
```

On startup, the server logs a startup-failure error and exits if `STRIPE_BILLING_ENABLED=true` but any required Stripe variable is missing. It also logs `[stripe] STRIPE_PREMIUM_MONTHLY_PRICE_ID is not set` as an error (non-fatal) when the env var is absent and no active price has been published through the Admin UI yet.

---

## 12. Configure Google Secret Manager And Cloud Run

```powershell
$ProjectId = 'YOUR_GCP_PROJECT_ID'
$Region    = 'us-east5'
$Service   = 'travel-itinerary-app'
gcloud config set project $ProjectId
```

Create the secrets without placing values in shell history:

```powershell
$StripeKey = Read-Host 'Stripe secret key (sk_test_... or sk_live_...)' -AsSecureString
$StripeKeyPlain = [System.Net.NetworkCredential]::new('', $StripeKey).Password
$StripeKeyPlain | gcloud secrets create STRIPE_SECRET_KEY --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
  $StripeKeyPlain | gcloud secrets versions add STRIPE_SECRET_KEY --data-file=-
}

$WebhookSecret = Read-Host 'Stripe webhook signing secret (whsec_...)' -AsSecureString
$WebhookSecretPlain = [System.Net.NetworkCredential]::new('', $WebhookSecret).Password
$WebhookSecretPlain | gcloud secrets create STRIPE_WEBHOOK_SECRET --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
  $WebhookSecretPlain | gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=-
}

Remove-Variable StripeKeyPlain,WebhookSecretPlain
[System.Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode(
  [System.Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($StripeKey))
[System.Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode(
  [System.Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($WebhookSecret))
```

Grant the Cloud Run service account access:

```powershell
$RuntimeSA = gcloud run services describe $Service `
  --region $Region `
  --format='value(spec.template.spec.serviceAccountName)'

foreach ($SecretName in 'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET') {
  gcloud secrets add-iam-policy-binding $SecretName `
    --member "serviceAccount:$RuntimeSA" `
    --role roles/secretmanager.secretAccessor
}
```

Add secret bindings to `server/.secrets` (read by the deploy script):

```text
STRIPE_SECRET_KEY=STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET
```

Add non-secret configuration to `server/.env` (deployed as plain env vars):

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
$env:ENV_FILE     = 'server/.env'
$env:SECRETS_FILE = 'server/.secrets'
$env:SERVICE_NAME = $Service
$env:REGION       = $Region
.\scripts\deploy-api.ps1
```

Verify the bound environment without printing secret values:

```powershell
gcloud run services describe $Service `
  --region $Region `
  --format='yaml(spec.template.spec.containers[0].env)'
```

Secret-bearing rows will show `secretKeyRef` objects rather than plain values.

### Configure Cloud Scheduler for durable grace-period enforcement

The in-process scheduler inside Cloud Run uses `setInterval`/`setTimeout` and is reset every time Cloud Run starts a new instance. For durable grace-period enforcement (so that past-due users are downgraded even after instance recycling), set up a Cloud Scheduler job that calls the internal reconciliation endpoint every 30 minutes.

Generate a shared secret and store it in Secret Manager:

```powershell
$SchedulerSecret = [System.Web.Security.Membership]::GeneratePassword(40, 10)
$SchedulerSecret | gcloud secrets create BILLING_SCHEDULER_SECRET --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
  $SchedulerSecret | gcloud secrets versions add BILLING_SCHEDULER_SECRET --data-file=-
}
Remove-Variable SchedulerSecret
```

Grant the Cloud Run service account access to this secret (same pattern as above):

```powershell
gcloud secrets add-iam-policy-binding BILLING_SCHEDULER_SECRET `
  --member "serviceAccount:$RuntimeSA" `
  --role roles/secretmanager.secretAccessor
```

Add it to `server/.secrets`:

```text
BILLING_SCHEDULER_SECRET=BILLING_SCHEDULER_SECRET
```

Create the Cloud Scheduler job:

```powershell
# Replace YOUR-API-DOMAIN with the Cloud Run service URL (no trailing slash)
$ApiDomain = 'https://YOUR-API-DOMAIN'
$SchedulerSecretValue = gcloud secrets versions access latest --secret BILLING_SCHEDULER_SECRET

gcloud scheduler jobs create http billing-reconcile `
  --schedule="*/30 * * * *" `
  --uri="$ApiDomain/api/internal/billing/reconcile" `
  --http-method=POST `
  --headers="Content-Type=application/json,X-Billing-Scheduler-Secret=$SchedulerSecretValue" `
  --message-body='{}' `
  --time-zone=UTC `
  --location=$Region

Remove-Variable SchedulerSecretValue
```

> **Note:** The `--headers` flag stores the secret value as a plaintext scheduler job parameter. If your security policy requires keeping secrets out of scheduler job definitions, use `--oidc-service-account-email` plus IAM-restricted Cloud Run access as additional layers. For most deployments, the shared-secret approach is sufficient when Cloud Run is not restricted to IAM callers.

Verify the job was created:

```powershell
gcloud scheduler jobs describe billing-reconcile --location $Region
```

To manually trigger a reconciliation run:

```powershell
gcloud scheduler jobs run billing-reconcile --location $Region
```

> **Separate sandbox and production environments:** `billing_plan_config` stores one active Stripe Price per plan key. It cannot hold both test and live Prices simultaneously. Always use separate databases (and separate Cloud Run deployments) for sandbox and production. Never point a production database at a Stripe test-mode key, or vice versa.

---

## 13. Run The Real Stripe Sandbox Smoke Test

Set sandbox variables in the current shell, then run the opt-in integration test:

```powershell
$env:STRIPE_SANDBOX_TEST             = '1'
$env:STRIPE_SECRET_KEY               = 'sk_test_...'
$env:STRIPE_WEBHOOK_SECRET           = 'whsec_...'
$env:STRIPE_PREMIUM_PRODUCT_ID       = 'prod_...'
$env:STRIPE_PREMIUM_MONTHLY_PRICE_ID = 'price_...'
$env:STRIPE_PREMIUM_ANNUAL_PRICE_ID  = 'price_...'
$env:STRIPE_CHECKOUT_SUCCESS_URL     = 'https://example.test/?billing=success'
$env:STRIPE_CHECKOUT_CANCEL_URL      = 'https://example.test/?billing=cancel'
$env:STRIPE_PORTAL_RETURN_URL        = 'https://example.test/'

npm --prefix server test -- --runInBand __tests__/billing-stripe-sandbox.test.ts
```

Remove the secrets from the shell after the test:

```powershell
Remove-Item Env:STRIPE_SANDBOX_TEST,Env:STRIPE_SECRET_KEY,Env:STRIPE_WEBHOOK_SECRET
```

---

## 14. Simulate Time-Based Scenarios With Stripe Test Clocks

Test Clocks let you advance time for a specific Stripe Customer without waiting for real days to pass. Use them to verify trial end, billing cycle renewal, and the 30-day past-due grace period.

> **Important:** The normal WanderBunnies Checkout flow creates a Stripe Customer on the fly (via `stripe.customers.create`) and attaches it to a new Checkout Session. Stripe does **not** allow the app to attach that Customer to a Test Clock via Checkout — the Customer must be created via the Stripe API with `test_clock` set before any subscription is created. This means the Test Clock workflow **cannot use the normal app Checkout UI**. Instead, create the customer and subscription via the Stripe CLI or API, then insert the customer/subscription mapping into the app's database manually (see below) or trigger the `checkout.session.completed` event with a custom payload.

Install `jq` if needed:

```powershell
winget install jqlang.jq
```

**Create a test clock and a customer attached to it:**

```powershell
# Record the current Unix timestamp
$Now = [int][double]::Parse((Get-Date -UFormat '%s'))

# Create a test clock frozen at "now"
$Clock = stripe test_helpers test_clocks create `
  --frozen-time $Now `
  --name 'WanderBunnies acceptance' `
  --api-key sk_test_... | ConvertFrom-Json
$ClockId = $Clock.id
Write-Host "Clock: $ClockId"

# Create a Stripe customer attached to the clock.
# Replace 'your-local-test-user-id' with the UUID of a real user in your local DB.
$Customer = stripe customers create `
  --email 'testuser@example.com' `
  --metadata[userId]='your-local-test-user-id' `
  --test-clock $ClockId `
  --api-key sk_test_... | ConvertFrom-Json
Write-Host "Customer: $($Customer.id)"
```

After creating the customer, insert the mapping into your local database so the app links that Stripe Customer ID to the user:

```sql
-- Run against your local Postgres DB
INSERT INTO billing_customers (user_id, stripe_customer_id, email_snapshot, livemode)
VALUES ('your-local-test-user-id', 'cus_test_...', 'testuser@example.com', false)
ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id;
```

Now create a subscription via the Stripe API (not through the app Checkout UI):

```powershell
stripe subscriptions create `
  --customer $($Customer.id) `
  --items[0][price]='price_test_...' `
  --trial-period-days 14 `
  --metadata[userId]='your-local-test-user-id' `
  --metadata[planKey]='premium_monthly' `
  --api-key sk_test_...
```

Stripe fires `customer.subscription.created`, which the webhook handler picks up and writes the subscription to the local DB.

**Advance through the trial (14 days):**

```powershell
$TrialEnd = $Now + (14 * 86400) + 3600   # 14 days + 1 hour
stripe test_helpers test_clocks advance `
  --test-clock $ClockId `
  --frozen-time $TrialEnd `
  --api-key sk_test_...
```

Stripe processes the trial-end invoice, fires `invoice.paid` (if the card succeeds), and transitions the subscription to `active`. Check the WanderBunnies Admin → Billing page to confirm the user's tier moved to `premium`.

**Advance through a billing cycle (renewal test):**

```powershell
$Renewal = $TrialEnd + (30 * 86400) + 3600   # ~1 month later
stripe test_helpers test_clocks advance `
  --test-clock $ClockId `
  --frozen-time $Renewal `
  --api-key sk_test_...
```

**Simulate a failed payment and the 30-day grace window:**

1. Attach Stripe test card `4000 0000 0000 0341` (always fails) to the test customer before advancing.
2. Advance to renewal. `invoice.payment_failed` fires; the server sets `past_due_since = now`.
3. Advance to day 29 (`$Renewal + (29 * 86400)`). User should still have Premium.
4. Advance to day 31 (`$Renewal + (31 * 86400)`). The grace expiry timer fires; user should be downgraded to `free`.
5. Fix the card (update to `4242 4242 4242 4242`). Trigger a payment retry:

```powershell
stripe invoices pay inv_... --api-key sk_test_...
```

`invoice.paid` fires; the server clears `past_due_since` and re-grants Premium.

**Delete the test clock when finished:**

```powershell
stripe test_helpers test_clocks delete $ClockId --api-key sk_test_...
```

---

## 15. Trigger Individual Webhook Events With Stripe CLI

Use these commands during development to test specific handlers without going through Checkout. Run with `stripe listen` active in another terminal.

```powershell
# Simulate a new subscription being created
stripe trigger customer.subscription.created --api-key sk_test_...

# Simulate a subscription update (e.g. plan switch)
stripe trigger customer.subscription.updated --api-key sk_test_...

# Simulate a subscription cancellation
stripe trigger customer.subscription.deleted --api-key sk_test_...

# Simulate a successful invoice payment
stripe trigger invoice.paid --api-key sk_test_...

# Simulate a failed invoice payment
stripe trigger invoice.payment_failed --api-key sk_test_...

# Simulate a 3DS/SCA authentication required scenario
stripe trigger invoice.payment_action_required --api-key sk_test_...

# Simulate a full charge refund
stripe trigger charge.refunded --api-key sk_test_...

# Simulate a dispute being opened
stripe trigger charge.dispute.created --api-key sk_test_...

# Simulate a dispute being won
stripe trigger charge.dispute.closed --api-key sk_test_...

# Resend a specific real event by ID (useful after fixing a handler bug)
stripe events resend evt_... --api-key sk_test_...
```

Note: `stripe trigger` creates synthetic Stripe objects with auto-generated IDs. The `userId` field in subscription metadata will be absent, so `userIdFromSubscription` falls back to looking up by `stripe_customer_id`. If the synthetic customer ID has no local `billing_customers` row, the handler logs `billing.webhook.user_not_found` and skips processing — this is expected behavior for synthetic events.

---

## 16. Manual Sandbox Acceptance Checklist

Start `stripe listen` (section 10) and both servers (section 11) before running these scenarios.

Use test cards:

| Card number | Behavior |
|---|---|
| `4242 4242 4242 4242` | Always succeeds |
| `4000 0025 0000 3155` | Requires 3DS authentication |
| `4000 0000 0000 0341` | Always declines (for payment_failed) |

Use any future expiry (e.g. `12/34`) and any 3-digit CVC.

**Checkout and entitlement:**

- [ ] New user opens the web app, navigates to Account → Billing, sees upgrade options at `$5/month` and `$35/year`.
- [ ] Clicking **Upgrade** for monthly redirects to Stripe Checkout. Payment method is required before the trial starts.
- [ ] Completing Checkout redirects to `/?billing=success`. The app calls `POST /api/billing/refresh`; the user's tier updates to `premium` without a page reload.
- [ ] Refreshing the page or logging out and back in retains Premium.
- [ ] A native (iOS/Android) user does not see the Stripe upgrade button — only their current plan status and benefits.

**Duplicate prevention:**

- [ ] An already-Premium user who opens the upgrade flow receives a 409 response (or the UI hides the upgrade button). No second Checkout Session is created.
- [ ] Opening two browser tabs simultaneously and clicking **Upgrade** in both does not create two active subscriptions. The checkout-claim mechanism allows only one pending checkout per user at a time.

**Portal and plan management:**

- [ ] Clicking **Manage subscription** opens the Stripe Customer Portal with the correct customer's data.
- [ ] A logged-in user cannot access another user's Portal session (the server generates portal sessions server-side using the authenticated user's Stripe Customer ID only).
- [ ] Monthly → annual plan switch in the Portal is immediate. Premium is retained and the next billing date reflects the annual period.
- [ ] Annual → monthly plan switch in the Portal is scheduled at period end. Premium is retained until the annual period ends.
- [ ] Cancellation in the Portal is offered at period end only — no immediate-cancel option appears.
- [ ] After period-end cancellation, Premium remains active until `current_period_end`. After that date (advance the Test Clock), the user is downgraded to `free`.

**Payment failure and grace period:**

- [ ] Attaching the `4000 0000 0000 0341` card and advancing time to a renewal starts the past-due clock (`past_due_since` is set). Premium is retained.
- [ ] At day 29 from `past_due_since`, the user still has Premium.
- [ ] At day 31, the grace-expiry timer fires and the user is downgraded to `free`.
- [ ] Paying the outstanding invoice (fixing the card, then retrying) clears `past_due_since` and restores Premium.
- [ ] `invoice.payment_action_required` (3DS card `4000 0025 0000 3155`) does **not** start the past-due clock. If the customer completes authentication and `invoice.paid` fires, the clock is never set.

**Refunds:**

- [ ] A full refund through the Dashboard (**Payments → [charge] → Refund**) fires `charge.refunded` then `refund.updated`. Premium is revoked.
- [ ] A partial refund does **not** revoke Premium; an audit log entry is created.
- [ ] If a full refund is reversed before it settles (Stripe issues a `refund.updated` with `status: failed`), Premium is restored if the subscription is otherwise eligible.
- [ ] If Stripe cannot process the refund at all (bank rejects it — `refund.failed` event fires), the original charge remains valid and Premium is restored automatically. Trigger locally with `stripe trigger refund.failed` and verify the tier returns to `premium`.

**Disputes:**

- [ ] Opening a dispute from the Dashboard revokes Premium immediately.
- [ ] A dispute closed as **Won** by WanderBunnies restores Premium automatically when the subscription state is otherwise active.
- [ ] A dispute closed as **Lost** keeps Premium revoked.

**Trial plan switching:**

- [ ] Switching plans in the Portal while on a trial ends the trial immediately and charges the customer at the new plan's rate. This is expected Stripe behavior — confirm the customer is charged and has Premium access on the new plan.

**Webhook reliability:**

- [ ] Replaying a processed event (`stripe events resend evt_...`) returns `{"received":true,"duplicate":true}` with HTTP 200 and does not change the user's tier.
- [ ] All event deliveries in **Workbench → Webhooks → [endpoint] → Event deliveries** show `200` responses.
- [ ] Note: webhook handlers perform Stripe API calls and DB writes before returning HTTP 200. This is acceptable at launch volume. If processing time grows to >5 seconds, Stripe may retry — plan to move to async queuing if average handler time exceeds 2 seconds under load.

**Reconciliation:**

- [ ] Triggering `POST /api/admin/billing/reconcile/:userId` for a test user returns the correct `result` and current `subscriptions`.
- [ ] Triggering `POST /api/admin/billing/reconcile-batch` processes stale subscriptions without errors.
- [ ] Triggering the Cloud Scheduler job (`gcloud scheduler jobs run billing-reconcile --location $Region`) completes successfully and returns `{"ok":true}` (check Cloud Run logs).

---

## 17. Repeat In Live Mode

Stripe sandbox and live objects are separate. Repeat every Dashboard step for live mode:

1. Verify business/public details and branding (section 2).
2. Create the Product (section 3).
3. Create monthly and annual Prices (section 4, Option B) or publish via Admin UI (Option A).
4. Configure Stripe Tax and registrations (section 5).
5. Configure payment methods (section 6). Apple Pay domain verification is not required for hosted Checkout.
6. Configure promotion codes (section 7).
7. Configure the Customer Portal (section 8).
8. Configure billing emails and revenue recovery (section 9).
9. Create a live webhook destination and copy the live signing secret (section 10).
10. Add live Secret Manager values and update Cloud Run configuration (section 12).

**Before enabling general availability:**

1. In **Admin → Billing**, leave **New checkout** disabled for both plans.
2. Deploy the live configuration.
3. Enable one plan temporarily for an authorized internal account only.
4. Complete one real subscription with a real card.
5. Verify: Checkout completes → webhook delivers → Premium is granted → Portal opens → cancellation schedules at period end → refund revokes access.
6. Enable both launch plans only after the end-to-end live flow passes.

---

## Official References

- [Stripe Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Customer Portal configuration](https://docs.stripe.com/customer-management/configure-portal)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe Tax setup](https://docs.stripe.com/tax/set-up)
- [Stripe Tax subscriptions](https://docs.stripe.com/tax/subscriptions)
- [Revenue recovery and Smart Retries](https://docs.stripe.com/billing/revenue-recovery)
- [Stripe Test Clocks](https://docs.stripe.com/billing/testing/test-clocks)
- [Stripe CLI reference](https://docs.stripe.com/stripe-cli)
- [Stripe test card numbers](https://docs.stripe.com/testing#cards)
