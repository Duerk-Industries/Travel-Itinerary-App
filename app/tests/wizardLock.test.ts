/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { shouldAllowPageChange, shouldDisableTab, type PageKey } from '../utils/wizardGuard';

const pages: PageKey[] = [
  'home',
  'overview',
  'flights',
  'lodging',
  'packing',
  'car',
  'tours',
  'expenses',
  'cost',
  'trips',
  'create-trip',
  'account',
  'follow',
];

describe('Trip wizard navigation lock', () => {
  test('blocks switching away from create-trip except Home', () => {
    pages.forEach((page) => {
      if (page === 'create-trip' || page === 'home') {
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

  test('disables all tabs except create-trip and Home when wizard is open', () => {
    pages.forEach((page) => {
      if (page === 'create-trip' || page === 'home') {
        expect(shouldDisableTab('create-trip', page)).toBe(false);
      } else {
        expect(shouldDisableTab('create-trip', page)).toBe(true);
      }
    });
  });

  test('blocks restricted pages for followed trips', () => {
    const blocked: PageKey[] = ['expenses', 'ingest', 'ledger', 'trips', 'create-trip', 'follow', 'following'];
    blocked.forEach((page) => {
      expect(shouldAllowPageChange('home', page, { isFollowedTrip: true })).toBe(false);
      expect(shouldDisableTab('home', page, { isFollowedTrip: true })).toBe(true);
    });
    ['overview', 'flights', 'lodging', 'packing', 'car', 'tours', 'cost', 'account'].forEach((page) => {
      expect(shouldAllowPageChange('home', page as PageKey, { isFollowedTrip: true })).toBe(true);
      expect(shouldDisableTab('home', page as PageKey, { isFollowedTrip: true })).toBe(false);
    });
  });
});
