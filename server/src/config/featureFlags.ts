import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { logError } from '../logger';

export type FlagSeed = {
  enabled: boolean;
  description?: string;
};

type RawFeatureFlagsConfig = {
  flags?: Record<string, unknown>;
};

const CONFIG_FILENAME = 'feature-flags.yaml';

const resolveConfigPath = (): string => {
  const override = String(process.env.FEATURE_FLAGS_CONFIG_PATH ?? '').trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  // Try multiple candidate locations to work regardless of cwd or compiled vs source.
  const candidates = [
    path.resolve(process.cwd(), 'config', CONFIG_FILENAME),            // cwd = server/
    path.resolve(process.cwd(), 'server', 'config', CONFIG_FILENAME),  // cwd = repo root
    path.resolve(__dirname, '../../config', CONFIG_FILENAME),           // tsx: src/config/
    path.resolve(__dirname, '../../../config', CONFIG_FILENAME),        // dist: dist/src/config/
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
};

export const getResolvedFeatureFlagsConfigPath = (): string => resolveConfigPath();
export const doesFeatureFlagsConfigExist = (): boolean => fs.existsSync(resolveConfigPath());

const normalizeFlagEntry = (raw: unknown): FlagSeed => {
  if (typeof raw !== 'object' || raw === null) {
    return { enabled: true };
  }
  const obj = raw as Record<string, unknown>;
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const description = typeof obj.description === 'string' ? obj.description : undefined;
  return { enabled, description };
};

const loadConfigFromFile = (): Record<string, FlagSeed> => {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const rawText = fs.readFileSync(configPath, 'utf8');
    const parsed = (parse(rawText) ?? {}) as RawFeatureFlagsConfig;
    const flags: Record<string, FlagSeed> = {};
    for (const [key, value] of Object.entries(parsed.flags ?? {})) {
      const normalized = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
      if (!normalized) continue;
      flags[normalized] = normalizeFlagEntry(value);
    }
    return flags;
  } catch (err) {
    logError(`[feature-flags] Failed to load YAML config from ${configPath}`, err);
    return {};
  }
};

// Loaded once at startup — not cached per-call since this is seed-only.
export const getFeatureFlagSeeds = (): Record<string, FlagSeed> => loadConfigFromFile();
