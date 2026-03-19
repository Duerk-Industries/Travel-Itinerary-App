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
});
