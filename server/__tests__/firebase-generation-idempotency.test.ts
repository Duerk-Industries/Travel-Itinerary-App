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

import { closePool, completeGenerationIdempotency, getGenerationIdempotency } from '../src/db.firebase';

class FakeDocSnapshot {
  constructor(public id: string, private value: any) {}
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value;
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
}

class FakeCollection {
  constructor(private store: Map<string, any>) {}
  doc(id: string) {
    return new FakeDocRef(this, id);
  }
  set(id: string, value: any) {
    this.store.set(id, value);
  }
  get(id: string) {
    return this.store.get(id);
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
  getRawDocValue(name: string, id: string) {
    return this.collections.get(name)?.get(id);
  }
}

describe('firebase generation idempotency responseBody serialization', () => {
  beforeEach(() => {
    process.env.GCLOUD_PROJECT_ID = 'test-project';
    fakeDb = new FakeFirestore();
  });

  afterEach(async () => {
    await closePool();
  });

  it('stores responseBody as a JSON string, not a raw nested array, and round-trips it', async () => {
    // Mirrors the shape of an AI-generated itinerary plan: arrays nested directly
    // inside arrays, which real Firestore rejects with "invalid nested entity"
    // when stored as a native map/array property.
    const responseBody = {
      plan: 'Day 1...',
      details: [
        { day: 1, activity: 'Museum' },
        { day: 2, activity: 'Park' },
      ],
      route: [
        ['CDG', 'Paris'],
        ['Paris', 'CDG'],
      ],
    };

    await completeGenerationIdempotency('key-1', responseBody);

    const rawStoredValue = fakeDb.getRawDocValue('generation_idempotency', 'key-1')?.responseBody;
    expect(typeof rawStoredValue).toBe('string');
    expect(Array.isArray(rawStoredValue)).toBe(false);

    const record = await getGenerationIdempotency('key-1');
    expect(record?.status).toBe('completed');
    expect(record?.responseBody).toEqual(responseBody);
  });

  it('returns null responseBody when the stored value is malformed JSON', async () => {
    await fakeDb.collection('generation_idempotency').doc('key-2').set({
      status: 'completed',
      responseBody: '{not valid json',
    });

    const record = await getGenerationIdempotency('key-2');
    expect(record?.responseBody).toBeNull();
  });
});
