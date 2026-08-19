import { renderActivityBlocksForPrompt } from '../src/services/itineraryPromptPlanService';
import type { ActivityBlock } from '../src/schemas/itineraryCacheSchemas';

const block: ActivityBlock = {
  block_id: 'blk-tokyo-tower',
  location_id: 'tokyo',
  zone_id: 'minato',
  role: 'anchor',
  category: 'landmark',
  title: 'Tokyo Tower',
  name_local: '東京タワー',
  name_script: 'Tokyo Tawa',
  copy: { teaser: 't', body: 'b', insider_tip: 'i', etiquette: null, priority_signal: 'dont_skip' },
  timing: { optimal_arrival: null, hard_deadline: null, time_box: null, after_dark_value: true },
  cost_band: { currency: 'JPY', low: 0, high: 0, note: null },
  duration_minutes: { typical: 60, min: 30, max: 90 },
  energy_cost: 2,
  source: 'curated',
  last_verified: '2026-08-01',
};

describe('renderActivityBlocksForPrompt', () => {
  test('returns "none" for an empty block list', () => {
    expect(renderActivityBlocksForPrompt([])).toBe('none');
  });

  // Regression: name_script is a romanization/transliteration of name_local, not a second
  // translated display name (see the doc comment on ActivityBlockSchema.name_script and
  // docs/implementation_plans/itinerary-narrative-depth-and-validation.md's multilingual-names
  // recommendation). Labeling it "travelerLanguageName" in the prompt told the LLM it was a
  // translation, which it is not — a romanization is still the same name a local taxi driver
  // or map search expects, unlike a translated name.
  test('labels name_script as romanizedName, not travelerLanguageName, and preserves name_local separately', () => {
    const payload = JSON.parse(renderActivityBlocksForPrompt([block]));
    expect(payload[0]).toMatchObject({
      localName: '東京タワー',
      romanizedName: 'Tokyo Tawa',
    });
    expect(payload[0]).not.toHaveProperty('travelerLanguageName');
  });

  test('caps the rendered block list at 40 entries', () => {
    const blocks = Array.from({ length: 45 }, (_, i) => ({ ...block, block_id: `blk-${i}`, title: `Block ${i}` }));
    const payload = JSON.parse(renderActivityBlocksForPrompt(blocks));
    expect(payload).toHaveLength(40);
  });
});
