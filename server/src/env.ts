import fs from 'fs';
import path from 'path';

type EnvOptions = {
  defaultValue?: string;
  required?: boolean;
};

const trimTrailingLineBreaks = (value: string): string => value.replace(/[\r\n]+$/, '');

export const getEnvValue = (key: string, options: EnvOptions = {}): string | undefined => {
  const fileKey = `${key}_FILE`;
  const filePath = process.env[fileKey];
  if (filePath && filePath.length > 0 && fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = trimTrailingLineBreaks(raw);
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const direct = process.env[key];
  if (direct && direct.length > 0) {
    return trimTrailingLineBreaks(direct);
  }

  if (options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  if (options.required) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return undefined;
};

export const getBackendUrl = (defaultValue?: string): string | undefined =>
  getEnvValue('BACKEND_URL') ??
  getEnvValue('WEB_URL') ??
  defaultValue;

type EnvFlagOptions = {
  defaultValue?: boolean;
};

export const getEnvFlag = (key: string, options: EnvFlagOptions = {}): boolean => {
  const raw = getEnvValue(key);
  if (!raw) {
    return options.defaultValue ?? false;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return options.defaultValue ?? false;
};

export const hasRunLocalFlag = (filePath: string): boolean => {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return /^\s*RUN_LOCAL\s*=\s*['"]?1['"]?\s*(?:#.*)?$/m.test(raw);
};

export const isLocalEnv = (): boolean => {
  if (process.env.K_SERVICE) {
    return false;
  }
  if (getEnvFlag('RUN_LOCAL')) {
    return true;
  }
  // Allow E2E test runners to signal local-mode without requiring a .local_env file.
  if (getEnvFlag('E2E_MODE')) {
    return true;
  }
  // Check for a marker file that only exists in the local dev environment.
  // Support both server/.local_env and repo-root/.local_env because local scripts
  // and server startup load from both locations.
  return (
    hasRunLocalFlag(path.resolve(__dirname, '../.local_env')) ||
    hasRunLocalFlag(path.resolve(__dirname, '../../.local_env'))
  );
};
