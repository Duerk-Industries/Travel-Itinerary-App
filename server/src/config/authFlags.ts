import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { logError } from '../logger';

type AuthFlags = {
  usernameLoginEnabled: boolean;
  multiEmailEnabled: boolean;
  appleOAuthEnabled: boolean;
  googleAutoLinkEnabled: boolean;
  enforceVerifiedEmailInvariant: boolean;
  uiProviderButtonsEnabled: boolean;
};

type AuthFlagsConfig = {
  flags: AuthFlags;
  reservedUsernames: string[];
};

type RawAuthFlagsConfig = {
  flags?: Record<string, unknown>;
  reservedUsernames?: unknown;
};

const CONFIG_FILENAME = 'auth-flags.yaml';
const DEFAULT_FLAGS: AuthFlags = {
  usernameLoginEnabled: false,
  multiEmailEnabled: false,
  appleOAuthEnabled: false,
  googleAutoLinkEnabled: true,
  enforceVerifiedEmailInvariant: true,
  uiProviderButtonsEnabled: true,
};

const normalizeKey = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();

const toBoolean = (raw: unknown, fallback: boolean): boolean => {
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeFlags = (raw: Record<string, unknown> | undefined): AuthFlags => {
  const source = raw ?? {};
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) {
    lookup.set(normalizeKey(key), value);
  }
  return {
    usernameLoginEnabled: toBoolean(lookup.get('usernameloginenabled'), DEFAULT_FLAGS.usernameLoginEnabled),
    multiEmailEnabled: toBoolean(lookup.get('multiemailenabled'), DEFAULT_FLAGS.multiEmailEnabled),
    appleOAuthEnabled: toBoolean(lookup.get('appleoauthenabled'), DEFAULT_FLAGS.appleOAuthEnabled),
    googleAutoLinkEnabled: toBoolean(lookup.get('googleautolinkenabled'), DEFAULT_FLAGS.googleAutoLinkEnabled),
    enforceVerifiedEmailInvariant: toBoolean(
      lookup.get('enforceverifiedemailinvariant'),
      DEFAULT_FLAGS.enforceVerifiedEmailInvariant
    ),
    uiProviderButtonsEnabled: toBoolean(lookup.get('uiproviderbuttonsenabled'), DEFAULT_FLAGS.uiProviderButtonsEnabled),
  };
};

const normalizeReservedUsernames = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of raw) {
    const value = String(item ?? '')
      .trim()
      .toLowerCase();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
};

const resolveConfigPath = (): string => {
  const override = String(process.env.AUTH_FLAGS_CONFIG_PATH ?? '').trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  const candidates = [
    path.resolve(process.cwd(), 'config', CONFIG_FILENAME),
    path.resolve(process.cwd(), 'server', 'config', CONFIG_FILENAME),
    path.resolve(__dirname, '../../config', CONFIG_FILENAME),
    path.resolve(__dirname, '../../../config', CONFIG_FILENAME),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
};

export const getResolvedAuthFlagsConfigPath = (): string => resolveConfigPath();
export const doesAuthFlagsConfigExist = (): boolean => fs.existsSync(resolveConfigPath());

let cachedConfig: AuthFlagsConfig | null = null;
let cachedPath: string | null = null;
let cachedMtimeMs = -1;

const loadConfigFromFile = (): AuthFlagsConfig => {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return { flags: { ...DEFAULT_FLAGS }, reservedUsernames: [] };
  }
  const stat = fs.statSync(configPath);
  if (
    cachedConfig &&
    cachedPath === configPath &&
    Number.isFinite(cachedMtimeMs) &&
    cachedMtimeMs === stat.mtimeMs
  ) {
    return cachedConfig;
  }
  try {
    const rawText = fs.readFileSync(configPath, 'utf8');
    const parsed = (parse(rawText) ?? {}) as RawAuthFlagsConfig;
    cachedConfig = {
      flags: normalizeFlags(parsed.flags),
      reservedUsernames: normalizeReservedUsernames(parsed.reservedUsernames),
    };
    cachedPath = configPath;
    cachedMtimeMs = stat.mtimeMs;
    return cachedConfig;
  } catch (err) {
    logError(`[auth-flags] Failed to load YAML config from ${configPath}`, err);
    return { flags: { ...DEFAULT_FLAGS }, reservedUsernames: [] };
  }
};

export const getAuthFlag = (flag: keyof AuthFlags): boolean => {
  const config = loadConfigFromFile();
  return config.flags[flag];
};

export const getAuthFlags = (): AuthFlags => {
  const config = loadConfigFromFile();
  return { ...config.flags };
};

export const getReservedUsernames = (): string[] => {
  const config = loadConfigFromFile();
  return [...config.reservedUsernames];
};
