/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { describe, expect, test } from '@jest/globals';

// implementation-plan-ux-remediation.md, Initiative F: a standing guard
// against internal/developer jargon leaking into traveler-facing copy — the
// class of bug behind "These map directly to prompt-plan `tt/ut` fields for
// itinerary generation." having shipped in two screens (createTripWizard.tsx,
// traits.tsx) and only being caught by manually walking every screen.
//
// This repo has no ESLint config (`npm run lint` is a `tsc` alias — see
// app/package.json / server/package.json), so a custom ESLint rule isn't a
// fit here. A plain Jest test that scans the same source tree accomplishes
// the same "catch it in CI, not by hand" goal with the tooling this project
// already runs on every PR.

const APP_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['tabs', 'components'];
const EXCLUDED_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.d.ts'];

// Exact phrases already found leaking into user-facing copy. Regression guard
// for the specific bug fixed in the field review — if one of these ever
// reappears, something regressed or was copy-pasted forward from a code
// comment/internal doc into UI copy.
//
// Deliberately excludes anything that's also a legitimate code identifier in
// this codebase (e.g. the `wizardPromptTraits` state variable itself) — this
// scan is a raw substring search over whole files, not JSX-aware, so a token
// that's simultaneously real jargon *and* a real variable name would flag its
// own non-buggy declaration. Every phrase below is a string ('/' or a space
// makes it unrepresentable as a bare identifier) so it can only match inside
// an actual string literal.
const KNOWN_BAD_PHRASES = ['prompt-plan', 'tt/ut'];

const collectSourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (!entry.isFile()) return [];
    if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) return [];
    if (EXCLUDED_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) return [];
    return [fullPath];
  });
};

const allSourceFiles = SCAN_DIRS.flatMap((dir) => collectSourceFiles(path.join(APP_ROOT, dir)));

describe('User-facing copy guard', () => {
  test('scans a non-trivial number of app source files (sanity check the scan itself runs)', () => {
    expect(allSourceFiles.length).toBeGreaterThan(20);
  });

  test.each(KNOWN_BAD_PHRASES)('the phrase %j never reappears in app/tabs or app/components', (phrase) => {
    const offenders = allSourceFiles.filter((file) => fs.readFileSync(file, 'utf8').includes(phrase));
    expect(offenders).toEqual([]);
  });

  test('fixture: the phrase check flags a known-bad sample and passes on ordinary copy', () => {
    const badSample = 'These map directly to prompt-plan `tt/ut` fields for itinerary generation.';
    const goodSample = "Tell us how your group likes to travel and we'll shape the AI itinerary around it.";

    expect(KNOWN_BAD_PHRASES.some((phrase) => badSample.includes(phrase))).toBe(true);
    expect(KNOWN_BAD_PHRASES.some((phrase) => goodSample.includes(phrase))).toBe(false);
  });
});
