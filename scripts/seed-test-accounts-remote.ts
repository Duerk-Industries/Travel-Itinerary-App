import { runCreateTestAccounts } from './create-test-accounts.ts';

runCreateTestAccounts({ remote: true }).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
