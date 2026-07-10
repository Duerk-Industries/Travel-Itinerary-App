# WanderBunnies Stripe Premium Launch Runbook

Last reviewed: June 30, 2026

This runbook matches the implemented billing flow:

- Stripe-hosted Checkout for web purchases
- Stripe Customer Portal for payment methods, invoices, cancellation, and plan switching
- server-verified snapshot webhooks
- monthly and annual Prices under one Product
- one-time 14-day payment-method-required trial for eligible Premium customers
- Stripe Tax and promotion codes controlled from the WanderBunnies Admin Billing page
- 30 elapsed days of Premium access after the first unresolved failed invoice
- immediate revocation for a full refund or opened dispute
- restoration when a refund is reversed (before the refund settles) or a dispute is won

---

## Environment Overview

This runbook covers three environments. Each has its own `.env` file — **all secrets live in `.env` only**. There is no Google Secret Manager and no `.secrets` file.

| Environment | Stripe mode | `.env` file | Webhook source |
|---|---|---|---|
| **Localhost** | Test (`sk_test_…` or `rk_test_…`) | `server/.env` | `stripe listen` CLI |
| **GCP Testing** | Test (`sk_test_…` or `rk_test_…`) | `server/.env` (deployed as env vars) | Cloud Run URL, test webhook destination |
| **GCP Production** | Live (`rk_live_…` preferred, `sk_live_…` accepted) | `server/.env` (deployed as env vars) | Cloud Run URL, live webhook destination |

Complete every sandbox step before repeating it in live mode.

### Webhook Secret Sources By Environment

`STRIPE_WEBHOOK_SECRET` always comes from the endpoint or listener that delivers Stripe events to the server. It is never interchangeable across environments.

**Same for all environments:**

- The server endpoint path is `/api/billing/webhooks/stripe`.
- The selected event list is the same in localhost test, GCP test, and GCP production.
- The webhook API version must match `STRIPE_API_VERSION` (`2026-06-24.dahlia`).
- Store the resulting `whsec_...` in the environment's `server/.env` as `STRIPE_WEBHOOK_SECRET`.
- Keep webhook secrets separate from API keys. `STRIPE_SECRET_KEY` is `sk_...` or `rk_...`; `STRIPE_WEBHOOK_SECRET` is `whsec_...`.

**Different by environment:**

| Environment | How to get `STRIPE_WEBHOOK_SECRET` | Endpoint URL | Stripe mode |
|---|---|---|---|
| Localhost test | Run `stripe listen --forward-to http://localhost:4000/api/billing/webhooks/stripe`; copy the CLI-printed `whsec_...`. | `http://localhost:4000/api/billing/webhooks/stripe` | Test |
| GCP test | In Stripe Dashboard test mode, create a webhook destination for the deployed Cloud Run test URL; reveal and copy that destination's `whsec_...`. | `https://YOUR-TEST-API-DOMAIN/api/billing/webhooks/stripe` | Test |
| GCP production | In Stripe Dashboard live mode, create a separate webhook destination for the deployed production Cloud Run URL; reveal and copy that destination's `whsec_...`. | `https://YOUR-PROD-API-DOMAIN/api/billing/webhooks/stripe` | Live |

Do not reuse the localhost `stripe listen` secret for GCP. Do not reuse the GCP test destination secret for production.

---

## How To Use This Runbook

Use this runbook in this order:

1. Run **Section 1 — Automated Launch Gate**. This is the primary pass/fail gate for repo tests, billing config, Stripe Price wiring, optional sandbox smoke tests, optional Test Clock scenarios, and optional Cloud Scheduler checks.
2. Complete **Sections 2-10 — Manual Setup And Dashboard Verification**. These are human checks in Stripe Dashboard, GCP, and the app UI that cannot be fully automated.
3. Use **Appendices A-E** only when you need the underlying commands, troubleshooting, or a targeted manual workflow.
4. Finish **Section 11 — Manual Sandbox Acceptance Checklist**, then repeat the necessary Dashboard/deploy steps in **Section 12 — Live Mode Cutover**.

The goal is to keep day-to-day launch validation script-first, with manual work limited to product, compliance, dashboard, and visual checks.

---

## 1. Automated Launch Gate

From the repository root in PowerShell:

```powershell
.\scripts\stripe-launch-validation.ps1 `
  -SkipCloudScheduler
```

`-StripeApiKey` is optional when `STRIPE_SECRET_KEY` is already set in `server/.env`. Pass `-StripeApiKey $StripeApiKey` to override it for a specific run. The script defaults launch-tool database commands to Firebase when `DB_PROVIDER` is omitted; set `DB_PROVIDER=postgres` and `DATABASE_URL=...` in `server/.env` to validate against Postgres.

For a fuller sandbox pass, add the opt-in checks you want to run:

```powershell
.\scripts\stripe-launch-validation.ps1 `
  -StripeApiKey $StripeApiKey `
  -UserId $UserId `
  -Email $Email `
  -RunSandboxSmoke `
  -RunTestClock `
  -RunFailedPaymentFlow `
  -RunCloudScheduler
```

The launch validation script automates repo tests, billing env checks, active plan/Price checks, optional Stripe sandbox smoke testing, optional Test Clock flow, optional Cloud Scheduler trigger, and writes `stripe-launch-validation-report.json`. It also records manual verification items for Stripe Dashboard and customer-facing UI checks that cannot be fully automated.

If the automated gate fails, use the appendices for targeted reruns and troubleshooting.

For Postgres, apply migrations in order before running the automated gate. The validation script verifies the resulting config but does not run migrations:

```powershell
npm --prefix server run migrate
```

Confirm these four migrations are recorded in the migrations table:

- `20260620_add_stripe_billing.sql` — billing_customers, billing_subscriptions, stripe_webhook_events
- `20260620_add_billing_plan_config.sql` — billing_plan_config, billing_price_history
- `20260622_add_billing_checkout_claims.sql` — billing_checkout_claims
- `20260628_add_billing_trial_usage.sql` — durable one-time Premium trial eligibility tracking

Firestore is the default backend for this launch tooling and requires no schema migration; billing collections are created on first write.

---

## 2. Manual Setup — Activate And Secure The Stripe Account

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
9. Set the Stripe-hosted page colors from the WanderBunnies design system:
   - **Brand color:** Deep Blue — `#152944`
   - **Accent color:** Sunset — `#F59E0B`

Deep Blue is the primary navigation and trust color. Sunset is the primary
call-to-action color used for buttons and other emphasized actions. Burnt Gold
`#D97706` remains the in-app Premium-tier color, but it is not the general
Stripe Checkout accent color.

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

## 3. Manual Setup — Create The Premium Product

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

Set that value in `server/.env`:

```text
STRIPE_PREMIUM_PRODUCT_ID=prod_...
```

Both monthly and annual Prices must remain under this same Product. The Customer Portal can only present plan-switching options between Prices that share a Product.

---

## 4. Manual Setup — Create Or Publish Monthly And Annual Prices

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

## 5. Manual Setup — Configure Stripe Tax

1. Open **Settings → Tax**.
2. Under **Tax settings**, set the business origin address (country, state/province, postal code).
3. Set **Default product tax code** to match the WanderBunnies Premium SaaS classification.
4. Return to **Product catalog → WanderBunnies Premium**. Confirm the product's own tax code overrides the default.
5. Confirm each Price's **Tax behavior** is set (Exclusive or Inclusive) consistently with the business policy.
6. Under **Tax registrations**, click **Add registration**. Add only jurisdictions where the business is legally registered to collect tax.
7. In **WanderBunnies Admin → Billing**, confirm the **Stripe Tax** toggle is enabled for both plans.
8. After the Dashboard setup is complete, set `STRIPE_REQUIRE_TAX_CONFIGURATION=true` and `STRIPE_TAX_CONFIGURED=true` in the deployed environment. The server refuses to start when Tax confirmation is required but not acknowledged.

Checkout sessions are created with `automatic_tax.enabled = true`. Stripe calculates tax based on the customer's billing address. Test at minimum:

- A US address in a state where the business is registered
- A US address in a state without a registration (should produce $0 tax)
- A Canadian or EU address
- An incomplete or unrecognizable address — Stripe's Checkout will prompt the customer to correct the address before allowing payment to proceed; it does **not** silently skip tax or proceed with an invalid address

---

## 6. Manual Setup — Configure Payment Methods

1. Open **Settings → Payment methods** (may appear under **Settings → Payment method types** in some accounts).
2. Under **Card**, toggle on **Card**.
3. Leave **Wallet** options (Apple Pay, Google Pay) enabled — Stripe presents them automatically in Checkout when the browser/device supports them.
4. Under **Bank debits** and **Bank transfers**, leave ACH debit, SEPA debit, and similar delayed-notification methods **disabled**.
   The server does not subscribe to `checkout.session.async_payment_succeeded` or `checkout.session.async_payment_failed`, so delayed methods must remain off for launch.

Apple Pay domain verification is **not required** for standard Stripe-hosted Checkout. Stripe manages its own payment domain for hosted Checkout sessions. Domain registration is only needed when using Stripe Elements or a custom payment domain — neither of which applies here.

No Stripe publishable key is needed for the current hosted Checkout integration.

---

## 7. Manual Setup — Configure Promotion Codes

1. Open **Product catalog → Coupons** and click **Create coupon**.
2. Set the discount (percent-off or amount-off), duration, and redemption limits.
3. Click **Create coupon**.
4. On the coupon detail page, click **Create promotion code** to generate a customer-facing code string.
5. Set code-level limits: max redemptions, expiration date, first-time-customer restriction.
6. In **WanderBunnies Admin → Billing**, confirm the **Promotion codes** toggle is enabled for each plan.

The Checkout Session reads `allow_promotion_codes` from Admin → Billing. Leave promotion codes disabled for launch unless a specific Stripe-managed promotion is approved later.

Do not create unrestricted production promotion codes to test Checkout — use sandbox codes first.

---

## 8. Manual Setup — Configure The Customer Portal

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
2. **Pause subscription collection:** leave **off**. Users should not be able to self-service pause via the Portal. Note: the server does handle `customer.subscription.paused` and `customer.subscription.resumed` webhook events (they sync the subscription snapshot and reconcile the tier), so if Stripe sends a pause event for any reason, entitlement is updated correctly. Leaving this toggle off simply prevents customers from initiating a pause themselves.
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

Set the **Default return URL** to match the environment:

| Environment | Return URL |
|---|---|
| Localhost | `http://localhost:19006/` |
| GCP Testing | `https://YOUR-TEST-DOMAIN/` |
| GCP Production | `https://YOUR-WEB-DOMAIN/` |

This URL must match `STRIPE_PORTAL_RETURN_URL` in `server/.env`.

### Portal Configuration ID

If you leave the portal in its default state (configured through the Dashboard), leave `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` unset — the server omits the `configuration` field from portal session creation and Stripe uses the account default.

If you create a separate API-managed configuration (e.g. for multi-tenant or A/B testing), copy its `bpc_...` ID:

```text
STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=bpc_...
```

**After publishing any new Price** (via the WanderBunnies Admin UI or manually), you must return to the Portal configuration and add the new Price to the approved plan catalog. This is a manual step — the Admin UI creates the Stripe Price but does not update the Portal. Customers on older Prices will not see the new Price as a switch target until it is added here.

---

## 9. Manual Setup — Configure Billing Emails And Revenue Recovery

Open **Settings → Billing → Subscriptions and emails** (or **Settings → Billing → Revenue recovery** in newer Dashboard layouts).

### Revenue recovery

1. Enable **Smart Retries**. Leave Stripe's ML-based retry schedule in place.
2. Under **Failed payments**, set the final action after all retries fail to **Cancel subscription**.
   - Rationale: `customer.subscription.deleted` fires, the server receives it via webhook, and the user's tier is downgraded after the grace window. Choosing **Mark as unpaid** instead results in `unpaid` status with no `deleted` event — this is handled by `isSubscriptionPremiumEligible` (unpaid = no Premium) but requires explicit confirmation that the 14-day grace behavior is still correct.
3. Confirm the final-action timing is **not** earlier than 14 days from the first failed invoice. The server's grace period starts at the first `invoice.payment_failed` and lasts exactly 14 days regardless of Stripe's retry schedule.

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

## 10. Manual Setup — Create The Webhook Event Destination

The webhook endpoint path and event list are the same everywhere, but the source of `STRIPE_WEBHOOK_SECRET` differs by environment. Each environment must use the `whsec_...` generated by its own Stripe listener or Dashboard destination.

**Same for all environments:**

1. Configure delivery to `/api/billing/webhooks/stripe`.
2. Select the exact event list below.
3. Pin the webhook API version to `2026-06-24.dahlia`.
4. Copy the generated `whsec_...` into that environment's `server/.env` as `STRIPE_WEBHOOK_SECRET`.

**Event list for all environments:**

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.paused
customer.subscription.resumed
customer.subscription.pending_update_applied
customer.subscription.pending_update_expired
customer.subscription.deleted
customer.subscription.trial_will_end
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
invoice.payment_action_required
charge.refunded
refund.updated
refund.failed
charge.dispute.created
charge.dispute.closed
```

**Endpoint URL patterns:**

```text
Localhost test:  http://localhost:4000/api/billing/webhooks/stripe
GCP test:        https://YOUR-TEST-API-DOMAIN/api/billing/webhooks/stripe
GCP production:  https://YOUR-PROD-API-DOMAIN/api/billing/webhooks/stripe
```

### 10a. Localhost Test — Stripe CLI Listener

> **Applies to:** Localhost testing only

Install the Stripe CLI if not already installed:

```powershell
winget install Stripe.StripeCLI
# or: scoop install stripe
```

Log in and forward events to the local server:

```powershell
stripe login

stripe listen `
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.paused,customer.subscription.resumed,customer.subscription.pending_update_applied,customer.subscription.pending_update_expired,customer.subscription.deleted,customer.subscription.trial_will_end,invoice.paid,invoice.payment_succeeded,invoice.payment_failed,invoice.payment_action_required,charge.refunded,refund.updated,refund.failed,charge.dispute.created,charge.dispute.closed `
  --forward-to http://localhost:4000/api/billing/webhooks/stripe
```

The CLI prints a temporary `whsec_...` value — copy it into `server/.env` as `STRIPE_WEBHOOK_SECRET`. This value differs from the Dashboard endpoint secret and is valid only while `stripe listen` is running.

Use this value only for localhost:

```text
STRIPE_WEBHOOK_SECRET=whsec_from_stripe_listen
```

### 10b. GCP Testing — Dashboard Test-Mode Webhook Destination

> **Applies to:** GCP Testing only

Deploy the test API to a public HTTPS URL before registering the destination. The endpoint must be live and return a valid response before Stripe can verify it.

1. Open the Stripe Dashboard and turn **Test mode** on.
2. Open **Workbench → Webhooks** (or **Developers → Webhooks**).
3. Click **Create an event destination**.
4. Under **Listen to**, select **Events from your account** (not Connect events).
5. Under **Event delivery**, select **Webhook endpoint**.
6. Enter the GCP test endpoint URL:

```text
https://YOUR-TEST-API-DOMAIN/api/billing/webhooks/stripe
```

7. Under **Select events**, click **Select events manually** and enable the event list above.
8. Click **Add endpoint** (or **Create destination**).
9. On the webhook detail page, click **Reveal signing secret**.
10. Copy the test-mode `whsec_...` into the GCP Testing `server/.env`:

```text
STRIPE_WEBHOOK_SECRET=whsec_from_gcp_test_dashboard_destination
```

This is a test-mode Dashboard destination secret. It is different from the localhost `stripe listen` secret even though both environments use test-mode Stripe API keys.

### 10c. GCP Production — Dashboard Live-Mode Webhook Destination

> **Applies to:** GCP Production only

Deploy the production API to a public HTTPS URL before registering the destination. The endpoint must be live and return a valid response before Stripe can verify it.

1. Open the Stripe Dashboard and turn **Test mode** off.
2. Open **Workbench → Webhooks** (or **Developers → Webhooks**).
3. Click **Create an event destination**.
4. Under **Listen to**, select **Events from your account** (not Connect events).
5. Under **Event delivery**, select **Webhook endpoint**.
6. Enter the production endpoint URL:

```text
https://YOUR-PROD-API-DOMAIN/api/billing/webhooks/stripe
```

7. Under **Select events**, click **Select events manually** and enable the event list above.
8. Click **Add endpoint** (or **Create destination**).
9. On the webhook detail page, click **Reveal signing secret**.
10. Copy the live-mode `whsec_...` into the GCP Production `server/.env`:

```text
STRIPE_WEBHOOK_SECRET=whsec_from_gcp_production_dashboard_destination
```

This is a live-mode Dashboard destination secret. Never use it in localhost or GCP Testing.

### 10d. Dashboard Event Destination Notes

> **Applies to:** GCP Testing (test mode keys) and GCP Production (live mode keys)

Create one Dashboard destination for GCP Testing and a separate Dashboard destination for GCP Production. The signing secret is different for the test destination and the live destination. Never use a test-mode secret in live mode or vice versa.

### Pinning the webhook API version

The webhook API version controls the shape of event payloads Stripe delivers to your endpoint. If left unpinned, Stripe uses your account's default version. The server code is pinned to a specific version in `server/src/config/stripeBilling.ts` — the webhook destination should match.

**The API version field does not appear during the creation wizard in the current Stripe Dashboard.** Set it after creation:

1. On the webhook endpoint detail page, find the **API version** row (near the top, alongside the endpoint URL and signing secret).
2. Click the version label or the **Update version** link next to it.
3. In the dropdown, select the version that matches `STRIPE_API_VERSION` in `server/src/config/stripeBilling.ts` (currently `2026-06-24.dahlia`).
4. Click **Update**.

If you do not see an **API version** row or **Update version** link on the detail page, your Stripe Dashboard may be rendering the newer Workbench event-destination UI. In that case:

1. On the destination detail page, click the **⋮** (more options) menu or **Edit destination**.
2. Look for an **Advanced** section or **API version** field.
3. Set it to `2026-06-24.dahlia` and save.

**Alternative — upgrade the server to match your account version instead:**

If you cannot pin the webhook in the Dashboard (e.g. your Stripe plan does not support it), you can instead upgrade the server's pinned version to match your account default. This changes every API request the server makes to use that version's response shapes. Review the [Stripe API changelog](https://docs.stripe.com/changelog) for breaking changes before doing this.

To upgrade the server version, edit `server/src/config/stripeBilling.ts`:

```typescript
export const STRIPE_API_VERSION = getEnvValue('STRIPE_API_VERSION') ?? '2026-06-24.dahlia';
```

Then update the TypeScript types by upgrading the `stripe` npm package:

```powershell
npm --prefix server install stripe@latest
```

Re-run the billing test suite after upgrading to catch any payload-shape regressions.

### Verifying delivery

After any test action, open **Workbench → Webhooks → [your endpoint] → Event deliveries**. Each row shows the event type, the HTTP status code returned by the server, and the response body. A `200` with `{"received":true}` indicates successful processing. A `500` triggers Stripe's automatic retry schedule.

To resend any event manually:

```powershell
# Find the event ID in the Dashboard, then:
stripe events resend evt_...
```

---

## Appendix A — Localhost Environment And Manual Test Commands

> **Applies to:** Localhost testing only

Manual repo checks equivalent to the automated launch gate:

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
  tests/premiumPlanComparisonDialog.test.tsx `
  tests/premiumTrialWelcomeDialog.test.tsx `
  tests/appStartup.test.tsx `
  tests/billing.utils.test.ts `
  tests/useBillingStatus.test.tsx
```

Copy the example file:

```powershell
Copy-Item server/.env.example server/.env
```

Add these values to `server/.env`:

```text
DB_PROVIDER=firebase                        # launch tooling defaults to firebase; use postgres only with DATABASE_URL
STRIPE_BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...               # test mode; rk_test_... is also supported
STRIPE_API_VERSION=2026-06-24.dahlia
STRIPE_WEBHOOK_SECRET=whsec_...             # localhost only: from stripe listen output in section 10a
STRIPE_PREMIUM_PRODUCT_ID=prod_...          # test-mode product ID
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...   # omit if using Admin UI to publish prices
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...    # omit if using Admin UI to publish prices
STRIPE_REQUIRE_TAX_CONFIGURATION=false
STRIPE_TAX_CONFIGURED=false                 # set true only after Dashboard Tax setup is complete
STRIPE_CHECKOUT_SUCCESS_URL=http://localhost:19006/?billing=success
STRIPE_CHECKOUT_CANCEL_URL=http://localhost:19006/?billing=cancel
STRIPE_PORTAL_RETURN_URL=http://localhost:19006/
AUTH_REDIRECT_URI_ALLOWLIST=travelitineraryplanner://  # required for native iOS/Android Google OAuth
BILLING_RECONCILE_ENABLED=true
BILLING_RECONCILE_INTERVAL_MS=86400000
BILLING_SCHEDULER_SECRET=any-local-dev-secret
```

Start the API and web client in separate terminals:

```powershell
npm --prefix server run dev
npm --prefix app run web
```

On startup, the server logs a startup-failure error and exits if `STRIPE_BILLING_ENABLED=true` but any required Stripe variable is missing. It also logs `[stripe] STRIPE_PREMIUM_MONTHLY_PRICE_ID is not set` as an error (non-fatal) when the env var is absent and no active price has been published through the Admin UI yet.

---

## Appendix B — GCP Cloud Run And Cloud Scheduler Commands

> **Applies to:** GCP Testing and GCP Production
>
> All secrets are passed as plain environment variables from `server/.env`. There is no Google Secret Manager and no `.secrets` file in this workflow.

### B1. Set up the environment file

For **GCP Testing**, `server/.env` should contain test-mode Stripe keys:

```text
# DB_PROVIDER is intentionally omitted for Firebase on Cloud Run.
# Set DB_PROVIDER=postgres and DATABASE_URL=... only if deploying against a Postgres backend.
STRIPE_BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...               # test mode; rk_test_... is also supported
STRIPE_API_VERSION=2026-06-24.dahlia
STRIPE_WEBHOOK_SECRET=whsec_...              # GCP test only: from section 10b Dashboard test-mode destination
STRIPE_PREMIUM_PRODUCT_ID=prod_...           # test-mode product
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...    # omit if using Admin UI
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...     # omit if using Admin UI
STRIPE_REQUIRE_TAX_CONFIGURATION=true
STRIPE_TAX_CONFIGURED=true
STRIPE_CHECKOUT_SUCCESS_URL=https://YOUR-TEST-DOMAIN/?billing=success
STRIPE_CHECKOUT_CANCEL_URL=https://YOUR-TEST-DOMAIN/?billing=cancel
STRIPE_PORTAL_RETURN_URL=https://YOUR-TEST-DOMAIN/
AUTH_REDIRECT_URI_ALLOWLIST=travelitineraryplanner://  # required for native iOS/Android Google OAuth
BILLING_RECONCILE_ENABLED=true
BILLING_RECONCILE_INTERVAL_MS=86400000
BILLING_SCHEDULER_SECRET=<random-string>
```

For **GCP Production**, `server/.env` should contain live-mode Stripe keys:

```text
# DB_PROVIDER is intentionally omitted for Firebase on Cloud Run.
# Set DB_PROVIDER=postgres and DATABASE_URL=... only if deploying against a Postgres backend.
STRIPE_BILLING_ENABLED=true
STRIPE_SECRET_KEY=rk_live_...               # restricted live key preferred; sk_live_... is accepted
STRIPE_API_VERSION=2026-06-24.dahlia
STRIPE_WEBHOOK_SECRET=whsec_...              # GCP production only: from section 10c Dashboard live-mode destination
STRIPE_PREMIUM_PRODUCT_ID=prod_...           # live-mode product
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_...    # omit if using Admin UI
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_...     # omit if using Admin UI
STRIPE_REQUIRE_TAX_CONFIGURATION=true
STRIPE_TAX_CONFIGURED=true
STRIPE_CHECKOUT_SUCCESS_URL=https://YOUR-WEB-DOMAIN/?billing=success
STRIPE_CHECKOUT_CANCEL_URL=https://YOUR-WEB-DOMAIN/?billing=cancel
STRIPE_PORTAL_RETURN_URL=https://YOUR-WEB-DOMAIN/
AUTH_REDIRECT_URI_ALLOWLIST=travelitineraryplanner://  # required for native iOS/Android Google OAuth
BILLING_RECONCILE_ENABLED=true
BILLING_RECONCILE_INTERVAL_MS=86400000
BILLING_SCHEDULER_SECRET=<random-string>
```

Generate a strong `BILLING_SCHEDULER_SECRET`:

```powershell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

> **Do not commit `server/.env` to source control.** It is listed in `.gitignore`. These files contain live secret keys; treat them with the same care as passwords.

### B2. Deploy to Cloud Run

```powershell
$ProjectId = 'YOUR_GCP_PROJECT_ID'
$RunRegion = 'us-east5'
$Service   = 'travel-itinerary-app'
gcloud config set project $ProjectId
```

Deploy, reading all configuration (including secrets) from `server/.env`:

```powershell
$env:ENV_FILE     = 'server/.env'
$env:SERVICE_NAME = $Service
$env:REGION       = $RunRegion
.\scripts\deploy-api.ps1
```

The deploy script reads `server/.env` and passes every variable as a plain `--set-env-vars` entry to Cloud Run. Secret values travel as environment variables — they are not visible in Cloud Run logs or in the deployment YAML beyond the initial `gcloud run deploy` call.

Verify the bound environment (values are shown in plain text here — do not share this output):

```powershell
gcloud run services describe $Service `
  --region $RunRegion `
  --format='yaml(spec.template.spec.containers[0].env)'
```

### B3. Configure Cloud Scheduler for durable grace-period enforcement

The in-process scheduler inside Cloud Run uses `setInterval`/`setTimeout` and is reset every time Cloud Run starts a new instance. For durable grace-period enforcement (so that past-due users are downgraded even after instance recycling), set up a Cloud Scheduler job that calls the internal reconciliation endpoint every 30 minutes.

The `BILLING_SCHEDULER_SECRET` you set in `server/.env` (Appendix B1) is already deployed to Cloud Run as a plain env var. Use that same value when creating the scheduler job:

```powershell
# Replace with the value you put in server/.env
$SchedulerSecretValue = 'the-same-value-you-set-in-env'
$ApiDomain = 'https://duerk.org'
$SchedulerRegion = 'us-east4' # Cloud Scheduler supports us-east4; it does not support us-east5.

gcloud scheduler jobs create http billing-reconcile `
  --schedule="*/30 * * * *" `
  --uri="$ApiDomain/api/internal/billing/reconcile" `
  --http-method=POST `
  --headers="Content-Type=application/json,X-Billing-Scheduler-Secret=$SchedulerSecretValue" `
  --message-body='{}' `
  --time-zone=UTC `
  --location=$SchedulerRegion

Remove-Variable SchedulerSecretValue
```

Verify the job was created:

```powershell
gcloud scheduler jobs describe billing-reconcile --location $SchedulerRegion
```

To manually trigger a reconciliation run:

```powershell
gcloud scheduler jobs run billing-reconcile --location $SchedulerRegion
```

> **Separate sandbox and production environments:** `billing_plan_config` stores one active Stripe Price per plan key. It cannot hold both test and live Prices simultaneously. Always use separate databases (and separate Cloud Run deployments) for sandbox and production. Never point a production database at a Stripe test-mode key, or vice versa.

---

## Appendix C — Real Stripe Sandbox Smoke Test

> **Applies to:** Localhost and GCP Testing (test mode keys only)

Set sandbox variables in the current shell, then run the opt-in integration test:

```powershell
$env:STRIPE_SANDBOX_TEST             = '1'
$env:STRIPE_SECRET_KEY               = 'sk_test_...'
$env:STRIPE_API_VERSION              = '2026-06-24.dahlia'
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

## Appendix D — Stripe Test Clock Scenarios

> **Applies to:** Localhost and GCP Testing (test mode only)

Test Clocks let you advance time for a specific Stripe Customer without waiting for real days to pass. Use them to verify trial end, billing cycle renewal, and the 14-day past-due grace period.

> **Important:** The normal WanderBunnies Checkout flow creates a Stripe Customer on the fly (via `stripe.customers.create`) and attaches it to a new Checkout Session. Stripe does **not** allow the app to attach that Customer to a Test Clock via Checkout — the Customer must be created via the Stripe API with `test_clock` set before any subscription is created. This means the Test Clock workflow **cannot use the normal app Checkout UI**. Instead, create the customer and subscription via the Stripe CLI or API, then insert the customer/subscription mapping into the app's database manually (see below) or trigger the `checkout.session.completed` event with a custom payload.

### Option A — Run the PowerShell helper

From the repo root:

```powershell
.\scripts\stripe-test-clock-workflow.ps1 `
  -StripeApiKey $StripeApiKey `
  -UserId $UserId `
  -Email $Email `
  -PublishMissingPrice
```

To also run the failed-payment renewal, day-13/day-15 grace checks, and invoice retry:

```powershell
.\scripts\stripe-test-clock-workflow.ps1 `
  -StripeApiKey $StripeApiKey `
  -UserId $UserId `
  -Email $Email `
  -PublishMissingPrice `
  -RunFailedPaymentFlow
```

The helper:

- reads the active Admin-published monthly Price from `npm run billing:list-plans`
- optionally publishes the missing monthly Price with `-PublishMissingPrice`
- creates the Test Clock, customer, successful default card, subscription, and app billing-customer link
- waits for the Test Clock to become `ready` between advances
- uses the successful card for trial-end payment, then optionally sets a failing card for the renewal/grace checkpoints before setting a successful card again and retrying the latest invoice

The helper uses the same backend selection as the launch validation script: Firebase when `DB_PROVIDER` is omitted, or Postgres when `DB_PROVIDER=postgres` and `DATABASE_URL` are set in `server/.env`.

### Option B — Manual CLI steps

Install `jq` if needed:

```powershell
winget install jqlang.jq
```

**Create a test clock and a customer attached to it:**

```powershell
# Use your full test-mode secret/restricted key. Do not leave this as the
# literal placeholder value `sk_test_...`.
$StripeApiKey = 'sk_test_REPLACE_WITH_YOUR_FULL_TEST_KEY'
if ($StripeApiKey.Length -lt 12 -or $StripeApiKey -notmatch '^(sk|rk)_test_') {
  throw 'Set $StripeApiKey to a full Stripe test-mode API key, e.g. sk_test_... or rk_test_...'
}

# Record the current Unix timestamp
$Now = [int][double]::Parse((Get-Date -UFormat '%s'))

# Create a test clock frozen at "now"
$Clock = stripe test_helpers test_clocks create `
  --frozen-time $Now `
  --name 'WanderBunnies acceptance' `
  --api-key $StripeApiKey | ConvertFrom-Json
$ClockId = $Clock.id
Write-Host "Clock: $ClockId"

function Wait-StripeTestClockReady {
  param(
    [Parameter(Mandatory = $true)][string]$ClockId,
    [Parameter(Mandatory = $true)][string]$StripeApiKey
  )

  do {
    $CurrentClock = stripe test_helpers test_clocks retrieve `
      $ClockId `
      --api-key $StripeApiKey | ConvertFrom-Json

    if ($CurrentClock.status -eq 'ready') {
      Write-Host "Clock ready: $ClockId"
      return
    }
    if ($CurrentClock.status -eq 'internal_failure') {
      throw "Stripe Test Clock failed internally: $ClockId"
    }

    Write-Host "Clock status is $($CurrentClock.status); waiting..."
    Start-Sleep -Seconds 10
  } while ($true)
}
```

Choose the local app user you want to attach to the Stripe Test Clock.

**Firebase / Firestore variant:**

```powershell
# Requires gcloud auth application-default login and FIRESTORE_DATABASE_ID in server/.env
npm run list-users -- --email jobs.duerk@gmail.com
```

Use the printed `User ID` as `$UserId`.

**Postgres variant:**

```powershell
$Email = 'jobs.duerk@gmail.com'
psql $env:DATABASE_URL -c "SELECT id, email, provider, created_at FROM users WHERE lower(email) = lower('$Email');"
```

Use the returned `id` as `$UserId`.

If prices were published through **WanderBunnies Admin → Billing**, read the active Price ID from the configured app backend:

```powershell
npm run billing:list-plans
```

Use the `activeStripePriceId` for `premium_monthly` as `$MonthlyPriceId`. If `activeStripePriceId` is `null`, the Admin page has saved local amount/trial settings but has not published a Stripe Price into this backend yet. Open **Admin → Billing**, publish/save the Premium Monthly price in the same environment, then rerun `npm run billing:list-plans`.

For either backend, set the values you will reuse in the Stripe and app mapping commands:

```powershell
$Email = 'jobs.duerk@gmail.com'
$UserId = 'your-local-test-user-id'
$MonthlyPriceId = 'price_...' # Use the active Premium Monthly test-mode Price ID.

# Create a Stripe customer attached to the clock.
$Customer = stripe customers create `
  -d "email=$Email" `
  -d "metadata[userId]=$UserId" `
  -d "test_clock=$ClockId" `
  --api-key $StripeApiKey | ConvertFrom-Json
Write-Host "Customer: $($Customer.id)"
```

After creating the customer, link the Stripe Customer ID to the app user.

**Firebase / Firestore and Postgres shared command (preferred):**

```powershell
npm run billing:link-customer -- `
  --user-id $UserId `
  --stripe-customer-id $($Customer.id) `
  --email $Email `
  --livemode false `
  --confirm-test-clock-link `
  --allow-replace-test-customer
```

This command uses `DB_PROVIDER` from `server/.env` and defaults to Firebase when `DB_PROVIDER` is omitted. For Firebase, it writes `billing_customers/{userId}` with `stripeCustomerId`, `emailSnapshot`, and `livemode`. For Postgres, it upserts the same mapping in `billing_customers`. It requires `--confirm-test-clock-link` because it writes to the configured backend. `--allow-replace-test-customer` allows repeat Test Clock runs to replace an existing non-live customer link for the same app user; it is rejected for live mappings. Omit that flag if you want the command to fail instead of relinking an already-linked test user.

**Postgres manual SQL variant:**

```sql
-- Run against your local Postgres DB
INSERT INTO billing_customers (user_id, stripe_customer_id, email_snapshot, livemode)
VALUES ('your-local-test-user-id', 'cus_test_...', 'jobs.duerk@gmail.com', false)
ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id;
```

**Firebase manual console variant:**

In Firestore, create or update document `billing_customers/{UserId}`:

```json
{
  "id": "any-generated-uuid",
  "userId": "your-local-test-user-id",
  "stripeCustomerId": "cus_test_...",
  "emailSnapshot": "jobs.duerk@gmail.com",
  "livemode": false,
  "createdAt": "2026-06-30T00:00:00.000Z",
  "updatedAt": "2026-06-30T00:00:00.000Z"
}
```

Now create a subscription via the Stripe API (not through the app Checkout UI):

```powershell
stripe subscriptions create `
  -d "customer=$($Customer.id)" `
  -d "items[0][price]=$MonthlyPriceId" `
  -d "trial_period_days=14" `
  -d "metadata[userId]=$UserId" `
  -d "metadata[planKey]=premium_monthly" `
  --api-key $StripeApiKey
```

Stripe fires `customer.subscription.created`, which the webhook handler picks up and writes the subscription to the configured backend:

- **Firebase / Firestore:** `billing_subscriptions/{stripeSubscriptionId}` and tier state in Firestore.
- **Postgres:** `billing_subscriptions` and `user_tiers`.

**Advance through the trial (14 days):**

```powershell
$TrialEnd = $Now + (14 * 86400) + 3600   # 14 days + 1 hour
stripe test_helpers test_clocks advance `
  $ClockId `
  --frozen-time $TrialEnd `
  --api-key $StripeApiKey

Wait-StripeTestClockReady -ClockId $ClockId -StripeApiKey $StripeApiKey
```

Stripe processes the trial-end invoice, fires `invoice.paid` (if the card succeeds), and transitions the subscription to `active`. Check the WanderBunnies Admin → Billing page to confirm the user's tier moved to `premium`.

**Advance through a billing cycle (renewal test):**

```powershell
$Renewal = $TrialEnd + (30 * 86400) + 3600   # ~1 month later
stripe test_helpers test_clocks advance `
  $ClockId `
  --frozen-time $Renewal `
  --api-key $StripeApiKey

Wait-StripeTestClockReady -ClockId $ClockId -StripeApiKey $StripeApiKey
```

**Simulate a failed payment and the 14-day grace window:**

1. Attach Stripe test card `4000 0000 0000 0341` (always fails) to the test customer before advancing.
2. Advance to renewal. `invoice.payment_failed` fires; the server sets `past_due_since = now`.
3. Advance to day 13 (`$Renewal + (13 * 86400)`). User should still have Premium.
4. Advance to day 15 (`$Renewal + (15 * 86400)`). The grace expiry timer fires; user should be downgraded to `free`.
5. Fix the card (update to `4242 4242 4242 4242`). Trigger a payment retry:

```powershell
# If you saved the subscription create response:
# $Subscription = stripe subscriptions create ... | ConvertFrom-Json
$Subscription = stripe subscriptions retrieve `
  $Subscription.id `
  --api-key $StripeApiKey | ConvertFrom-Json
$InvoiceId = if ($Subscription.latest_invoice -is [string]) {
  $Subscription.latest_invoice
} else {
  $Subscription.latest_invoice.id
}

# If you did not save $Subscription, list recent invoices for this customer:
# $InvoiceId = (stripe invoices list -d "customer=$($Customer.id)" --limit 1 --api-key $StripeApiKey | ConvertFrom-Json).data[0].id

stripe invoices pay $InvoiceId --api-key $StripeApiKey
```

`invoice.paid` fires; the server clears `past_due_since` and re-grants Premium.

**Delete the test clock when finished:**

```powershell
stripe test_helpers test_clocks delete $ClockId --api-key $StripeApiKey
```

---

## Appendix E — Individual Webhook Event Commands

> **Applies to:** Localhost (requires `stripe listen` running in another terminal)

Use these commands during development to test specific handlers without going through Checkout.

```powershell
# Reuse the same full test-mode key from the Test Clock section.
$StripeApiKey = 'sk_test_REPLACE_WITH_YOUR_FULL_TEST_KEY'
if ($StripeApiKey.Length -lt 12 -or $StripeApiKey -notmatch '^(sk|rk)_test_') {
  throw 'Set $StripeApiKey to a full Stripe test-mode API key, e.g. sk_test_... or rk_test_...'
}

# Simulate a new subscription being created
stripe trigger customer.subscription.created --api-key $StripeApiKey

# Simulate a subscription update (e.g. plan switch)
stripe trigger customer.subscription.updated --api-key $StripeApiKey

# Simulate a subscription cancellation
stripe trigger customer.subscription.deleted --api-key $StripeApiKey

# Simulate a trial-ending-soon reminder event
stripe trigger customer.subscription.trial_will_end --api-key $StripeApiKey

# Simulate a successful invoice payment
stripe trigger invoice.paid --api-key $StripeApiKey

# Simulate a failed invoice payment
stripe trigger invoice.payment_failed --api-key $StripeApiKey

# Simulate a 3DS/SCA authentication required scenario
stripe trigger invoice.payment_action_required --api-key $StripeApiKey

# Simulate a full charge refund
stripe trigger charge.refunded --api-key $StripeApiKey

# Simulate a dispute being opened
stripe trigger charge.dispute.created --api-key $StripeApiKey

# Simulate a dispute being won
stripe trigger charge.dispute.closed --api-key $StripeApiKey

# Resend a specific real event by ID (useful after fixing a handler bug)
stripe events resend evt_... --api-key $StripeApiKey
```

Note: `stripe trigger` creates synthetic Stripe objects with auto-generated IDs. The `userId` field in subscription metadata will be absent, so `userIdFromSubscription` falls back to looking up by `stripe_customer_id`. If the synthetic customer ID has no matching billing customer record in the configured backend (`billing_customers/{userId}` in Firestore or `billing_customers` in Postgres), the handler logs `billing.webhook.user_not_found` and skips processing — this is expected behavior for synthetic events.

---

## 11. Manual Sandbox Acceptance Checklist

> **Applies to:** Localhost and GCP Testing

Start `stripe listen` (section 10a, localhost only) and both servers (Appendix A) before running these scenarios. For GCP Testing, use the Dashboard webhook destination (section 10b) and deploy the test configuration (Appendix B).

This checklist is for human-visible acceptance and Dashboard evidence. Run Section 1 first; if `stripe-launch-validation-report.json` already passed a repo test, config check, sandbox smoke test, Test Clock step, or Cloud Scheduler check, use this section only for the customer-facing behavior and Dashboard confirmations that the script cannot observe directly.

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
- [ ] Promotion codes are not shown in Checkout for launch unless explicitly enabled later in Admin → Billing.
- [ ] A user whose normalized email already has a row in `billing_trial_usage` can still check out, but the new Checkout Session has no free trial.
- [ ] Deleting and recreating an app account with the same email does not grant another free trial.

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
- [ ] At day 13 from `past_due_since`, the user still has Premium.
- [ ] At day 15, the grace-expiry timer fires and the user is downgraded to `free`.
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

- [ ] Switching plans in the Portal while on a trial preserves the remaining trial when the Portal's **Keep trial when changing plan** toggle is enabled.
- [ ] If the Portal trial-preservation toggle is disabled in a Stripe environment, switching plans ends the trial immediately and charges the customer at the new plan's rate. Treat that as a Stripe Dashboard configuration issue, not an app-code issue.

**Trial reminders:**

- [ ] `customer.subscription.trial_will_end` deliveries return HTTP 200 and leave the subscription tier as `premium`.
- [ ] `customer.subscription.trial_will_end` creates a Billing notification in Account → Premium.
- [ ] If SMTP is configured, `customer.subscription.trial_will_end` sends one trial-ending email. Replaying the same event does not send a duplicate email.

**Webhook reliability:**

- [ ] Replaying a processed event (`stripe events resend evt_...`) returns `{"received":true,"duplicate":true}` with HTTP 200 and does not change the user's tier.
- [ ] All event deliveries in **Workbench → Webhooks → [endpoint] → Event deliveries** show `200` responses.
- [ ] Note: webhook handlers perform Stripe API calls and DB writes before returning HTTP 200. This is acceptable at launch volume. If processing time grows to >5 seconds, Stripe may retry — plan to move to async queuing if average handler time exceeds 2 seconds under load.

**Reconciliation:**

- [ ] Triggering `POST /api/admin/billing/reconcile/:userId` for a test user returns the correct `result` and current `subscriptions`.
- [ ] Triggering `POST /api/admin/billing/reconcile-batch` processes stale subscriptions without errors.
- [ ] Triggering the Cloud Scheduler job (`gcloud scheduler jobs run billing-reconcile --location $SchedulerRegion`) completes successfully and returns `{"ok":true}` (check Cloud Run logs).

---

## 12. Live Mode Cutover

> **Applies to:** GCP Production only

Stripe sandbox and live objects are separate. Repeat every Dashboard step for live mode:

1. Verify business/public details and branding (section 2).
2. Create the Product (section 3).
3. Create monthly and annual Prices (section 4, Option B) or publish via Admin UI (Option A).
4. Configure Stripe Tax and registrations (section 5).
5. Configure payment methods (section 6). Apple Pay domain verification is not required for hosted Checkout.
6. Configure promotion codes (section 7).
7. Configure the Customer Portal (section 8).
8. Configure billing emails and revenue recovery (section 9).
9. Create a live webhook destination and copy the live signing secret (section 10c).
10. Update `server/.env` with live-mode values and redeploy to the production Cloud Run service (Appendix B).

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
