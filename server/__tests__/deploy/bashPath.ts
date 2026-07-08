import path from 'path';
import { execFileSync } from 'child_process';

let cachedDrivePrefix: string | null = null;

const getBashDrivePrefix = (): string => {
  if (cachedDrivePrefix) return cachedDrivePrefix;
  try {
    cachedDrivePrefix = execFileSync(
      'bash',
      ['-lc', 'if [ -d /mnt/c ]; then printf /mnt; elif [ -d /c ]; then printf ""; else printf /mnt; fi'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    cachedDrivePrefix = '/mnt';
  }
  return cachedDrivePrefix;
};

export const toBashPath = (inputPath: string): string => {
  const normalized = path.resolve(inputPath).replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return normalized;
  return `${getBashDrivePrefix()}/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
};

export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
