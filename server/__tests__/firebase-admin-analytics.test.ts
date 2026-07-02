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
  FieldValue: {
    increment: (value: number) => ({ __increment: value }),
  },
}));

import {
  acceptGroupInvite,
  adminGetUserData,
  closePool,
  deleteGroup,
  rebuildGroupAccessForGroup,
  rebuildTripAccessForTrip,
  rejectGroupInvite,
  updateTripGroup,
} from '../src/db.firebase';

type Filter = { field: string; op: string; value: any };
type BatchOp =
  | { kind: 'set'; ref: FakeDocRef; value: any; options?: { merge?: boolean } }
  | { kind: 'update'; ref: FakeDocRef; value: any }
  | { kind: 'delete'; ref: FakeDocRef };

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const applyValue = (current: any, incoming: any): any => {
  if (isPlainObject(incoming) && '__increment' in incoming) {
    return Number(current ?? 0) + Number((incoming as any).__increment ?? 0);
  }
  if (isPlainObject(incoming)) {
    const base = isPlainObject(current) ? { ...current } : {};
    for (const [key, value] of Object.entries(incoming)) {
      base[key] = applyValue(base[key], value);
    }
    return base;
  }
  return incoming;
};

const mergeData = (current: any, incoming: any): any => {
  if (!isPlainObject(incoming)) return incoming;
  const base = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(incoming)) {
    base[key] = applyValue(base[key], value);
  }
  return base;
};

class FakeDocSnapshot {
  constructor(public id: string, private value: any, public ref: FakeDocRef) {}
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value;
  }
}

class FakeQuerySnapshot {
  constructor(public docs: FakeDocSnapshot[]) {}
  get empty() {
    return this.docs.length === 0;
  }
  forEach(callback: (doc: FakeDocSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

class FakeDocRef {
  constructor(private collection: FakeCollection, public id: string) {}
  async get() {
    return new FakeDocSnapshot(this.id, this.collection.getById(this.id), this);
  }
  async set(value: any, options?: { merge?: boolean }) {
    this.collection.set(this.id, value, options);
  }
  async update(value: any) {
    this.collection.update(this.id, value);
  }
  async delete() {
    this.collection.delete(this.id);
  }
}

class FakeQuery {
  constructor(
    private collection: FakeCollection,
    private filters: Filter[] = [],
    private limitCount?: number,
  ) {}

  where(field: string, op: string, value: any) {
    return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.limitCount);
  }

  limit(count: number) {
    return new FakeQuery(this.collection, this.filters, count);
  }

  orderBy(_field: string, _direction?: 'asc' | 'desc') {
    return new FakeQuery(this.collection, this.filters, this.limitCount);
  }

  async get() {
    const docs = this.collection
      .all()
      .filter(({ data }) =>
        this.filters.every((filter) => {
          const value = data[filter.field];
          if (filter.op === '==') return value === filter.value;
          if (filter.op === 'in') return Array.isArray(filter.value) && filter.value.includes(value);
          return false;
        })
      )
      .slice(0, this.limitCount ?? undefined)
      .map(({ id, data }) => new FakeDocSnapshot(id, data, this.collection.doc(id)));
    return new FakeQuerySnapshot(docs);
  }
}

class FakeCollection {
  constructor(private store: Map<string, any>) {}

  doc(id: string) {
    return new FakeDocRef(this, id);
  }

  where(field: string, op: string, value: any) {
    return new FakeQuery(this, [{ field, op, value }]);
  }

  async get() {
    return new FakeQuerySnapshot(this.all().map(({ id, data }) => new FakeDocSnapshot(id, data, this.doc(id))));
  }

  set(id: string, value: any, options?: { merge?: boolean }) {
    if (options?.merge) {
      this.store.set(id, mergeData(this.store.get(id), value));
      return;
    }
    this.store.set(id, value);
  }

  update(id: string, value: any) {
    this.store.set(id, mergeData(this.store.get(id), value));
  }

  getById(id: string) {
    return this.store.get(id);
  }

  delete(id: string) {
    this.store.delete(id);
  }

  all() {
    return Array.from(this.store.entries()).map(([id, data]) => ({ id, data }));
  }
}

class FakeBatch {
  private ops: BatchOp[] = [];

  set(ref: FakeDocRef, value: any, options?: { merge?: boolean }) {
    this.ops.push({ kind: 'set', ref, value, options });
  }

  update(ref: FakeDocRef, value: any) {
    this.ops.push({ kind: 'update', ref, value });
  }

  delete(ref: FakeDocRef) {
    this.ops.push({ kind: 'delete', ref });
  }

  async commit() {
    for (const op of this.ops) {
      if (op.kind === 'set') await op.ref.set(op.value, op.options);
      if (op.kind === 'update') await op.ref.update(op.value);
      if (op.kind === 'delete') await op.ref.delete();
    }
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

  batch() {
    return new FakeBatch();
  }

  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map((ref) => ref.get()));
  }

  getDocData(collectionName: string, id: string) {
    return this.collections.get(collectionName)?.get(id);
  }
}

const seedTier = async (tierKey: string, rank: number) => {
  await fakeDb.collection('tiers').doc(tierKey).set({
    id: tierKey,
    key: tierKey,
    displayName: tierKey[0].toUpperCase() + tierKey.slice(1),
    rank,
    isActive: true,
    createdAt: '2026-03-01T00:00:00.000Z',
  });
};

const seedUser = async (id: string, email: string, role = 'user', createdAt = '2026-03-01T00:00:00.000Z') => {
  await fakeDb.collection('users').doc(id).set({ email, role, createdAt });
};

const seedUserTier = async (docId: string, userId: string, tierKey = 'free') => {
  await fakeDb.collection('user_tiers').doc(docId).set({
    userId,
    tierId: tierKey,
    tierKey,
    effectiveFrom: '2026-03-01T00:00:00.000Z',
    effectiveTo: null,
    source: 'system',
  });
};

describe('firebase admin analytics mutations', () => {
  beforeEach(async () => {
    process.env.GCLOUD_PROJECT_ID = 'test-project';
    fakeDb = new FakeFirestore();
    await seedTier('free', 1);
  });

  afterEach(async () => {
    await closePool();
  });

  it('updates analytics on invite acceptance and exposes the count via admin user data', async () => {
    await seedUser('owner-1', 'owner@example.com');
    await seedUser('member-1', 'member@example.com');
    await seedUserTier('ut-owner', 'owner-1');
    await seedUserTier('ut-member', 'member-1');

    await fakeDb.collection('groups').doc('group-1').set({ ownerId: 'owner-1', name: 'Group 1', createdAt: '2026-03-02T00:00:00.000Z' });
    await fakeDb.collection('group_members').doc('gm-owner').set({ groupId: 'group-1', userId: 'owner-1', removedAt: null });
    await fakeDb.collection('group_members').doc('gm-invite').set({ groupId: 'group-1', inviteEmail: 'member@example.com', removedAt: null });
    await fakeDb.collection('trips').doc('trip-1').set({ groupId: 'group-1', name: 'Trip 1', createdAt: '2026-03-03T00:00:00.000Z' });
    await fakeDb.collection('group_invites').doc('invite-1').set({
      groupId: 'group-1',
      inviterId: 'owner-1',
      inviteeEmail: 'member@example.com',
      inviteeUserId: null,
      status: 'pending',
      createdAt: '2026-03-03T00:00:00.000Z',
    });

    await acceptGroupInvite('invite-1', 'member-1', 'member@example.com');

    const analytics = fakeDb.getDocData('admin_user_analytics', 'member-1');
    expect(analytics?.tripCount).toBe(1);

    const userData = await adminGetUserData({ window: 'all-time', page: 1, limit: 10 });
    const memberRow = userData.users.find((user) => user.id === 'member-1');
    expect(memberRow?.tripCount).toBe(1);
  });

  it('decrements analytics on invite rejection when a resolved user membership exists', async () => {
    await seedUser('member-2', 'member2@example.com');
    await fakeDb.collection('groups').doc('group-2').set({ ownerId: 'owner-2', name: 'Group 2', createdAt: '2026-03-02T00:00:00.000Z' });
    await fakeDb.collection('group_members').doc('gm-member').set({
      groupId: 'group-2',
      userId: 'member-2',
      inviteEmail: 'member2@example.com',
      removedAt: null,
    });
    await fakeDb.collection('trips').doc('trip-2').set({ groupId: 'group-2', name: 'Trip 2', createdAt: '2026-03-03T00:00:00.000Z' });
    await fakeDb.collection('group_invites').doc('invite-2').set({
      groupId: 'group-2',
      inviteeEmail: 'member2@example.com',
      inviteeUserId: 'member-2',
      status: 'pending',
      createdAt: '2026-03-03T00:00:00.000Z',
    });
    await fakeDb.collection('admin_user_analytics').doc('member-2').set({
      userId: 'member-2',
      tripCount: 1,
      backfilledAt: '2026-03-04T00:00:00.000Z',
      analyticsVersion: 1,
    });
    await rebuildGroupAccessForGroup('group-2');
    await rebuildTripAccessForTrip('trip-2');

    await rejectGroupInvite('invite-2', 'member-2', 'member2@example.com');

    expect(fakeDb.getDocData('admin_user_analytics', 'member-2')?.tripCount).toBe(0);
    expect(fakeDb.getDocData('group_invites', 'invite-2')).toBeUndefined();
    expect(fakeDb.getDocData('group_members', 'gm-member')?.removedAt).toBeTruthy();
  });

  it('rebalances analytics when moving a trip between groups', async () => {
    await seedUser('actor-1', 'actor@example.com');
    await seedUser('old-only-1', 'old@example.com');
    await seedUser('new-only-1', 'new@example.com');

    await fakeDb.collection('groups').doc('group-old').set({ ownerId: 'actor-1', name: 'Old', createdAt: '2026-03-02T00:00:00.000Z' });
    await fakeDb.collection('groups').doc('group-new').set({ ownerId: 'actor-1', name: 'New', createdAt: '2026-03-02T00:00:00.000Z' });
    await fakeDb.collection('group_members').doc('gm-actor-old').set({ groupId: 'group-old', userId: 'actor-1', removedAt: null });
    await fakeDb.collection('group_members').doc('gm-old-only').set({ groupId: 'group-old', userId: 'old-only-1', removedAt: null });
    await fakeDb.collection('group_members').doc('gm-actor-new').set({ groupId: 'group-new', userId: 'actor-1', removedAt: null });
    await fakeDb.collection('group_members').doc('gm-new-only').set({ groupId: 'group-new', userId: 'new-only-1', removedAt: null });
    await fakeDb.collection('trips').doc('trip-move').set({ groupId: 'group-old', name: 'Trip Move', createdAt: '2026-03-03T00:00:00.000Z' });
    await fakeDb.collection('admin_user_analytics').doc('actor-1').set({ userId: 'actor-1', tripCount: 1, backfilledAt: '2026-03-04T00:00:00.000Z' });
    await fakeDb.collection('admin_user_analytics').doc('old-only-1').set({ userId: 'old-only-1', tripCount: 1, backfilledAt: '2026-03-04T00:00:00.000Z' });
    await fakeDb.collection('admin_user_analytics').doc('new-only-1').set({ userId: 'new-only-1', tripCount: 0, backfilledAt: '2026-03-04T00:00:00.000Z' });
    await rebuildGroupAccessForGroup('group-old');
    await rebuildGroupAccessForGroup('group-new');
    await rebuildTripAccessForTrip('trip-move');

    await updateTripGroup('actor-1', 'trip-move', 'group-new');

    expect(fakeDb.getDocData('admin_user_analytics', 'actor-1')?.tripCount).toBe(1);
    expect(fakeDb.getDocData('admin_user_analytics', 'old-only-1')?.tripCount).toBe(0);
    expect(fakeDb.getDocData('admin_user_analytics', 'new-only-1')?.tripCount).toBe(1);
  });

  it('decrements analytics for all active users when a group is deleted', async () => {
    await seedUser('owner-3', 'owner3@example.com');
    await seedUser('member-3', 'member3@example.com');

    await fakeDb.collection('groups').doc('group-delete').set({ ownerId: 'owner-3', name: 'Delete Me', createdAt: '2026-03-02T00:00:00.000Z' });
    await fakeDb.collection('group_members').doc('gm-owner-3').set({ groupId: 'group-delete', userId: 'owner-3', removedAt: null });
    await fakeDb.collection('group_members').doc('gm-member-3').set({ groupId: 'group-delete', userId: 'member-3', removedAt: null });
    await fakeDb.collection('trips').doc('trip-a').set({ groupId: 'group-delete', name: 'Trip A', createdAt: '2026-03-03T00:00:00.000Z' });
    await fakeDb.collection('trips').doc('trip-b').set({ groupId: 'group-delete', name: 'Trip B', createdAt: '2026-03-04T00:00:00.000Z' });
    await fakeDb.collection('trip_removals').doc('tr-member').set({ tripId: 'trip-b', userId: 'member-3', createdAt: '2026-03-05T00:00:00.000Z' });
    await fakeDb.collection('admin_user_analytics').doc('owner-3').set({ userId: 'owner-3', tripCount: 2, backfilledAt: '2026-03-05T00:00:00.000Z' });
    await fakeDb.collection('admin_user_analytics').doc('member-3').set({ userId: 'member-3', tripCount: 1, backfilledAt: '2026-03-05T00:00:00.000Z' });
    await rebuildGroupAccessForGroup('group-delete');
    await rebuildTripAccessForTrip('trip-a');
    await rebuildTripAccessForTrip('trip-b');

    await deleteGroup('owner-3', 'group-delete');

    expect(fakeDb.getDocData('admin_user_analytics', 'owner-3')?.tripCount).toBe(0);
    expect(fakeDb.getDocData('admin_user_analytics', 'member-3')?.tripCount).toBe(0);
    expect(fakeDb.getDocData('groups', 'group-delete')).toBeUndefined();
    expect(fakeDb.getDocData('trips', 'trip-a')).toBeUndefined();
    expect(fakeDb.getDocData('trips', 'trip-b')).toBeUndefined();
  });
});
