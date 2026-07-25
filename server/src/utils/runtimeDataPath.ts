import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve data files in both layouts used by the server:
 * - tsx/Jest: server/src/... -> server/data/...
 * - compiled runtime: /app/dist/... -> /app/dist/data/...
 */
export const resolveRuntimeDataPath = (
  relativePath: string,
  configuredPath?: string,
  moduleDir: string = __dirname
): string => {
  if (configuredPath?.trim()) return path.resolve(configuredPath);

  const candidates = [
    path.resolve(moduleDir, '../data', relativePath),
    path.resolve(moduleDir, '../../data', relativePath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};
