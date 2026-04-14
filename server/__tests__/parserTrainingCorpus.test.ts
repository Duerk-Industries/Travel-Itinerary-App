import {
  buildCuratedOpenTravelExample,
  buildOssRawEmailExample,
  buildWeakTravelMiningExample,
  buildPublicMarkupExample,
  extractWeakTravelMiningTextsFromHtml,
  extractJsonLdBlocks,
  flightReservationToLabelItem,
  parseFlightSummaryHtml,
  parseRawEmailBasic,
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

  it('parses raw emails and wraps them as generic-note examples', () => {
    const rawEmail = [
      'From: sender@example.com',
      'To: receiver@example.com',
      'Subject: Hello there',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'This is a test body.',
    ].join('\n');

    const parsed = parseRawEmailBasic(rawEmail);
    expect(parsed.subject).toBe('Hello there');
    expect(parsed.textBody).toContain('test body');

    const example = buildOssRawEmailExample({
      rawEmail,
      title: 'Sample OSS Email',
      provider: 'Example Project',
      url: 'https://example.com/raw',
      harvestedAt: '2026-04-14T00:00:00.000Z',
      licenseHint: 'Public corpus',
    });

    expect(example.label.itemType).toBe('generic_note');
    expect(example.label.items).toEqual([]);
    expect(example.email.subject).toBe('Hello there');
  });

  it('parses curated travel summary rows', () => {
    const rows = parseFlightSummaryHtml(`
      <tr><td class="left"><h5>From</h5>BOS<td class="middle" rowspan="2">&#9992;<td class="right"><h5>Destination</h5>LAX</tr>
      <tr><td class="left"><h5>Depart</h5>08:05<td class="right"><h5>Date</h5>2027-04-05</tr>
      <tr><td colspan="3" class="details"><h5>Arriving</h5>2027-04-05 11:30<h5>Flight number</h5>UA1704 with <h5>Ticket</h5></td></tr>
      <tr><td colspan="3" class="email"><h5>Email</h5>\"Fwd: eTicket itinerary\"</td></tr>
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].departureLocation).toBe('BOS');

    const example = buildCuratedOpenTravelExample({
      title: 'Curated Travel Fixture',
      provider: 'Open Travel Repo',
      url: 'https://example.com/summary.html',
      harvestedAt: '2026-04-14T00:00:00.000Z',
      ...rows[0],
    });
    expect(example.label.itemType).toBe('flight');
    expect(example.email.subject).toContain('Fwd: eTicket itinerary');
  });

  it('extracts travel-focused weak-mining text snippets from HTML', () => {
    const snippets = extractWeakTravelMiningTextsFromHtml(`
      <html><body>
        <p>Ignore me</p>
        <pre>
          Your itinerary is confirmed.
          Flight number AA120
          Route: BOS-LAX
          Confirmation: ZXCVB7
        </pre>
        <td>
          Stay confirmation at Hotel Example.
          Check-in 2027-05-01.
          Check-out 2027-05-03.
          Guest: Eva Green.
          Address: 123 Example Street, Boston, MA.
          Reservation reference: HOTEL123.
        </td>
      </body></html>
    `);

    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toContain('Flight number AA120');
    expect(snippets[1]).toContain('Stay confirmation');
  });

  it('builds weak travel examples only when travel-specific signals align', () => {
    const example = buildWeakTravelMiningExample({
      rawEmail: [
        'From: alerts@example.com',
        'To: traveler@example.com',
        'Subject: Your itinerary and boarding pass',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'Flight number AA120',
        'Route: BOS-LAX',
        'Confirmation: ZXCVB7',
      ].join('\n'),
      title: 'Weak travel sample',
      provider: 'Corpus',
      url: 'https://example.com/raw',
      harvestedAt: '2026-04-14T00:00:00.000Z',
      licenseHint: 'Public corpus',
    });

    expect(example?.label.itemType).toBe('flight');
    expect(example?.label.items[0].departureAirportCode).toBe('BOS');
    expect(example?.label.items[0].arrivalAirportCode).toBe('LAX');
  });
});
