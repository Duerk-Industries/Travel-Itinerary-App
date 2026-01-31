import fs from 'fs';
import path from 'path';

type EnvOptions = {
  defaultValue?: string;
  required?: boolean;
};

export const getEnvValue = (key: string, options: EnvOptions = {}): string | undefined => {
  const fileKey = `${key}_FILE`;
  const filePath = process.env[fileKey];
  if (filePath && filePath.length > 0 && fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.replace(/[\r\n]+$/, '');
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const direct = process.env[key];
  if (direct && direct.length > 0) {
    return direct;
  }

  if (options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  if (options.required) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return undefined;
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
  // Check for a marker file that only exists in the local dev environment.
  return hasRunLocalFlag(path.resolve(__dirname, '../.local_env'));
};
