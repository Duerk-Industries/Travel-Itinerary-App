import * as firebaseDb from '../src/db.firebase';

describe('firebase lodging update', () => {
  it('strips undefined fields so paidBy updates do not send imageUrl undefined', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const get = jest
      .fn()
      .mockResolvedValueOnce({ exists: true, data: () => ({ trip_id: 'trip-1' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ id: 'lodging-1', trip_id: 'trip-1' }) });
    const doc = { get, update };
    const docFn = jest.fn().mockReturnValue(doc);
    const collection = jest.fn().mockReturnValue({ doc: docFn });
    const fakeDb = { collection } as any;

    const getDbSpy = jest.spyOn(firebaseDb, 'getDb').mockReturnValue(fakeDb);
    const ensureSpy = jest.spyOn(firebaseDb, 'ensureUserInTrip').mockResolvedValue({ groupId: 'g1' } as any);

    await firebaseDb.updateLodging('lodging-1', 'user-1', { paid_by: ['m1'], imageUrl: undefined });

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload).toMatchObject({ paid_by: ['m1'] });
    expect(payload).not.toHaveProperty('imageUrl');

    getDbSpy.mockRestore();
    ensureSpy.mockRestore();
  });
});
