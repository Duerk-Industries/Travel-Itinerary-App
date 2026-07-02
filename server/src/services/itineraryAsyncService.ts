import { randomUUID } from 'crypto';
import {
  addItineraryDetail,
  createItineraryRecord,
  ensureUserInTrip,
  getWebUserProfile,
  insertActivity,
  insertCarRental,
  insertFlight,
  insertLodging,
  listGroupMembers,
  listItineraries,
  listItineraryDetails,
  upsertExpenseForSource,
} from '../db';
import { logError, logInfo } from '../logger';
import { incrementMetric, recordTiming } from '../metrics';
import { failGenerationUsage, finalizeGenerationUsage } from './entitlementService';
import {
  generateItineraryViaPromptPlan,
  type ItineraryGeneratedItems,
  type ItineraryGeneratedTransfer,
} from './itineraryPromptPlanService';
import type { ActivityType } from '../types';

type AsyncStatus = 'queued' | 'running' | 'completed' | 'failed';
type TransferWithPassengers = ItineraryGeneratedTransfer & { passengerIds?: string[] };

export type AsyncItineraryJob = {
  id: string;
  userId: string;
  tripId: string;
  itineraryId?: string;
  status: AsyncStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: {
    itineraryId: string;
    detailsCount: number;
    transfersCount: number;
    lodgingsCount: number;
    activitiesCount: number;
    carRentalsCount: number;
  };
};

type QueueInput = {
  apiKey: string;
  userId: string;
  tripId: string;
  itineraryId?: string;
  destinationSummary: string;
  locations: string[];
  mustSeeAttractions?: string[];
  days: number;
  budgetMin: number;
  budgetMax: number;
  departureAirport?: string;
  tripStyle?: string;
  tt?: unknown;
  ut?: unknown;
  groupTraits: Array<{ userId: string; name: string; traits: string[] }>;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  tripStartMonth?: number | null;
  tripStartYear?: number | null;
  idempotencyKey?: string;
  usageWindowKey?: string;
};

const jobs = new Map<string, AsyncItineraryJob>();
const jobRuns = new Map<string, Promise<void>>();

// Cap the in-memory job store so long-lived server processes don't accumulate
// completed jobs indefinitely. We keep the most-recently-touched N jobs; this
// covers in-flight + recently-finished jobs that the client may still poll.
// Tunable via env if a deploy needs a different ceiling.
const JOB_RETENTION_LIMIT = Number(process.env.ITINERARY_JOB_RETENTION_LIMIT ?? 5000);
// Completed/failed jobs older than this are eligible for pruning regardless
// of the count cap, so a quiet server doesn't keep stale jobs around forever.
const JOB_RETENTION_TTL_MS = Number(
  process.env.ITINERARY_JOB_RETENTION_TTL_MS ?? 24 * 60 * 60 * 1000,
);

const pruneStaleJobs = (
  opts: { limit?: number; ttlMs?: number; now?: number } = {},
): void => {
  if (jobs.size === 0) return;
  const limit = opts.limit ?? JOB_RETENTION_LIMIT;
  const ttlMs = opts.ttlMs ?? JOB_RETENTION_TTL_MS;
  const now = opts.now ?? Date.now();

  // Phase 1: drop any terminal job whose updatedAt is older than the TTL.
  if (ttlMs > 0) {
    for (const [id, job] of jobs) {
      if (job.status !== 'completed' && job.status !== 'failed') continue;
      const updated = Date.parse(job.updatedAt);
      if (Number.isFinite(updated) && now - updated > ttlMs) {
        jobs.delete(id);
      }
    }
  }

  // Phase 2: enforce the count cap by evicting oldest terminal jobs first,
  // and only falling back to oldest jobs of any status if still over the cap.
  if (limit > 0 && jobs.size > limit) {
    const sortable: Array<{ id: string; updated: number; terminal: boolean }> = [];
    for (const [id, job] of jobs) {
      sortable.push({
        id,
        updated: Date.parse(job.updatedAt) || 0,
        terminal: job.status === 'completed' || job.status === 'failed',
      });
    }
    // Terminal-first, then oldest-first.
    sortable.sort((a, b) => {
      if (a.terminal !== b.terminal) return a.terminal ? -1 : 1;
      return a.updated - b.updated;
    });
    while (jobs.size > limit && sortable.length) {
      const victim = sortable.shift();
      if (victim) jobs.delete(victim.id);
    }
  }
};

const nowIso = (): string => new Date().toISOString();

const safeString = (value: unknown): string => String(value ?? '').trim();
const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
const addDays = (isoDate: string, days: number): string => {
  const base = new Date(isoDate);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};
const normalizeAirportCode = (value: unknown): string => {
  const input = safeString(value);
  if (!input) return '';
  const parenMatch = input.match(/\(([A-Za-z0-9]{3,4})\)/);
  if (parenMatch?.[1]) return parenMatch[1].toUpperCase();
  if (/^[A-Za-z0-9]{3,4}$/.test(input)) return input.toUpperCase();
  const token = input.match(/\b([A-Za-z0-9]{3,4})\b/);
  return token?.[1]?.toUpperCase() ?? '';
};
const dateWithTimeKey = (date: string, time?: string): string => {
  const safeDate = isIsoDate(date) ? date : '9999-12-31';
  const safeTime = /^\d{2}:\d{2}$/.test(time ?? '') ? String(time) : '23:59';
  return `${safeDate}T${safeTime}`;
};
const validActivityType = (value: unknown): ActivityType => {
  const input = safeString(value);
  return (
    [
      'Class',
      'Concert/Show',
      'Day Trip',
      'Event',
      'Food & Drink',
      'Fun & Games',
      'Hike',
      'Nightlife',
      'Open Access',
      'Outdoor Activity',
      'Reservation',
      'Shopping',
      'Sights & Landmarks',
      'Spa/Wellness',
      'Ticketed Attraction',
      'Tour',
    ] as const
  ).includes(input as ActivityType)
    ? (input as ActivityType)
    : 'Tour';
};
const validTransferType = (value: unknown): ItineraryGeneratedTransfer['transferType'] => {
  const input = safeString(value);
  return (['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'] as const).includes(
    input as ItineraryGeneratedTransfer['transferType']
  )
    ? (input as ItineraryGeneratedTransfer['transferType'])
    : 'Flight';
};
const buildMemberDisplayName = (member: any): string => {
  const first = safeString(member?.firstName);
  const last = safeString(member?.lastName);
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const guest = safeString(member?.guestName);
  if (guest) return guest;
  const email = safeString(member?.email);
  return email || 'Traveler';
};

const deriveTerminalTransferContext = (generatedItems: ItineraryGeneratedItems) => {
  const lodgings = Array.isArray(generatedItems.lodgings) ? generatedItems.lodgings : [];
  const activities = Array.isArray(generatedItems.activities) ? generatedItems.activities : [];
  const transfers = Array.isArray(generatedItems.transfers) ? generatedItems.transfers : [];
  const firstDate = [
    safeString(lodgings[0]?.checkInDate),
    safeString(activities[0]?.date),
    safeString(transfers[0]?.departureDate),
  ].find(isIsoDate) ?? nowIso().slice(0, 10);

  const sortedLodgings = [...lodgings].sort((a, b) =>
    safeString(a.checkInDate).localeCompare(safeString(b.checkInDate))
  );
  const sortedActivities = [...activities].sort((a, b) =>
    dateWithTimeKey(safeString(a.date), safeString(a.startTime)).localeCompare(
      dateWithTimeKey(safeString(b.date), safeString(b.startTime))
    )
  );
  const sortedTransfers = [...transfers].sort((a, b) =>
    dateWithTimeKey(safeString(a.departureDate), safeString(a.departureTime)).localeCompare(
      dateWithTimeKey(safeString(b.departureDate), safeString(b.departureTime))
    )
  );
  const firstLodging = sortedLodgings[0];
  const lastLodging = sortedLodgings[Math.max(0, sortedLodgings.length - 1)];
  const firstActivity = sortedActivities[0];
  const lastActivity = sortedActivities[Math.max(0, sortedActivities.length - 1)];
  const firstTransfer = sortedTransfers[0];
  const lastTransfer = sortedTransfers[Math.max(0, sortedTransfers.length - 1)];
  const firstDestination =
    safeString(firstLodging?.address) ||
    safeString(firstLodging?.name) ||
    safeString(firstActivity?.startLocation) ||
    safeString(firstTransfer?.arrivalLocation) ||
    safeString(firstTransfer?.departureLocation);
  const lastDestination =
    safeString(lastLodging?.address) ||
    safeString(lastLodging?.name) ||
    safeString(lastActivity?.startLocation) ||
    safeString(lastTransfer?.departureLocation) ||
    safeString(lastTransfer?.arrivalLocation);

  const lastDateCandidates = [
    safeString(lastLodging?.checkOutDate),
    safeString(lastActivity?.date),
    safeString(lastTransfer?.arrivalDate),
    safeString(lastTransfer?.departureDate),
  ].filter(isIsoDate);
  lastDateCandidates.sort((a, b) => b.localeCompare(a));
  const lastDate = lastDateCandidates[0] ?? firstDate;

  return { firstDestination, lastDestination, firstDate, lastDate };
};

const buildTerminalTransfers = async (params: {
  tripId: string;
  userId: string;
  generatedItems: ItineraryGeneratedItems;
  currentUserPreferredAirport?: string | null;
}): Promise<{ first: TransferWithPassengers[]; last: TransferWithPassengers[] }> => {
  const { firstDestination, lastDestination, firstDate, lastDate } = deriveTerminalTransferContext(params.generatedItems);
  if (!firstDestination || !lastDestination) return { first: [], last: [] };

  const membership = await ensureUserInTrip(params.tripId, params.userId);
  if (!membership) return { first: [], last: [] };
  const members = await listGroupMembers(membership.groupId, params.userId).catch(() => []);
  const activeMembers = (Array.isArray(members) ? members : []).filter(
    (m: any) => safeString(m?.id) && safeString(m?.status || 'active') !== 'removed'
  );
  if (!activeMembers.length) return { first: [], last: [] };

  let creatorAirport =
    normalizeAirportCode(activeMembers.find((m: any) => Boolean((m as any).isGroupOwner))?.preferredAirport) ||
    normalizeAirportCode(params.currentUserPreferredAirport);
  if (!creatorAirport) {
    creatorAirport = '';
  }

  const groups = new Map<string, string[]>();
  for (const member of activeMembers as any[]) {
    const id = safeString(member.id);
    if (!id) continue;
    const effective = normalizeAirportCode(member.preferredAirport) || creatorAirport;
    if (!effective) continue;
    const bucket = groups.get(effective) ?? [];
    if (!bucket.includes(id)) bucket.push(id);
    groups.set(effective, bucket);
  }

  if (!groups.size) return { first: [], last: [] };
  const entries = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  const generatedTransfers = Array.isArray(params.generatedItems.transfers) ? params.generatedItems.transfers : [];
  const hasExistingFirstTransfer = (airport: string): boolean =>
    generatedTransfers.some(
      (transfer) =>
        isIsoDate(safeString(transfer.departureDate)) &&
        safeString(transfer.departureDate) === firstDate &&
        safeString(transfer.departureLocation).toUpperCase() === airport.toUpperCase()
    );
  const hasExistingLastTransfer = (airport: string): boolean =>
    generatedTransfers.some(
      (transfer) =>
        (safeString(transfer.departureDate) === lastDate || safeString(transfer.arrivalDate) === lastDate) &&
        safeString(transfer.arrivalLocation).toUpperCase() === airport.toUpperCase()
    );

  const first = entries
    .filter(([airport]) => !hasExistingFirstTransfer(airport))
    .map(([airport, passengerIds]) => ({
      status: 'Needed' as const,
      transferType: 'Flight' as const,
      departureDate: firstDate,
      arrivalDate: firstDate,
      departureLocation: airport,
      arrivalLocation: firstDestination,
      departureTime: '09:00',
      arrivalTime: '11:00',
      carrier: '',
      flightNumber: '',
      bookingReference: '',
      passengerIds,
    }));
  const last = entries
    .filter(([airport]) => !hasExistingLastTransfer(airport))
    .map(([airport, passengerIds]) => ({
      status: 'Needed' as const,
      transferType: 'Flight' as const,
      departureDate: lastDate,
      arrivalDate: lastDate,
      departureLocation: lastDestination,
      arrivalLocation: airport,
      departureTime: '17:00',
      arrivalTime: '20:00',
      carrier: '',
      flightNumber: '',
      bookingReference: '',
      passengerIds,
    }));

  return {
    first,
    last,
  };
};

const ensureItineraryId = async (params: {
  userId: string;
  tripId: string;
  itineraryId?: string;
  destination: string;
  days: number;
  budget: number;
}): Promise<string> => {
  if (params.itineraryId) return params.itineraryId;
  const existing = await listItineraries(params.userId);
  const match = existing.find(
    (item) =>
      item.tripId === params.tripId &&
      safeString(item.destination).toLowerCase() === safeString(params.destination).toLowerCase() &&
      Number(item.days) === Number(params.days) &&
      Number(item.budget ?? 0) === Number(params.budget ?? 0)
  );
  if (match?.id) return match.id;
  const created = await createItineraryRecord(
    params.userId,
    params.tripId,
    params.destination,
    Number(params.days),
    Number(params.budget ?? 0)
  );
  return created.id;
};

const persistResult = async (params: {
  userId: string;
  tripId: string;
  itineraryId: string;
  details: Array<{ day: number; activity: string; cost: number | null }>;
  generatedItems: ItineraryGeneratedItems;
  currentUserPreferredAirport?: string | null;
}): Promise<{
  detailsCount: number;
  transfersCount: number;
  lodgingsCount: number;
  activitiesCount: number;
  carRentalsCount: number;
}> => {
  const existingDetails = await listItineraryDetails(params.userId, params.itineraryId).catch(() => []);
  const detailKeys = new Set(
    (Array.isArray(existingDetails) ? existingDetails : []).map(
      (d: any) => `${Number(d.day) || 1}|${safeString(d.activity).toLowerCase()}`
    )
  );

  let detailsCount = 0;
  for (const detail of params.details) {
    const key = `${Number(detail.day) || 1}|${safeString(detail.activity).toLowerCase()}`;
    if (!safeString(detail.activity) || detailKeys.has(key)) continue;
    await addItineraryDetail(params.userId, params.itineraryId, {
      day: Number(detail.day) || 1,
      time: null,
      activity: safeString(detail.activity),
      cost: detail.cost ?? null,
    });
    detailKeys.add(key);
    detailsCount += 1;
  }

  const membership = await ensureUserInTrip(params.tripId, params.userId);
  if (!membership) {
    return {
      detailsCount,
      transfersCount: 0,
      lodgingsCount: 0,
      activitiesCount: 0,
      carRentalsCount: 0,
    };
  }

  const members = await listGroupMembers(membership.groupId, params.userId).catch(() => []);
  const defaultPayerId = safeString((members?.[0] as any)?.id);
  const activeMembers = (Array.isArray(members) ? members : []).filter(
    (member: any) => safeString(member?.id) && safeString(member?.status || 'active') !== 'removed'
  );
  const defaultTravelerIds = activeMembers
    .map((m: any) => safeString(m?.id))
    .filter(Boolean);
  const memberNameById = new Map<string, string>();
  activeMembers.forEach((member: any) => {
    const id = safeString(member?.id);
    if (!id) return;
    memberNameById.set(id, buildMemberDisplayName(member));
  });
  const today = nowIso().slice(0, 10);

  const terminalTransfers = await buildTerminalTransfers({
    tripId: params.tripId,
    userId: params.userId,
    generatedItems: params.generatedItems,
    currentUserPreferredAirport: params.currentUserPreferredAirport,
  });
  const generatedTransfers = Array.isArray(params.generatedItems.transfers) ? params.generatedItems.transfers : [];
  const transfers: TransferWithPassengers[] = [...terminalTransfers.first, ...generatedTransfers, ...terminalTransfers.last];
  const dedupedTransfers: TransferWithPassengers[] = [];
  const seenTransferKeys = new Set<string>();
  for (const transfer of transfers) {
    const key = [
      validTransferType(transfer.transferType),
      safeString(transfer.departureDate),
      safeString(transfer.departureTime),
      safeString(transfer.arrivalDate),
      safeString(transfer.arrivalTime),
      safeString(transfer.departureLocation).toUpperCase(),
      safeString(transfer.arrivalLocation).toUpperCase(),
    ].join('|');
    if (seenTransferKeys.has(key)) continue;
    seenTransferKeys.add(key);
    dedupedTransfers.push(transfer);
  }
  const terminalAirports = new Set<string>(
    [...terminalTransfers.first.map((t) => safeString(t.departureLocation)), ...terminalTransfers.last.map((t) => safeString(t.arrivalLocation))]
      .map((value) => value.toUpperCase())
      .filter(Boolean)
  );
  const seenReturnAirportDate = new Set<string>();
  const normalizedTransfers = dedupedTransfers.filter((transfer) => {
    const transferType = validTransferType(transfer.transferType);
    if (transferType !== 'Flight') return true;
    const airport = safeString(transfer.arrivalLocation).toUpperCase();
    if (!airport || !terminalAirports.has(airport)) return true;
    const key = `${safeString(transfer.departureDate)}|${airport}`;
    if (seenReturnAirportDate.has(key)) return false;
    seenReturnAirportDate.add(key);
    return true;
  });

  let transfersCount = 0;
  for (const transfer of normalizedTransfers) {
    const passengerIds = Array.isArray(transfer.passengerIds) && transfer.passengerIds.length
      ? Array.from(new Set(transfer.passengerIds.map((id) => safeString(id)).filter(Boolean)))
      : defaultTravelerIds;
    const passengerName = passengerIds.map((id) => memberNameById.get(id) || 'Traveler').join(', ') || 'Traveler';
    const saved = await insertFlight({
      userId: params.userId,
      status: 'Needed',
      transferType: validTransferType(transfer.transferType),
      passengerName,
      passengerIds,
      departureDate: safeString(transfer.departureDate) || today,
      arrivalDate: safeString(transfer.arrivalDate) || safeString(transfer.departureDate) || today,
      tripId: params.tripId,
      departureLocation: safeString(transfer.departureLocation),
      departureAirportCode: safeString(transfer.departureLocation),
      departureTime: safeString(transfer.departureTime) || '09:00',
      arrivalLocation: safeString(transfer.arrivalLocation),
      arrivalAirportCode: safeString(transfer.arrivalLocation),
      layoverLocation: '',
      layoverLocationCode: '',
      layoverDuration: '',
      arrivalTime: safeString(transfer.arrivalTime) || '11:00',
      cost: 0,
      carrier: safeString(transfer.carrier),
      flightNumber: safeString(transfer.flightNumber),
      bookingReference: safeString(transfer.bookingReference),
      paidBy: defaultPayerId ? [defaultPayerId] : [],
    } as any);
    await upsertExpenseForSource({
      userId: params.userId,
      tripId: params.tripId,
      groupId: membership.groupId,
      expenseDate: safeString(transfer.departureDate) || today,
      category: 'Transfers',
      amount: 0,
      currency: undefined,
      payerIds: defaultPayerId ? [defaultPayerId] : [],
      forIds: passengerIds,
      sourceType: 'flight',
      sourceId: saved.id,
    });
    transfersCount += 1;
  }

  const lodgings = Array.isArray(params.generatedItems.lodgings) ? params.generatedItems.lodgings : [];
  let lodgingsCount = 0;
  for (const lodging of lodgings) {
    const checkInDate = safeString(lodging.checkInDate) || today;
    const totalCost = Number(safeString(lodging.totalCost)) || 0;
    const nights = Math.max(1, Math.round((new Date(addDays(checkInDate, 1)).getTime() - new Date(checkInDate).getTime()) / 86400000));
    const saved = await insertLodging({
      userId: params.userId,
      tripId: params.tripId,
      status: 'Needed',
      name: safeString(lodging.name) || 'Suggested lodging',
      checkInDate,
      checkOutDate: safeString(lodging.checkOutDate) || addDays(checkInDate, 1),
      rooms: Number(safeString(lodging.rooms)) || 1,
      refundBy: null,
      totalCost,
      costPerNight: Number(safeString(lodging.costPerNight)) || totalCost / nights,
      address: safeString(lodging.address),
      place_id: null,
      paid_by: defaultPayerId ? [defaultPayerId] : [],
      traveler_ids: defaultTravelerIds,
      imageUrl: null,
    } as any);
    await upsertExpenseForSource({
      userId: params.userId,
      tripId: params.tripId,
      groupId: membership.groupId,
      expenseDate: checkInDate,
      category: 'Lodging',
      amount: totalCost,
      currency: undefined,
      payerIds: defaultPayerId ? [defaultPayerId] : [],
      forIds: defaultTravelerIds,
      sourceType: 'lodging',
      sourceId: saved.id,
    });
    lodgingsCount += 1;
  }

  const activities = Array.isArray(params.generatedItems.activities) ? params.generatedItems.activities : [];
  let activitiesCount = 0;
  for (const activity of activities) {
    const date = safeString(activity.date) || today;
    const cost = Number(safeString(activity.cost)) || 0;
    const saved = await insertActivity({
      userId: params.userId,
      tripId: params.tripId,
      status: safeString(activity.status) === 'Needed' ? 'Needed' : 'Proposed',
      activityType: validActivityType(activity.activityType),
      date,
      name: safeString(activity.name) || 'Suggested activity',
      startLocation: safeString(activity.startLocation),
      startTime: safeString(activity.startTime) || '13:00',
      duration: safeString(activity.duration) || '2h',
      cost,
      freeCancelBy: null,
      bookedOn: safeString(activity.bookedOn),
      reference: safeString(activity.reference),
      notes: safeString(activity.notes),
      paidBy: defaultPayerId ? [defaultPayerId] : [],
      travelerIds: defaultTravelerIds,
    } as any);
    await upsertExpenseForSource({
      userId: params.userId,
      tripId: params.tripId,
      groupId: membership.groupId,
      expenseDate: date,
      category: 'Activities',
      amount: cost,
      currency: undefined,
      payerIds: defaultPayerId ? [defaultPayerId] : [],
      forIds: defaultTravelerIds,
      sourceType: 'activity',
      sourceId: saved.id,
    });
    activitiesCount += 1;
  }

  const carRentals = Array.isArray(params.generatedItems.carRentals) ? params.generatedItems.carRentals : [];
  let carRentalsCount = 0;
  for (const rental of carRentals) {
    const pickupDate = safeString(rental.pickupDate) || today;
    const cost = Number(safeString(rental.cost)) || 0;
    const saved = await insertCarRental({
      userId: params.userId,
      tripId: params.tripId,
      status: 'Needed',
      pickupLocation: safeString(rental.pickupLocation),
      pickupDate,
      dropoffLocation: safeString(rental.dropoffLocation),
      dropoffDate: safeString(rental.dropoffDate) || addDays(pickupDate, 1),
      reference: safeString(rental.reference),
      vendor: safeString(rental.vendor),
      prepaid: safeString(rental.prepaid),
      cost,
      model: safeString(rental.model),
      notes: safeString(rental.notes),
      paidBy: defaultPayerId ? [defaultPayerId] : [],
      travelerIds: defaultTravelerIds,
    } as any);
    await upsertExpenseForSource({
      userId: params.userId,
      tripId: params.tripId,
      groupId: membership.groupId,
      expenseDate: pickupDate,
      category: 'Car Rentals',
      amount: cost,
      currency: undefined,
      payerIds: defaultPayerId ? [defaultPayerId] : [],
      forIds: defaultTravelerIds,
      sourceType: 'car_rental',
      sourceId: saved.id,
    });
    carRentalsCount += 1;
  }

  return { detailsCount, transfersCount, lodgingsCount, activitiesCount, carRentalsCount };
};

const runJob = async (jobId: string, input: QueueInput): Promise<void> => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  job.updatedAt = nowIso();
  jobs.set(jobId, job);

  const jobStart = Date.now();
  try {
    let fallbackAirport = safeString(input.departureAirport);
    if (!fallbackAirport) {
      const profile = await getWebUserProfile(input.userId).catch(() => null);
      fallbackAirport = safeString((profile as any)?.preferredAirport);
    }

    const result = await generateItineraryViaPromptPlan({
      apiKey: input.apiKey,
      userId: input.userId,
      destinations: input.locations.length ? input.locations : [input.destinationSummary],
      mustSeeAttractions: Array.isArray(input.mustSeeAttractions)
        ? input.mustSeeAttractions.map((item) => safeString(item)).filter(Boolean)
        : [],
      days: input.days,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      departureAirport: fallbackAirport || undefined,
      tripStyle: input.tripStyle ? String(input.tripStyle).trim() : undefined,
      promptTraits: {
        tt: input.tt && typeof input.tt === 'object' ? (input.tt as any) : undefined,
        ut: input.ut && typeof input.ut === 'object' ? (input.ut as any) : undefined,
      },
      groupTraits: input.groupTraits,
      tripStartDate: input.tripStartDate,
      tripEndDate: input.tripEndDate,
      tripStartMonth: input.tripStartMonth,
      tripStartYear: input.tripStartYear,
      tripIdSeed: input.tripId,
      usageWindowKey: input.usageWindowKey,
    });

    const itineraryId = await ensureItineraryId({
      userId: input.userId,
      tripId: input.tripId,
      itineraryId: input.itineraryId,
      destination: input.destinationSummary,
      days: input.days,
      budget: input.budgetMax,
    });
    const persisted = await persistResult({
      userId: input.userId,
      tripId: input.tripId,
      itineraryId,
      details: result.details,
      generatedItems: result.generatedItems,
      currentUserPreferredAirport: fallbackAirport || null,
    });

    job.status = 'completed';
    job.updatedAt = nowIso();
    job.result = { itineraryId, ...persisted };
    jobs.set(jobId, job);
    if (input.idempotencyKey && input.usageWindowKey) {
      await finalizeGenerationUsage({
        userId: input.userId,
        windowKey: input.usageWindowKey,
        idempotencyKey: input.idempotencyKey,
        responseBody: {
          jobId,
          tripId: input.tripId,
          itineraryId,
          status: 'completed',
          result: job.result,
        },
      });
    }
    logInfo(
      `[itinerary][async] completed job=${jobId} trip=${input.tripId} itinerary=${itineraryId} details=${persisted.detailsCount} transfers=${persisted.transfersCount} lodgings=${persisted.lodgingsCount} activities=${persisted.activitiesCount} carRentals=${persisted.carRentalsCount}`
    );
    incrementMetric('itinerary_generation_success', { destination: input.destinationSummary || 'unknown' });
    recordTiming('itinerary_generation_duration_ms', Date.now() - jobStart, { success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    job.updatedAt = nowIso();
    jobs.set(jobId, job);
    if (input.idempotencyKey) {
      await failGenerationUsage(input.idempotencyKey, message);
    }
    logError(`[itinerary][async] failed job=${jobId} trip=${input.tripId}`, err);
    incrementMetric('itinerary_generation_failure', {
      destination: input.destinationSummary || 'unknown',
      reason: message.slice(0, 80),
    });
    recordTiming('itinerary_generation_duration_ms', Date.now() - jobStart, { success: false });
  }
};

export const enqueueAsyncItineraryJob = (input: QueueInput): AsyncItineraryJob => {
  const id = randomUUID();
  const now = nowIso();
  const job: AsyncItineraryJob = {
    id,
    userId: input.userId,
    tripId: input.tripId,
    itineraryId: input.itineraryId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  // Opportunistic prune at the moment of growth — cheap, and avoids needing
  // a separate timer/interval that would also have to be cleaned up.
  pruneStaleJobs();
  logInfo(`[itinerary][async] queued job=${id} trip=${input.tripId}`);
  const runPromise = new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      runJob(id, input).then(resolve, reject);
    }, 0);
  });
  jobRuns.set(id, runPromise);
  runPromise.finally(() => {
    if (jobRuns.get(id) === runPromise) {
      jobRuns.delete(id);
    }
  }).catch(() => undefined);
  return job;
};

export const getAsyncItineraryJob = (jobId: string): AsyncItineraryJob | null => jobs.get(jobId) ?? null;

const waitForJobForTest = async (jobId: string, timeoutMs = 10000): Promise<AsyncItineraryJob | null> => {
  const runPromise = jobRuns.get(jobId);
  if (runPromise) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        runPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Timed out waiting for itinerary job ${jobId}`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  return getAsyncItineraryJob(jobId);
};

// Test-only helper. Lets the regression test exercise the prune logic
// without having to enqueue thousands of real jobs.
export const __testing = {
  jobs,
  jobRuns,
  waitForJob: waitForJobForTest,
  pruneStaleJobs,
  JOB_RETENTION_LIMIT,
  JOB_RETENTION_TTL_MS,
};
