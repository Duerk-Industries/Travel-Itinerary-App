/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimeDataPath } from '../src/utils/runtimeDataPath';

describe('runtime data path resolution', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-data-path-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('finds data copied beside compiled dist files', () => {
    const moduleDir = path.join(tempRoot, 'dist', 'services');
    const dataPath = path.join(tempRoot, 'dist', 'data', 'destinations.csv');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, 'data', 'utf8');

    expect(resolveRuntimeDataPath('destinations.csv', undefined, moduleDir)).toBe(dataPath);
  });

  it('falls back to the source-tree data directory', () => {
    const moduleDir = path.join(tempRoot, 'server', 'src', 'services');
    const dataPath = path.join(tempRoot, 'server', 'data', 'destinations.csv');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, 'data', 'utf8');

    expect(resolveRuntimeDataPath('destinations.csv', undefined, moduleDir)).toBe(dataPath);
  });
});
