import fs from 'fs';
import path from 'path';

// The Firestore emulator does not enforce composite indexes, but production Firestore rejects a
// query that combines an equality filter with a range or ordering on another field unless an index
// exists. These are the queries in the gap-closing and blog worker code that need one; keep this list
// in step with firestore.indexes.json (deploy with scripts/deploy-firestore-indexes).
const REQUIRED: Array<{ collection: string; fields: string[]; query: string }> = [
  { collection: 'notification_work', fields: ['completed', 'dueAt'], query: 'claimNotificationWork: completed == false, dueAt <= now, orderBy dueAt' },
  { collection: 'notification_work', fields: ['completed', 'expiresAt'], query: 'prunePlanningWork: completed == true, expiresAt <= now' },
  { collection: 'ingestion_mail_receipts', fields: ['state', 'nextAttemptAt'], query: 'mail drain: state == PENDING, nextAttemptAt <= now, orderBy nextAttemptAt' },
  { collection: 'ingestion_mail_receipts', fields: ['userId', 'state'], query: 'mail admission: userId == x, state in [PENDING, HELD]' },
  { collection: 'notifications', fields: ['userId', 'inApp', 'createdAt', '__name__'], query: 'inbox page: userId, inApp, orderBy createdAt desc, __name__ desc' },
  { collection: 'notifications', fields: ['userId', 'inApp', 'readAt', 'createdAt', '__name__'], query: 'unread inbox page' },
  { collection: 'notification_outbox', fields: ['state', 'nextAttemptAt'], query: 'outbox claim: state in [...], nextAttemptAt <= now' },
  { collection: 'itineraries', fields: ['tripId', 'createdAt', '__name__'], query: 'planning bundle: latest itinerary for a trip' },
  // The planning scans (state/status == x ordered by __name__) are served by Firestore's automatic single-field
  // indexes; Firestore rejects a composite for them (HTTP 400 "this index is not necessary"), so none is declared.
  { collection: 'blog_media_assets', fields: ['state', 'createdAt'], query: 'day photo job: state == ready, orderBy createdAt desc' },
  { collection: 'blog_items', fields: ['tripId', 'createdAt'], query: 'day photo reminder: tripId == x, createdAt > cutoff' },
];

describe('firestore.indexes.json', () => {
  const file = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8')) as {
    indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>;
  };

  it.each(REQUIRED)('declares the composite index for $query', ({ collection, fields }) => {
    const found = file.indexes.some(index => index.collectionGroup === collection
      && index.fields.length === fields.length && index.fields.every((field, i) => field.fieldPath === fields[i]));
    expect(found).toBe(true);
  });
});
