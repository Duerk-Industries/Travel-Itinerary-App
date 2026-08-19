import { canShowItineraryDocumentImport } from '../components/ItineraryDocumentImport';

describe('itinerary document import visibility', () => {
  test.each(['premium', 'pro'])('shows for %s on web when enabled', (userTier) => {
    expect(canShowItineraryDocumentImport({ featureEnabled: true, userTier, platform: 'web' })).toBe(true);
  });

  test('hides when the feature flag is disabled', () => {
    expect(canShowItineraryDocumentImport({ featureEnabled: false, userTier: 'premium', platform: 'web' })).toBe(false);
  });

  test.each(['free', '', null])('hides for a non-premium tier (%s)', (userTier) => {
    expect(canShowItineraryDocumentImport({ featureEnabled: true, userTier, platform: 'web' })).toBe(false);
  });

  test('hides on native and for read-only followers', () => {
    expect(canShowItineraryDocumentImport({ featureEnabled: true, userTier: 'premium', platform: 'ios' })).toBe(false);
    expect(canShowItineraryDocumentImport({ featureEnabled: true, userTier: 'premium', platform: 'web', readOnly: true })).toBe(false);
  });
});
