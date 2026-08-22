/// <reference types="jest" />
/// <reference types="node" />

// Phase 2's Firebase adapter parity coverage — see the note at the top of
// blog/firebaseEngagementRepository.ts: this repo has no Firestore emulator available, so this
// follows the established pattern in firebase-lodging-membership.test.ts /
// firebase-admin-analytics.test.ts / ingestion.repository.firebase.test.ts of a hand-rolled
// FakeFirestore rather than a real one. It combines FieldValue.increment support (from
// firebase-admin-analytics.test.ts) with transaction support (from
// ingestion.repository.firebase.test.ts) — this repository needs both, and no single existing
// fake in this codebase had both together.
let fakeDb: FakeFirestore;

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({ name: 'fake-app' })),
  getApps: jest.fn(() => []),
  deleteApp: jest.fn(async () => {}),
}));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb as any,
  FieldValue: { increment: (value: number) => ({ __increment: value }) },
}));

jest.mock('../src/db.firebase', () => ({ getDb: () => fakeDb }));

import * as engagement from '../src/blog/firebaseEngagementRepository';

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const applyValue = (current: any, incoming: any): any => {
  if (isPlainObject(incoming) && '__increment' in incoming) {
    return Number(current ?? 0) + Number((incoming as any).__increment ?? 0);
  }
  if (isPlainObject(incoming)) {
    const base = isPlainObject(current) ? { ...current } : {};
    for (const [key, value] of Object.entries(incoming)) base[key] = applyValue(base[key], value);
    return base;
  }
  return incoming;
};

const mergeData = (current: any, incoming: any): any => {
  if (!isPlainObject(incoming)) return incoming;
  const base = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(incoming)) base[key] = applyValue(base[key], value);
  return base;
};

class FakeDocSnapshot {
  constructor(public id: string, private value: any) {}
  get exists() { return this.value !== undefined; }
  data() { return this.value; }
}
class FakeQuerySnapshot {
  constructor(public docs: FakeDocSnapshot[]) {}
  get empty() { return this.docs.length === 0; }
}
type Filter = { field: string; op: string; value: any };
class FakeQuery {
  constructor(private collection: FakeCollection, private filters: Filter[] = [], private limitCount?: number) {}
  where(field: string, op: string, value: any) { return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.limitCount); }
  limit(count: number) { return new FakeQuery(this.collection, this.filters, count); }
  async get() {
    const docs = this.collection.all()
      .filter(({ data }) => this.filters.every((f) => data[f.field] === f.value))
      .slice(0, this.limitCount ?? undefined)
      .map(({ id, data }) => new FakeDocSnapshot(id, data));
    return new FakeQuerySnapshot(docs);
  }
}
class FakeDocRef {
  constructor(private collection: FakeCollection, public id: string) {}
  async get() { return new FakeDocSnapshot(this.id, this.collection.getById(this.id)); }
  async set(value: any, options?: { merge?: boolean }) { this.collection.set(this.id, value, options); }
  async delete() { this.collection.delete(this.id); }
}
class FakeCollection {
  constructor(private store: Map<string, any>) {}
  doc(id: string) { return new FakeDocRef(this, id); }
  where(field: string, op: string, value: any) { return new FakeQuery(this, [{ field, op, value }]); }
  set(id: string, value: any, options?: { merge?: boolean }) {
    this.store.set(id, options?.merge ? mergeData(this.store.get(id), value) : value);
  }
  getById(id: string) { return this.store.get(id); }
  delete(id: string) { this.store.delete(id); }
  all() { return Array.from(this.store.entries()).map(([id, data]) => ({ id, data })); }
}
class FakeFirestore {
  private collections = new Map<string, Map<string, any>>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return new FakeCollection(this.collections.get(name)!);
  }
  // No real isolation/atomicity — a plain forward onto the same store, sufficient for a
  // sequential unit test double, not a concurrency test.
  async runTransaction<T>(callback: (tx: { get: (ref: FakeDocRef) => Promise<FakeDocSnapshot>; set: (ref: FakeDocRef, value: any, options?: { merge?: boolean }) => void; delete: (ref: FakeDocRef) => void }) => Promise<T>): Promise<T> {
    const tx = {
      get: async (ref: FakeDocRef) => ref.get(),
      set: (ref: FakeDocRef, value: any, options?: { merge?: boolean }) => { void ref.set(value, options); },
      delete: (ref: FakeDocRef) => { void ref.delete(); },
    };
    return callback(tx);
  }
  getDocData(name: string, id: string) { return this.collections.get(name)?.get(id); }
}

describe('blog engagement — Firebase adapter parity', () => {
  beforeEach(() => { fakeDb = new FakeFirestore(); });

  it('upsertReaction: adds, replaces, and clears on repeat — mirrors FR-B1.2 against the Postgres adapter', async () => {
    const first = await engagement.upsertReaction('trip-1', 'user-1', 'item', 'item-1', 'heart', 'public');
    expect(first.cleared).toBe(false);
    let counter = fakeDb.getDocData('blog_engagement_counters', 'item:item-1:public');
    expect(counter.reactionTotal).toBe(1);
    expect(counter.reactionCounts.heart).toBe(1);

    // Replacing the emoji: total stays 1, the old emoji's count drops, the new one's rises.
    const replaced = await engagement.upsertReaction('trip-1', 'user-1', 'item', 'item-1', 'fire', 'public');
    expect(replaced.cleared).toBe(false);
    counter = fakeDb.getDocData('blog_engagement_counters', 'item:item-1:public');
    expect(counter.reactionTotal).toBe(1);
    expect(counter.reactionCounts.heart).toBe(0);
    expect(counter.reactionCounts.fire).toBe(1);

    // Re-sending the same emoji clears it.
    const cleared = await engagement.upsertReaction('trip-1', 'user-1', 'item', 'item-1', 'fire', 'public');
    expect(cleared.cleared).toBe(true);
    counter = fakeDb.getDocData('blog_engagement_counters', 'item:item-1:public');
    expect(counter.reactionTotal).toBe(0);
  });

  it('getEngagementSummaries sums across visible audiences and reports the caller’s own reaction', async () => {
    await engagement.upsertReaction('trip-1', 'user-1', 'item', 'item-1', 'heart', 'public');
    await engagement.upsertReaction('trip-1', 'user-2', 'item', 'item-1', 'laugh', 'followers');
    const summaries = await engagement.getEngagementSummaries('user-1', [{ targetKind: 'item', targetId: 'item-1' }], ['travelers', 'followers', 'public']);
    const summary = summaries['item:item-1'];
    expect(summary.reactionTotal).toBe(2);
    expect(summary.reactionCounts).toEqual({ heart: 1, laugh: 1 });
    expect(summary.userReaction).toBe('heart');
  });

  it('createComment increments the parent reply count and the counter’s commentCount', async () => {
    const parent = await engagement.createComment({ tripId: 'trip-1', targetKind: 'item', targetId: 'item-1', audience: 'public', authorUserId: 'user-1', authorRole: 'traveler', body: 'Parent' });
    await engagement.createComment({ tripId: 'trip-1', targetKind: 'item', targetId: 'item-1', audience: 'public', authorUserId: 'user-2', authorRole: 'follower', body: 'Reply', parentCommentId: parent.id });

    const parentAfter = await engagement.getCommentById(parent.id);
    expect(parentAfter?.replyCount).toBe(1);
    const counter = fakeDb.getDocData('blog_engagement_counters', 'item:item-1:public');
    expect(counter.commentCount).toBe(2);
  });

  it('softDeleteComment: a comment with replies becomes a tombstone; one with none is removed (FR-B2.4)', async () => {
    const parent = await engagement.createComment({ tripId: 'trip-1', targetKind: 'item', targetId: 'item-1', audience: 'public', authorUserId: 'user-1', authorRole: 'traveler', body: 'Parent' });
    const reply = await engagement.createComment({ tripId: 'trip-1', targetKind: 'item', targetId: 'item-1', audience: 'public', authorUserId: 'user-2', authorRole: 'follower', body: 'Reply', parentCommentId: parent.id });

    // Delete the parent *while its reply is still live* — the tombstone case FR-B2.4 actually
    // describes. (Deleting the reply first would legitimately leave the parent with zero replies,
    // at which point hard-deleting it too is correct, not a tombstone — that's a different,
    // equally valid scenario, not this one.)
    await engagement.softDeleteComment(parent.id, 'user-1');
    const tombstone = await engagement.getCommentById(parent.id);
    expect(tombstone).not.toBeNull();
    expect(tombstone!.body).toBeNull();
    expect(tombstone!.deletedAt).not.toBeNull();

    // The reply itself is untouched and still readable — the thread stays coherent.
    const stillThere = await engagement.getCommentById(reply.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.body).toBe('Reply');

    // Now delete the reply too (it has no replies of its own) — hard delete, and the parent's
    // replyCount (already a tombstone, not touched by this) reflects the removal.
    await engagement.softDeleteComment(reply.id, 'user-2');
    const goneReply = await engagement.getCommentById(reply.id);
    expect(goneReply).toBeNull();
  });

  it('softDeleteComment refuses to delete another user’s comment', async () => {
    const comment = await engagement.createComment({ tripId: 'trip-1', targetKind: 'item', targetId: 'item-1', audience: 'public', authorUserId: 'user-1', authorRole: 'traveler', body: 'Mine' });
    const result = await engagement.softDeleteComment(comment.id, 'user-2');
    expect(result).toBe(false);
    const stillThere = await engagement.getCommentById(comment.id);
    expect(stillThere).not.toBeNull();
  });

  it('reportComment is idempotent per (comment, reporter) — a deterministic doc ID, not a query-then-insert', async () => {
    const comment = await engagement.createComment({ tripId: 'trip-1', targetKind: 'item', targetId: 'item-1', audience: 'public', authorUserId: 'user-1', authorRole: 'traveler', body: 'Reportable' });
    await engagement.reportComment(comment.id, 'user-2', 'spam');
    await engagement.reportComment(comment.id, 'user-2', 'spam');
    const report = fakeDb.getDocData('blog_comment_reports', `${comment.id}:user-2`);
    expect(report).toBeDefined();
    expect(report.reason).toBe('spam');
  });

  it('incrementStrike blocks after the third strike (FR-B11.3)', async () => {
    await engagement.incrementStrike('trip-1', 'user-1');
    await engagement.incrementStrike('trip-1', 'user-1');
    const third = await engagement.incrementStrike('trip-1', 'user-1');
    expect(third.strikeCount).toBe(3);
    expect(third.blockedAt).not.toBeNull();
    const state = await engagement.getStrikeState('trip-1', 'user-1');
    expect(state.blockedAt).not.toBeNull();
  });
});
