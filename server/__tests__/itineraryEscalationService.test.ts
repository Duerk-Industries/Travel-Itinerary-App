jest.mock('../src/config/apiLimits', () => ({
  getApiCacheSetting: jest.fn((group: string, key: string) => {
    const values: Record<string, number> = {
      escalationEnabled: 1,
      escalationMinDays: 10,
      escalationMinDestinations: 3,
      escalationMinCoveragePercent: 0.5,
      escalationModel: 1,
    };
    return group === 'itineraryPlan' ? values[key] : undefined;
  }),
}));

import { decideItineraryEscalation } from '../src/services/itineraryEscalationService';

describe('itineraryEscalationService', () => {
  it('escalates only the compatible p2 provider for configured risk triggers', () => {
    expect(decideItineraryEscalation({
      days: 14,
      destinationCount: 1,
      shortlistCoverage: 1,
      provider: 'openai',
    })).toEqual({
      enabled: true,
      shouldEscalate: true,
      model: 'gpt-4o',
      reasons: ['long_trip'],
    });
  });

  it('collects multiple reasons without escalating incompatible providers', () => {
    const decision = decideItineraryEscalation({
      days: 4,
      destinationCount: 3,
      shortlistCoverage: 0.25,
      repairFailed: true,
      provider: 'anthropic',
    });
    expect(decision.reasons).toEqual(['many_destinations', 'low_shortlist_coverage', 'repair_failure']);
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.model).toBeNull();
  });

  it('does not escalate when no quality trigger is present', () => {
    expect(decideItineraryEscalation({
      days: 3,
      destinationCount: 1,
      shortlistCoverage: 1,
      provider: 'openai',
    }).shouldEscalate).toBe(false);
  });
});
