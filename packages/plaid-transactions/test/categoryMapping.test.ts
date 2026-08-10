import { mapPlaidToNeutral } from '../src/lib/categoryMapping';

describe('mapPlaidToNeutral', () => {
  it('maps food and drink categories', () => {
    expect(mapPlaidToNeutral('FOOD_AND_DRINK')).toBe('Food & Drink');
    expect(mapPlaidToNeutral('FOOD_AND_DRINK_RESTAURANTS')).toBe('Food & Drink');
  });

  it('maps travel and transportation categories', () => {
    expect(mapPlaidToNeutral('TRAVEL')).toBe('Travel');
    expect(mapPlaidToNeutral('TRANSPORTATION')).toBe('Travel');
  });

  it('maps entertainment categories', () => {
    expect(mapPlaidToNeutral('ENTERTAINMENT')).toBe('Entertainment');
  });

  it('defaults to Other for unknown categories', () => {
    expect(mapPlaidToNeutral(null)).toBe('Other');
    expect(mapPlaidToNeutral(undefined)).toBe('Other');
    expect(mapPlaidToNeutral('UNKNOWN_CATEGORY')).toBe('Other');
  });
});
