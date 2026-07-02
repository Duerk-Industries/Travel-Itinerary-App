/// <reference types="jest" />
/// <reference types="node" />
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

import { closePool, deleteFlight, getFlightForUser, updateFlight } from '../src/db.firebase';

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

describe('firebase flight membership updates/deletes', () => {
  beforeEach(() => {
    process.env.GCLOUD_PROJECT_ID = 'test-project';
    fakeDb = new FakeFirestore();
  });

  afterEach(async () => {
    await closePool();
  });

  it('allows any trip member to read, update, and delete parser-created flights', async () => {
    const tripId = 'trip-1';
    const groupId = 'group-1';
    const ownerId = 'user-owner';
    const memberId = 'user-member';
    const flightId = 'flight-1';

    await fakeDb.collection('trips').doc(tripId).set({ id: tripId, groupId });
    await fakeDb.collection('group_members').doc('member-1').set({ groupId, userId: memberId, removedAt: null });
    await fakeDb.collection('trip_access').doc(`${tripId}_${memberId}`).set({
      tripId,
      groupId,
      userId: memberId,
      role: 'member',
      status: 'active',
      canRead: true,
      canWrite: true,
    });
    await fakeDb.collection('flights').doc(flightId).set({
      id: flightId,
      userId: ownerId,
      tripId,
      passengerName: 'Bryan Duerk',
      carrier: 'JetBlue',
      flightNumber: 'B6187',
    });

    const visible = await getFlightForUser(flightId, memberId);
    expect(visible?.id).toBe(flightId);

    const updated = await updateFlight(flightId, memberId, { carrier: 'JetBlue Airways' } as any);
    expect(updated?.carrier).toBe('JetBlue Airways');
    expect(fakeDb.getDocData('flights', flightId)?.carrier).toBe('JetBlue Airways');

    await deleteFlight(flightId, memberId);
    expect(fakeDb.getDocData('flights', flightId)).toBeUndefined();
  });

  it('rejects read/update/delete from non-members', async () => {
    const tripId = 'trip-2';
    const groupId = 'group-2';
    const ownerId = 'user-owner';
    const outsiderId = 'user-outsider';
    const flightId = 'flight-2';

    await fakeDb.collection('trips').doc(tripId).set({ id: tripId, groupId });
    await fakeDb.collection('flights').doc(flightId).set({
      id: flightId,
      userId: ownerId,
      tripId,
      passengerName: 'Bryan Duerk',
      carrier: 'JetBlue',
      flightNumber: 'B6187',
    });

    const visible = await getFlightForUser(flightId, outsiderId);
    expect(visible).toBeNull();

    await expect(updateFlight(flightId, outsiderId, { carrier: 'Nope' } as any)).rejects.toThrow('Not authorized to update');
    expect(fakeDb.getDocData('flights', flightId)?.carrier).toBe('JetBlue');

    await expect(deleteFlight(flightId, outsiderId)).rejects.toThrow('Not authorized to delete');
    expect(fakeDb.getDocData('flights', flightId)).toBeDefined();
  });
});
