import * as db from '../server/src/db.ts';
import * as envLoader from '../server/src/env_loader.ts';

const envLoaderApi = ((envLoader as any).default ?? envLoader) as any;

envLoaderApi.loadEnv({ serverOnly: true });
if (!process.env.DB_PROVIDER) process.env.DB_PROVIDER = 'firebase';

const printHelp = () => {
  console.log(`Usage:
  npm run billing:link-customer -- --user-id <app-user-id> --stripe-customer-id <cus_...> --email <email> [--livemode true|false]

Creates or updates the app billing customer mapping using DB_PROVIDER from server/.env.
Defaults to Firebase when DB_PROVIDER is omitted.
If the user already has a different Stripe customer ID, the script refuses to
replace it unless --allow-replace-test-customer is provided for a non-live test
mapping.

Requires --confirm-test-clock-link because this writes to the configured backend.
`);
};

const getArg = (name: string): string => {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  return index >= 0 ? String(process.argv[index + 1] ?? '').trim() : '';
};

let openedDb = false;

const main = async () => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const userId = getArg('user-id');
  const stripeCustomerId = getArg('stripe-customer-id');
  const email = getArg('email').toLowerCase();
  const livemodeRaw = getArg('livemode');
  const livemode = livemodeRaw === 'true';
  const confirmed = process.argv.includes('--confirm-test-clock-link');
  const allowReplaceTestCustomer = process.argv.includes('--allow-replace-test-customer');

  if (!userId) throw new Error('Missing --user-id');
  if (!stripeCustomerId || !stripeCustomerId.startsWith('cus_')) {
    throw new Error('Missing --stripe-customer-id or value does not start with cus_');
  }
  if (!email || !email.includes('@')) throw new Error('Missing --email');
  if (livemodeRaw && livemodeRaw !== 'true' && livemodeRaw !== 'false') {
    throw new Error('--livemode must be true or false when provided');
  }
  if (!confirmed) {
    throw new Error('Refusing to write without --confirm-test-clock-link');
  }

  await db.initDb();
  openedDb = true;
  const existing = await db.getBillingCustomerByUserId(userId);
  if (existing && existing.stripeCustomerId !== stripeCustomerId) {
    if (allowReplaceTestCustomer && !livemode && existing.livemode === false) {
      console.warn(
        `Replacing existing test Stripe customer link for user ${userId}: ` +
        `${existing.stripeCustomerId} -> ${stripeCustomerId}`,
      );
    } else {
      throw new Error(
        `User ${userId} is already linked to Stripe customer ${existing.stripeCustomerId}. ` +
        `Refusing to replace it with ${stripeCustomerId}; use --allow-replace-test-customer for a non-live Test Clock rerun, ` +
        `or update the test database manually if this is intentional.`,
      );
    }
  }

  const record = await db.upsertBillingCustomer({
    userId,
    stripeCustomerId,
    emailSnapshot: email,
    livemode,
  });

  console.log(
    JSON.stringify(
      {
        provider: db.getCurrentDbProvider(),
        userId: record.userId,
        stripeCustomerId: record.stripeCustomerId,
        emailSnapshot: record.emailSnapshot,
        livemode: record.livemode,
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
