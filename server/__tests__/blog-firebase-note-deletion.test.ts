let fakeDb: ReturnType<typeof makeFakeDb>;
jest.mock('../src/db.firebase', () => ({ getDb: () => fakeDb }));
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (amount: number) => ({ incrementBy: amount }) } }));
jest.mock('../src/blog/deletedTargetCleanup', () => ({ clearFirebaseDeletedTarget: jest.fn(async () => {}) }));

import { syncItineraryToBlog } from '../src/blog/firebaseRepository';
import { clearFirebaseDeletedTarget } from '../src/blog/deletedTargetCleanup';

type RecordData = Record<string, unknown>;
function makeFakeDb() {
  const tables = new Map<string, Map<string, RecordData>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const doc = (name: string, id: string) => ({
    id,
    get: async () => ({ id, exists: table(name).has(id), data: () => table(name).get(id) }),
    set: async (data: RecordData) => {
      const current = table(name).get(id) ?? {};
      const resolved = Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
        value && typeof value === 'object' && 'incrementBy' in value ? Number(current[key] ?? 0) + Number(value.incrementBy) : value,
      ]));
      table(name).set(id, { ...current, ...resolved });
    },
  });
  const query = (name: string, filters: Array<[string, unknown]> = []) => ({
    where: (field: string, _operator: string, value: unknown) => query(name, [...filters, [field, value]]),
    get: async () => ({ docs: [...table(name)].filter(([, data]) => filters.every(([field, value]) => data[field] === value))
      .map(([id, data]) => ({ id, ref: doc(name, id), data: () => data })) }),
  });
  return {
    table,
    collection: (name: string) => ({ ...query(name), doc: (id: string) => doc(name, id), add: async (data: RecordData) => doc(name, String(table(name).size)).set(data) }),
    batch: () => {
      const writes: Array<() => Promise<void>> = [];
      return {
        set: (ref: ReturnType<typeof doc>, data: RecordData) => { writes.push(() => ref.set(data)); },
        commit: async () => { for (const write of writes) await write(); },
      };
    },
  };
}

it('removes a deleted source note and its source link without touching a manually authored note', async () => {
  fakeDb = makeFakeDb();
  const tripId = 'firebase-note-delete';
  fakeDb.table('trips').set(tripId, { startDate: '2027-01-01', endDate: '2027-01-01' });
  fakeDb.table('trip_blogs').set(tripId, { contentRevision: 1 });
  fakeDb.table('blog_days').set('day', { tripId, localDate: '2027-01-01' });
  fakeDb.table('itineraries').set('itinerary', { tripId });
  fakeDb.table('blog_items').set('linked', { tripId, sourceType: 'itinerary_detail', sourceId: 'removed-note', sourceDetached: true, deletedAt: null, version: 2, tags: ['old-tag'] });
  fakeDb.table('blog_items').set('manual', { tripId, body: 'Independent note', deletedAt: null });
  fakeDb.table('blog_item_source_links').set('itinerary_detail_removed-note', { itemId: 'linked' });

  await syncItineraryToBlog(tripId, 'traveler');

  expect(fakeDb.table('blog_items').get('linked')).toMatchObject({ deletedAt: expect.any(String), tags: [], version: 3 });
  expect(fakeDb.table('blog_item_source_links').get('itinerary_detail_removed-note')).toMatchObject({ detached: true });
  expect(fakeDb.table('trip_blogs').get(tripId)).toMatchObject({ contentRevision: 2 });
  expect(fakeDb.table('blog_items').get('manual')).toMatchObject({ deletedAt: null });
  expect(clearFirebaseDeletedTarget).toHaveBeenCalledWith(fakeDb, 'item', 'linked');
});
