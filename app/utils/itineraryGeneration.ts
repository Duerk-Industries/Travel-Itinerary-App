import { parsePlanToDetails, type ParsedItineraryDetail } from './itineraryParser';

type TransferMode = 'Flight' | 'Train' | 'Bus' | 'Private' | 'Ferry' | 'Other';
type ActivityType =
  | 'Class'
  | 'Concert/Show'
  | 'Day Trip'
  | 'Event'
  | 'Food & Drink'
  | 'Fun & Games'
  | 'Hike'
  | 'Nightlife'
  | 'Open Access'
  | 'Outdoor Activity'
  | 'Reservation'
  | 'Shopping'
  | 'Sights & Landmarks'
  | 'Spa/Wellness'
  | 'Ticketed Attraction'
  | 'Tour';

type GeneratedTransfer = {
  status?: 'Needed';
  transferType?: TransferMode;
  departureDate?: string;
  arrivalDate?: string;
  departureLocation?: string;
  arrivalLocation?: string;
  departureTime?: string;
  arrivalTime?: string;
  carrier?: string;
  flightNumber?: string;
  bookingReference?: string;
  passengerIds?: string[];
};

type GeneratedLodging = {
  status?: 'Needed';
  name?: string;
  checkInDate?: string;
  checkOutDate?: string;
  rooms?: string;
  totalCost?: string;
  costPerNight?: string;
  address?: string;
};

type GeneratedActivity = {
  status?: 'Needed' | 'Proposed';
  activityType?: ActivityType;
  date?: string;
  name?: string;
  startLocation?: string;
  startTime?: string;
  duration?: string;
  cost?: string;
  freeCancelBy?: string;
  bookedOn?: string;
  reference?: string;
  notes?: string;
};

type GeneratedCarRental = {
  status?: 'Needed';
  pickupLocation?: string;
  pickupDate?: string;
  dropoffLocation?: string;
  dropoffDate?: string;
  reference?: string;
  vendor?: string;
  prepaid?: string;
  cost?: string;
  model?: string;
  notes?: string;
};

type GeneratedItems = {
  transfers?: GeneratedTransfer[];
  lodgings?: GeneratedLodging[];
  activities?: GeneratedActivity[];
  carRentals?: GeneratedCarRental[];
};

export type ItineraryGenerationResponse = {
  plan?: string;
  details?: ParsedItineraryDetail[];
  generatedItems?: GeneratedItems;
};

export type GeneratedItemsSaveResult = {
  ok: boolean;
  failures: string[];
};

const isoToday = (): string => new Date().toISOString().slice(0, 10);

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const safeString = (value: unknown): string => String(value ?? '').trim();

const validTransferType = (value: unknown): TransferMode => {
  const input = safeString(value);
  return (['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'] as const).includes(input as TransferMode)
    ? (input as TransferMode)
    : 'Flight';
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

export const getGeneratedItineraryDetails = (response: ItineraryGenerationResponse): ParsedItineraryDetail[] => {
  if (Array.isArray(response.details)) {
    const structured = response.details
      .map((d) => ({
        day: Number(d?.day) || 1,
        activity: safeString(d?.activity),
        cost: typeof d?.cost === 'number' && Number.isFinite(d.cost) ? d.cost : null,
      }))
      .filter((d) => d.activity.length > 0);
    if (structured.length) return structured;
  }
  return parsePlanToDetails(String(response.plan ?? ''));
};

type TripMemberWithAirport = {
  id?: string;
  status?: string;
  preferredAirport?: string | null;
  isGroupOwner?: boolean;
};

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

const dateWithTimeKey = (date: string, time?: string): string => {
  const safeDate = isIsoDate(date) ? date : '9999-12-31';
  const safeTime = /^\d{2}:\d{2}$/.test(time ?? '') ? String(time) : '23:59';
  return `${safeDate}T${safeTime}`;
};

const normalizeAirportCode = (value: unknown): string => {
  const input = safeString(value);
  if (!input) return '';
  const parenMatch = input.match(/\(([A-Za-z0-9]{3,4})\)/);
  if (parenMatch?.[1]) return parenMatch[1].toUpperCase();
  const exact = input.match(/^[A-Za-z0-9]{3,4}$/);
  if (exact) return input.toUpperCase();
  const token = input.match(/\b([A-Za-z0-9]{3,4})\b/);
  return token?.[1]?.toUpperCase() ?? '';
};

const pickEarliestIso = (values: string[]): string | null => {
  const valid = values.filter(isIsoDate).sort((a, b) => a.localeCompare(b));
  return valid[0] ?? null;
};

const pickLatestIso = (values: string[]): string | null => {
  const valid = values.filter(isIsoDate).sort((a, b) => b.localeCompare(a));
  return valid[0] ?? null;
};

const deriveTerminalTransferContext = (generatedItems?: GeneratedItems): {
  firstDestination: string;
  lastDestination: string;
  firstDate: string;
  lastDate: string;
} => {
  const lodgings = Array.isArray(generatedItems?.lodgings) ? generatedItems!.lodgings! : [];
  const activities = Array.isArray(generatedItems?.activities) ? generatedItems!.activities! : [];
  const transfers = Array.isArray(generatedItems?.transfers) ? generatedItems!.transfers! : [];

  const sortedLodgings = [...lodgings].sort((a, b) => {
    const aDate = safeString(a.checkInDate) || '9999-12-31';
    const bDate = safeString(b.checkInDate) || '9999-12-31';
    return aDate.localeCompare(bDate);
  });
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

  const firstDate =
    pickEarliestIso([
      safeString(firstLodging?.checkInDate),
      safeString(firstActivity?.date),
      safeString(firstTransfer?.departureDate),
    ]) ?? isoToday();
  const lastDate =
    pickLatestIso([
      safeString(lastLodging?.checkOutDate),
      safeString(lastActivity?.date),
      safeString(lastTransfer?.arrivalDate),
      safeString(lastTransfer?.departureDate),
    ]) ?? firstDate;

  return { firstDestination, lastDestination, firstDate, lastDate };
};

const loadTripMembers = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
}): Promise<TripMemberWithAirport[]> => {
  const res = await fetch(`${params.backendUrl}/api/account/trips/${params.tripId}/members`, {
    headers: params.headers,
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? (data as TripMemberWithAirport[]) : [];
};

const loadCurrentUserPreferredAirport = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
}): Promise<string> => {
  const res = await fetch(`${params.backendUrl}/api/account`, { headers: params.headers });
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  return normalizeAirportCode((data as any)?.preferredAirport);
};

const buildPreferredAirportTransferPlan = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  generatedItems?: GeneratedItems;
}): Promise<{ firstTransfers: GeneratedTransfer[]; lastTransfers: GeneratedTransfer[] }> => {
  const authorization = params.headers.Authorization ?? params.headers.authorization;
  if (!safeString(authorization)) return { firstTransfers: [], lastTransfers: [] };

  const { firstDestination, lastDestination, firstDate, lastDate } = deriveTerminalTransferContext(params.generatedItems);
  if (!firstDestination || !lastDestination) return { firstTransfers: [], lastTransfers: [] };

  let members: TripMemberWithAirport[] = [];
  try {
    members = await loadTripMembers(params);
  } catch {
    return { firstTransfers: [], lastTransfers: [] };
  }

  const activeMembers = members.filter((m) => safeString(m.id) && safeString(m.status || 'active') !== 'removed');
  if (!activeMembers.length) return { firstTransfers: [], lastTransfers: [] };

  let creatorAirport = normalizeAirportCode(
    activeMembers.find((m) => m.isGroupOwner)?.preferredAirport
  );
  if (!creatorAirport) {
    try {
      creatorAirport = await loadCurrentUserPreferredAirport({
        backendUrl: params.backendUrl,
        headers: params.headers,
      });
    } catch {
      creatorAirport = '';
    }
  }

  const groups = new Map<string, string[]>();
  for (const member of activeMembers) {
    const memberId = safeString(member.id);
    if (!memberId) continue;
    const effectiveAirport = normalizeAirportCode(member.preferredAirport) || creatorAirport;
    if (!effectiveAirport) continue;
    const bucket = groups.get(effectiveAirport) ?? [];
    if (!bucket.includes(memberId)) bucket.push(memberId);
    groups.set(effectiveAirport, bucket);
  }

  if (!groups.size) return { firstTransfers: [], lastTransfers: [] };

  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  const firstTransfers: GeneratedTransfer[] = sortedGroups.map(([airport, passengerIds]) => ({
    status: 'Needed',
    transferType: 'Flight',
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
  const lastTransfers: GeneratedTransfer[] = sortedGroups.map(([airport, passengerIds]) => ({
    status: 'Needed',
    transferType: 'Flight',
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

  return { firstTransfers, lastTransfers };
};

const postJson = async (url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; error?: string }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: String(data?.error ?? `Request failed (${res.status})`) };
  return { ok: true };
};

export const addGeneratedItemsToTrip = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  generatedItems?: GeneratedItems;
}): Promise<GeneratedItemsSaveResult> => {
  const { backendUrl, headers, tripId, generatedItems } = params;
  if (!tripId || !generatedItems) return { ok: true, failures: [] };

  const failures: string[] = [];
  const today = isoToday();

  const terminalTransferPlan = await buildPreferredAirportTransferPlan({
    backendUrl,
    headers,
    tripId,
    generatedItems,
  });
  const generatedTransfers = Array.isArray(generatedItems.transfers) ? generatedItems.transfers : [];
  const transfers = [...terminalTransferPlan.firstTransfers, ...generatedTransfers, ...terminalTransferPlan.lastTransfers];
  for (let i = 0; i < transfers.length; i += 1) {
    const transfer = transfers[i];
    const departureDate = safeString(transfer.departureDate) || today;
    const passengerIds = Array.isArray(transfer.passengerIds)
      ? Array.from(new Set(transfer.passengerIds.map((id) => safeString(id)).filter(Boolean)))
      : [];
    const payload = {
      status: 'Needed',
      transferType: validTransferType(transfer.transferType),
      passengerName: 'Traveler',
      passengerIds,
      departureDate,
      arrivalDate: safeString(transfer.arrivalDate) || departureDate,
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
      tripId,
      paidBy: [] as string[],
    };
    const result = await postJson(`${backendUrl}/api/transfers`, headers, payload);
    if (!result.ok) failures.push(`transfer ${i + 1}: ${result.error || 'Unable to save transfer'}`);
  }

  const lodgings = Array.isArray(generatedItems.lodgings) ? generatedItems.lodgings : [];
  for (let i = 0; i < lodgings.length; i += 1) {
    const lodging = lodgings[i];
    const checkInDate = safeString(lodging.checkInDate) || today;
    const payload = {
      status: 'Needed',
      tripId,
      name: safeString(lodging.name) || 'Suggested lodging',
      checkInDate,
      checkOutDate: safeString(lodging.checkOutDate) || addDays(checkInDate, 1),
      rooms: safeString(lodging.rooms) || '1',
      refundBy: '',
      totalCost: safeString(lodging.totalCost),
      costPerNight: safeString(lodging.costPerNight),
      address: safeString(lodging.address),
      paidBy: [] as string[],
      travelerIds: [] as string[],
    };
    const result = await postJson(`${backendUrl}/api/lodgings`, headers, payload);
    if (!result.ok) failures.push(`lodging ${i + 1}: ${result.error || 'Unable to save lodging'}`);
  }

  const activities = Array.isArray(generatedItems.activities) ? generatedItems.activities : [];
  for (let i = 0; i < activities.length; i += 1) {
    const activity = activities[i];
    const payload = {
      status: safeString(activity.status) === 'Needed' ? 'Needed' : 'Proposed',
      tripId,
      activityType: validActivityType(activity.activityType),
      date: safeString(activity.date) || today,
      name: safeString(activity.name) || 'Suggested activity',
      startLocation: safeString(activity.startLocation),
      startTime: safeString(activity.startTime) || '13:00',
      duration: safeString(activity.duration) || '2h',
      cost: safeString(activity.cost),
      freeCancelBy: safeString(activity.freeCancelBy) || null,
      bookedOn: safeString(activity.bookedOn),
      reference: safeString(activity.reference),
      notes: safeString(activity.notes),
      paidBy: [] as string[],
      travelerIds: [] as string[],
    };
    const result = await postJson(`${backendUrl}/api/activities`, headers, payload);
    if (!result.ok) failures.push(`activity ${i + 1}: ${result.error || 'Unable to save activity'}`);
  }

  const carRentals = Array.isArray(generatedItems.carRentals) ? generatedItems.carRentals : [];
  for (let i = 0; i < carRentals.length; i += 1) {
    const rental = carRentals[i];
    const pickupDate = safeString(rental.pickupDate) || today;
    const payload = {
      status: 'Needed',
      tripId,
      pickupLocation: safeString(rental.pickupLocation),
      pickupDate,
      dropoffLocation: safeString(rental.dropoffLocation),
      dropoffDate: safeString(rental.dropoffDate) || addDays(pickupDate, 1),
      reference: safeString(rental.reference),
      vendor: safeString(rental.vendor),
      prepaid: safeString(rental.prepaid),
      cost: safeString(rental.cost),
      model: safeString(rental.model),
      notes: safeString(rental.notes),
      paidBy: [] as string[],
      travelerIds: [] as string[],
    };
    const result = await postJson(`${backendUrl}/api/car-rentals`, headers, payload);
    if (!result.ok) failures.push(`car rental ${i + 1}: ${result.error || 'Unable to save car rental'}`);
  }

  return { ok: failures.length === 0, failures };
};
