import { rebuildGroupAccessForAllGroups } from '../server/src/db.firebase';

const run = async () => {
  const result = await rebuildGroupAccessForAllGroups();
  console.log(`[group-access] rebuilt access projections for ${result.groupCount} group(s)`);
};

run().catch((err) => {
  console.error('[group-access] backfill failed', err);
  process.exit(1);
});
