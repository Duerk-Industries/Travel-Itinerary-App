import fixture from './fixtures/itinerary-phase-0a-v1.json';
import {
  buildItineraryPreferenceContract,
  INTEREST_KEYS,
  type PreferenceContractInput,
} from '../src/services/itineraryPreferenceContract';

const base: PreferenceContractInput = {
  trip: {
    p: 'F', c: 'M', mob: 'H', car: 'P', is: 'mixed',
    w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
  },
  account: { interests: [] }, travelers: [],
};

describe('itinerary Phase 0A preference contract', () => {
  test('the versioned golden fixture covers every required scenario class', () => {
    expect(fixture.version).toBe('itinerary-phase-0a-fixtures-v1');
    const tags = new Set(fixture.scenarios.flatMap((scenario) => scenario.tags));
    for (const required of ['multi-city', 'open-jaw', 'round-trip', 'date-line', 'arrival-late',
      'departure-early', 'booked-transfer', 'low-mobility', 'family', 'large-group',
      'conflicting-preferences', 'budget', 'must-see', 'closure', 'missing-coordinate', 'repeat-visitor']) {
      expect(tags).toContain(required);
    }
  });

  test('account pace overrides trip pace while mobility uses the most restrictive traveler value', () => {
    const contract = buildItineraryPreferenceContract({
      ...base,
      account: { po: 'R', mob: 'M', interests: ['Photography'] },
      travelers: [{ traits: ['High mobility', 'Nightlife'] }, { traits: ['Low mobility', 'Culture'] }],
    });
    expect(contract.pace).toMatchObject({ value: 'R', source: 'account' });
    expect(contract.mobility).toMatchObject({ value: 'L', source: 'traveler' });
    expect(contract.conflicts).toEqual(expect.arrayContaining([
      expect.stringContaining('Mobility preferences conflict'), expect.stringContaining('pace override'),
    ]));
    expect(contract.travelerInterests).toEqual(['culture', 'nightlife', 'photography']);
    expect(INTEREST_KEYS.reduce((sum, key) => sum + contract.weights[key], 0)).toBe(100);
  });

  test('reordering travelers cannot change the contract', () => {
    const travelers = [{ traits: ['Foodie', 'Low mobility'] }, { traits: ['Photography'] }, { traits: ['Cultural'] }];
    const forward = buildItineraryPreferenceContract({ ...base, travelers });
    const reverse = buildItineraryPreferenceContract({ ...base, travelers: [...travelers].reverse() });
    expect(reverse).toEqual(forward);
  });

  test('adding a restrictive mobility constraint cannot increase effective mobility', () => {
    const ranks = { L: 0, M: 1, H: 2 } as const;
    const before = buildItineraryPreferenceContract(base);
    const after = buildItineraryPreferenceContract({ ...base, travelers: [{ traits: ['Low mobility'] }] });
    expect(ranks[after.mobility.value]).toBeLessThanOrEqual(ranks[before.mobility.value]);
  });

  test('unknown free-form labels do not become hard constraints or leak into shared dimensions', () => {
    const secret = 'Vegetarian; home is 123 Private Street';
    const contract = buildItineraryPreferenceContract({ ...base, travelers: [{ traits: [secret] }] });
    expect(contract.mobility.value).toBe('H');
    expect(JSON.stringify(contract.sharedCacheDimensions)).not.toContain(secret);
    expect(contract.sharedCacheDimensions).not.toHaveProperty('travelers');
  });
});

