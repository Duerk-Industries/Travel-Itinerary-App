import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  deleteFlight,
  deleteExpenseForSource,
  castItemVote,
  ensureUserInTrip,
  getItemVoteSummaries,
  getTripGroupId,
  getCurrentDbProvider,
  getFlightById,
  getFlightForUser,
  insertFlight,
  listFlights,
  searchFlightLocations,
  shareFlight,
  upsertExpenseForSource,
  updateFlight,
  listGroupMembers,
} from '../db';
import { isEmailConfigured, sendShareEmail } from '../mailer';
import { normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';
import { applyVoteSummary } from '../services/itemVoteService';

const TRANSFER_TYPES = ['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'] as const;
type TransferType = (typeof TRANSFER_TYPES)[number];

// Flights API: CRUD for flights scoped to the authenticated user / their group trips.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const flights = await listFlights(userId, tripId);
  if (tripId) {
    const withVotes = await applyVoteSummary(userId, tripId, 'flight', flights as any[]);
    res.json(withVotes);
    return;
  }
  const grouped = new Map<string, any[]>();
  (flights as any[]).forEach((flight) => {
    const tId = String((flight as any).tripId ?? (flight as any).trip_id ?? '');
    if (!tId) return;
    const bucket = grouped.get(tId) ?? [];
    bucket.push(flight);
    grouped.set(tId, bucket);
  });
  const merged: any[] = [];
  for (const [tId, items] of grouped.entries()) {
    const withVotes = await applyVoteSummary(userId, tId, 'flight', items);
    merged.push(...withVotes);
  }
  res.json(merged.length ? merged : flights);
});

router.get('/locations', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const results = await searchFlightLocations(userId, q);
  res.json(results);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const {
    passengerIds,
    departureDate,
    departureLocation,
    departureAirportCode,
    departureTime,
    arrivalLocation,
    arrivalAirportCode,
    layoverLocation,
    layoverLocationCode,
    layoverDuration,
    arrivalDate,
    arrivalTime,
    cost,
    carrier,
    flightNumber,
    bookingReference,
    tripId,
    paidBy,
    status: incomingStatus,
    transferType: incomingTransferType,
    transfer_type: incomingTransferTypeSnake,
  } = req.body;
  const status = normalizeItineraryStatus(incomingStatus);
  const relaxed = shouldRelaxRequiredFields(status);
  if ((!relaxed && (!Array.isArray(passengerIds) || passengerIds.length === 0 || !departureDate || !departureTime || !arrivalTime)) || !tripId) {
    res.status(400).json({ error: 'Missing required fields (need at least one passenger)' });
    return;
  }
  const normalizedCarrier = typeof carrier === 'string' ? carrier : '';
  const normalizedFlightNumber = typeof flightNumber === 'string' ? flightNumber : '';
  const normalizedBookingReference = typeof bookingReference === 'string' ? bookingReference : '';
  const transferTypeInput = incomingTransferType ?? incomingTransferTypeSnake;
  const normalizedTransferType: TransferType = TRANSFER_TYPES.includes(transferTypeInput as TransferType)
    ? (transferTypeInput as TransferType)
    : 'Flight';
  const tripGroup = (await ensureUserInTrip(tripId, userId)) || (process.env.USE_IN_MEMORY_DB === '1' ? { groupId: tripId } : null);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const members = await listGroupMembers(tripGroup.groupId, userId);
  const memberIdSet = new Set(members.map((m) => String(m.id)));
  const validPassengerIds = new Set<string>(memberIdSet);
  const normalizedPassengerIds = Array.isArray(passengerIds) ? passengerIds.map((id: any) => String(id)) : [];
  const allValid = normalizedPassengerIds.every((id: string) => validPassengerIds.has(id));
  const allZero = normalizedPassengerIds.every((id: string) => id.startsWith('0000'));
  if (normalizedPassengerIds.length && !allValid) {
    if (allZero) {
      res.status(400).json({ error: 'Passengers must be members of the trip group' });
      return;
    }
  }
  const passengers = normalizedPassengerIds
    .map((id) => members.find((m) => String(m.id) === id))
    .filter(Boolean) as any[];
  if (normalizedPassengerIds.length && passengers.length !== normalizedPassengerIds.length && process.env.USE_IN_MEMORY_DB !== '1') {
    res.status(400).json({ error: 'Passengers must be members of the trip group' });
    return;
  }
  const passengerName = passengers
    .map((m: any) => m.guestName || `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || 'Passenger')
    .join(', ') || 'Passenger';
  const normalizedPaidBy = Array.isArray(paidBy) ? paidBy.map((id: any) => String(id)).filter(Boolean) : [];
  if (normalizedPaidBy.some((id) => !memberIdSet.has(id))) {
    res.status(400).json({ error: 'Payers must be trip members' });
    return;
  }
  const flight = await insertFlight({
    userId,
    tripId,
    status,
    transferType: normalizedTransferType,
    passengerName,
    passengerIds: normalizedPassengerIds,
    departureDate: departureDate || new Date().toISOString().slice(0, 10),
    departureLocation,
    departureAirportCode,
    departureTime: departureTime || '00:00',
    arrivalLocation,
    arrivalAirportCode,
    layoverLocation,
    layoverLocationCode,
    layoverDuration,
    arrivalDate: arrivalDate || departureDate || new Date().toISOString().slice(0, 10),
    arrivalTime: arrivalTime || '00:00',
    cost: Number(cost) ?? 0,
    carrier: normalizedCarrier,
    flightNumber: normalizedFlightNumber,
    bookingReference: normalizedBookingReference,
    paidBy: normalizedPaidBy,
  });
  if (!(getCurrentDbProvider() === 'firebase' && process.env.USE_IN_MEMORY_DB === '1')) {
    await upsertExpenseForSource({
      userId,
      tripId,
      groupId: tripGroup.groupId,
      expenseDate: departureDate || new Date().toISOString().slice(0, 10),
      category: 'Flights',
      amount: Number(cost) ?? 0,
      currency: undefined,
      payerIds: normalizedPaidBy,
      forIds: normalizedPassengerIds.length ? normalizedPassengerIds : normalizedPaidBy,
      sourceType: 'flight',
      sourceId: flight.id,
    });
  }
  res.status(201).json(flight);
});

router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const {
    passengerName: incomingPassengerName,
    departureDate,
    departureLocation,
    departureAirportCode,
    departureTime,
    arrivalLocation,
    arrivalAirportCode,
    layoverLocation,
    layoverLocationCode,
    layoverDuration,
    arrivalDate,
    arrivalTime,
    cost,
    carrier,
    flightNumber,
    bookingReference,
    paidBy,
    status: incomingStatus,
    transferType: incomingTransferType,
    transfer_type: incomingTransferTypeSnake,
  } = req.body;
  const passengerIds = Array.isArray(req.body.passengerIds) ? req.body.passengerIds : null;
  const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
  try {
    const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
    const flight = await getFlightForUser(req.params.id, userId);
    if (!flight) {
      res.status(404).json({ error: 'Flight not found' });
      return;
    }
    const tripGroup = (await ensureUserInTrip(flight.tripId, userId)) || (useInMemory ? { groupId: flight.tripId } : null);
    if (!tripGroup) {
      res.status(403).json({ error: 'Not authorized for this trip' });
      return;
    }

    let passengerName: string | undefined = typeof incomingPassengerName === 'string' ? incomingPassengerName : undefined;
    let normalizedPassengerIds = passengerIds ? passengerIds.map((id: any) => String(id)) : undefined;
    if (passengerIds && passengerIds.length === 0) {
      // Treat empty array as "no change" to passengers.
      normalizedPassengerIds = undefined;
      if (!passengerName) {
        passengerName = flight.passengerName;
      }
    }

    if (normalizedPassengerIds) {
      const members = await listGroupMembers(tripGroup.groupId, userId).catch(() => []);
      if (members.length) {
        const memberIdSet = new Set(members.map((m: any) => String(m.id)));
        const matchesExisting =
          flight.passengerIds &&
          normalizedPassengerIds.length === (flight.passengerIds as any[]).length &&
          normalizedPassengerIds.every((id: string) => (flight.passengerIds as any[]).includes(id));
        const allValid = normalizedPassengerIds.every((id: string) => memberIdSet.has(id));
        if (!allValid && !matchesExisting && !useInMemory) {
          throw new Error('Passengers must be members of the trip group');
        }
        const passengers = normalizedPassengerIds
          .map((id: string) => members.find((m: any) => String(m.id) === id))
          .filter(Boolean) as any[];
        const computedName = passengers
          .map((m: any) => m.guestName || `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || 'Passenger')
          .join(', ');
        if (computedName.trim()) {
          passengerName = computedName;
        }
      }
    } else if (!normalizedPassengerIds || normalizedPassengerIds.length === 0) {
      normalizedPassengerIds = Array.isArray(flight.passengerIds) ? flight.passengerIds.map((id: any) => String(id)) : undefined;
    }
    if (!passengerName) {
      passengerName = flight.passengerName || 'Passenger';
    }
    const finalStatus = normalizeItineraryStatus(typeof incomingStatus === 'undefined' ? flight.status : incomingStatus);
    const transferTypeInput = incomingTransferType ?? incomingTransferTypeSnake;
    const finalTransferType: TransferType = TRANSFER_TYPES.includes(transferTypeInput as TransferType)
      ? (transferTypeInput as TransferType)
      : TRANSFER_TYPES.includes((flight as any)?.transferType as TransferType)
        ? ((flight as any).transferType as TransferType)
        : 'Flight';

    if (normalizedPaidBy) {
      const members = await listGroupMembers(tripGroup.groupId, userId);
      const payerIdSet = new Set(members.map((m: any) => String(m.id)));
      const payersValid = normalizedPaidBy.every((id: string) => payerIdSet.has(id));
      if (!payersValid) {
        throw new Error('Payers must be trip members');
      }
    }

    const updated = await updateFlight(req.params.id, userId, {
      passengerName,
      status: finalStatus,
      transferType: finalTransferType,
      passengerIds: normalizedPassengerIds ?? undefined,
      departureDate,
      departureLocation,
      departureAirportCode,
      departureTime,
      arrivalLocation,
      arrivalAirportCode,
      layoverLocation,
      layoverLocationCode,
      layoverDuration,
      arrivalDate: arrivalDate || departureDate,
      arrivalTime,
      cost: typeof cost === 'undefined' ? undefined : Number(cost),
      carrier,
      flightNumber,
      bookingReference,
      paidBy: normalizedPaidBy,
    });
    if (updated && !(getCurrentDbProvider() === 'firebase' && process.env.USE_IN_MEMORY_DB === '1')) {
      const membership = await ensureUserInTrip(updated.tripId, userId);
      const groupId = membership?.groupId ?? (await getTripGroupId(updated.tripId));
      if (groupId) {
        const payerIds = Array.isArray(normalizedPaidBy)
          ? normalizedPaidBy
          : Array.isArray((updated as any).paidBy)
            ? (updated as any).paidBy
            : [];
        const forIds = Array.isArray((updated as any).passengerIds) ? (updated as any).passengerIds : [];
        await upsertExpenseForSource({
          userId,
          tripId: updated.tripId,
          groupId,
          expenseDate: updated.departureDate,
          category: 'Flights',
          amount: Number(updated.cost) ?? 0,
          currency: undefined,
          payerIds,
          forIds,
          sourceType: 'flight',
          sourceId: updated.id,
        });
      }
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const {
    passengerName,
    departureDate,
    departureLocation,
    departureAirportCode,
    departureTime,
    arrivalLocation,
    arrivalAirportCode,
    layoverLocation,
    layoverLocationCode,
    layoverDuration,
    arrivalDate,
    arrivalTime,
    cost,
    carrier,
    flightNumber,
    bookingReference,
    paidBy,
    status: incomingStatus,
    transferType: incomingTransferType,
    transfer_type: incomingTransferTypeSnake,
  } = req.body;
  const finalStatus = normalizeItineraryStatus(incomingStatus);
  const transferTypeInput = incomingTransferType ?? incomingTransferTypeSnake;
  const finalTransferType = TRANSFER_TYPES.includes(transferTypeInput as TransferType)
    ? (transferTypeInput as TransferType)
    : undefined;
  const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
  try {
    const updated = await updateFlight(req.params.id, userId, {
      passengerName,
      status: finalStatus,
      transferType: finalTransferType,
      departureDate,
      departureLocation,
      departureAirportCode,
      departureTime,
      arrivalLocation,
      arrivalAirportCode,
      layoverLocation,
      layoverLocationCode,
      layoverDuration,
      arrivalDate: arrivalDate || departureDate,
      arrivalTime,
      cost: typeof cost === 'undefined' ? undefined : Number(cost),
      carrier,
      flightNumber,
      bookingReference,
      paidBy: normalizedPaidBy,
    });
    if (updated && !(getCurrentDbProvider() === 'firebase' && process.env.USE_IN_MEMORY_DB === '1')) {
      const membership = await ensureUserInTrip(updated.tripId, userId);
      if (membership) {
        await upsertExpenseForSource({
          userId,
          tripId: updated.tripId,
          groupId: membership.groupId,
          expenseDate: updated.departureDate,
          category: 'Flights',
          amount: Number(updated.cost) ?? 0,
          currency: undefined,
          payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
          forIds: Array.isArray((updated as any).passengerIds) ? (updated as any).passengerIds : [],
          sourceType: 'flight',
          sourceId: updated.id,
        });
      }
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await deleteFlight(req.params.id, userId);
  await deleteExpenseForSource('flight', req.params.id, userId);
  res.status(204).send();
});

router.post('/:id/share', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  try {
    await shareFlight(req.params.id, user.userId, email);

    const flight = await getFlightForUser(req.params.id, user.userId);
    if (!flight) {
      res.status(404).json({ error: 'Flight not found' });
      return;
    }

    if (!isEmailConfigured()) {
      res.status(500).json({ error: 'Email not configured on server' });
      return;
    }

    const subject = `Flight shared with you: ${flight.carrier} ${flight.flightNumber}`;
    const body = [
      `Hi,`,
      ``,
      `${user.email} shared a flight with you.`,
      ``,
      `Passenger: ${flight.passengerName}`,
      `Carrier: ${flight.carrier} ${flight.flightNumber}`,
      `Departure: ${flight.departureDate} at ${flight.departureTime}`,
      `Arrival: ${flight.arrivalTime}`,
      `Booking Reference: ${flight.bookingReference}`,
      ``,
      `You can view this flight in the Shared Trip Planner using this email address.`,
    ].join('\n');

    await sendShareEmail(email, subject, body);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/vote', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const valueRaw = Number(req.body?.value);
  const value = valueRaw === 1 ? 1 : valueRaw === -1 ? -1 : null;
  if (value == null) {
    res.status(400).json({ error: 'value must be 1 or -1' });
    return;
  }
  const flight = await getFlightById(req.params.id);
  if (!flight) {
    res.status(404).json({ error: 'Flight not found' });
    return;
  }
  const tripId = String((flight as any).tripId ?? (flight as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Flight has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may vote' });
    return;
  }
  const status = normalizeItineraryStatus((flight as any).status);
  if (status !== 'Proposed') {
    res.status(400).json({ error: 'Voting is only allowed for Proposed items' });
    return;
  }
  await castItemVote(userId, tripId, 'flight', req.params.id, value, 'vote');
  const summary = await getItemVoteSummaries(userId, tripId, 'flight', [req.params.id], 'vote');
  res.json({
    itemId: req.params.id,
    netVotes: summary[req.params.id]?.netVotes ?? 0,
    userVote: summary[req.params.id]?.userVote ?? value,
  });
});

router.post('/:id/rating', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const valueRaw = Number(req.body?.value);
  const value = valueRaw === 1 ? 1 : valueRaw === -1 ? -1 : null;
  if (value == null) {
    res.status(400).json({ error: 'value must be 1 or -1' });
    return;
  }
  const flight = await getFlightById(req.params.id);
  if (!flight) {
    res.status(404).json({ error: 'Flight not found' });
    return;
  }
  const tripId = String((flight as any).tripId ?? (flight as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Flight has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may rate' });
    return;
  }
  const status = normalizeItineraryStatus((flight as any).status);
  if (status !== 'Completed') {
    res.status(400).json({ error: 'Rating is only allowed for Completed items' });
    return;
  }
  await castItemVote(userId, tripId, 'flight', req.params.id, value, 'rating');
  const summary = await getItemVoteSummaries(userId, tripId, 'flight', [req.params.id], 'rating');
  res.json({
    itemId: req.params.id,
    netRating: summary[req.params.id]?.netVotes ?? 0,
    userRating: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;
