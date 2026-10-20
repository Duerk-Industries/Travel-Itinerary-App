/**
 * @jest-environment jsdom
 */
import { withStorageLease, REPLAY_LOCK_LEASE_MS } from '../utils/replayLock';

const KEY = 'stp.replay-lock.q';

describe('storage replay lease (no Web Locks)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('runs the work and releases the lease afterwards', async () => {
    expect(await withStorageLease('q', async () => 'done')).toBe('done');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('releases the lease even when the work throws', async () => {
    await expect(withStorageLease('q', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('skips the work while another tab holds a live lease', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ token: 'other-tab', until: Date.now() + 10_000 }));
    const work = jest.fn(async () => 'ran');
    expect(await withStorageLease('q', work)).toBeNull();
    expect(work).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).token).toBe('other-tab');
  });

  it('takes over an expired lease, and one left by a clock that moved back', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ token: 'crashed', until: Date.now() - 1 }));
    expect(await withStorageLease('q', async () => 'ok')).toBe('ok');
    window.localStorage.setItem(KEY, JSON.stringify({ token: 'future', until: Date.now() + REPLAY_LOCK_LEASE_MS * 10 }));
    expect(await withStorageLease('q', async () => 'ok')).toBe('ok');
  });

  it('lets only one of two racing tabs run, and ignores a corrupt lease', async () => {
    const ran: string[] = [];
    const tab = (id: string) => withStorageLease('q', async () => { ran.push(id); await new Promise(r => setTimeout(r, 80)); return id; });
    const [a, b] = await Promise.all([tab('a'), tab('b')]);
    expect(ran).toHaveLength(1);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    window.localStorage.setItem(KEY, '{not json');
    expect(await withStorageLease('q', async () => 'ok')).toBe('ok');
  });

  it('still runs the work when storage rejects writes', async () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try { expect(await withStorageLease('q', async () => 'ran')).toBe('ran'); } finally { spy.mockRestore(); }
  });
});
