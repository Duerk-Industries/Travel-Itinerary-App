/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { parseInstructionMarkdown, type ItineraryInstructionPhase } from '../src/services/itineraryInstructionService';

// Parses the same .md files itineraryInstructionService.ts actually loads at runtime (the
// prompts/prompts/*.json siblings were an unused, stale duplicate of this content and were
// deleted — see server/prompts/README.md).
const readPrompt = (phase: ItineraryInstructionPhase, fileName: string): { sys: string; usr: string } => {
  const promptPath = path.join(__dirname, '..', 'prompts', 'prompts', fileName);
  return parseInstructionMarkdown(phase, fs.readFileSync(promptPath, 'utf8'));
};

describe('itinerary prompt specificity guardrails', () => {
  it('enforces destination-specific activities and no generic events in p2/p3', () => {
    const p2 = readPrompt('p2', 'p2_days.md');
    const p3 = readPrompt('p3', 'p3_validate.md');

    expect(p2.usr).toContain('Specificity requirement');
    expect(p2.usr).toContain('do NOT add generic event/festival suggestions');
    expect(p2.usr).toContain('Tours/day trips must name a specific place or route anchor');
    expect(p3.usr).toContain('remove generic festival/cultural-event suggestions');
    expect(p3.usr).toContain('must include a specific anchor');
  });

  it('preserves specific names during markdown rendering', () => {
    const p4 = readPrompt('p4', 'p4_render_md.md');

    expect(p4.sys).toContain('Preserve destination-specific names from input JSON when plausible');
    expect(p4.sys).toContain('Do not replace specific input names with vague placeholders');
    expect(p4.usr).toContain('Avoid vague terms like "nearby" or "local area"');
  });
});
