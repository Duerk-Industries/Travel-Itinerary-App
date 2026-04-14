import {
  buildPublicMarkupExample,
  extractJsonLdBlocks,
  flightReservationToLabelItem,
} from '../src/services/parserTrainingCorpus';

describe('parserTrainingCorpus', () => {
  it('extracts JSON-LD blocks from HTML', () => {
    const blocks = extractJsonLdBlocks(`
      <html><body>
        <script type="application/ld+json">
          {"@context":"http://schema.org","@type":"FlightReservation","reservationNumber":"ABC123","reservationFor":{"@type":"Flight","airline":{"name":"Example Air"},"flightNumber":"EA123","departureAirport":{"iataCode":"BOS","name":"Boston Logan"},"departureTime":"2027-01-02T09:15:00Z","arrivalAirport":{"iataCode":"LAX","name":"Los Angeles Intl"},"arrivalTime":"2027-01-02T12:45:00Z"},"underName":{"@type":"Person","name":"Eva Green"}}
        </script>
      </body></html>
    `);

    expect(blocks).toHaveLength(1);
  });

  it('extracts JSON-LD from escaped doc code blocks', () => {
    const blocks = extractJsonLdBlocks(`
      <pre syntax="JSON-LD"><code>
        &lt;<span>scrip</span><span>t</span> type="application/ld+json"&gt;
        {"@context":"http://schema.org","@type":"LodgingReservation","reservationNumber":"abc456","reservationFor":{"@type":"LodgingBusiness","name":"Hotel Example"}}
        &lt;/script&gt;
      </code></pre>
    `);

    expect(blocks).toHaveLength(1);
  });

  it('converts a flight reservation into parser labels', () => {
    const item = flightReservationToLabelItem({
      reservationNumber: 'ABC123',
      underName: { name: 'Eva Green' },
      reservationFor: {
        airline: { name: 'Example Air' },
        flightNumber: 'EA123',
        departureAirport: { iataCode: 'BOS', name: 'Boston Logan' },
        departureTime: '2027-01-02T09:15:00Z',
        arrivalAirport: { iataCode: 'LAX', name: 'Los Angeles Intl' },
        arrivalTime: '2027-01-02T12:45:00Z',
      },
    });

    expect(item.confirmationNumber).toBe('ABC123');
    expect(item.airline).toBe('Example Air');
    expect(item.departureAirportCode).toBe('BOS');
    expect(item.arrivalAirportCode).toBe('LAX');
    expect(item.travelers).toEqual(['Eva Green']);
  });

  it('builds a public example from JSON-LD', () => {
    const example = buildPublicMarkupExample({
      itemType: 'flight',
      title: 'Flight Example',
      provider: 'Google',
      url: 'https://example.com/flight',
      harvestedAt: '2026-04-14T00:00:00.000Z',
      jsonLd: {
        '@context': 'http://schema.org',
        '@type': 'FlightReservation',
        reservationNumber: 'ABC123',
        underName: { '@type': 'Person', name: 'Eva Green' },
        reservationFor: {
          '@type': 'Flight',
          airline: { name: 'Example Air' },
          flightNumber: 'EA123',
          departureAirport: { iataCode: 'BOS', name: 'Boston Logan' },
          departureTime: '2027-01-02T09:15:00Z',
          arrivalAirport: { iataCode: 'LAX', name: 'Los Angeles Intl' },
          arrivalTime: '2027-01-02T12:45:00Z',
        },
      },
    });

    expect(example?.label.itemType).toBe('flight');
    expect(example?.label.items[0].departureAirportCode).toBe('BOS');
    expect(example?.email.rawEmail).toContain('Subject: Your flight reservation ABC123 is confirmed');
  });
});
