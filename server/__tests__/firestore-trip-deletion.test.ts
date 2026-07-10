/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import net from 'net';
import { randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';

jest.setTimeout(60000);

const canConnect = async (host: string, port: number, timeoutMs = 1500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });

// Exercises the Firestore adapter's deleteTrip cascade against a real
// Firestore emulator (Firestore has no FK cascade, unlike Postgres, so this
// path is hand-written and easy to silently regress). Soft-skips (no-ops)
// when no emulator is reachable, matching the convention in
// firestore.rules.test.ts.
describe('Firestore trip deletion cascade (emulator)', () => {
  let emulatorReady = false;
  let db: Firestore;
  let firebase: typeof import('../src/db.firebase');

  beforeAll(async () => {
    process.env.DB_PROVIDER = 'firebase';
    process.env.USE_IN_MEMORY_DB = '0';
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
    process.env.GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID ?? 'firestore-emulator-test';

    const [host, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    emulatorReady = await canConnect(host, Number(portRaw || 8080));
    if (!emulatorReady) {
      console.warn(`[TEST][firestore-trip-deletion] emulator not reachable at ${process.env.FIRESTORE_EMULATOR_HOST}`);
      return;
    }

    jest.resetModules();
    const { resetDbAdapter } = require('../src/db.providers') as typeof import('../src/db.providers');
    resetDbAdapter();
    firebase = require('../src/db.firebase') as typeof import('../src/db.firebase');
    db = firebase.getDb();
    await db.listCollections();
  });

  it('deletes every trip-scoped artifact when the last traveler leaves', async () => {
    if (!emulatorReady) return;
    const ownerId = randomUUID();

    const { trip, groupId } = await firebase.createTripWithGroupAndMembers({
      ownerId,
      tripName: `Cascade Test ${randomUUID()}`,
      members: [],
    });
    const tripId = trip.id;

    const flightId = randomUUID();
    await db.collection('flights').doc(flightId).set({ id: flightId, tripId, passengerIds: [ownerId], paidBy: [ownerId] });
    const lodgingId = randomUUID();
    await db
      .collection('lodgings')
      .doc(lodgingId)
      .set({ id: lodgingId, trip_id: tripId, traveler_ids: [ownerId], paid_by: [ownerId] });
    const tourId = randomUUID();
    await db.collection('tours').doc(tourId).set({ id: tourId, tripId, paidBy: [ownerId] });
    const expenseId = randomUUID();
    await db.collection('expenses').doc(expenseId).set({ id: expenseId, tripId, payerIds: [ownerId], forIds: [ownerId] });
    const carRentalId = randomUUID();
    await db.collection('car_rentals').doc(carRentalId).set({ id: carRentalId, tripId });
    const itemVoteId = randomUUID();
    await db
      .collection('item_votes')
      .doc(itemVoteId)
      .set({ id: itemVoteId, tripId, itemType: 'flight', itemId: flightId, userId: ownerId, value: 1 });
    const activityId = randomUUID();
    await db.collection('trip_activity').doc(activityId).set({ id: activityId, tripId, type: 'TRIP_CREATED' });
    const commentId = randomUUID();
    await db.collection('trip_comments').doc(commentId).set({ id: commentId, tripId, body: 'hi' });
    const followerDocId = randomUUID();
    await db.collection('trip_followers').doc(followerDocId).set({ id: followerDocId, tripId, followerUserId: randomUUID() });
    const followCode = `T${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await db.collection('follow_codes').doc(followCode).set({ tripId, code: followCode, status: 'active' });
    const shareInviteId = randomUUID();
    await db.collection('trip_share_invites').doc(shareInviteId).set({ id: shareInviteId, tripId });
    const paymentId = randomUUID();
    await db.collection('trip_payments').doc(paymentId).set({ id: paymentId, tripId });
    await db.collection('trip_removals').doc(randomUUID()).set({ tripId, userId: randomUUID() });

    const itineraryId = randomUUID();
    await db.collection('itineraries').doc(itineraryId).set({
      id: itineraryId,
      tripId,
      destination: 'x',
      days: 1,
      budget: null,
      createdAt: new Date().toISOString(),
      userId: ownerId,
    });
    const detailId = randomUUID();
    await db
      .collection('itinerary_details')
      .doc(detailId)
      .set({ id: detailId, itineraryId, day: 1, activity: 'Test', cost: null, kind: 'checklist' });
    const checklistItemId = randomUUID();
    await db.collection('itinerary_checklist_items').doc(checklistItemId).set({
      id: checklistItemId,
      detailId,
      position: 0,
      label: 'Pack passport',
      checkedBy: null,
      checkedAt: null,
      createdAt: new Date().toISOString(),
    });
    await db
      .collection('itinerary_detail_reactions')
      .doc(`${detailId}_${ownerId}`)
      .set({ tripId, detailId, userId: ownerId, value: 1, updatedAt: new Date().toISOString() });

    const messageId = randomUUID();
    await db.collection('trip_messages').doc(messageId).set({ id: messageId, tripId, body: 'hi', createdAt: new Date().toISOString() });
    await db.collection('message_reads').doc(`${messageId}_${ownerId}`).set({ messageId, userId: ownerId, readAt: new Date().toISOString() });
    await db
      .collection('chat_read_watermarks')
      .doc(`${ownerId}_${tripId}`)
      .set({ userId: ownerId, tripId, lastReadMessageId: messageId, lastReadCreatedAt: new Date().toISOString() });

    // createTrip already seeds default packing-list items; add an explicit
    // "check" too so the nested checks subcollection isn't trivially empty.
    await db.collection('trip_packing_lists').doc(tripId).collection('checks').doc(randomUUID()).set({ checked: true });

    await firebase.deleteTrip(ownerId, tripId);

    const tripDoc = await db.collection('trips').doc(tripId).get();
    expect(tripDoc.exists).toBe(false);

    const flatChecks: Array<[string, string, string]> = [
      ['flights', 'tripId', tripId],
      ['lodgings', 'trip_id', tripId],
      ['tours', 'tripId', tripId],
      ['expenses', 'tripId', tripId],
      ['car_rentals', 'tripId', tripId],
      ['item_votes', 'tripId', tripId],
      ['trip_activity', 'tripId', tripId],
      ['trip_comments', 'tripId', tripId],
      ['trip_followers', 'tripId', tripId],
      ['follow_codes', 'tripId', tripId],
      ['trip_share_invites', 'tripId', tripId],
      ['trip_payments', 'tripId', tripId],
      ['trip_removals', 'tripId', tripId],
      ['itineraries', 'tripId', tripId],
      ['itinerary_detail_reactions', 'tripId', tripId],
      ['trip_messages', 'tripId', tripId],
      ['chat_read_watermarks', 'tripId', tripId],
    ];
    for (const [collection, field, value] of flatChecks) {
      const snap = await db.collection(collection).where(field, '==', value).get();
      expect({ collection, size: snap.size }).toEqual({ collection, size: 0 });
    }

    const detailsSnap = await db.collection('itinerary_details').where('itineraryId', '==', itineraryId).get();
    expect(detailsSnap.size).toBe(0);
    const checklistSnap = await db.collection('itinerary_checklist_items').where('detailId', '==', detailId).get();
    expect(checklistSnap.size).toBe(0);
    const messageReadsSnap = await db.collection('message_reads').where('messageId', '==', messageId).get();
    expect(messageReadsSnap.size).toBe(0);

    const packingItemsSnap = await db.collection('trip_packing_lists').doc(tripId).collection('items').get();
    expect(packingItemsSnap.size).toBe(0);
    const packingChecksSnap = await db.collection('trip_packing_lists').doc(tripId).collection('checks').get();
    expect(packingChecksSnap.size).toBe(0);

    // Cleanup the group scaffolding this test created (trip itself is already gone).
    await db.collection('groups').doc(groupId).delete().catch(() => undefined);
    const membersSnap = await db.collection('group_members').where('groupId', '==', groupId).get();
    await Promise.all(membersSnap.docs.map((d) => d.ref.delete()));
    const accessSnap = await db.collection('group_access').where('groupId', '==', groupId).get();
    await Promise.all(accessSnap.docs.map((d) => d.ref.delete()));
  });
});
