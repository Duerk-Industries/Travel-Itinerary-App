export type CarRental = {
  id: string;
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
};

export type CarRentalDraft = {
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
};

export const createInitialCarRentalDraft = (): CarRentalDraft => ({
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
});

export const buildCarRentalFromDraft = (
  draft: CarRentalDraft,
  defaultPayerId?: string | null
): { rental?: CarRental; error?: string } => {
  if (!draft.vendor.trim() && !draft.model.trim() && !draft.pickupLocation.trim()) {
    return { error: 'Enter at least a pickup location, vendor, or car model.' };
  }
  const paidBy = draft.paidBy.length ? draft.paidBy : defaultPayerId ? [defaultPayerId] : [];
  const rental: CarRental = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    pickupLocation: draft.pickupLocation.trim(),
    pickupDate: draft.pickupDate.trim(),
    dropoffLocation: draft.dropoffLocation.trim(),
    dropoffDate: draft.dropoffDate.trim(),
    reference: draft.reference.trim(),
    vendor: draft.vendor.trim(),
    prepaid: draft.prepaid.trim(),
    cost: draft.cost.trim(),
    model: draft.model.trim(),
    notes: draft.notes.trim(),
    paidBy,
  };
  return { rental };
};
