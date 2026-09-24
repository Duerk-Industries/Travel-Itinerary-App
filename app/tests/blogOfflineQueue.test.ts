import { enqueueOfflineBlogEntry, flushOfflineBlogEntries, listOfflineBlogEntries } from '../utils/blogOfflineQueue';
import { removeAsync } from '../utils/persistentStorage';

describe('blogOfflineQueue', () => {
  const accountId = 'offline-user';
  const tripId = 'offline-trip';
  const key = `wanderbunnies.blog-offline.v1:${accountId}:${tripId}`;
  beforeEach(async () => { await removeAsync(key); });
  afterEach(async () => { await removeAsync(key); });

  it('keeps prose account/trip scoped and removes only confirmed sends', async () => {
    await enqueueOfflineBlogEntry({ accountId, tripId, dayDate: '2027-04-02', body: '<p>Rainy market</p>' }, 2, 7);
    await enqueueOfflineBlogEntry({ accountId, tripId, dayDate: '2027-04-03', body: '<p>Train day</p>' }, 2, 7);
    expect(await listOfflineBlogEntries(accountId, tripId)).toHaveLength(2);
    const send = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const result = await flushOfflineBlogEntries(accountId, tripId, send);
    expect(result.sent).toBe(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].attempts).toBe(1);
  });

  it('enforces its finite local queue cap', async () => {
    await enqueueOfflineBlogEntry({ accountId, tripId, dayDate: '2027-04-02', body: 'One' }, 1, 7);
    await expect(enqueueOfflineBlogEntry({ accountId, tripId, dayDate: '2027-04-03', body: 'Two' }, 1, 7)).rejects.toThrow('Offline queue is full');
  });
});
