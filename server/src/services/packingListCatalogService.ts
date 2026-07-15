import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizePackingLabel } from '../utils/packingListNormalize';
import { listPackingPresetsV2, syncPackingPresetCatalogV2 } from '../db';

export type ParsedPackingPresetItem = {
  category: string;
  label: string;
  normalizedLabel: string;
  position: number;
};

export type ParsedPackingPreset = {
  key: string;
  label: string;
  description: string;
  gendered: boolean;
  items: ParsedPackingPresetItem[];
  contentHash: string;
  filename: string;
};

const allowedFrontmatter = new Set(['key', 'label', 'description', 'gendered']);
let activeCatalogCache: ParsedPackingPreset[] | null = null;

const parseBoolean = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1'].includes(normalized)) return true;
  if (['false', 'no', '0'].includes(normalized)) return false;
  throw new Error(`gendered must be boolean, received ${value}`);
};

const stripComment = (line: string): string => line.replace(/<!--.*?-->/g, '').trim();

export const parsePresetMarkdown = (raw: string, filename: string, generalLabels: Iterable<string> = []): ParsedPackingPreset => {
  if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) throw new Error('Packing preset markdown exceeds 256 KB');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw new Error('Packing preset must start with YAML frontmatter');
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing < 0) throw new Error('Packing preset frontmatter is not closed');
  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closing)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) throw new Error(`Invalid frontmatter line: ${line}`);
    const [, key, value] = match;
    if (!allowedFrontmatter.has(key)) throw new Error(`Unknown frontmatter key: ${key}`);
    frontmatter[key] = value.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const expectedKey = path.basename(filename, path.extname(filename));
  const key = frontmatter.key ?? '';
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || key !== expectedKey) {
    throw new Error(`Preset key ${key || '(missing)'} must match filename ${expectedKey}`);
  }
  const label = frontmatter.label?.trim();
  if (!label) throw new Error('Preset label is required');
  const categories: ParsedPackingPresetItem[] = [];
  let category = 'General';
  for (const rawLine of lines.slice(closing + 1)) {
    const line = stripComment(rawLine);
    if (!line) continue;
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      category = heading[1].trim();
      if (!category) throw new Error('Preset category cannot be empty');
      continue;
    }
    if (!line.startsWith('- ')) throw new Error(`Unexpected markdown content: ${rawLine}`);
    const itemLabel = line.slice(2).trim();
    const normalizedLabel = normalizePackingLabel(itemLabel);
    if (!normalizedLabel) throw new Error('Preset item label cannot be empty');
    categories.push({ category, label: itemLabel, normalizedLabel, position: categories.length });
  }
  if (!categories.length) throw new Error('Preset must contain at least one item');
  const duplicate = categories.find((item, index) => categories.findIndex((other) => other.normalizedLabel === item.normalizedLabel) !== index);
  if (duplicate) throw new Error(`Duplicate preset item: ${duplicate.label}`);
  if (key !== 'general') {
    const general = new Set([...generalLabels].map(normalizePackingLabel));
    const collision = categories.find((item) => general.has(item.normalizedLabel));
    if (collision) throw new Error(`Preset item duplicates General: ${collision.label}`);
  }
  return {
    key,
    label,
    description: frontmatter.description?.trim() ?? '',
    gendered: frontmatter.gendered === undefined ? false : parseBoolean(frontmatter.gendered),
    items: categories,
    contentHash: crypto.createHash('sha256').update(raw, 'utf8').digest('hex'),
    filename,
  };
};

export const getPackingListDataDir = (): string => {
  // Runtime assets are copied beside compiled server code on deploy, while
  // tsx/Jest execute from server/src. Keep both layouts supported.
  const candidates = [
    path.resolve(__dirname, '../data/packing_lists'),
    path.resolve(__dirname, '../../data/packing_lists'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

export const readPackingPresetFiles = (dataDir = getPackingListDataDir()): Array<{ filename: string; raw: string }> => {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ filename: entry.name, raw: fs.readFileSync(path.join(dataDir, entry.name), 'utf8') }));
};

export const parsePackingPresetDirectory = (dataDir = getPackingListDataDir()): ParsedPackingPreset[] => {
  const files = readPackingPresetFiles(dataDir);
  const generalFile = files.find((file) => file.filename === 'general.md');
  if (!generalFile) throw new Error('general.md is required');
  const general = parsePresetMarkdown(generalFile.raw, generalFile.filename);
  const generalLabels = general.items.map((item) => item.normalizedLabel);
  return files.map((file) => parsePresetMarkdown(file.raw, file.filename, generalLabels));
};

/**
 * Deploy-time catalog synchronization. The markdown files are the source of
 * truth for shipped presets; the database stores the parsed, queryable copy.
 */
export const syncPackingPresetCatalogFromDisk = async (): Promise<ParsedPackingPreset[]> => {
  const presets = parsePackingPresetDirectory();
  await syncPackingPresetCatalogV2(presets);
  activeCatalogCache = null;
  return presets;
};

export const invalidatePackingPresetCatalogCache = (): void => {
  activeCatalogCache = null;
};

export const getActivePresetCatalog = async (): Promise<ParsedPackingPreset[]> => {
  if (activeCatalogCache) return activeCatalogCache;
  const presets = await listPackingPresetsV2();
  activeCatalogCache = presets.map((preset) => ({
    key: preset.key,
    label: preset.label,
    description: preset.description,
    gendered: preset.gendered,
    items: preset.items.map((item) => ({ ...item, normalizedLabel: normalizePackingLabel(item.label) })),
    contentHash: preset.contentHash,
    filename: preset.sourceFilename,
  }));
  return activeCatalogCache;
};
