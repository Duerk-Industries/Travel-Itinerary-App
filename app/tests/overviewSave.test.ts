import { describe, expect, test } from '@jest/globals';
import { getOverviewSaveFlags } from '../utils/overviewEditing';

describe('Overview save behavior', () => {
  test('skips trip save and exits edit mode when no edits are made', () => {
    const trip = {
      description: 'Test',
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      startMonth: null,
      startYear: null,
      durationDays: null,
    };
    const dateDraft = {
      mode: 'range' as const,
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      startMonth: '',
      startYear: '',
      durationDays: '',
    };
    const result = getOverviewSaveFlags(trip, 'Test', dateDraft, []);
    expect(result.shouldSkipTripSave).toBe(true);
    expect(result.hasTripEdits).toBe(false);
  });

  test('saves when trip fields were edited', () => {
    const trip = {
      description: 'Test',
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      startMonth: null,
      startYear: null,
      durationDays: null,
    };
    const dateDraft = {
      mode: 'range' as const,
      startDate: '2026-01-02',
      endDate: '2026-01-06',
      startMonth: '',
      startYear: '',
      durationDays: '',
    };
    const result = getOverviewSaveFlags(trip, 'Updated', dateDraft, []);
    expect(result.shouldSkipTripSave).toBe(false);
    expect(result.hasTripEdits).toBe(true);
  });
});
