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
});
