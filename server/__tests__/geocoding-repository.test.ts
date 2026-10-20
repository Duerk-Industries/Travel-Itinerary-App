import { initDb, mutateGeocodingState } from '../src/db';
describe('durable geocoding storage contract', () => {
  beforeAll(async () => { await initDb(); });
  it('persists jobs, cached misses and fencing state across adapter calls', async () => {
    const key = 'repository-contract';
    await mutateGeocodingState(state => ({ ...state, providerLeaseToken: key, providerLeaseUntil: Date.now() + 30_000, jobs: [{ key, query: { name: 'Public museum', locality: 'Paris', country: 'France', language: 'en', providerVersion: 'test-v1' }, state: 'done', attempts: 1, dueAt: 0, result: null, expiresAt: Date.now() + 86400_000 }] }));
    const reread = await mutateGeocodingState(state => state);
    expect(reread.providerLeaseToken).toBe(key); expect(reread.jobs[0].result).toBeNull();
    await expect(mutateGeocodingState(state => { throw new Error('abort'); })).rejects.toThrow('abort');
    expect((await mutateGeocodingState(state => state)).jobs[0].key).toBe(key);
  });
});
