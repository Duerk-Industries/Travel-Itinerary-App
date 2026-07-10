import * as db from '../server/src/db.ts';
import * as envLoader from '../server/src/env_loader.ts';
import { getStripeClient } from '../server/src/billing/stripeClient.ts';
import {
  getStripePremiumProductId,
  isStripeBillingEnabled,
} from '../server/src/config/stripeBilling.ts';
import type { BillingPlanKey } from '../server/src/types.ts';

const envLoaderApi = ((envLoader as any).default ?? envLoader) as any;

envLoaderApi.loadEnv({ serverOnly: true });
if (!process.env.DB_PROVIDER) process.env.DB_PROVIDER = 'firebase';

const getArg = (name: string): string => {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  return index >= 0 ? String(process.argv[index + 1] ?? '').trim() : '';
};

const printHelp = () => {
  console.log(`Usage:
  npm run billing:publish-price -- --plan-key premium_monthly --confirm-publish-price

Creates a new Stripe Price for the configured plan and stores it as active in
the configured backend. Use premium_monthly or premium_annual.
`);
};

let openedDb = false;

const main = async () => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const planKey = getArg('plan-key') as BillingPlanKey;
  const confirmed = process.argv.includes('--confirm-publish-price');
  if (planKey !== 'premium_monthly' && planKey !== 'premium_annual') {
    throw new Error('--plan-key must be premium_monthly or premium_annual');
  }
  if (!confirmed) throw new Error('Refusing to publish without --confirm-publish-price');
  if (!isStripeBillingEnabled()) throw new Error('STRIPE_BILLING_ENABLED is not true');

  const stripeProductId = getStripePremiumProductId();
  if (!stripeProductId) throw new Error('STRIPE_PREMIUM_PRODUCT_ID is not configured');

  await db.initDb();
  openedDb = true;
  const config = await db.getBillingPlanConfig(planKey);
  if (!config) throw new Error(`No billing plan config found for ${planKey}`);

  const interval = planKey === 'premium_annual' ? 'year' : 'month';
  const lookupKey =
    planKey === 'premium_annual' ? 'wanderbunnies_premium_annual' : 'wanderbunnies_premium_monthly';

  const stripe = getStripeClient();
  const stripePrice = await stripe.prices.create({
    product: stripeProductId,
    unit_amount: config.unitAmountCents,
    currency: config.currency,
    recurring: { interval },
    tax_behavior: 'exclusive',
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { planKey, createdBy: 'publish-billing-price-script' },
  });

  await db.deactivateOldPricesForPlan(planKey, stripePrice.id);
  await db.insertBillingPriceHistory({
    stripePriceId: stripePrice.id,
    planKey,
    stripeProductId,
    unitAmountCents: config.unitAmountCents,
    currency: config.currency,
    interval,
    livemode: stripePrice.livemode,
    activeForNewCheckout: true,
    createdBy: null,
  });
  const updated = await db.upsertBillingPlanConfig({
    planKey,
    activeStripePriceId: stripePrice.id,
    unitAmountCents: config.unitAmountCents,
    currency: config.currency,
    updatedBy: null,
  });

  console.log(
    JSON.stringify(
      {
        provider: db.getCurrentDbProvider(),
        planKey,
        activeStripePriceId: updated.activeStripePriceId,
        unitAmountCents: updated.unitAmountCents,
        currency: updated.currency,
        livemode: stripePrice.livemode,
      },
      null,
      2,
    ),
  );
};

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (openedDb) await db.closePool().catch(() => undefined);
  });
