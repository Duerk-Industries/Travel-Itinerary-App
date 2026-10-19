/** Transaction contract checks; real Firestore emulator contention remains a release gate. */
describe('Firestore mail admission transactions', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => { jest.dontMock('../src/db'); jest.dontMock('../src/ingestion/shared/repository'); });

  it('atomically reserves the alias hash and dedupes delivery/quota with all reads before writes', async () => {
    const records = new Map<string, Record<string, unknown>>();
    const reference = (collection: string, id: string) => ({ key: `${collection}/${id}` });
    const snap = (ref: { key: string }) => ({ exists: records.has(ref.key), data: () => records.get(ref.key) });
    const query = (collection: string, filters: Array<[string, string, unknown]> = []): any => ({
      collection, filters, limit: () => query(collection, filters),
      where: (field: string, op: string, value: unknown) => query(collection, [...filters, [field, op, value]]),
      doc: (id: string) => reference(collection, id),
    });
    const db = {
      collection: (name: string) => query(name),
      runTransaction: async (work: (tx: unknown) => Promise<unknown>) => {
        let writesStarted = false;
        const writes: Array<() => void> = [];
        const tx = {
          get: async (ref: any) => {
            if (writesStarted) throw new Error('Read after write');
            if (ref.key) return snap(ref);
            return { docs: [...records.entries()].filter(([key, data]) => key.startsWith(`${ref.collection}/`) && ref.filters.every(([field, op, value]: [string, string, any]) =>
              op === 'in' ? value.includes(data[field]) : data[field] === value)).map(([, data]) => ({ data: () => data })) };
          },
          create: (ref: { key: string }, data: Record<string, unknown>) => { writesStarted = true; writes.push(() => { if (records.has(ref.key)) throw new Error('Duplicate'); records.set(ref.key, data); }); },
          set: (ref: { key: string }, data: Record<string, unknown>) => { writesStarted = true; writes.push(() => records.set(ref.key, data)); },
          update: (ref: { key: string }, data: Record<string, unknown>) => { writesStarted = true; writes.push(() => records.set(ref.key, { ...records.get(ref.key), ...data })); },
          delete: (ref: { key: string }) => { writesStarted = true; writes.push(() => records.delete(ref.key)); },
        };
        const result = await work(tx); writes.forEach(write => write()); return result;
      },
    };
    jest.doMock('../src/db', () => ({ getCurrentDbProvider: () => 'firebase' }));
    jest.doMock('../src/ingestion/shared/repository', () => ({ getFirebaseDb: () => db }));
    const repo = require('../src/ingestion/shared/mailAdmission') as typeof import('../src/ingestion/shared/mailAdmission');
    await repo.getMailAlias('owner');
    const alias = records.get('ingestion_alias_owners/owner')!;
    const params = { id: 'receipt', userId: 'owner', aliasHash: String(alias.tokenHash), raw: { body: { text: 'confirmation' }, files: [] }, monthlyLimit: 10, allowLargeLlm: false, allowSmallLlm: false };
    expect((await repo.admitMail(params))?.state).toBe('PENDING');
    expect((await repo.admitMail(params))?.state).toBe('PENDING');
    expect([...records.entries()].filter(([key]) => key.startsWith('usage_counters/')).map(([, data]) => data.count)).toEqual([1]);
    const oldHash = alias.tokenHash;
    await repo.getMailAlias('owner', true);
    expect(records.has(`ingestion_aliases/${oldHash}`)).toBe(false);
    expect(records.get('ingestion_alias_owners/owner')!.tokenHash).not.toBe(oldHash);
  });
});
