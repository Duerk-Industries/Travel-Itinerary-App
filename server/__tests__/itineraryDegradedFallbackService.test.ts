import { chooseSafeItineraryMarkdown, hasSafeItineraryMarkdown } from '../src/services/itineraryDegradedFallbackService';

describe('itineraryDegradedFallbackService', () => {
  it('accepts rendered markdown with ordinary itinerary content', () => {
    expect(hasSafeItineraryMarkdown('## Day 1\n- Morning: museum')).toBe(true);
  });

  it.each([
    '',
    'undefined',
    '{{PROVIDER_ERROR}}',
    'Error: OpenAI unavailable',
    'GetYourGuide placeholder unavailable',
  ])('rejects unsafe provider output: %s', (value) => {
    expect(hasSafeItineraryMarkdown(value)).toBe(false);
  });

  it('chooses the deterministic fallback when rendering is unsafe', () => {
    expect(chooseSafeItineraryMarkdown('Error: timeout', '## Day 1\n- Estimated: walk')).toEqual({
      markdown: '## Day 1\n- Estimated: walk',
      fallbackUsed: true,
    });
  });
});
