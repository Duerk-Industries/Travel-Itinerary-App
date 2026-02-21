import { sanitizeCostInput } from '../utils/sanitizeCost';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  type ItineraryStatus,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
} from '../utils/itineraryStatus';

export type CarRental = {
  id: string;
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
