import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  LEGACY_ITINERARY_STATUS,
  type ItineraryStatus,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
} from '../utils/itineraryStatus';

export type Lodging = {
  id: string;
  userId: string;
  tripId: string;
  status: ItineraryStatus;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  notes?: string | null;
  features?: string[];
  placeId?: string;
  paidBy: string[];
  travelerIds: string[];
  imageUrl?: string;
};

export type LodgingDraft = {
  status: ItineraryStatus;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  notes?: string | null;
  features?: string[];
  placeId?: string;
  paidBy: string[];
  travelerIds: string[];
  imageUrl?: string;
};

// Build a blank lodging draft with today's dates and default room count.
export const createInitialLodgingState = (overrides: Partial<LodgingDraft> = {}): LodgingDraft => ({
  status: DEFAULT_NEW_ITINERARY_STATUS,
  name: '',
  checkInDate: normalizeDate(new Date().toISOString()),
  checkOutDate: normalizeDate(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  rooms: '1',
  refundBy: '',
  totalCost: '',
  costPerNight: '',
  address: '',
  notes: '',
  features: [],
  placeId: '',
  paidBy: [],
  travelerIds: [],
  imageUrl: '',
  ...overrides,
});

// Calculate whole-night stay length; returns 0 if invalid or checkout <= checkin.
export const calculateNights = (checkIn: string, checkOut: string): number => {
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
};

// Normalize a lodging row from the API.
export const normalizeLodgingFromApi = (l: any): Lodging => ({
  id: l.id,
  userId: l.user_id,
  tripId: l.trip_id,
  status: normalizeItineraryStatus(l.status, LEGACY_ITINERARY_STATUS),
  netVotes: Number(l.netVotes ?? 0) || 0,
  userVote: l.userVote === 1 || l.userVote === -1 ? l.userVote : null,
  netRating: Number(l.netRating ?? 0) || 0,
  userRating: l.userRating === 1 || l.userRating === -1 ? l.userRating : null,
  name: l.name,
  checkInDate: normalizeDate(l.check_in_date),
  checkOutDate: normalizeDate(l.check_out_date),
  rooms: String(l.rooms ?? '1'),
  refundBy: normalizeDate(l.refund_by),
  totalCost: String(l.total_cost ?? ''),
  costPerNight: String(l.cost_per_night ?? ''),
  address: l.address ?? '',
  notes: l.notes ?? null,
  features: Array.isArray(l.features) ? l.features : [],
  placeId: l.place_id ?? l.placeId ?? '',
  paidBy: Array.isArray(l.paid_by) ? l.paid_by : [],
  travelerIds: Array.isArray(l.traveler_ids)
    ? l.traveler_ids
    : Array.isArray(l.travelerIds)
      ? l.travelerIds
      : Array.isArray(l.paid_by)
        ? l.paid_by
        : Array.isArray(l.paidBy)
          ? l.paidBy
          : [],
  imageUrl: l.imageUrl,
});

// Build a payload for creating/updating lodging; validates dates and cost.
export const buildLodgingPayload = (
  draft: LodgingDraft,
  activeTripId: string,
  defaultPayerId?: string | null
): { payload?: any; error?: string } => {
  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);
  if (!shouldRelaxRequiredFields(status) && !draft.name.trim()) return { error: 'Please enter a lodging name and select an active trip.' };

  const nights = calculateNights(draft.checkInDate, draft.checkOutDate);
  if (!shouldRelaxRequiredFields(status) && nights <= 0) return { error: 'Check-out must be after check-in.' };

  const cleanTotal = sanitizeCostInput(draft.totalCost);
  const totalNum = Number(cleanTotal) || 0;
  const rooms = Number(draft.rooms) || 1;
  const costPerNight = totalNum && rooms > 0 && nights > 0 ? (totalNum / (nights * rooms)).toFixed(2) : '0';
  const paidBy = draft.paidBy.length ? draft.paidBy : defaultPayerId ? [defaultPayerId] : [];
  const travelerIds = draft.travelerIds.length ? draft.travelerIds : paidBy;

  return {
    payload: {
      ...draft,
      status,
      totalCost: cleanTotal,
      tripId: activeTripId,
      rooms,
      costPerNight,
      placeId: draft.placeId ?? '',
      paidBy,
      travelerIds,
    },
  };
};

export const getDefaultLodgingDates = (
  tripStartDate?: string | null,
  existingLodgings: Array<{ checkOutDate?: string | null }> = []
): { checkInDate: string; checkOutDate: string } => {
  const normalizedTripStart = normalizeDate(tripStartDate ?? '');
  const validCheckoutDates = existingLodgings
    .map((l) => normalizeDate(l.checkOutDate ?? ''))
    .filter(Boolean)
    .sort();
  const latestCheckout = validCheckoutDates.length ? validCheckoutDates[validCheckoutDates.length - 1] : '';
  const checkInDate = latestCheckout || normalizedTripStart || normalizeDate(new Date().toISOString());
  const checkOutDate = addDays(checkInDate, 1);
  return { checkInDate, checkOutDate };
};

export const createLodgingDraftForTrip = (params: {
  tripStartDate?: string | null;
  existingLodgings?: Array<{ checkOutDate?: string | null }>;
  defaultPayerId?: string | null;
  defaultTravelerIds?: string[];
}): LodgingDraft => {
  const { tripStartDate, existingLodgings = [], defaultPayerId, defaultTravelerIds = [] } = params;
  const { checkInDate, checkOutDate } = getDefaultLodgingDates(tripStartDate, existingLodgings);
  const paidBy = defaultPayerId ? [defaultPayerId] : [];
  const travelerIds = defaultTravelerIds.length ? defaultTravelerIds : paidBy;
  return createInitialLodgingState({
    checkInDate,
    checkOutDate,
    paidBy,
    travelerIds,
  });
};

export const fetchLodgingsApi = async (backendUrl: string, activeTripId: string, token: string): Promise<Lodging[]> => {
  const res = await fetch(`${backendUrl}/api/lodgings?tripId=${activeTripId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any[]).map(normalizeLodgingFromApi);
};

export const saveLodgingApi = async (
  backendUrl: string,
  jsonHeaders: Record<string, string>,
  payload: any,
  lodgingId?: string | null
): Promise<{ ok: boolean; error?: string }> => {
  const url = lodgingId ? `${backendUrl}/api/lodgings/${lodgingId}` : `${backendUrl}/api/lodgings`;
  const method = lodgingId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) return { ok: false, error: data?.error };
  return { ok: true };
};

export const createLodgingForTrip = async (params: {
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  draft: LodgingDraft;
  activeTripId: string | null;
  defaultPayerId?: string | null;
}): Promise<{ ok: boolean; error?: string }> => {
  const { backendUrl, jsonHeaders, draft, activeTripId, defaultPayerId } = params;
  if (!activeTripId) return { ok: false, error: 'Select an active trip before adding lodging.' };
  const { payload, error } = buildLodgingPayload(draft, activeTripId, defaultPayerId);
  if (error || !payload) return { ok: false, error };
  return saveLodgingApi(backendUrl, jsonHeaders, payload);
};

export const removeLodgingApi = async (
  backendUrl: string,
  jsonHeaders: Record<string, string>,
  id: string
): Promise<{ ok: boolean; error?: string }> => {
  const res = await fetch(`${backendUrl}/api/lodgings/${id}`, { method: 'DELETE', headers: jsonHeaders });
  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    return { ok: false, error: data?.error };
  }
  return { ok: true };
};

export const toLodgingDraft = (
  lodging: Lodging,
  opts?: { normalize?: (date: string) => string; defaultPayerId?: string | null }
): LodgingDraft => {
  const normalize = opts?.normalize ?? ((v: string) => v);
  return {
    status: normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS),
    name: lodging.name,
    checkInDate: normalize(lodging.checkInDate),
    checkOutDate: normalize(lodging.checkOutDate),
    rooms: lodging.rooms || '1',
    refundBy: lodging.refundBy ? normalize(lodging.refundBy) : '',
    totalCost: lodging.totalCost || '',
    costPerNight: lodging.costPerNight || '',
    address: lodging.address || '',
    notes: lodging.notes ?? '',
    features: Array.isArray(lodging.features) ? lodging.features : [],
    placeId: lodging.placeId || '',
    paidBy: Array.isArray(lodging.paidBy) && lodging.paidBy.length ? lodging.paidBy : opts?.defaultPayerId ? [opts.defaultPayerId] : [],
    travelerIds: Array.isArray(lodging.travelerIds) && lodging.travelerIds.length
      ? lodging.travelerIds
      : Array.isArray(lodging.paidBy) && lodging.paidBy.length
        ? lodging.paidBy
        : opts?.defaultPayerId
          ? [opts.defaultPayerId]
          : [],
  };
};

export type PlaceDetailsPayload = {
  placeId: string;
  name: string;
  details: Record<string, any>;
  cached: boolean;
};

export const fetchPlaceDetailsApi = async (
  backendUrl: string,
  headers: Record<string, string>,
  placeId: string
): Promise<PlaceDetailsPayload | null> => {
  if (!placeId) return null;
  const res = await fetch(`${backendUrl}/api/places/${encodeURIComponent(placeId)}`, { headers });
  if (!res.ok) return null;
  return res.json();
};

// Helper to keep the detailed card consistent with normalized dates if needed elsewhere.
export const formatLodgingDates = (lodging: Lodging) => ({
  checkInLabel: formatDateLong(normalizeDate(lodging.checkInDate)),
  checkOutLabel: formatDateLong(normalizeDate(lodging.checkOutDate)),
});

function normalizeDate(date: string): string {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const base = new Date(isoDate);
  if (Number.isNaN(base.getTime())) return normalizeDate(new Date().toISOString());
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}
