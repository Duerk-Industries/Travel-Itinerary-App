/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';

const appTsxPath = path.join(path.resolve(__dirname, '..'), 'App.tsx');

describe('AI Ops deep links', () => {
  const source = fs.readFileSync(appTsxPath, 'utf8');

  it('declares flat admin AI Ops routes for every nested section', () => {
    for (const route of [
      'admin/ai-ops',
      'admin/ai-ops/providers',
      'admin/ai-ops/experiments',
      'admin/ai-ops/recommendations',
      'admin/ai-ops/captures',
      'admin/ai-ops/parser-quality',
      'admin/ai-ops/shadow-replay',
      'admin/ai-ops/executive',
      'admin/ai-ops/runtime-settings',
      'admin/ai-ops/ai-audit-log',
    ]) {
      expect(source).toContain(route);
    }
  });

  it('threads nested AI Ops section changes back through navigation', () => {
    expect(source).toContain('onAiOpsSectionChange');
    expect(source).toContain('aiOpsScreenBySection');
  });
});
