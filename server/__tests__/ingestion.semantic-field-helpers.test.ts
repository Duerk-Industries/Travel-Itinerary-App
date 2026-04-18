import { determineSemanticHelperType, extractSemanticFieldsForType } from '../src/ingestion/extraction/semanticFieldHelpers';

describe('semantic field helpers', () => {
  it('maps parsed item types to semantic helper families', () => {
    expect(determineSemanticHelperType('flight')).toBe('transport');
    expect(determineSemanticHelperType('rail')).toBe('transport');
    expect(determineSemanticHelperType('hotel')).toBe('hotel');
    expect(determineSemanticHelperType('car_rental')).toBe('car_rental');
    expect(determineSemanticHelperType('tour_activity')).toBe('activity');
    expect(determineSemanticHelperType('generic_note')).toBe('generic');
  });

  it('extracts hotel semantic fields from labeled text', () => {
    const fields = extractSemanticFieldsForType(
      'hotel',
      [
        'Guest name Bryan Duerk',
        'Check-in Sunday, November 30, 2025',
        'Check-out Wednesday, December 3, 2025',
        'Location Kisalat RD Ban Visoun Luangprabang, 06000 Luang Prabang, Laos',
        'Phone +856 20 54 443 905',
        'Breakfast included in the price',
        'You paid $321.39',
      ].join(' ')
    );

    expect(fields.guestName).toBe('Bryan Duerk');
    expect(String(fields.checkInDate)).toContain('2025-11-30');
    expect(String(fields.checkOutDate)).toContain('2025-12-03');
    expect(fields.address).toBe('Kisalat RD Ban Visoun Luangprabang, 06000 Luang Prabang, Laos');
    expect(fields.phone).toBe('+856 20 54 443 905');
    expect(fields.breakfastIncluded).toBe(true);
    expect(fields.totalCost).toBeCloseTo(321.39, 2);
    expect(fields.currency).toBe('USD');
    expect(fields.paid).toBe(true);
  });

  it('extracts transport semantic fields from labeled text', () => {
    const fields = extractSemanticFieldsForType(
      'flight',
      [
        'Airline Delta Air Lines',
        'Flight Number DL123',
        'From Boston',
        'To San Francisco',
        'Departure July 4, 2026',
      ].join('\n')
    );

    expect(fields.providerVendor).toBe('Delta Air Lines');
    expect(fields.flightNumber).toBe('DL123');
    expect(fields.departureLocation).toBe('Boston');
    expect(fields.arrivalLocation).toBe('San Francisco');
    expect(String(fields.startDateTimeUtc)).toContain('2026-07-04');
  });
});
