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
  FieldValue: {},
}));

class FakeDocRef {
  constructor(public collectionName: string, public id: string, private store: Map<string, any>) {}
}

class FakeBatch {
  private ops: Array<{ ref: FakeDocRef; data: any }> = [];
  set(ref: FakeDocRef, data: any) {
    this.ops.push({ ref, data });
  }
  async commit() {
    for (const { ref, data } of this.ops) {
      ref['store'].set(ref.id, data);
    }
  }
}

class FakeCollection {
  constructor(public store: Map<string, any>) {}
  doc(id: string) {
    return new FakeDocRef('airports', id, this.store);
  }
}

class FakeFirestore {
  collections = new Map<string, Map<string, any>>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return new FakeCollection(this.collections.get(name)!);
  }
  batch() {
    return new FakeBatch();
  }
}

jest.mock('../src/apis/airportDatasetCallers', () => ({
  downloadAirportDatasetForDailyRefresh: jest.fn(),
}));

import { refreshAirportsDaily } from '../src/db.firebase';
import { downloadAirportDatasetForDailyRefresh } from '../src/apis/airportDatasetCallers';

describe('refreshAirportsDaily (firebase adapter)', () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore();
    jest.clearAllMocks();
  });

  it('writes downloaded airports into the Firestore airports collection', async () => {
    (downloadAirportDatasetForDailyRefresh as jest.Mock).mockResolvedValue([
      { iata_code: 'bos', name: 'Boston Logan Intl', city: 'Boston', country: 'United States', lat: 42.36, lng: -71.01 },
      { iata_code: 'jfk', name: 'John F Kennedy Intl', city: 'New York', country: 'United States', lat: 40.64, lng: -73.78 },
    ]);

    await refreshAirportsDaily();

    const stored = fakeDb.collections.get('airports');
    expect(stored).toBeDefined();
    expect(stored!.size).toBe(2);

    const bos = stored!.get('BOS');
    expect(bos).toMatchObject({
      iata_code: 'BOS',
      name: 'Boston Logan Intl',
      city: 'Boston',
      country: 'United States',
      label: 'Boston (BOS)',
    });
    expect(bos.search).toEqual(expect.arrayContaining(['bos', 'boston']));
  });

  it('falls back to the bundled local dataset when the download fails', async () => {
    (downloadAirportDatasetForDailyRefresh as jest.Mock).mockRejectedValue(new Error('network down'));

    await refreshAirportsDaily();

    const stored = fakeDb.collections.get('airports');
    expect(stored).toBeDefined();
    expect(stored!.size).toBeGreaterThan(1000);
    expect(stored!.get('CLE')).toMatchObject({ iata_code: 'CLE' });
  });

  it('does nothing when the download succeeds but returns no usable records', async () => {
    // A successful-but-empty response does not trigger the local-file fallback (that only
    // runs when the download itself throws), so the airports collection should stay untouched.
    (downloadAirportDatasetForDailyRefresh as jest.Mock).mockResolvedValue([]);

    await refreshAirportsDaily();

    const stored = fakeDb.collections.get('airports');
    expect(stored).toBeUndefined();
  });
});
