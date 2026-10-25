import { printableItineraryCss } from '../theme/theme';
type PrintableRecord = Record<string, any>;

export type PrintableItineraryInput = {
  trip: PrintableRecord;
  travelers?: PrintableRecord[];
  locationLabel?: string | null;
  days: Array<{
    date: string;
    dayNumber: number;
    details?: PrintableRecord[];
    flights?: PrintableRecord[];
    lodgings?: PrintableRecord[];
    tours?: PrintableRecord[];
    rentals?: PrintableRecord[];
  }>;
};

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const text = (value: unknown, fallback = 'Not specified'): string => {
  const clean = String(value ?? '').trim();
  return clean ? escapeHtml(clean) : fallback;
};

const money = (value: unknown, currency: string): string => {
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${escapeHtml(currency)} ${numeric.toFixed(2)}` : text(value);
};

const formatDate = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Date not specified';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.valueOf())) return escapeHtml(raw);
  return escapeHtml(date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
};

const field = (label: string, value: unknown): string => {
  const clean = String(value ?? '').trim();
  return clean ? `<div class="field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(clean)}</strong></div>` : '';
};

// Coordinates are printed only when the item has them, so the importer can restore them. The
// source ("catalog", "airport", "manual", "geocoder") travels with them for provenance.
const coordinate = (lat: unknown, lng: unknown): string => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  const present = lat !== null && lat !== undefined && lng !== null && lng !== undefined;
  return present && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : '';
};
const coordinateFields = (item: PrintableRecord, hasCoordinates: boolean): string =>
  hasCoordinates ? field('Coordinate source', item.coordinateSource) : '';

const renderFlight = (flight: PrintableRecord, currency: string): string => {
  const dep = flight.departure_location || flight.departure_airport_code || 'Departure';
  const arr = flight.arrival_location || flight.arrival_airport_code || 'Arrival';
  const route = `${dep} → ${arr}`;
  return `<article class="item transfer">
    <div class="item-heading"><span class="item-kind">${text(flight.transfer_type || flight.transferType || 'Transfer')}</span><h3>${text(route)}</h3></div>
    <div class="fields">
      ${field('Carrier', flight.carrier)}${field('Number', flight.flight_number || flight.flightNumber)}
      ${field('Departure', `${flight.departure_time || 'Time TBD'} · ${flight.departure_airport_code || dep}`)}
      ${field('Arrival', `${flight.arrival_time || 'Time TBD'} · ${flight.arrival_airport_code || arr}`)}
      ${field('Travelers', flight.passenger_name)}${field('Booking reference', flight.booking_reference || flight.bookingReference)}
      ${field('Layover', flight.layover_location || flight.layover_location_code)}${field('Layover duration', flight.layover_duration)}
      ${flight.cost !== undefined && flight.cost !== null ? field('Cost', money(flight.cost, currency)) : ''}
    </div>
  </article>`;
};

const renderLodging = (lodging: PrintableRecord, currency: string): string => `<article class="item lodging">
  <div class="item-heading"><span class="item-kind">Accommodation</span><h3>${text(lodging.name)}</h3></div>
  <div class="fields">
    ${field('Check-in', formatDate(lodging.checkInDate))}${field('Check-out', formatDate(lodging.checkOutDate))}
    ${field('Address', lodging.address)}${field('Rooms', lodging.rooms)}${field('Status', lodging.status)}
    ${field('Refund by', lodging.refundBy ? formatDate(lodging.refundBy) : '')}
    ${lodging.totalCost ? field('Total', money(lodging.totalCost, currency)) : ''}${lodging.costPerNight ? field('Per night', money(lodging.costPerNight, currency)) : ''}
    ${field('Coordinates', coordinate(lodging.lat, lodging.lng))}${coordinateFields(lodging, Boolean(coordinate(lodging.lat, lodging.lng)))}
  </div>
</article>`;

const renderTour = (tour: PrintableRecord, currency: string): string => `<article class="item activity">
  <div class="item-heading"><span class="item-kind">Activity</span><h3>${text(tour.name)}</h3></div>
  <div class="fields">
    ${field('Time', tour.startTime)}${field('Location', tour.startLocation)}${field('Duration', tour.duration)}
    ${field('Status', tour.status)}${field('Category', tour.activityType)}${field('Booking reference', tour.reference)}${tour.cost ? field('Cost', money(tour.cost, currency)) : ''}
    ${field('Free cancellation by', tour.freeCancelBy ? formatDate(tour.freeCancelBy) : '')}
    ${field('Coordinates', coordinate(tour.lat, tour.lng))}${coordinateFields(tour, Boolean(coordinate(tour.lat, tour.lng)))}
  </div>
</article>`;

const renderRental = (rental: PrintableRecord, currency: string): string => `<article class="item rental">
  <div class="item-heading"><span class="item-kind">Car rental</span><h3>${text(rental.vendor || rental.model || 'Rental car')}</h3></div>
  <div class="fields">
    ${field('Vehicle', rental.model)}${field('Pick up', `${formatDate(rental.pickupDate)} · ${rental.pickupLocation || 'Location TBD'}`)}
    ${field('Drop off', `${formatDate(rental.dropoffDate)} · ${rental.dropoffLocation || 'Location TBD'}`)}
    ${field('Reference', rental.reference)}${field('Prepaid', rental.prepaid)}${rental.cost ? field('Cost', money(rental.cost, currency)) : ''}
    ${field('Pick-up coordinates', coordinate(rental.lat, rental.lng))}${field('Drop-off coordinates', coordinate(rental.dropoffLat, rental.dropoffLng))}
    ${coordinateFields(rental, Boolean(coordinate(rental.lat, rental.lng) || coordinate(rental.dropoffLat, rental.dropoffLng)))}${field('Notes', rental.notes)}
  </div>
</article>`;

const renderDetail = (detail: PrintableRecord): string => {
  const checklist = Array.isArray(detail.checklistItems) && detail.checklistItems.length
    ? `<ul class="checklist">${detail.checklistItems.map((item: PrintableRecord) => `<li class="${item.checkedAt ? 'checked' : ''}">${item.checkedAt ? '✓' : '□'} ${text(item.label)}</li>`).join('')}</ul>`
    : '';
  return `<article class="item note">
    <div class="item-heading"><span class="item-kind">${text(detail.kind || 'Note')}</span><h3>${text(detail.activity)}</h3></div>
    ${detail.time ? `<div class="time">${text(detail.time)}</div>` : ''}
    ${detail.cost !== undefined && detail.cost !== null ? `<div class="time">Cost: ${money(detail.cost, '')}</div>` : ''}
    ${checklist}
  </article>`;
};

export const buildPrintableItineraryHtml = (input: PrintableItineraryInput): string => {
  const trip = input.trip ?? {};
  const currency = String(trip.currency || 'USD');
  const travelers = (input.travelers ?? []).map((traveler) => traveler.guestName || [traveler.firstName, traveler.lastName].filter(Boolean).join(' ') || traveler.email || traveler.userEmail).filter(Boolean);
  const tripDates = input.days.length ? `${formatDate(input.days[0].date)} - ${formatDate(input.days[input.days.length - 1].date)}` : '';
  const daySections = input.days.map((day) => {
    const items = [
      ...(day.flights ?? []).map((item) => renderFlight(item, currency)),
      ...(day.lodgings ?? []).map((item) => renderLodging(item, currency)),
      ...(day.tours ?? []).map((item) => renderTour(item, currency)),
      ...(day.rentals ?? []).map((item) => renderRental(item, currency)),
      ...(day.details ?? []).map(renderDetail),
    ];
    return `<section class="day">
      <div class="day-heading"><span>DAY ${day.dayNumber}</span><h2>${formatDate(day.date)}</h2></div>
      ${items.length ? items.join('') : '<p class="empty">No scheduled items.</p>'}
    </section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${text(trip.name, 'Trip itinerary')}</title>
  <style>${printableItineraryCss}</style></head><body>
    <header class="cover"><div class="eyebrow">Travel itinerary</div><h1>${text(trip.name, 'Trip itinerary')}</h1>
      <div class="meta">${tripDates}${input.locationLabel ? ` · ${text(input.locationLabel)}` : ''}</div></header>
    <div class="summary">
      <div class="summary-card"><span>Trip length</span><strong>${input.days.length} day${input.days.length === 1 ? '' : 's'}</strong></div>
      <div class="summary-card"><span>Travelers</span><strong>${travelers.length ? travelers.map(escapeHtml).join(', ') : 'Not specified'}</strong></div>
      <div class="summary-card"><span>Currency</span><strong>${escapeHtml(currency)}</strong></div>
    </div>
    ${trip.description ? `<div class="intro">${text(trip.description)}</div>` : ''}
    ${Array.isArray(trip.mustSeeAttractions) && trip.mustSeeAttractions.length ? `<div class="intro"><strong>Must-see:</strong> ${trip.mustSeeAttractions.map(escapeHtml).join(', ')}</div>` : ''}
    ${daySections}
    <section class="practical"><h2>Trip notes</h2><p>Keep booking references and timing details with you while traveling. Costs shown are the values currently saved in WanderBunnies.</p></section>
    <div class="footer">Printed from WanderBunnies · ${escapeHtml(new Date().toLocaleDateString())}</div>
  </body></html>`;
};

export const printItinerary = (input: PrintableItineraryInput): boolean => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const printWindow = window.open('', '_blank', 'width=900,height=900');
  if (!printWindow) return false;
  let printed = false;
  const startPrint = () => {
    if (printed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.onload = startPrint;
  printWindow.document.open();
  printWindow.document.write(buildPrintableItineraryHtml(input));
  printWindow.document.close();
  // Some browsers do not emit a second load event for document.write into a
  // newly opened window; keep printing reliable without double-opening the
  // dialog when the event does fire.
  window.setTimeout(startPrint, 150);
  return true;
};
