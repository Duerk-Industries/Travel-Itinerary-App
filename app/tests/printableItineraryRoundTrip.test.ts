import { buildPrintableItineraryHtml } from '../utils/printableItinerary';
import { isWanderBunniesPrint, parseWanderBunniesPrint } from '../../server/src/services/wanderBunniesPrintParser';

// Approximates what a PDF text extractor returns for the printed page: block elements start a new
// line, inline elements (a label and its value) run together.
const extractText = (html: string): string => html
  .replace(/<style[\s\S]*?<\/style>/g, '')
  // The stylesheet upper-cases these, and lays a heading's kind and title out on one row.
  .replace(/(<div class="eyebrow">|<span class="item-kind">|<div class="summary-card"><span>)([^<]*)/g, (_match, tag: string, label: string) => tag + label.toUpperCase())
  .replace(/<\/span><(h2|h3)>/g, '</span>')
  .replace(/<\/(div|article|section|header|h1|h2|h3|p|li|ul)>/g, '\n')
  .replace(/<(div|article|section|header|h1|h2|h3|p|li|ul)[^>]*>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
  .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

const trip = { name: 'Japan Spring', currency: 'USD', description: 'Cherry blossoms.', notes: 'Book the Shinkansen first.\n\nFLIGHT prices rise in November.' };

describe('printable itinerary round trip (format v2)', () => {
  const html = buildPrintableItineraryHtml({
    trip,
    planMarkdown: 'Day one is a long travel day.',
    travelers: [{ firstName: 'Alex', lastName: 'Rivera' }],
    unscheduled: [{ name: 'Tea ceremony', date: '', status: 'Proposed', startLocation: 'Gion', activityType: 'Tour' }],
    days: [
      {
        date: '2027-04-05', dayNumber: 1,
        flights: [{ transfer_type: 'Flight', departure_location: 'BOS', arrival_location: 'NRT', departure_airport_code: 'BOS', arrival_airport_code: 'NRT', departure_time: '23:00', arrival_time: '06:00', departureDate: '2027-04-05', arrivalDate: '2027-04-06', carrier: 'JAL', flight_number: 'JL 5', cost: 900, status: 'Booked', booking_reference: 'ABC123' }],
      },
      {
        date: '2027-04-06', dayNumber: 2,
        flights: [{ transfer_type: 'Flight', departure_location: 'BOS', arrival_location: 'NRT', departure_airport_code: 'BOS', arrival_airport_code: 'NRT', departure_time: '23:00', arrival_time: '06:00', departureDate: '2027-04-05', arrivalDate: '2027-04-06', carrier: 'JAL', flight_number: 'JL 5', cost: 900, status: 'Booked', booking_reference: 'ABC123' }],
        lodgings: [{ name: 'Ryokan Yamashiro', checkInDate: '2027-04-06', checkOutDate: '2027-04-07', address: '12 Gion, Kyoto', rooms: 1, status: 'Proposed', features: ['Breakfast', 'Dinner'], notes: 'Ask for a private onsen.\n\nSecond paragraph.' }],
        tours: [{ name: 'Fushimi Inari', date: '2027-04-06', startTime: '15:00', startLocation: 'Fushimi', duration: '2h', status: 'Needs Booking', activityType: 'Hike', bookedOn: 'Klook', notes: 'Go early.' }],
        rentals: [{ vendor: 'Hertz', model: 'Fiat 500', pickupDate: '2027-04-06', pickupLocation: 'Airport', dropoffDate: '2027-04-07', dropoffLocation: 'City', status: 'Booked', notes: 'Child seat.\nSecond line.' }],
        details: [
          { kind: 'note', activity: 'Booking priorities', noteBody: '1. Shinkansen\nOTHER: ryokan fills early' },
          { kind: 'checklist', activity: 'Before dinner', checklistItems: [{ label: 'Reserve table', checkedAt: '2027-04-01T00:00:00Z' }, { label: 'Charge phone', checkedAt: null }] },
          { kind: 'place', activity: 'Bar del Pla', time: '19:30', address: 'Carrer 1, Barcelona', lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' },
        ],
      },
    ],
  });
  const text = extractText(html);
  const parsed = parseWanderBunniesPrint(text);

  it('is recognised as a v2 printout, with the Travel tips boilerplate and a visible version marker', () => {
    expect(isWanderBunniesPrint(text)).toBe(true);
    expect(parsed.version).toBe(2);
    expect(html).toContain('Travel tips');
    expect(html).not.toMatch(/<h2>Trip notes<\/h2>/);
  });

  it('prints every populated field as a labelled line', () => {
    for (const expected of ['TRIP NOTES', 'TRIP GUIDE', 'UNSCHEDULED', 'Features', 'Booked on', 'Departure date', 'Arrival date', 'Address', '☑', '☐']) {
      expect(text).toContain(expected);
    }
    expect(html).toContain('<div class="q">&gt; Book the Shinkansen first.</div>');
    expect(html).toContain('<div class="q">&gt;</div>');
  });

  it('reads back trip notes, the guide and the unscheduled activity', () => {
    expect(parsed.tripNotes).toBe(trip.notes);
    expect(parsed.tripGuide).toBe('Day one is a long travel day.');
    expect(parsed.candidates.find((c) => c.name === 'Tea ceremony')).toEqual(expect.objectContaining({ unscheduled: true, activityDate: null }));
  });

  it('reads back transfers, lodging, activities and rentals with their new fields', () => {
    const flights = parsed.candidates.filter((c) => c.type === 'flight');
    expect(flights).toHaveLength(1);
    expect(flights[0]).toEqual(expect.objectContaining({ status: 'Booked', departureDate: '2027-04-05', arrivalDate: '2027-04-06', confirmationNumber: 'ABC123', totalCost: 900 }));
    expect(parsed.candidates.find((c) => c.type === 'hotel')).toEqual(expect.objectContaining({
      name: 'Ryokan Yamashiro', features: ['Breakfast', 'Dinner'], notes: 'Ask for a private onsen.\n\nSecond paragraph.',
    }));
    expect(parsed.candidates.find((c) => c.name === 'Fushimi Inari')).toEqual(expect.objectContaining({ status: 'Needs Booking', bookedOn: 'Klook', notes: 'Go early.' }));
    expect(parsed.candidates.find((c) => c.type === 'car_rental')).toEqual(expect.objectContaining({ status: 'Booked', notes: 'Child seat.\nSecond line.' }));
  });

  it('reads back note bodies, checklist state and a place address', () => {
    const [note, checklist, place] = parsed.details;
    expect(note).toEqual(expect.objectContaining({ kind: 'note', body: '1. Shinkansen\nOTHER: ryokan fills early' }));
    expect(checklist.checklist).toEqual([{ label: 'Reserve table', checked: true }, { label: 'Charge phone', checked: false }]);
    expect(place).toEqual(expect.objectContaining({ kind: 'place', time: '19:30', address: 'Carrer 1, Barcelona', lat: 41.4036, lng: 2.1744 }));
  });
});
