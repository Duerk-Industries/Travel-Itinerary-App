/// <reference types="jest" />

import { aiOpsScreenBySection, linking } from '../navigationConfig';
import type { AiOpsSection } from '../components/admin/aiOps/types';

const aiOpsSections: AiOpsSection[] = [
  'overview',
  'providers',
  'experiments',
  'recommendations',
  'captures',
  'parser-quality',
  'shadow-replay',
  'executive',
  'runtime-settings',
  'ai-audit-log',
];

describe('AI Ops deep links', () => {
  const screens = linking.config!.screens as Record<string, string>;

  it('covers every AiOpsSection value with no gaps', () => {
    expect(Object.keys(aiOpsScreenBySection).sort()).toEqual([...aiOpsSections].sort());
  });

  it('maps every AI Ops section to a screen with a declared, unique path in the real linking config', () => {
    const seenPaths = new Set<string>();
    for (const section of aiOpsSections) {
      const screen = aiOpsScreenBySection[section];
      expect(screen).toBeTruthy();

      const path = screens[screen];
      expect(path).toBeTruthy();
      expect(seenPaths.has(path)).toBe(false);
      seenPaths.add(path);
    }
  });

  it('nests every non-overview AI Ops path under admin/ai-ops/ and roots the overview at admin/ai-ops', () => {
    for (const section of aiOpsSections) {
      const path = screens[aiOpsScreenBySection[section]];
      if (section === 'overview') {
        expect(path).toBe('admin/ai-ops');
      } else {
        expect(path).toBe(`admin/ai-ops/${section}`);
      }
    }
  });
});
