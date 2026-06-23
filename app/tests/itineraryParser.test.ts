/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { parsePlanToDetails } from '../utils/itineraryParser';

describe('Itinerary Parser', () => {
  test('parses a basic plan with days and activities', () => {
    const plan = `
      Day 1: Arrival
      - Check into hotel
      - Dinner
      Day 2: Sightseeing
      - Museum
      - Park
    `;
    const details = parsePlanToDetails(plan);
    expect(details).toEqual([
      { day: 1, activity: 'Check into hotel', cost: null },
      { day: 1, activity: 'Dinner', cost: null },
      { day: 2, activity: 'Museum', cost: null },
      { day: 2, activity: 'Park', cost: null },
    ]);
  });

  test('parses activities with costs', () => {
    const plan = `
      Day 1: Activities
      - Tour $50
      - Lunch $25.50
      - Souvenirs $1,000.00
    `;
    const details = parsePlanToDetails(plan);
    expect(details).toEqual([
      { day: 1, activity: 'Tour $50', cost: 50 },
      { day: 1, activity: 'Lunch $25.50', cost: 25.5 },
      { day: 1, activity: 'Souvenirs $1,000.00', cost: 1000 },
    ]);
  });

  test('ignores empty lines and lines before the first day heading', () => {
    const plan = `
      This is a preamble.
      It should be ignored.

      Day 1: First Day
      - Activity 1
    `;
    const details = parsePlanToDetails(plan);
    expect(details).toEqual([{ day: 1, activity: 'Activity 1', cost: null }]);
  });

  test('handles different formatting', () => {
    const plan = 'Day 1 * Activity 1\nDay 2   - Activity 2';
    const details = parsePlanToDetails(plan);
    expect(details).toEqual([
      { day: 1, activity: 'Activity 1', cost: null },
      { day: 2, activity: 'Activity 2', cost: null },
    ]);
  });

  test('parses a multi-day plan', () => {
    const plan = `
      Day 1
      - Activity A
      Day 2
      - Activity B
      Day 3
      - Activity C
    `;
    const details = parsePlanToDetails(plan);
    expect(details).toEqual([
      { day: 1, activity: 'Activity A', cost: null },
      { day: 2, activity: 'Activity B', cost: null },
      { day: 3, activity: 'Activity C', cost: null },
    ]);
  });

  test('returns an empty array for an empty plan', () => {
    const plan = '';
    const details = parsePlanToDetails(plan);
    expect(details).toEqual([]);
  });
});
