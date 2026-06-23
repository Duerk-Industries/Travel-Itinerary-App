/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import {
  __resetActivityTypeWeightsCacheForTests,
  scoreActivityTypeByPreferences,
  type InterestWeights,
} from '../src/services/activityTypeInterestWeights';

const pref = (overrides: Partial<InterestWeights>): InterestWeights => ({
  outdoors: 0,
  adventure: 0,
  culture: 0,
  food: 0,
  nightlife: 0,
  relax: 0,
  photography: 0,
  authentic_local: 0,
  iconic_landmarks: 0,
  ...overrides,
});

describe('activity_type_interest_weights.csv scoring', () => {
  test('favors matching activity types for strong preference vectors', () => {
    __resetActivityTypeWeightsCacheForTests();
    const outdoorsPref = pref({ outdoors: 100 });
    const foodPref = pref({ food: 100 });

    expect(scoreActivityTypeByPreferences('Outdoor Activity', outdoorsPref)).toBeGreaterThan(
      scoreActivityTypeByPreferences('Nightlife', outdoorsPref)
    );
    expect(scoreActivityTypeByPreferences('Food & Drink', foodPref)).toBeGreaterThan(
      scoreActivityTypeByPreferences('Hike', foodPref)
    );
  });

  test('returns zero for unknown activity type rows', () => {
    __resetActivityTypeWeightsCacheForTests();
    expect(scoreActivityTypeByPreferences('Unknown Type', pref({ culture: 100 }))).toBe(0);
  });
});
