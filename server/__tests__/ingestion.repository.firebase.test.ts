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
});
