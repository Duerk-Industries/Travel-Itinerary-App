import { rebuildTripAccessForAllTrips } from '../server/src/db.firebase';

const run = async () => {
  const result = await rebuildTripAccessForAllTrips();
  console.log(`[trip-access] rebuilt access projections for ${result.tripCount} trip(s)`);
};

run().catch((err) => {
  console.error('[trip-access] backfill failed', err);
  process.exit(1);
});
