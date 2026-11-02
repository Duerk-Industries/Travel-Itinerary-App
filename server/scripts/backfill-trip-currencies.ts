import { closePool, getCurrentDbProvider } from '../src/db';
import { getDb } from '../src/db.firebase';
import { queryBlog } from '../src/db.postgres';
import { defaultTripCurrency } from '../src/services/tripCurrencyDefaults';
import { logError, logInfo } from '../src/logger';

// Additive and repeatable. Explicit nonempty currency selections always win.
// Run with tsx server/scripts/backfill-trip-currencies.ts [--apply].
const run = async () => {
  const apply = process.argv.includes('--apply');
  let candidates = 0;
  if (getCurrentDbProvider() === 'firebase') {
    const db = getDb();
    let cursor = '';
    for (;;) {
      let query = db.collection('trips').orderBy('__name__').limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        const trip = doc.data();
        if (typeof trip.currency === 'string' && trip.currency.trim()) continue;
        const currency = await defaultTripCurrency(trip.createdBy ?? '', trip.locationIds, trip.destination);
        candidates++;
        if (apply) await db.runTransaction(async tx => {
          const fresh = (await tx.get(doc.ref)).data();
          if (fresh && !(typeof fresh.currency === 'string' && fresh.currency.trim())) tx.update(doc.ref, { currency });
        });
      }
      if (page.size < 200) break;
      cursor = page.docs[page.size - 1].id;
    }
  } else {
    const rows = await queryBlog<{ id: string; locationIds: string[]; destination: string | null }>(`SELECT id,location_ids AS "locationIds",destination FROM trips WHERE currency IS NULL OR trim(currency)=''`, []);
    for (const trip of rows.rows) {
      const currency = await defaultTripCurrency('', trip.locationIds, trip.destination);
      candidates++;
      if (apply) await queryBlog(`UPDATE trips SET currency=$2 WHERE id=$1 AND (currency IS NULL OR trim(currency)='')`, [trip.id, currency]);
    }
  }
  logInfo(`[trip-currency-backfill] ${JSON.stringify({ apply, candidates })}`);
};
void run().catch(error => { logError('Trip currency backfill failed', error); process.exitCode = 1; }).finally(closePool);
