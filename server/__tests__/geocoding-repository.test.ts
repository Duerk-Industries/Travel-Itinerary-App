import { initDb, mutateGeocodingState } from '../src/db';
describe('durable geocoding storage contract', () => {
  beforeAll(async () => { await initDb(); });
  it('persists jobs, cached misses and fencing state across adapter calls', async () => {
    const key = 'repository-contract';
    await mutateGeocodingState(state => ({ ...state, providerLeaseToken: key, providerLeaseUntil: Date.now() + 30_000, jobs: [{ key, query: { name: 'Public museum', locality: 'Paris', country: 'France', language: 'en', providerVersion: 'test-v1' }, state: 'done', attempts: 1, dueAt: 0, result: null, expiresAt: Date.now() + 86400_000 }] }));
    const reread = await mutateGeocodingState(state => state);
    expect(reread.providerLeaseToken).toBe(key); expect(reread.jobs[0].result).toBeNull();
    await expect(mutateGeocodingState(state => { state.jobs[0].key = 'must-not-leak'; throw new Error('abort'); })).rejects.toThrow('abort');
    expect((await mutateGeocodingState(state => state)).jobs[0].key).toBe(key);
  });
});

it('rejects oversized mutations without altering the durable original', async () => {
  const before = await mutateGeocodingState(state => state);
  await expect(mutateGeocodingState(state => {
    state.jobs[0].query.name = 'x'.repeat(700_001); return state;
  })).rejects.toThrow('Geocoding state full');
  expect(await mutateGeocodingState(state => state)).toEqual(before);
});

// pg-mem does not implement SELECT FOR UPDATE isolation. Test contention on
// the real transactional adapter rather than claiming a pg-mem concurrency proof.
(process.env.JEST_DB_PROVIDER === 'firebase' ? it : it.skip)('admits one owner under concurrent Firestore transactions', async () => {
  await mutateGeocodingState(state => { delete state.providerLeaseToken; delete state.providerLeaseUntil; return state; });
  const results = await Promise.all(Array.from({ length: 4 }, (_, n) => mutateGeocodingState(state => {
    if (!state.providerLeaseToken) { state.providerLeaseToken = `concurrent-${n}`; state.providerLeaseUntil = Date.now() + 30_000; }
    return state;
  })));
  expect(new Set(results.map(state => state.providerLeaseToken)).size).toBe(1);
});
