import fs from 'fs';
import path from 'path';

const readPrompt = (fileName: string): { sys: string; usr: string } => {
  const promptPath = path.join(__dirname, '..', 'prompts', 'prompts', fileName);
  return JSON.parse(fs.readFileSync(promptPath, 'utf8'));
};

describe('itinerary prompt specificity guardrails', () => {
  it('enforces destination-specific activities and no generic events in p2/p3', () => {
    const p2 = readPrompt('p2_days.json');
    const p3 = readPrompt('p3_validate.json');

    expect(p2.usr).toContain('Specificity requirement');
    expect(p2.usr).toContain('do NOT add generic event/festival suggestions');
    expect(p2.usr).toContain('Tours/day trips must name a specific place or route anchor');
    expect(p3.usr).toContain('remove generic festival/cultural-event suggestions');
    expect(p3.usr).toContain('must include a specific anchor');
  });

  it('preserves specific names during markdown rendering', () => {
    const p4 = readPrompt('p4_render_md.json');

    expect(p4.sys).toContain('Preserve destination-specific names from input JSON when plausible');
    expect(p4.sys).toContain('Do not replace specific input names with vague placeholders');
    expect(p4.usr).toContain('Avoid vague terms like "nearby" or "local area"');
  });
});
