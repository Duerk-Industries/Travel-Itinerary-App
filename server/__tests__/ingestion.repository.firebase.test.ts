describe('ingestion repository firebase writes', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('omits undefined fields when updating import job state in Firestore', async () => {
    const setMock = jest.fn().mockResolvedValue(undefined);
    const docMock = jest.fn(() => ({ set: setMock }));
    const collectionMock = jest.fn(() => ({ doc: docMock, limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) })) }));
    const firestoreMock = { collection: collectionMock } as any;

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(),
      upsertExpenseForSource: jest.fn(),
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => firestoreMock,
    }));

    const { updateImportJobState } = await import('../src/ingestion/shared/repository');

    await updateImportJobState({
      jobId: 'job-1',
      state: 'NORMALIZING',
    });

    expect(collectionMock).toHaveBeenCalledWith('import_jobs');
    expect(docMock).toHaveBeenCalledWith('job-1');
    expect(setMock).toHaveBeenCalledTimes(1);
    const [payload, options] = setMock.mock.calls[0];
    expect(payload.state).toBe('NORMALIZING');
    expect(payload.updatedAt).toBeTruthy();
    expect(payload.stateChangedAt).toBeTruthy();
    expect(payload.startedAt).toBeTruthy();
    expect('normalizedContentHash' in payload).toBe(false);
    expect('failureCode' in payload).toBe(false);
    expect('failureReason' in payload).toBe(false);
    expect('lastErrorCode' in payload).toBe(false);
    expect('completedAt' in payload).toBe(false);
    expect(options).toEqual({ merge: true });
  });

  it('strips nested undefined values before writing extraction cache and parsed items', async () => {
    const setMock = jest.fn().mockResolvedValue(undefined);
    const docMock = jest.fn(() => ({ set: setMock }));
    const collectionMock = jest.fn(() => ({ doc: docMock, limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) })) }));
    const firestoreMock = { collection: collectionMock } as any;

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(),
      upsertExpenseForSource: jest.fn(),
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => firestoreMock,
    }));

    const { createParsedItem, saveExtractionCacheEntry } = await import('../src/ingestion/shared/repository');

    await saveExtractionCacheEntry('user-1', 'hash-1', 'logic-1', {
      parsedItems: [
        {
          itemType: 'flight',
          extractedFields: {
            flightNumber: 'AA100',
            flightNumbers: undefined,
          },
        },
      ],
    });

    await createParsedItem({
      userId: 'user-1',
      importJobId: 'job-1',
      rawDocId: 'doc-1',
      logicVersion: 'logic-1',
      candidate: {
        itemType: 'flight',
        sourceType: 'MANUAL_UPLOAD',
        sourceDate: null,
        providerVendor: 'American Airlines',
        travelerNames: ['Bryan Duerk'],
        confirmationNumber: 'ABC123',
        startDateTimeUtc: '2026-03-19T18:09:10.000Z',
        endDateTimeUtc: null,
        originalTimezone: null,
        timezoneStatus: 'UNKNOWN',
        rawDatetimeString: null,
        timezoneDisplayHint: null,
        rawSourceReference: 'Boston to Los Angeles.pdf',
        confidenceScore: 0.94,
        reviewStatus: 'READY_FOR_REVIEW',
        deduplicationFingerprint: 'fingerprint-1',
        extractedFields: {
          flightNumber: 'AA100',
          flightNumbers: undefined,
        },
      },
    });

    const extractionCachePayload = setMock.mock.calls[0][0];
    expect(extractionCachePayload.extractionResult.parsedItems[0].extractedFields.flightNumber).toBe('AA100');
    expect('flightNumbers' in extractionCachePayload.extractionResult.parsedItems[0].extractedFields).toBe(false);

    const parsedItemPayload = setMock.mock.calls[1][0];
    expect(parsedItemPayload.extractedFields.flightNumber).toBe('AA100');
    expect('flightNumbers' in parsedItemPayload.extractedFields).toBe(false);
  });

  it('queries Firebase import jobs by userId and createdAt desc, matching the required composite index shape', async () => {
    const getMock = jest.fn().mockResolvedValue({ docs: [] });
    const limitMock = jest.fn(() => ({ get: getMock }));
    const orderByMock = jest.fn(() => ({ limit: limitMock }));
    const whereMock = jest.fn(() => ({ orderBy: orderByMock }));
    const collectionMock = jest.fn(() => ({ where: whereMock, limit: limitMock }));
    const firestoreMock = { collection: collectionMock } as any;

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(),
      upsertExpenseForSource: jest.fn(),
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => firestoreMock,
    }));

    const { listImportJobsForUser } = await import('../src/ingestion/shared/repository');

    await listImportJobsForUser('user-123');

    expect(collectionMock).toHaveBeenCalledWith('import_jobs');
    expect(whereMock).toHaveBeenCalledWith('userId', '==', 'user-123');
    expect(orderByMock).toHaveBeenCalledWith('createdAt', 'desc');
    expect(limitMock).toHaveBeenCalledWith(25);
    expect(getMock).toHaveBeenCalled();
  });

  it('loads Firebase provider connections with filters only and picks the latest in memory to avoid a composite index', async () => {
    const getMock = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'older',
          data: () => ({
            userId: 'user-123',
            provider: 'gmail',
            status: 'connected',
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            tokenExpiry: null,
            scopes: ['scope-a'],
            metadata: { emailAddress: 'older@example.com' },
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-01T10:00:00.000Z',
          }),
        },
        {
          id: 'latest',
          data: () => ({
            userId: 'user-123',
            provider: 'gmail',
            status: 'AUTH_EXPIRED',
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            tokenExpiry: null,
            scopes: ['scope-b'],
            metadata: { emailAddress: 'latest@example.com' },
            createdAt: '2026-03-02T10:00:00.000Z',
            updatedAt: '2026-03-02T10:00:00.000Z',
          }),
        },
      ],
    });
    const providerWhereMock = jest.fn(() => ({ get: getMock }));
    const userWhereMock = jest.fn(() => ({ where: providerWhereMock }));
    const limitMock = jest.fn(() => ({ get: getMock }));
    const collectionMock = jest.fn(() => ({ where: userWhereMock, limit: limitMock }));
    const firestoreMock = { collection: collectionMock } as any;

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(),
      upsertExpenseForSource: jest.fn(),
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => firestoreMock,
    }));

    const { getProviderConnection } = await import('../src/ingestion/shared/repository');

    const result = await getProviderConnection('user-123', 'gmail');

    expect(collectionMock).toHaveBeenCalledWith('provider_connections');
    expect(userWhereMock).toHaveBeenCalledWith('userId', '==', 'user-123');
    expect(providerWhereMock).toHaveBeenCalledWith('provider', '==', 'gmail');
    expect(result?.id).toBe('latest');
    expect(result?.status).toBe('AUTH_EXPIRED');
    expect(result?.metadata.emailAddress).toBe('latest@example.com');
  });

  it('loads Firebase review queue items with a user filter only and sorts active items in memory', async () => {
    const getMock = jest.fn().mockResolvedValue({
      docs: [
        {
          id: 'inactive',
          data: () => ({
            userId: 'user-123',
            importJobId: 'job-inactive',
            rawDocId: 'doc-inactive',
            itemType: 'flight',
            sourceType: 'MANUAL_UPLOAD',
            rawSourceReference: 'inactive.pdf',
            confidenceScore: 0.1,
            reviewStatus: 'ASSIGNED',
            deduplicationFingerprint: 'inactive',
            extractedFields: {},
            travelerNames: [],
            updatedAt: '2026-03-01T10:00:00.000Z',
            createdAt: '2026-03-01T09:00:00.000Z',
          }),
        },
        {
          id: 'older-active',
          data: () => ({
            userId: 'user-123',
            importJobId: 'job-older',
            rawDocId: 'doc-older',
            itemType: 'flight',
            sourceType: 'MANUAL_UPLOAD',
            rawSourceReference: 'older.pdf',
            confidenceScore: 0.8,
            reviewStatus: 'READY_FOR_REVIEW',
            deduplicationFingerprint: 'older',
            extractedFields: {},
            travelerNames: [],
            updatedAt: '2026-03-01T10:00:00.000Z',
            createdAt: '2026-03-01T09:00:00.000Z',
          }),
        },
        {
          id: 'latest-active',
          data: () => ({
            userId: 'user-123',
            importJobId: 'job-latest',
            rawDocId: 'doc-latest',
            itemType: 'hotel',
            sourceType: 'GMAIL',
            rawSourceReference: 'latest.pdf',
            confidenceScore: 0.9,
            reviewStatus: 'LOW_CONFIDENCE',
            deduplicationFingerprint: 'latest',
            extractedFields: {},
            travelerNames: [],
            updatedAt: '2026-03-03T10:00:00.000Z',
            createdAt: '2026-03-03T09:00:00.000Z',
          }),
        },
      ],
    });
    const userWhereMock = jest.fn(() => ({ get: getMock }));
    const limitMock = jest.fn(() => ({ get: getMock }));
    const collectionMock = jest.fn(() => ({ where: userWhereMock, limit: limitMock }));
    const firestoreMock = { collection: collectionMock } as any;

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(),
      upsertExpenseForSource: jest.fn(),
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => firestoreMock,
    }));

    const { listReviewQueueItems } = await import('../src/ingestion/shared/repository');

    const items = await listReviewQueueItems('user-123');

    expect(collectionMock).toHaveBeenCalledWith('parsed_items');
    expect(userWhereMock).toHaveBeenCalledWith('userId', '==', 'user-123');
    expect(items.map((item) => item.id)).toEqual(['latest-active', 'older-active']);
  });

  it('matches Firebase group members via linked web user profile names during assignment', async () => {
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
      constructor(public docs: Array<{ id: string; ref: any; data: () => any }>) {}
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
        const docs = this.collection
          .all()
          .filter((doc) =>
            this.filters.every((f) => {
              const docValue = doc.data[f.field];
              return docValue === f.value;
            })
          )
          .slice(0, this.limitCount ?? undefined)
          .map((doc) => ({
            id: doc.id,
            ref: this.collection.doc(doc.id),
            data: () => doc.data,
          }));
        return new FakeQuerySnapshot(docs);
      }
    }

    class FakeDocRef {
      constructor(private collection: FakeCollection, private id: string) {}
      async get() {
        return new FakeDocSnapshot(this.id, this.collection.get(this.id));
      }
      async set(value: any, options?: { merge?: boolean }) {
        if (options?.merge) {
          const existing = this.collection.get(this.id) ?? {};
          this.collection.set(this.id, { ...existing, ...value });
          return;
        }
        this.collection.set(this.id, value);
      }
      async update(value: any) {
        const existing = this.collection.get(this.id) ?? {};
        this.collection.set(this.id, { ...existing, ...value });
      }
    }

    class FakeCollection {
      constructor(private store: Map<string, any>) {}
      doc(id: string) {
        return new FakeDocRef(this, id);
      }
      limit(count: number) {
        return new FakeQuery(this, [], count);
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
      async runTransaction(callback: (tx: { get: (ref: any) => Promise<any>; set: (ref: any, value: any) => Promise<void>; update: (ref: any, value: any) => Promise<void> }) => Promise<void>) {
        const tx = {
          get: async (ref: any) => ref.get(),
          set: async (ref: any, value: any) => ref.set(value),
          update: async (ref: any, value: any) => ref.update(value),
        };
        await callback(tx);
      }
      getDocData(name: string, id: string) {
        return this.collections.get(name)?.get(id);
      }
    }

    const fakeDb = new FakeFirestore();

    fakeDb.collection('parsed_items').doc('parsed-1').set({
      id: 'parsed-1',
      userId: 'user-1',
      importJobId: 'job-1',
      rawDocId: 'doc-1',
      itemType: 'flight',
      sourceType: 'MANUAL_UPLOAD',
      sourceDate: '2026-03-20T00:00:00.000Z',
      providerVendor: 'Lao Airlines',
      travelerNames: ['Bryan Duerk', 'Vicky Duerk'],
      confirmationNumber: 'NGMDB9',
      startDateTimeUtc: '2025-11-30T18:50:00.000Z',
      endDateTimeUtc: '2025-11-30T20:00:00.000Z',
      originalTimezone: 'Asia/Ho_Chi_Minh',
      timezoneStatus: 'INFERRED',
      rawDatetimeString: 'Nov 30, 2025 06:50 pm',
      timezoneDisplayHint: 'item-local',
      rawSourceReference: 'manual:test.pdf',
      confidenceScore: 0.94,
      reviewStatus: 'READY_FOR_REVIEW',
      status: 'READY_FOR_REVIEW',
      deduplicationFingerprint: 'fp-1',
      logicVersion: 'logic-1',
      extractedFields: {
        departureLocation: 'HAN',
        departureAirportCode: 'HAN',
        arrivalLocation: 'LPQ',
        arrivalAirportCode: 'LPQ',
        flightNumber: 'QV314',
        cost: 591.2,
        currency: 'USD',
      },
      editedFields: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
    });
    fakeDb.collection('group_members').doc('gm-bryan').set({
      groupId: 'group-1',
      userId: 'user-bryan',
      removedAt: null,
    });
    fakeDb.collection('group_members').doc('gm-vicky').set({
      groupId: 'group-1',
      guestName: 'Vicky Duerk',
      removedAt: null,
    });
    fakeDb.collection('web_users').doc('user-bryan').set({
      firstName: 'Bryan',
      lastName: 'Duerk',
      email: 'bryan.duerk@gmail.com',
    });

    const upsertExpenseForSource = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(async (tripId: string) => (
        tripId === 'trip-1'
          ? { id: tripId, groupId: 'group-1', name: 'Trip 1', currency: 'USD' }
          : null
      )),
      upsertExpenseForSource,
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('../src/apis/frankfurterApi', () => ({
      fetchFrankfurterExchangeRate: jest.fn(),
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => fakeDb,
    }));

    const { assignParsedItemToTrip } = await import('../src/ingestion/shared/repository');

    await assignParsedItemToTrip('user-1', 'parsed-1', 'trip-1', 'user-1');

    const allFlights = (fakeDb as any).collections.get('flights');
    const storedFlight = (allFlights ? Array.from(allFlights.values())[0] : null) as any;
    expect(storedFlight?.passengerIds).toEqual(expect.arrayContaining(['gm-bryan', 'gm-vicky']));
    expect(fakeDb.getDocData('parsed_items', 'parsed-1')?.reviewStatus).toBe('ASSIGNED');
    expect(upsertExpenseForSource).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 'trip-1',
      category: 'Flights',
      amount: 591.2,
      currency: 'USD',
      amountInTripCurrency: undefined,
      exchangeRateToTripCurrency: undefined,
      payerIds: expect.arrayContaining(['gm-bryan', 'gm-vicky']),
      forIds: expect.arrayContaining(['gm-bryan', 'gm-vicky']),
      sourceType: 'flight',
    }));
  });

  it('converts assigned flight expenses into the trip currency when source currency differs', async () => {
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
      constructor(public docs: Array<{ id: string; ref: any; data: () => any }>) {}
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
        const docs = this.collection
          .all()
          .filter((doc) =>
            this.filters.every((f) => {
              const docValue = doc.data[f.field];
              return docValue === f.value;
            })
          )
          .slice(0, this.limitCount ?? undefined)
          .map((doc) => ({
            id: doc.id,
            ref: this.collection.doc(doc.id),
            data: () => doc.data,
          }));
        return new FakeQuerySnapshot(docs);
      }
    }

    class FakeDocRef {
      constructor(private collection: FakeCollection, private id: string) {}
      async get() {
        return new FakeDocSnapshot(this.id, this.collection.get(this.id));
      }
      async set(value: any, options?: { merge?: boolean }) {
        if (options?.merge) {
          const existing = this.collection.get(this.id) ?? {};
          this.collection.set(this.id, { ...existing, ...value });
          return;
        }
        this.collection.set(this.id, value);
      }
      async update(value: any) {
        const existing = this.collection.get(this.id) ?? {};
        this.collection.set(this.id, { ...existing, ...value });
      }
    }

    class FakeCollection {
      constructor(private store: Map<string, any>) {}
      doc(id: string) {
        return new FakeDocRef(this, id);
      }
      limit(count: number) {
        return new FakeQuery(this, [], count);
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
      async runTransaction(callback: (tx: { get: (ref: any) => Promise<any>; set: (ref: any, value: any) => Promise<void>; update: (ref: any, value: any) => Promise<void> }) => Promise<void>) {
        const tx = {
          get: async (ref: any) => ref.get(),
          set: async (ref: any, value: any) => ref.set(value),
          update: async (ref: any, value: any) => ref.update(value),
        };
        await callback(tx);
      }
    }

    const fakeDb = new FakeFirestore();

    fakeDb.collection('parsed_items').doc('parsed-2').set({
      id: 'parsed-2',
      userId: 'user-1',
      importJobId: 'job-1',
      rawDocId: 'doc-2',
      itemType: 'flight',
      sourceType: 'MANUAL_UPLOAD',
      sourceDate: '2026-03-20T00:00:00.000Z',
      providerVendor: 'Thai Airways',
      travelerNames: ['Bryan Duerk'],
      confirmationNumber: 'ABC123',
      startDateTimeUtc: '2025-12-15T09:30:00.000Z',
      endDateTimeUtc: '2025-12-15T11:00:00.000Z',
      originalTimezone: 'Asia/Bangkok',
      timezoneStatus: 'INFERRED',
      rawDatetimeString: 'Dec 15, 2025 09:30 am',
      timezoneDisplayHint: 'item-local',
      rawSourceReference: 'manual:thai.pdf',
      confidenceScore: 0.92,
      reviewStatus: 'READY_FOR_REVIEW',
      status: 'READY_FOR_REVIEW',
      deduplicationFingerprint: 'fp-2',
      logicVersion: 'logic-1',
      extractedFields: {
        departureLocation: 'BKK',
        departureAirportCode: 'BKK',
        arrivalLocation: 'CNX',
        arrivalAirportCode: 'CNX',
        flightNumber: 'TG102',
        cost: 1000,
        currency: 'THB',
      },
      editedFields: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
    });
    fakeDb.collection('group_members').doc('gm-bryan').set({
      groupId: 'group-2',
      guestName: 'Bryan Duerk',
      removedAt: null,
    });

    const upsertExpenseForSource = jest.fn().mockResolvedValue(undefined);
    const fetchFrankfurterExchangeRate = jest.fn().mockResolvedValue({ rate: 0.028, date: '2025-12-15' });

    jest.doMock('../src/db', () => ({
      getCurrentDbProvider: () => 'firebase',
      poolClient: jest.fn(),
      getTripById: jest.fn(async (tripId: string) => (
        tripId === 'trip-2'
          ? { id: tripId, groupId: 'group-2', name: 'Trip 2', currency: 'USD' }
          : null
      )),
      upsertExpenseForSource,
    }));
    jest.doMock('../src/env', () => ({
      getEnvValue: jest.fn(),
    }));
    jest.doMock('../src/apis/frankfurterApi', () => ({
      fetchFrankfurterExchangeRate,
    }));
    jest.doMock('firebase-admin/app', () => ({
      getApps: () => [{}],
      initializeApp: jest.fn(),
      cert: jest.fn(),
    }));
    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => fakeDb,
    }));

    const { assignParsedItemToTrip } = await import('../src/ingestion/shared/repository');

    await assignParsedItemToTrip('user-1', 'parsed-2', 'trip-2', 'user-1');

    expect(fetchFrankfurterExchangeRate).toHaveBeenCalledWith({
      caller: 'INGESTION_ASSIGNMENT_FX',
      fromCurrency: 'THB',
      toCurrency: 'USD',
      date: '2025-12-15',
    });
    expect(upsertExpenseForSource).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 'trip-2',
      amount: 1000,
      currency: 'THB',
      amountInTripCurrency: 28,
      exchangeRateToTripCurrency: 0.028,
      exchangeRateDate: '2025-12-15',
      sourceType: 'flight',
    }));
  });
});
