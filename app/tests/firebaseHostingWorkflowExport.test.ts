/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(appRoot, '..');

describe('Firebase Hosting workflow web export', () => {
  it.each([
    'firebase-hosting-merge.yml',
    'firebase-hosting-pull-request.yml',
  ])('%s uses the guarded app export script', (workflow) => {
    const source = fs.readFileSync(path.join(workspaceRoot, '.github/workflows', workflow), 'utf8');
    expect(source).toContain('npm --prefix app run export:web -- --output-dir ../dist');
    expect(source).not.toMatch(/npx\s+expo\s+export/);
  });
});

