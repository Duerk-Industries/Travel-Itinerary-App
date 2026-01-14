import { describe, expect, test } from '@jest/globals';
import { buildCarRentalFromDraft, createInitialCarRentalDraft } from '../tabs/carRentals';

describe('Car rental helpers', () => {
  test('requires at least a pickup location, vendor, or model', () => {
    const draft = createInitialCarRentalDraft();
    const result = buildCarRentalFromDraft(draft, null);
    expect(result.error).toBe('Enter at least a pickup location, vendor, or car model.');
  });

  test('applies default payer and trims fields', () => {
    const result = buildCarRentalFromDraft(
      {
        pickupLocation: ' Airport ',
        pickupDate: '2025-04-10',
        dropoffLocation: '',
        dropoffDate: '',
        reference: '',
        vendor: ' Hertz ',
        prepaid: '',
        cost: '',
        model: ' SUV ',
        notes: '',
        paidBy: [],
      },
      'payer-1'
    );
    expect(result.rental?.paidBy).toEqual(['payer-1']);
    expect(result.rental?.pickupLocation).toBe('Airport');
    expect(result.rental?.vendor).toBe('Hertz');
    expect(result.rental?.model).toBe('SUV');
  });
});
