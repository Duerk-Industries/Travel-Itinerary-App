import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteFlight, ensureUserInTrip, getFlightForUser, insertFlight, listFlights, searchFlightLocations, shareFlight, updateFlight } from '../db';
import { isEmailConfigured, sendShareEmail } from '../mailer';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const flights = await listFlights(userId, tripId);
  res.json(flights);
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
    arrivalTime,
    cost,
    carrier,
    flightNumber,
    bookingReference,
    tripId,
    paidBy,
  } = req.body;
  if (!passengerName || !departureDate || !departureTime || !arrivalTime || !carrier || !flightNumber || !bookingReference || !tripId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const flight = await insertFlight({
    userId,
    tripId,
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
    arrivalTime,
    cost: Number(cost) ?? 0,
    carrier,
    flightNumber,
    bookingReference,
    paidBy: Array.isArray(paidBy) ? paidBy : [],
  });
  res.status(201).json(flight);
});

router.patch('/:id', async (req, res) => {
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
    arrivalTime,
    cost,
    carrier,
    flightNumber,
    bookingReference,
    paidBy,
  } = req.body;
  if (!passengerName || !departureDate || !departureTime || !arrivalTime || !carrier || !flightNumber || !bookingReference) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  try {
    const updated = await updateFlight(req.params.id, userId, {
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
      arrivalTime,
      cost: Number(cost) ?? 0,
      carrier,
      flightNumber,
      bookingReference,
      paidBy: Array.isArray(paidBy) ? paidBy : [],
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await deleteFlight(req.params.id, userId);
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

export default router;
