import { describe, expect, test } from '@jest/globals';
import { canProceedFromItineraryStep } from '../utils/createTripWizard';

describe('Itinerary step guard', () => {
  test('requires user to select Yes or No before proceeding', () => {
    expect(canProceedFromItineraryStep(null)).toBe(false);
    expect(canProceedFromItineraryStep('ai')).toBe(true);
    expect(canProceedFromItineraryStep('manual')).toBe(true);
  });
});
