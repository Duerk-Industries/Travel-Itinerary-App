/// <reference types="jest" />
/// <reference types="node" />

// firebaseMediaRepository.initUpload writes a media blog_items doc with `blogDayId = <date
// string>` while text items use `blogDayId = <blog_days doc id>`. getVisibleMediaForDay used to
// query on `blogDayId == <doc id>`, so it never found composer/gallery photos on the Firebase
// deployment — the day-fact strip silently dropped its "Photos & videos" (and distance) chips.
// This pins the lookup to `localDate`, which every blog_items doc sets consistently.

let fakeDb: any;
jest.mock('firebase-admin/app', () => ({ initializeApp: jest.fn(() => ({ name: 'x' })), getApps: jest.fn(() => []), deleteApp: jest.fn(async () => {}) }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => fakeDb, FieldValue: { increment: (v: number) => ({ __increment: v }) } }));
jest.mock('../src/db.firebase', () => ({ getDb: () => fakeDb }));

import { getVisibleMediaForDay, hasTextItemForDay } from '../src/blog/firebaseBlogDayData';

class Snap { constructor(public id: string, private value: any) {} get exists() { return this.value !== undefined; } data() { return this.value; } }
class Query {
  constructor(private col: Col, private filters: Array<{ f: string; op: string; v: any }> = []) {}
  where(f: string, op: string, v: any) { return new Query(this.col, [...this.filters, { f, op, v }]); }
  async get() {
    const docs = this.col.all().filter(({ data }) => this.filters.every(({ f, op, v }) =>
      op === 'in' ? Array.isArray(v) && v.includes(data[f]) : data[f] === v));
    return { docs: docs.map(({ id, data }) => new Snap(id, data)), get empty() { return docs.length === 0; } };
  }
}
class Col {
  constructor(private store = new Map<string, any>()) {}
  doc(id: string) { const self = this; return { async get() { return new Snap(id, self.store.get(id)); }, async set(v: any) { self.store.set(id, v); } }; }
  where(f: string, op: string, v: any) { return new Query(this, [{ f, op, v }]); }
  all() { return [...this.store.entries()].map(([id, data]) => ({ id, data })); }
  _seed(id: string, data: any) { this.store.set(id, data); }
}
class FakeDb {
  private cols = new Map<string, Col>();
  collection(name: string) { if (!this.cols.has(name)) this.cols.set(name, new Col()); return this.cols.get(name)!; }
}

describe('getVisibleMediaForDay (Firebase) — keyed on localDate, not the blog_days doc id', () => {
  beforeEach(() => {
    fakeDb = new FakeDb();
    // A media item as firebaseMediaRepository.initUpload actually writes it: blogDayId is the DATE.
    fakeDb.collection('blog_items')._seed('item-media', { tripId: 't1', blogDayId: '2026-08-28', localDate: '2026-08-28', kindKey: 'media.photo', audience: 'public', deletedAt: null });
    // A text item as firebaseRepository writes it: blogDayId is the doc id.
    fakeDb.collection('blog_items')._seed('item-text', { tripId: 't1', blogDayId: 'day-doc-123', localDate: '2026-08-28', kindKey: 'core.text', audience: 'public', deletedAt: null });
    fakeDb.collection('blog_media_assets')._seed('asset-1', { blogItemId: 'item-media', state: 'ready', mediaKind: 'photo', capturedAt: '2026-08-28T10:00:00', capturedLat: 46.5, capturedLng: 12.2 });
    fakeDb.collection('blog_media_assets')._seed('asset-2', { blogItemId: 'item-media', state: 'uploading', mediaKind: 'video' });
  });

  it('finds the day\'s ready media even though the item\'s blogDayId is a date string', async () => {
    const rows = await getVisibleMediaForDay('2026-08-28', ['public']);
    expect(rows).toHaveLength(1); // only the ready one
    expect(rows[0].media_kind_key).toBe('photo');
    expect(rows[0].captured_lat).toBe(46.5);
  });

  it('respects the audience filter', async () => {
    fakeDb.collection('blog_items')._seed('item-media', { tripId: 't1', blogDayId: '2026-08-28', localDate: '2026-08-28', kindKey: 'media.photo', audience: 'travelers', deletedAt: null });
    expect(await getVisibleMediaForDay('2026-08-28', ['public'])).toHaveLength(0);
    expect(await getVisibleMediaForDay('2026-08-28', ['travelers', 'public'])).toHaveLength(1);
  });

  it('hasTextItemForDay also keys on localDate', async () => {
    expect(await hasTextItemForDay('2026-08-28')).toBe(true);
    expect(await hasTextItemForDay('2026-08-29')).toBe(false);
  });
});
