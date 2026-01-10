import { type CarRental, type CarRentalDraft } from '../tabs/carRentals';
import { type Flight, type FlightCreateDraft } from '../tabs/flights';
import { type Tour, type TourDraft } from '../tabs/tours';

export const buildFlightDraftFromRow = (flight: Flight): FlightCreateDraft & { passengerIds: string[]; paidBy?: string[] } => ({
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
});

export const buildRentalDraftFromRow = (rental: CarRental): CarRentalDraft => ({
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
});
