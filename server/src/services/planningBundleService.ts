import { planningBundleInventory } from './planningBundleInventory';
import { createHash } from 'crypto';
import * as db from '../db';
import { withPlanningTransaction } from '../db.postgres';
import { getEnvFlag } from '../env';
import { EntitlementError } from '../errors';
import type { PlanningBundle } from '../types';
import { assertCanUseFeature } from './entitlementService';
import { PlanningError } from './planningOperations';
import { withAirportCoordinates } from './planningPointsService';

const MAX_ROWS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;

export const readPlanningBundle = async (userId: string, tripId: string, role?: string, ifNoneMatch?: string): Promise<{ etag: string; bundle?: PlanningBundle }> => {
  const read = async () => {
    // Authorization ALWAYS precedes conditional handling. Followers use their
    // existing audience-specific routes, never this private member projection.
    const member = await db.ensureUserInTrip(tripId, userId);
    if (!member) throw new PlanningError('TRIP_ACCESS_DENIED', 403, 'Trip access is required');
    let costTracking = true;
    try { await assertCanUseFeature(userId, 'cost_tracking', role as 'admin' | 'user'); }
    catch (error) { if (error instanceof EntitlementError) costTracking = false; else throw error; }
    const version = await db.getPlanningRevision(tripId, member.groupId);
    const etag = `"${createHash('sha256').update(JSON.stringify([1, userId, tripId, member.groupId, costTracking, version])).digest('hex')}"`;
    if (ifNoneMatch === etag) return { etag };
    const trip = await db.getTripById(tripId);
    if (!trip) throw new PlanningError('TRIP_NOT_FOUND', 404, 'Trip not found');
    const latest = await planningBundleInventory(tripId, member.groupId);
    const [groupMembers, flights, lodgings, tours, carRentals, expenses, payments, coveredBy] = await Promise.all([
      db.listGroupMembers(member.groupId, userId), db.listFlights(userId, tripId), db.listLodgings(userId, tripId),
      db.listActivities(userId, tripId), db.listCarRentals(userId, tripId),
      costTracking ? db.listExpenses(userId, tripId) : Promise.resolve([]),
      costTracking ? db.listTripPayments(userId, tripId) : Promise.resolve([]),
      db.getTripCovering(userId, tripId),
    ]);
    const itinerary = latest ? { id: latest.id, planMarkdown: latest.planMarkdown ?? null, details: await db.listItineraryDetails(userId, latest.id) } : null;
    const bundle: PlanningBundle = { schemaVersion: 1, tripId, representation: { costTracking }, trip,
      groupMembers, flights: flights.map(withAirportCoordinates), lodgings, tours, carRentals, expenses, payments, coveredBy, itinerary };
    const rows = [groupMembers, flights, lodgings, tours, carRentals, expenses, payments, itinerary?.details ?? []].reduce((n, list) => n + list.length, 0);
    if (rows > MAX_ROWS || Buffer.byteLength(JSON.stringify(bundle)) > MAX_BYTES) throw new PlanningError('BUNDLE_TOO_LARGE', 413, 'This trip is too large for a saved bundle');
    if (!(await db.ensureUserInTrip(tripId, userId))) throw new PlanningError('TRIP_ACCESS_DENIED', 403, 'Trip access is required');
    if (version !== await db.getPlanningRevision(tripId, member.groupId)) throw new PlanningError('BUNDLE_CHANGED', 409, 'The trip changed. Please refresh.');
    return { etag, bundle };
  };
  if (db.getCurrentDbProvider() === 'firebase') {
    // Each writer bumps its scope in the same Firestore transaction. A stable
    // before/after fence prevents a mixed graph from being saved.
    for (let attempt = 0; ; attempt++) {
      try { return await read(); }
      catch (error) { if (!(error instanceof PlanningError) || error.code !== 'BUNDLE_CHANGED' || attempt >= 1) throw error; }
    }
  }
  return withPlanningTransaction(async client => {
    if (!getEnvFlag('USE_IN_MEMORY_DB') && db.getCurrentDbProvider() !== 'memory') await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return read();
  });
};
