import fs from 'fs';
import path from 'path';
import { logError } from '../../logger';

export type TravelFieldRule = {
  required: boolean;
  typicallyPresent: boolean;
  format: string | null;
};

export type TravelFieldSpec = {
  version: number;
  formats: Record<string, { pattern: string; description?: string }>;
  itemTypes: Record<string, {
    fields: Record<string, TravelFieldRule>;
    crossFieldChecks?: Array<{ rule: string; onFail: string }>;
  }>;
};

const SPEC_FILENAME = 'travel-field-spec.json';
let cachedSpec: TravelFieldSpec | null = null;

const resolveSpecPath = (): string => {
  const override = String(process.env.TRAVEL_FIELD_SPEC_PATH ?? '').trim();
  if (override) return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  const candidates = [
    path.resolve(process.cwd(), 'config', SPEC_FILENAME),
    path.resolve(process.cwd(), 'server', 'config', SPEC_FILENAME),
    path.resolve(__dirname, '../../../config', SPEC_FILENAME),
    path.resolve(__dirname, '../../../../config', SPEC_FILENAME),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

export const loadTravelFieldSpec = (): TravelFieldSpec => {
  if (cachedSpec) return cachedSpec;
  const specPath = resolveSpecPath();
  try {
    cachedSpec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as TravelFieldSpec;
  } catch (err) {
    logError(`[ai-eval] Failed to load travel field spec from ${specPath}`, err);
    cachedSpec = { version: 1, formats: {}, itemTypes: {} };
  }
  return cachedSpec;
};

export const clearTravelFieldSpecCacheForTesting = (): void => {
  cachedSpec = null;
};
