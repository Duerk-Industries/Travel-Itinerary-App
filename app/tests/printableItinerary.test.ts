import { buildPrintableItineraryHtml } from '../utils/printableItinerary';

describe('printable itinerary', () => {
  it('includes the trip summary and every supported day item', () => {
    const html = buildPrintableItineraryHtml({
      trip: {
        name: 'Romania <Road Trip>',
        description: 'A castle and mountain trip.',
        currency: 'EUR',
        mustSeeAttractions: ['Peleș Castle'],
      },
      locationLabel: 'Bucharest, Brașov',
      travelers: [{ firstName: 'Bryan', lastName: 'Duerk' }],
      days: [{
        date: '2026-09-05',
        dayNumber: 1,
        flights: [{ departure_location: 'OTP', arrival_location: 'CLJ', carrier: 'Example Air', cost: 125 }],
        lodgings: [{ name: 'Grand Hotel', checkInDate: '2026-09-05', checkOutDate: '2026-09-06' }],
        tours: [{ name: 'Old Town Walk', date: '2026-09-05', startTime: '10:00', startLocation: 'Old Town' }],
        rentals: [{ vendor: 'Example Cars', pickupLocation: 'Airport', pickupDate: '2026-09-05', dropoffLocation: 'City', dropoffDate: '2026-09-10' }],
        details: [{ activity: 'Dinner reservation', time: '19:00', kind: 'activity' }],
      }],
    });

    expect(html).toContain('Romania &lt;Road Trip&gt;');
    expect(html).toContain('Grand Hotel');
    expect(html).toContain('Example Air');
    expect(html).toContain('Old Town Walk');
    expect(html).toContain('Example Cars');
    expect(html).toContain('Dinner reservation');
    expect(html).toContain('Peleș Castle');
    expect(html).toContain('@page');
  });

  it('prints the activity category, and coordinates with their source only when known', () => {
    const html = buildPrintableItineraryHtml({
      trip: { name: 'Spain', currency: 'EUR' },
      days: [{
        date: '2026-03-04',
        dayNumber: 1,
        lodgings: [{ name: 'Hotel Gracia', checkInDate: '2026-03-04', checkOutDate: '2026-03-05', lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' }],
        tours: [
          { name: 'Sagrada Familia', date: '2026-03-04', status: 'Booked', activityType: 'Sights & Landmarks', lat: 41.40363, lng: 2.17436, coordinateSource: 'catalog' },
          { name: 'Wander', date: '2026-03-04', status: 'Proposed', activityType: 'Other' },
        ],
        rentals: [{ vendor: 'Hertz', pickupDate: '2026-03-04', dropoffDate: '2026-03-05', lat: 41.2974, lng: 2.0833, dropoffLat: 41.379, dropoffLng: 2.140, coordinateSource: 'manual', notes: 'Child seat.' }],
      }],
    });
    expect(html).toContain('<span>Category</span><strong>Sights &amp; Landmarks</strong>');
    expect(html).toContain('<span>Coordinates</span><strong>41.40363, 2.17436</strong>');
    expect(html).toContain('<span>Coordinate source</span><strong>catalog</strong>');
    expect(html).toContain('<span>Coordinates</span><strong>41.40360, 2.17440</strong>');
    expect(html).toContain('<span>Pick-up coordinates</span><strong>41.29740, 2.08330</strong>');
    expect(html).toContain('<span>Drop-off coordinates</span><strong>41.37900, 2.14000</strong>');
    expect(html).toContain('<span>Notes</span><strong>Child seat.</strong>');
    // An item with no coordinates prints none, and never an invented source.
    const unlocated = html.slice(html.indexOf('Wander'), html.indexOf('Hertz'));
    expect(unlocated).not.toContain('Coordinates');
    expect(unlocated).not.toContain('Coordinate source');
  });

  it('ignores impossible coordinates', () => {
    const html = buildPrintableItineraryHtml({
      trip: { name: 'Bad data' },
      days: [{ date: '2026-03-04', dayNumber: 1, tours: [{ name: 'Nowhere', date: '2026-03-04', lat: 400, lng: 0, coordinateSource: 'manual' }] }],
    });
    expect(html).not.toContain('Coordinates');
  });
});
