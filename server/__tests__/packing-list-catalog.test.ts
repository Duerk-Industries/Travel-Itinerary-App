import fs from 'node:fs';
import path from 'node:path';
import { parsePackingPresetDirectory, parsePresetMarkdown } from '../src/services/packingListCatalogService';

describe('packing list catalog parser', () => {
  it('validates every checked-in preset file', () => {
    const presets = parsePackingPresetDirectory(path.resolve(__dirname, '../data/packing_lists'));
    expect(presets.length).toBeGreaterThanOrEqual(7);
    expect(presets.map((preset) => preset.key)).toContain('general');
  });

  it('rejects duplicate labels and General collisions', () => {
    const duplicate = `---\nkey: sample\nlabel: Sample\n---\n## Items\n- Hat\n- hat`;
    expect(() => parsePresetMarkdown(duplicate, 'sample.md')).toThrow(/Duplicate/);
    const collision = `---\nkey: beach\nlabel: Beach\n---\n## Items\n- Adapter`;
    expect(() => parsePresetMarkdown(collision, 'beach.md', ['adapter'])).toThrow(/General/);
  });
});
