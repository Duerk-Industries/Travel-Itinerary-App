import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const baseDir = path.join(os.tmpdir(), 'travel-itinerary-ingestion');

const ensureBaseDir = async (): Promise<void> => {
  await fs.promises.mkdir(baseDir, { recursive: true });
};

export const writeTempBytes = async (filename: string, bytes: Buffer): Promise<string> => {
  await ensureBaseDir();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(baseDir, `${randomUUID()}_${safeName}`);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
};

export const readTempBytes = async (filePath: string): Promise<Buffer> => fs.promises.readFile(filePath);

export const deleteTempBytes = async (filePath: string | null | undefined): Promise<void> => {
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch(() => undefined);
};
