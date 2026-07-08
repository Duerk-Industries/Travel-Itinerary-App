import path from 'path';

export const toBashPath = (inputPath: string): string => {
  const normalized = path.resolve(inputPath).replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return normalized;
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
};

export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
