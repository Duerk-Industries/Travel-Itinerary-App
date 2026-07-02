import * as db from '../server/src/db.ts';
import * as envLoader from '../server/src/env_loader.ts';

const envLoaderApi = ((envLoader as any).default ?? envLoader) as any;

envLoaderApi.loadEnv({ serverOnly: true });
if (!process.env.DB_PROVIDER) process.env.DB_PROVIDER = 'firebase';

const main = async () => {
  await db.initDb();
  const plans = await db.listBillingPlanConfigs();
  console.log(
    JSON.stringify(
      {
        provider: db.getCurrentDbProvider(),
        plans: plans.map((plan) => ({
          planKey: plan.planKey,
          activeStripePriceId: plan.activeStripePriceId,
          unitAmountCents: plan.unitAmountCents,
          currency: plan.currency,
          interval: plan.interval,
          trialDays: plan.trialDays,
        })),
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
    await db.closePool().catch(() => undefined);
  });
