/// <reference types="jest" />
/// <reference types="node" />

import { evaluateFields } from '../../src/ai/evaluation/fieldEvaluator';
import { scoreEvaluation } from '../../src/ai/evaluation/qualityScore';

describe('fieldEvaluator', () => {
  it('validates known-good flight fields using the travel field spec', () => {
    const result = evaluateFields('flight', {
      carrier: 'Delta Air Lines',
      flightNumber: 'DL123',
      bookingReference: 'ABC123',
      departureAirportCode: 'BOS',
      arrivalAirportCode: 'LAX',
      departureDate: '2026-08-01',
      arrivalDate: '2026-08-01',
      departureTime: '9:30 AM',
      arrivalTime: '12:10 PM',
      passengerName: 'Test Traveler',
      cost: 250,
    });

    expect(result.fields.find((field) => field.fieldName === 'bookingReference')?.formatValid).toBe(true);
    expect(result.fields.find((field) => field.fieldName === 'departureAirportCode')?.formatValid).toBe(true);
    expect(scoreEvaluation('capture-1', [result]).scores.validationScore).toBe(100);
  });

  it('flags bad formats without depending on parser output', () => {
    const result = evaluateFields('flight', {
      carrier: 'Delta Air Lines',
      flightNumber: 'not-a-flight',
      bookingReference: 'not-a-pnr!',
      departureAirportCode: 'Boston',
      arrivalAirportCode: 'LAX',
      departureDate: '08/01/2026',
      departureTime: '9:30am',
      arrivalTime: '12:10',
      passengerName: 'Test Traveler',
    });

    expect(result.fields.find((field) => field.fieldName === 'flightNumber')?.formatValid).toBe(false);
    expect(result.fields.find((field) => field.fieldName === 'bookingReference')?.formatValid).toBe(false);
    expect(result.fields.find((field) => field.fieldName === 'departureAirportCode')?.formatValid).toBe(false);
    expect(result.fields.find((field) => field.fieldName === 'departureTime')?.formatValid).toBe(true);
    expect(result.fields.find((field) => field.fieldName === 'arrivalTime')?.formatValid).toBe(false);
    expect(scoreEvaluation('capture-2', [result]).scores.validationScore).toBeLessThan(100);
  });

  it('treats null-format fields as presence-only', () => {
    const result = evaluateFields('hotel', {
      name: 'Hotel Test',
      checkInDate: '2026-08-01',
      checkOutDate: '2026-08-03',
    });

    const name = result.fields.find((field) => field.fieldName === 'name');
    expect(name?.present).toBe(true);
    expect(name?.formatValid).toBeNull();
  });

  it('evaluates hotel checkout after checkin cross-field rule', () => {
    const good = evaluateFields('hotel', {
      name: 'Hotel Test',
      check_in_date: '2026-08-01',
      check_out_date: '2026-08-03',
    });
    const bad = evaluateFields('hotel', {
      name: 'Hotel Test',
      check_in_date: '2026-08-03',
      check_out_date: '2026-08-01',
    });

    expect(good.crossFieldChecks[0]?.passed).toBe(true);
    expect(bad.crossFieldChecks[0]?.passed).toBe(false);
  });
});
