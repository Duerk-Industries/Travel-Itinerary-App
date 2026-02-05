import { describe, expect, test } from '@jest/globals';
import { shouldAllowPageChange, shouldDisableTab, type PageKey } from '../utils/wizardGuard';

const pages: PageKey[] = [
  'home',
  'overview',
  'flights',
  'lodging',
  'car',
  'tours',
  'expenses',
  'cost',
  'trips',
  'create-trip',
  'trip-details',
  'itinerary',
  'account',
  'follow',
];

describe('Trip wizard navigation lock', () => {
  test('blocks switching away from create-trip', () => {
    pages.forEach((page) => {
      if (page === 'create-trip') {
        expect(shouldAllowPageChange('create-trip', page)).toBe(true);
      } else {
        expect(shouldAllowPageChange('create-trip', page)).toBe(false);
      }
    });
  });

  test('allows switching when not in create-trip', () => {
    pages.forEach((current) => {
      if (current === 'create-trip') return;
      pages.forEach((next) => {
        expect(shouldAllowPageChange(current, next)).toBe(true);
      });
    });
  });

  test('disables all tabs except create-trip when wizard is open', () => {
    pages.forEach((page) => {
      if (page === 'create-trip') {
        expect(shouldDisableTab('create-trip', page)).toBe(false);
      } else {
        expect(shouldDisableTab('create-trip', page)).toBe(true);
      }
    });
  });
});
