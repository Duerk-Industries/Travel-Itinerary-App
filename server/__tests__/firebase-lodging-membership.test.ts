let fakeDb: FakeFirestore;

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({ name: 'fake-app' })),
  getApps: jest.fn(() => []),
  deleteApp: jest.fn(async () => {}),
}));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb as any,
  FieldPath: { documentId: () => '__name__' },
}));

import { closePool, deleteLodging, listLodgings, updateLodging } from '../src/db.firebase';

class FakeDocSnapshot {
  constructor(public id: string, private value: any) {}
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value;
  }
}

class FakeQuerySnapshot {
  constructor(public docs: Array<{ id: string; data: () => any }>) {}
  get empty() {
    return this.docs.length === 0;
  }
}

type Filter = { field: string; op: string; value: any };

class FakeQuery {
  constructor(private collection: FakeCollection, private filters: Filter[], private limitCount?: number) {}
  where(field: string, op: string, value: any) {
    return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.limitCount);
  }
  limit(count: number) {
    return new FakeQuery(this.collection, this.filters, count);
  }
  async get() {
    const matches = this.collection
      .all()
      .filter((doc) =>
        this.filters.every((f) => {
          const docValue = doc.data[f.field];
          if (f.op === 'in') {
            return Array.isArray(f.value) && f.value.includes(docValue);
          }
          return docValue === f.value;
        })
      )
      .slice(0, this.limitCount ?? undefined)
      .map((doc) => ({ id: doc.id, data: () => doc.data }));
    return new FakeQuerySnapshot(matches);
  }
}

class FakeDocRef {
  constructor(private collection: FakeCollection, private id: string) {}
  async get() {
    const data = this.collection.get(this.id);
    return new FakeDocSnapshot(this.id, data);
  }
  async set(value: any) {
    this.collection.set(this.id, value);
  }
  async update(value: any) {
    const existing = this.collection.get(this.id) ?? {};
    this.collection.set(this.id, { ...existing, ...value });
  }
  async delete() {
    this.collection.delete(this.id);
  }
}

class FakeCollection {
  constructor(private store: Map<string, any>) {}
  doc(id: string) {
    return new FakeDocRef(this, id);
  }
  where(field: string, op: string, value: any) {
    return new FakeQuery(this, [{ field, op, value }], undefined);
  }
  set(id: string, value: any) {
    this.store.set(id, value);
  }
  get(id: string) {
    return this.store.get(id);
  }
  delete(id: string) {
    this.store.delete(id);
  }
  all() {
    return Array.from(this.store.entries()).map(([id, data]) => ({ id, data }));
  }
}

class FakeFirestore {
  private collections = new Map<string, Map<string, any>>();
  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return new FakeCollection(this.collections.get(name)!);
  }
  getDocData(name: string, id: string) {
    return this.collections.get(name)?.get(id);
  }
}

describe('firebase lodging membership updates/deletes', () => {
  beforeEach(() => {
    process.env.GCLOUD_PROJECT_ID = 'test-project';
    fakeDb = new FakeFirestore();
  });

  afterEach(async () => {
    await closePool();
  });

  it('allows any trip member to update and delete lodgings', async () => {
    const tripId = 'trip-1';
    const groupId = 'group-1';
    const ownerId = 'user-owner';
    const memberId = 'user-member';
    const lodgingId = 'lodging-1';

    await fakeDb.collection('trips').doc(tripId).set({ id: tripId, groupId });
    await fakeDb.collection('group_members').doc('member-1').set({ groupId, userId: memberId, removedAt: null });
    await fakeDb.collection('lodgings').doc(lodgingId).set({
      id: lodgingId,
      user_id: ownerId,
      trip_id: tripId,
      name: 'Old Hotel',
    });

    const updated = await updateLodging(lodgingId, memberId, { name: 'New Hotel' } as any);
    expect(updated?.name).toBe('New Hotel');
    expect(fakeDb.getDocData('lodgings', lodgingId)?.name).toBe('New Hotel');

    await deleteLodging(lodgingId, memberId);
    expect(fakeDb.getDocData('lodgings', lodgingId)).toBeUndefined();
  });

  it('rejects updates/deletes from non-members', async () => {
    const tripId = 'trip-2';
    const groupId = 'group-2';
    const ownerId = 'user-owner';
    const nonMemberId = 'user-outsider';
    const lodgingId = 'lodging-2';

    await fakeDb.collection('trips').doc(tripId).set({ id: tripId, groupId });
    await fakeDb.collection('lodgings').doc(lodgingId).set({
      id: lodgingId,
      user_id: ownerId,
      trip_id: tripId,
      name: 'Locked Hotel',
    });

    const updated = await updateLodging(lodgingId, nonMemberId, { name: 'Nope' } as any);
    expect(updated).toBeNull();
    expect(fakeDb.getDocData('lodgings', lodgingId)?.name).toBe('Locked Hotel');

    await deleteLodging(lodgingId, nonMemberId);
    expect(fakeDb.getDocData('lodgings', lodgingId)).toBeDefined();
  });

  it('lists all lodgings for trips in the user group', async () => {
    const tripId = 'trip-3';
    const groupId = 'group-3';
    const ownerId = 'user-owner';
    const memberId = 'user-member';
    const otherMemberId = 'user-other';

    await fakeDb.collection('trips').doc(tripId).set({ id: tripId, groupId });
    await fakeDb.collection('group_members').doc('member-1').set({ groupId, userId: memberId, removedAt: null });
    await fakeDb.collection('group_members').doc('member-2').set({ groupId, userId: otherMemberId, removedAt: null });

    await fakeDb.collection('lodgings').doc('lodging-a').set({
      id: 'lodging-a',
      user_id: ownerId,
      trip_id: tripId,
      name: 'Member A Hotel',
    });
    await fakeDb.collection('lodgings').doc('lodging-b').set({
      id: 'lodging-b',
      user_id: otherMemberId,
      trip_id: tripId,
      name: 'Member B Hotel',
    });

    const lodgings = await listLodgings(memberId);
    const names = lodgings.map((l) => l.name).sort();
    expect(names).toEqual(['Member A Hotel', 'Member B Hotel']);
  });
});
