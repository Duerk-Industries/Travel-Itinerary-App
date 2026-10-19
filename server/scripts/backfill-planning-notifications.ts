import { getCurrentDbProvider } from '../src/db';
import { getDb } from '../src/db.firebase';
import { logInfo } from '../src/logger';

// Expand-only, bounded and resumable. Dry run unless --apply is supplied.
// Existing notifications were created only for opted-in inbox users, so a
// missing inApp field on a legacy row means true, never a new email consent.
const run = async () => {
  if (getCurrentDbProvider() !== 'firebase') throw new Error('This backfill is for Firestore only');
  const apply = process.argv.includes('--apply');
  const argument = (key: string) => process.argv.find(arg => arg.startsWith(`${key}=`))?.slice(key.length + 1);
  const pages = Math.min(20, Math.max(1, Number(argument('--pages')) || 1));
  let cursor = argument('--cursor') || '';
  let candidates = 0;
  const db = getDb();
  for (let page = 0; page < pages; page++) {
    let query = db.collection('notifications').orderBy('__name__').limit(200);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const missing = snapshot.docs.filter(doc => typeof doc.data().inApp !== 'boolean');
    candidates += missing.length;
    if (apply && missing.length) {
      const batch = db.batch(); missing.forEach(doc => batch.update(doc.ref, { inApp: true })); await batch.commit();
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]?.id || cursor;
    if (snapshot.size < 200) { cursor = ''; break; }
  }
  logInfo(`[planning-backfill] ${JSON.stringify({ apply, candidates, nextCursor: cursor || null })}`);
};
void run().catch(() => { process.exitCode = 1; logInfo('[planning-backfill] failed; no data was deleted'); });
