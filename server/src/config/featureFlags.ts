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

const DEFAULT_CONFIG_RELATIVE_PATH = '../../config/feature-flags.yaml';

const resolveConfigPath = (): string => {
  const override = String(process.env.FEATURE_FLAGS_CONFIG_PATH ?? '').trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.resolve(__dirname, DEFAULT_CONFIG_RELATIVE_PATH);
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
