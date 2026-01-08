import { formatDateLong } from '../utils/formatDateLong';

export type Lodging = {
  id: string;
  tripId?: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  paidBy?: string[];
};

export type LodgingDraft = {
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  paidBy: string[];
};

// Build a blank lodging draft with today's dates and default room count.
export const createInitialLodgingState = (): LodgingDraft => ({
  name: '',
  checkInDate: new Date().toISOString().slice(0, 10),
  checkOutDate: new Date().toISOString().slice(0, 10),
  rooms: '1',
  refundBy: '',
  totalCost: '',
  costPerNight: '',
  address: '',
  paidBy: [],
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
  ...l,
  rooms: String(l.rooms ?? ''),
  totalCost: String(l.totalCost ?? ''),
  costPerNight: String(l.costPerNight ?? ''),
  refundBy: l.refundBy ?? '',
  paidBy: Array.isArray(l.paidBy) ? l.paidBy : [],
});

// Build a payload for creating/updating lodging; validates dates and cost.
export const buildLodgingPayload = (
  draft: LodgingDraft,
  activeTripId: string,
  defaultPayerId?: string | null
): { payload?: any; error?: string } => {
  if (!draft.name.trim()) return { error: 'Please enter a lodging name and select an active trip.' };

  const nights = calculateNights(draft.checkInDate, draft.checkOutDate);
  if (nights <= 0) return { error: 'Check-out must be after check-in.' };

  const totalNum = Number(draft.totalCost) || 0;
  const rooms = Number(draft.rooms) || 1;
  const costPerNight = totalNum && rooms > 0 ? (totalNum / (nights * rooms)).toFixed(2) : '0';
  const paidBy = draft.paidBy.length ? draft.paidBy : defaultPayerId ? [defaultPayerId] : [];

  return {
    payload: {
      ...draft,
      tripId: activeTripId,
      rooms,
      costPerNight,
      paidBy,
    },
  };
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
    name: lodging.name,
    checkInDate: normalize(lodging.checkInDate),
    checkOutDate: normalize(lodging.checkOutDate),
    rooms: lodging.rooms || '1',
    refundBy: lodging.refundBy ? normalize(lodging.refundBy) : '',
    totalCost: lodging.totalCost || '',
    costPerNight: lodging.costPerNight || '',
    address: lodging.address || '',
    paidBy: Array.isArray(lodging.paidBy) && lodging.paidBy.length ? lodging.paidBy : opts?.defaultPayerId ? [opts.defaultPayerId] : [],
  };
};

// Helper to keep the detailed card consistent with normalized dates if needed elsewhere.
export const formatLodgingDates = (lodging: Lodging) => ({
  checkInLabel: formatDateLong(normalizeDate(lodging.checkInDate)),
  checkOutLabel: formatDateLong(normalizeDate(lodging.checkOutDate)),
});

const normalizeDate = (date: string) => {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date(date).toISOString().slice(0, 10);
};
