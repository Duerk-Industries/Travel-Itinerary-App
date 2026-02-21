import { sanitizeCostInput } from '../utils/sanitizeCost';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  type ItineraryStatus,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
} from '../utils/itineraryStatus';

export type CarRental = {
  id: string;
  tripId?: string;
  status: ItineraryStatus;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  pickupLocation: string;
  pickupDate: string;
  dropoffLocation: string;
  dropoffDate: string;
  reference: string;
  vendor: string;
  prepaid: string;
  cost: string;
  model: string;
  notes: string;
  paidBy: string[];
  travelerIds: string[];
};

export type CarRentalDraft = {
  status: ItineraryStatus;
  pickupLocation: string;
  pickupDate: string;
  dropoffLocation: string;
  dropoffDate: string;
  reference: string;
  vendor: string;
  prepaid: string;
  cost: string;
  model: string;
  notes: string;
  paidBy: string[];
  travelerIds: string[];
};

export const createInitialCarRentalDraft = (): CarRentalDraft => ({
  status: DEFAULT_NEW_ITINERARY_STATUS,
  pickupLocation: '',
  pickupDate: '',
  dropoffLocation: '',
  dropoffDate: '',
  reference: '',
  vendor: '',
  prepaid: '',
  cost: '',
  model: '',
  notes: '',
  paidBy: [],
  travelerIds: [],
});

export const buildCarRentalFromDraft = (
  draft: CarRentalDraft,
  defaultPayerId?: string | null,
  defaultTravelerIds: string[] = []
): { rental?: CarRental; error?: string } => {
  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);
  if (!shouldRelaxRequiredFields(status) && !draft.vendor.trim() && !draft.model.trim() && !draft.pickupLocation.trim()) {
    return { error: 'Enter at least a pickup location, vendor, or car model.' };
  }
  const cleanCost = sanitizeCostInput(draft.cost || '');
  const paidBy = draft.paidBy.length ? draft.paidBy : defaultPayerId ? [defaultPayerId] : [];
  const travelerIds = draft.travelerIds.length ? draft.travelerIds : paidBy.length ? paidBy : defaultTravelerIds;
  const rental: CarRental = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status,
    pickupLocation: draft.pickupLocation.trim(),
    pickupDate: draft.pickupDate.trim(),
    dropoffLocation: draft.dropoffLocation.trim(),
    dropoffDate: draft.dropoffDate.trim(),
    reference: draft.reference.trim(),
    vendor: draft.vendor.trim(),
    prepaid: draft.prepaid.trim(),
    cost: cleanCost,
    model: draft.model.trim(),
    notes: draft.notes.trim(),
    paidBy,
    travelerIds,
  };
  return { rental };
};

export const normalizeCarRentalFromApi = (r: any): CarRental => ({
  id: String(r.id ?? ''),
  tripId: r.tripId ?? r.trip_id ?? undefined,
  status: normalizeItineraryStatus(r.status, DEFAULT_NEW_ITINERARY_STATUS),
  netVotes: Number(r.netVotes ?? 0) || 0,
  userVote: r.userVote === 1 || r.userVote === -1 ? r.userVote : null,
  pickupLocation: String(r.pickupLocation ?? r.pickup_location ?? ''),
  pickupDate: String(r.pickupDate ?? r.pickup_date ?? ''),
  dropoffLocation: String(r.dropoffLocation ?? r.dropoff_location ?? ''),
  dropoffDate: String(r.dropoffDate ?? r.dropoff_date ?? ''),
  reference: String(r.reference ?? ''),
  vendor: String(r.vendor ?? ''),
  prepaid: String(r.prepaid ?? ''),
  cost: sanitizeCostInput(String(r.cost ?? '')),
  model: String(r.model ?? ''),
  notes: String(r.notes ?? ''),
  paidBy: Array.isArray(r.paidBy) ? r.paidBy : Array.isArray(r.paid_by) ? r.paid_by : [],
  travelerIds: Array.isArray(r.travelerIds) ? r.travelerIds : Array.isArray(r.traveler_ids) ? r.traveler_ids : [],
});

export const fetchCarRentalsForTrip = async (params: {
  backendUrl: string;
  activeTripId: string | null;
  token?: string | null;
}): Promise<CarRental[]> => {
  const { backendUrl, activeTripId, token } = params;
  if (!activeTripId || !token) return [];
  const res = await fetch(`${backendUrl}/api/car-rentals?tripId=${activeTripId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.map((item) => normalizeCarRentalFromApi(item)) : [];
};
