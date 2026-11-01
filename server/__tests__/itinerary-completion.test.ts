/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, insertActivity, insertCarRental, insertFlight, insertLodging, listActivities, listCarRentals, listFlights, listLodgings } from '../src/db';
import { completeEndedItems, firstUnfinishedDay } from '../src/services/itineraryCompletionService';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

describe('completing itinerary items once their last day is over', () => {
  const uniq = Date.now();
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const owner = await registerAndLoginWebUser({ email: `complete+${uniq}@example.com`, firstName: 'Complete', lastName: 'Owner', password: 'testtest' });
    userId = owner.userId;
    await setUserTierInDb(userId, 'premium');
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${owner.token}`).expect(200);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `Completion Trip ${uniq}`, groupId: groups.body[0].id }).expect(201);
    tripId = trip.body.id;
  });

  afterAll(async () => {
    await closePool();
  });

  it('treats a day as over 12 hours after UTC midnight', () => {
    expect(firstUnfinishedDay(new Date('2026-03-05T11:59:00Z'))).toBe('2026-03-04');
    expect(firstUnfinishedDay(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05');
  });

  it('completes booked items that end before today and leaves multi-day items running until the day after', async () => {
    const flight = (over: Record<string, unknown>) => insertFlight({
      userId, tripId, status: 'Booked', transferType: 'Flight', passengerName: 'A', departureDate: '2026-03-03', arrivalDate: '2026-03-03', departureTime: '09:00', arrivalTime: '11:00',
      cost: 0, carrier: 'X', flightNumber: '1', bookingReference: 'R', ...over,
    } as any);
    const activity = (over: Record<string, unknown>) => insertActivity({
      userId, tripId, status: 'Booked', activityType: 'Other', date: '2026-03-03', name: 'Walk', startLocation: '', startTime: '10:00', duration: '', cost: 0, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [], ...over,
    } as any);
    const lodging = (over: Record<string, unknown>) => insertLodging({
      userId, tripId, status: 'Booked', name: 'Hotel', checkInDate: '2026-03-01', checkOutDate: '2026-03-04', rooms: 1, totalCost: 0, costPerNight: 0, address: '', paid_by: [], traveler_ids: [], ...over,
    } as any);
    const rental = (over: Record<string, unknown>) => insertCarRental({
      userId, tripId, status: 'Booked', pickupLocation: 'A', pickupDate: '2026-03-01', dropoffLocation: 'B', dropoffDate: '2026-03-04', reference: '', vendor: '', prepaid: '', cost: 0, model: '', notes: '', paidBy: [], travelerIds: [], ...over,
    } as any);

    const overnight = await flight({ departureDate: '2026-03-04', arrivalDate: '2026-03-05' });
    const sameDay = await flight({});
    const proposedActivity = await activity({ status: 'Proposed' });
    const pastActivity = await activity({});
    const todayActivity = await activity({ date: '2026-03-05' });
    const checkedOut = await lodging({});
    const stillStaying = await lodging({ checkOutDate: '2026-03-05' });
    const returned = await rental({});
    const stillRented = await rental({ dropoffDate: '2026-03-05' });

    // 2026-03-05 18:00 UTC: March 4 is over, March 5 is not.
    const completed = await completeEndedItems(new Date('2026-03-05T18:00:00Z'));
    expect(completed).toBeGreaterThanOrEqual(4);

    const status = <T extends { id: string; status: string }>(items: T[], id: string) => items.find((item) => item.id === id)!.status;
    const flights = await listFlights(userId, tripId);
    const activities = await listActivities(userId, tripId);
    const lodgings = await listLodgings(userId, tripId);
    const rentals = await listCarRentals(userId, tripId);
    expect(status(flights, sameDay.id)).toBe('Completed');
    expect(status(flights, overnight.id)).toBe('Booked');
    expect(status(activities, pastActivity.id)).toBe('Completed');
    expect(status(activities, todayActivity.id)).toBe('Booked');
    expect(status(activities, proposedActivity.id)).toBe('Proposed');
    expect(status(lodgings, checkedOut.id)).toBe('Completed');
    expect(status(lodgings, stillStaying.id)).toBe('Booked');
    expect(status(rentals, returned.id)).toBe('Completed');
    expect(status(rentals, stillRented.id)).toBe('Booked');

    // The day after the final day, the spanning items finish too.
    await completeEndedItems(new Date('2026-03-06T18:00:00Z'));
    expect(status(await listFlights(userId, tripId), overnight.id)).toBe('Completed');
    expect(status(await listCarRentals(userId, tripId), stillRented.id)).toBe('Completed');
  });
});
