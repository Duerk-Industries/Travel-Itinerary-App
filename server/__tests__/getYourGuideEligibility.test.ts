import * as domain from '../../packages/domain/src/getYourGuideEligibility';
import * as server from '../src/utils/getYourGuideEligibility';

const baseCandidate = (overrides: Partial<domain.GetYourGuideCandidate> = {}): domain.GetYourGuideCandidate => ({
  id: 'a1', name: 'Louvre Museum Guided Tour', activityType: 'Tour', date: '2026-08-01',
  destination: { destination: 'Paris, France' }, durationMinutes: 120, availableMinutes: 420,
  previousTravelMinutes: 20, nextTravelMinutes: 20, bufferMinutes: 30, interestTags: ['culture'], ...overrides,
});

describe('GetYourGuide Phase 1 eligibility rules', () => {
  it('normalizes Unicode, punctuation, and whitespace without losing searchable text', () => {
    expect(domain.normalizeGetYourGuideText('  Museo Nacional de Antropología  ')).toBe('museo nacional de antropologia');
    expect(domain.normalizeGetYourGuideText(null)).toBe('');
  });

  it.each([
    ['Tour', true], ['Ticketed Attraction', true], ['Spa/Wellness', true],
    ['Sights & Landmarks', false], ['Open Access', false], ['Food & Drink', false], ['unknown', false],
  ])('applies the bookable activity allowlist to %s', (type, expected) => {
    expect(domain.isBookableGetYourGuideActivityType(type)).toBe(expected);
  });

  it.each([
    ['Louvre Museum Guided Tour', true], ['Museo Nacional de Antropología', true],
    ['Museum', false], ['a local market', false], ['Nearby', false], ['Old Town Walk', false],
    ['Flexible activity', false], ['City Center Tour', false], ['Activity Experience', false],
  ])('checks activity-name specificity for %s', (name, expected) => {
    expect(domain.isLikelySpecificGetYourGuideActivityName(name)).toBe(expected);
  });

  it('normalizes and disambiguates destinations using city/country or coordinates', () => {
    expect(domain.normalizeGetYourGuideDestination({ destination: 'Paris, France' })).toMatchObject({
      query: 'paris, france', city: 'paris', country: 'france', disambiguated: true,
    });
    expect(domain.normalizeGetYourGuideDestination({ destination: 'Paris' })).toMatchObject({
      query: 'paris', disambiguated: false,
    });
    expect(domain.normalizeGetYourGuideDestination({ destination: 'Springfield', coordinates: { lat: 39.8, lon: -89.6 } })).toMatchObject({
      query: 'springfield', disambiguated: true, coordinates: { lat: 39.8, lon: -89.6 },
    });
    expect(domain.normalizeGetYourGuideDestination({ destination: 'Nowhere', coordinates: { lat: 999, lon: 2 } })).toMatchObject({ disambiguated: false });
    expect(domain.normalizeGetYourGuideDestination({})).toBeNull();
  });

  it('parses 12/24-hour clocks and rejects invalid times', () => {
    expect(domain.parseGetYourGuideClockMinutes('9:30 AM')).toBe(570);
    expect(domain.parseGetYourGuideClockMinutes('9:30 pm')).toBe(1290);
    expect(domain.parseGetYourGuideClockMinutes('00:15')).toBe(15);
    expect(domain.parseGetYourGuideClockMinutes('25:00')).toBeNull();
    expect(domain.parseGetYourGuideClockMinutes('not-a-time')).toBeNull();
  });

  it('handles normal and overnight activity windows without timezone conversion', () => {
    expect(domain.isGetYourGuideTimeWindowFeasible({ startTime: '10:00', durationMinutes: 90, timeWindow: { start: '09:00', end: '12:00' } })).toBe(true);
    expect(domain.isGetYourGuideTimeWindowFeasible({ startTime: '23:30', durationMinutes: 60, timeWindow: { start: '22:00', end: '01:00' } })).toBe(true);
    expect(domain.isGetYourGuideTimeWindowFeasible({ startTime: '08:00', durationMinutes: 30, timeWindow: { start: '09:00', end: '12:00' } })).toBe(false);
    expect(domain.isGetYourGuideTimeWindowFeasible({ startTime: '08:00', durationMinutes: 30, timeWindow: null })).toBe(true);
  });

  it('rejects infeasible transfers, invalid durations, excessive walking, and inaccessible venues', () => {
    expect(domain.isGetYourGuideTravelWindowFeasible(baseCandidate({ availableMinutes: 150 }))).toBe(false);
    expect(domain.isGetYourGuideTravelWindowFeasible(baseCandidate({ durationMinutes: -1 }))).toBe(false);
    expect(domain.isGetYourGuideTravelWindowFeasible(baseCandidate({ previousTravelMinutes: -5 }))).toBe(false);
    expect(domain.isGetYourGuideTravelWindowFeasible(baseCandidate({ walkingMinutes: 45 }), 'Low')).toBe(false);
    expect(domain.isGetYourGuideTravelWindowFeasible(baseCandidate({ mobilityAccessible: false }), 'Low')).toBe(false);
    expect(domain.isGetYourGuideTravelWindowFeasible(baseCandidate({ availableMinutes: null, durationMinutes: null }), 'Medium')).toBe(true);
  });

  it('applies preferences and returns stable suppression reasons', () => {
    const candidate = baseCandidate({ budgetTier: 'premium', languages: ['fr'], interestTags: ['nightlife'] });
    const decision = domain.evaluateGetYourGuideCandidate(candidate, {
      comfort: 'Budget', language: 'en', avoid: ['nightlife'], interestWeights: { culture: 20 },
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining(['budget_incompatible', 'language_unavailable', 'matches_avoid_preference']));
    expect(decision.canonicalKey).toContain('2026-08-01|paris, france|louvre museum guided tour');
    expect(domain.evaluateGetYourGuideCandidate(baseCandidate({ languages: ['en-US'], budgetTier: 'paid' }), { language: 'en', comfort: 'Luxury' }).eligible).toBe(true);
    expect(domain.evaluateGetYourGuideCandidate(baseCandidate({ budgetTier: 'free' }), { comfort: 'Luxury' }).reasons).toContain('budget_incompatible');
  });

  it('prioritizes must-sees, deduplicates per date/destination/name, and enforces the cap', () => {
    const normal = baseCandidate({ id: 'normal', name: 'Eiffel Tower Evening Tour', interestTags: ['culture'] });
    const duplicate = baseCandidate({ id: 'duplicate', name: 'Louvre Museum Guided Tour' });
    const mustSee = baseCandidate({ id: 'must', name: 'Notre Dame Cathedral Tour', mustSee: true });
    const later = baseCandidate({ id: 'later', name: 'Seine River Cruise Experience', date: '2026-08-02' });
    const result = domain.selectGetYourGuideCandidates([normal, duplicate, mustSee, later], { maxCandidates: 2, interestWeights: { culture: 10 } });
    expect(result.selected.map((item) => item.id)).toEqual(['must', 'normal']);
    expect(result.rejected).toHaveLength(0);
    expect(domain.selectGetYourGuideCandidates([baseCandidate({ activityType: 'Open Access' })], {}).rejected[0].reasons).toContain('activity_type_not_eligible');
  });

  it('keeps server mirror behavior aligned with the shared domain package', () => {
    expect(server.GETYOURGUIDE_RULES_VERSION).toBe(domain.GETYOURGUIDE_RULES_VERSION);
    expect(server.BOOKABLE_GETYOURGUIDE_ACTIVITY_TYPES).toEqual(domain.BOOKABLE_GETYOURGUIDE_ACTIVITY_TYPES);
    const cases = [baseCandidate(), baseCandidate({ name: 'nearby', activityType: 'Open Access' }), baseCandidate({ destination: { destination: 'Paris' } })];
    for (const candidate of cases) {
      expect(server.evaluateGetYourGuideCandidate(candidate as server.GetYourGuideCandidate, { maxCandidates: 4 })).toEqual(
        domain.evaluateGetYourGuideCandidate(candidate, { maxCandidates: 4 })
      );
    }
    expect(server.selectGetYourGuideCandidates(cases as server.GetYourGuideCandidate[], { maxCandidates: 2 }).selected.map((item) => item.id))
      .toEqual(domain.selectGetYourGuideCandidates(cases, { maxCandidates: 2 }).selected.map((item) => item.id));
  });
});
