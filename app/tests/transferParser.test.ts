/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { parseFlightText } from '../utils/parsers/transferParser';
import { sanitizeCostInput } from '../utils/sanitizeCost';

describe('transfer parser cost extraction', () => {
  test('extracts the trip total instead of concatenating card suffix digits', () => {
    const text = `
Receipt:
Total price of your trip purchased via Visa ending in: 2961 124.58 USD
Reservation:
N2N5JT
To Bucharest (Otopeni) FR 259
Milan (Bergamo) - Bucharest (Otopeni)
Sat, 05 Sep 26
Departure time - 10:55
Arrival time - 14:05
(BGY) - (OTP)
Passenger(s):
Mr. BRYAN DUERK
Mrs. VICKY DUERK
    `;

    const { primary } = parseFlightText(text);

    expect(primary.cost).toBe('124.58');
    expect(primary.flightNumber).toBe('FR259');
  });

  test('keeps only the actual monetary amount when sanitizing ambiguous strings', () => {
    expect(sanitizeCostInput('2961 124.58 USD')).toBe('124.58');
  });
});
