import * as firebaseDb from '../src/db.firebase';

describe('Firebase optional activities', () => {
  afterEach(() => jest.restoreAllMocks());

  it('clears the day and resets ordering while retaining the nearby hotel', async () => {
    let stored = { id: 'activity', tripId: 'trip', date: '2027-05-04', nearLodgingId: null as string | null, dayPosition: 4, dayOrderPinned: true };
    const update = jest.fn(async (fields) => { stored = { ...stored, ...fields }; });
    const doc = { get: jest.fn(async () => ({ exists: true, data: () => stored })), update };
    jest.spyOn(firebaseDb, 'getDb').mockReturnValue({ collection: () => ({ doc: () => doc }) } as unknown as ReturnType<typeof firebaseDb.getDb>);
    jest.spyOn(firebaseDb, 'ensureUserInTrip').mockResolvedValue({ groupId: 'group' });

    const saved = await firebaseDb.updateActivity('activity', 'traveler', { date: '', nearLodgingId: 'hotel' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ date: '', nearLodgingId: 'hotel', dayPosition: null, dayOrderPinned: false }));
    expect(saved).toMatchObject({ date: '', nearLodgingId: 'hotel' });
  });

  it('removes nearby hotel links when a hotel is deleted', async () => {
    const unlink = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const query = { where: jest.fn().mockReturnThis(), get: jest.fn(async () => ({ docs: [{ ref: { update: unlink } }] })) };
    const hotelDoc = { get: jest.fn(async () => ({ exists: true, data: () => ({ tripId: 'trip' }) })), delete: remove };
    jest.spyOn(firebaseDb, 'getDb').mockReturnValue({ collection: (name: string) => name === 'tours' ? query : { doc: () => hotelDoc } as unknown } as unknown as ReturnType<typeof firebaseDb.getDb>);
    jest.spyOn(firebaseDb, 'ensureUserInTrip').mockResolvedValue({ groupId: 'group' });

    await firebaseDb.deleteLodging('hotel', 'traveler');
    expect(query.where).toHaveBeenCalledWith('tripId', '==', 'trip');
    expect(query.where).toHaveBeenCalledWith('nearLodgingId', '==', 'hotel');
    expect(unlink).toHaveBeenCalledWith({ nearLodgingId: null });
    expect(remove).toHaveBeenCalled();
  });
});
