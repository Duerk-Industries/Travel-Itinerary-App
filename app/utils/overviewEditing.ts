import { type CarRental, type CarRentalDraft } from '../tabs/carRentals';
import { type Flight, type FlightCreateDraft } from '../tabs/transfers';
import { type Tour, type TourDraft } from '../tabs/tours';
import { DEFAULT_NEW_ITINERARY_STATUS, LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from './itineraryStatus';

type TripSnapshot = {
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
};

type DateDraft = {
  mode: 'range' | 'month';
  startDate: string;
  endDate: string;
  startMonth: string;
  startYear: string;
  durationDays: string;
};

export const getOverviewSaveFlags = (
  trip: TripSnapshot | null,
  descriptionDraft: string,
  dateDraft: DateDraft,
  pendingRemovalIds: string[]
) => {
  const originalDescription = trip?.description ?? '';
  const hasDescriptionEdit = descriptionDraft !== originalDescription;
  const hasDateEdit =
    (dateDraft.mode === 'range' &&
      (dateDraft.startDate !== (trip?.startDate ?? '') || dateDraft.endDate !== (trip?.endDate ?? ''))) ||
    (dateDraft.mode === 'month' &&
      (dateDraft.startMonth !== (trip?.startMonth ? String(trip?.startMonth) : '') ||
        dateDraft.startYear !== (trip?.startYear ? String(trip?.startYear) : '') ||
        dateDraft.durationDays !== (trip?.durationDays ? String(trip?.durationDays) : '')));
  const hasTripEdits = hasDescriptionEdit || hasDateEdit;
  const hasGroupEdits = pendingRemovalIds.length > 0;
  return {
    hasTripEdits,
    hasGroupEdits,
    shouldSkipTripSave: !hasTripEdits && !hasGroupEdits,
  };
};

export const buildFlightDraftFromRow = (flight: Flight): FlightCreateDraft & { passengerIds: string[]; paidBy?: string[] } => ({
  status: normalizeItineraryStatus((flight as any).status, LEGACY_ITINERARY_STATUS),
  transferType:
    (flight as any).transferType ??
    (flight as any).transfer_type ??
    'Flight',
  passengerName: flight.passenger_name,
  arrivalDate: (flight as any).arrival_date || (flight as any).arrivalDate || flight.departure_date,
  passengerIds: Array.isArray(flight.passenger_ids) ? flight.passenger_ids : Array.isArray((flight as any).passengerIds) ? (flight as any).passengerIds : [],
  departureDate: flight.departure_date,
  departureAirportCode: flight.departure_airport_code ?? '',
  departureTime: flight.departure_time,
  arrivalAirportCode: flight.arrival_airport_code ?? '',
  arrivalTime: flight.arrival_time,
  layoverLocation: flight.layover_location ?? '',
  layoverLocationCode: flight.layover_location_code ?? '',
  layoverDuration: flight.layover_duration ?? '',
  cost: flight.cost ? String(flight.cost) : '',
  carrier: flight.carrier,
  flightNumber: flight.flight_number,
  bookingReference: flight.booking_reference,
  paidBy: Array.isArray(flight.paidBy) ? flight.paidBy : Array.isArray(flight.paid_by) ? flight.paid_by : [],
});

export const buildTourDraftFromRow = (tour: Tour): TourDraft => ({
  status: normalizeItineraryStatus((tour as any).status, LEGACY_ITINERARY_STATUS),
  date: tour.date,
  name: tour.name,
  startLocation: tour.startLocation,
  startTime: tour.startTime,
  duration: tour.duration,
  cost: tour.cost,
  freeCancelBy: tour.freeCancelBy,
  bookedOn: tour.bookedOn,
  reference: tour.reference,
  paidBy: tour.paidBy ?? [],
  travelerIds: (tour as any).travelerIds ?? [],
});

export const buildRentalDraftFromRow = (rental: CarRental): CarRentalDraft => ({
  status: normalizeItineraryStatus((rental as any).status, DEFAULT_NEW_ITINERARY_STATUS),
  pickupLocation: rental.pickupLocation,
  pickupDate: rental.pickupDate,
  dropoffLocation: rental.dropoffLocation,
  dropoffDate: rental.dropoffDate,
  reference: rental.reference,
  vendor: rental.vendor,
  prepaid: rental.prepaid,
  cost: rental.cost,
  model: rental.model,
  notes: rental.notes,
  paidBy: rental.paidBy ?? [],
  travelerIds: rental.travelerIds ?? [],
});

