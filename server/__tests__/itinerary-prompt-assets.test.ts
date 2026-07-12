import fs from 'node:fs';
import path from 'node:path';

const promptsRoot = path.resolve(__dirname, '../prompts');

describe('itinerary prompt asset lifecycle', () => {
  const superseded = [
    'narrative_expansion_prompt.md',
    'structural_optimizer_prompt.md',
    'validator_and_formatter_prompt.md',
  ];

  test.each(superseded)('%s is prominently marked as non-runtime documentation', (name) => {
    const content = fs.readFileSync(path.join(promptsRoot, name), 'utf8');
    expect(content).toMatch(/Superseded — documentation only/i);
    expect(content).toMatch(/not loaded by the application/i);
  });

  test('the runtime service does not reference superseded prompt filenames', () => {
    const service = fs.readFileSync(path.resolve(__dirname, '../src/services/itineraryPromptPlanService.ts'), 'utf8');
    for (const name of superseded) expect(service).not.toContain(name);
  });

  test('plan.md retains explicit stage token targets used by regression tests', () => {
    const plan = fs.readFileSync(path.join(promptsRoot, 'plan.md'), 'utf8');
    expect(plan).toContain('**Prompt 0:** <350 tokens');
    expect(plan).toContain('**Prompt 1:** <450 tokens');
    expect(plan).toContain('**Prompt 2:** <600 tokens per 7 days');
    expect(plan).toContain('**Prompt 3:** <350 tokens');
  });
});

