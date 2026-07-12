import { injectMustSeesIntoCachedFragments } from '../src/services/fragmentInjectorService';
import { runShadowComparison, shouldRunItineraryShadow } from '../src/services/itineraryShadowPlanningService';

describe('Phase 4 fragment injection and shadow assignment', () => {
  test('injects a must-see onto the day already using its nearest pod', () => {
    const itinerary = { dy: [
      { b: 'Paris', it: [['M', 'A', 'Louvre Museum']] as Array<[string, string, string]> },
      { b: 'Paris', it: [['M', 'O', 'Montmartre Walk']] as Array<[string, string, string]> },
    ] };
    const entry = (name: string) => ({ id: name, destinationKey: 'paris', destinationDisplayName: 'Paris', name, rank: 1, activityType: 'Open Access' as const, interestTags: ['culture'] as any, updatedAt: 'x' });
    const result = injectMustSeesIntoCachedFragments({ itinerary, mustSees: [{ name: 'Musée de l’Orangerie', destinationName: 'Paris' }], podsByDestination: { Paris: [{ id: 'pod-1', destination: 'Paris', kind: 'geographic', items: [entry('Louvre Museum'), entry('Musée de l’Orangerie')], centroid: { lat: 1, lon: 1 }, radiusKm: 1, distanceGuaranteed: true }] } });
    expect(result.dy[0].it.some((item) => item[2] === 'Musée de l’Orangerie')).toBe(true);
    expect(itinerary.dy[0].it.some((item) => item[2] === 'Musée de l’Orangerie')).toBe(false);
  });

  test('shadow selection is stable and judge invocation is opt-in by sample', async () => {
    expect(shouldRunItineraryShadow('same-seed', 5)).toBe(shouldRunItineraryShadow('same-seed', 5));
    const judge = jest.fn(async () => ({ winner: 'improved' as const, transitRealism: 0.9, preferenceAlignment: 0.8, rationale: 'better' }));
    expect(await runShadowComparison({ seed: 'x', legacy: {}, improved: {}, judge, samplePercent: 0 })).toBeNull();
    expect(await runShadowComparison({ seed: 'x', legacy: {}, improved: {}, judge, samplePercent: 100 })).toMatchObject({ winner: 'improved' });
    expect(judge).toHaveBeenCalledTimes(1);
  });
});

