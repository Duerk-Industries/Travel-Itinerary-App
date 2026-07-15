import fs from 'fs';
import path from 'path';
import { getAdminSetting, setAdminSetting, writeAuditLog } from '../db';
import { logError } from '../logger';

export const ITINERARY_INSTRUCTION_PHASES = ['p0', 'p1', 'p2', 'p3', 'p4'] as const;
export type ItineraryInstructionPhase = (typeof ITINERARY_INSTRUCTION_PHASES)[number];

export type ItineraryPromptTemplate = {
  id: string;
  sys: string;
  usr: string;
};

export type ItineraryInstructionDocument = {
  phase: ItineraryInstructionPhase;
  markdown: string;
  template: ItineraryPromptTemplate;
  source: 'default' | 'admin';
  updatedAt?: string | null;
  updatedBy?: string | null;
};

const PROMPTS_ROOT = path.resolve(__dirname, '../../prompts');
const ADMIN_SETTING_KEY = 'itinerary_generation_instruction_documents';

const PHASE_FILES: Record<ItineraryInstructionPhase, string> = {
  p0: 'p0_norm.md',
  p1: 'p1_route.md',
  p2: 'p2_days.md',
  p3: 'p3_validate.md',
  p4: 'p4_render_md.md',
};

const PHASE_TEMPLATE_IDS: Record<ItineraryInstructionPhase, string> = {
  p0: 'p0_norm',
  p1: 'p1_route',
  p2: 'p2_days',
  p3: 'p3_validate',
  p4: 'p4_render_md',
};

type StoredInstructionSet = {
  schemaVersion: 1;
  phases: Partial<Record<ItineraryInstructionPhase, {
    markdown: string;
    updatedAt: string;
    updatedBy: string;
  }>>;
};

const phaseSet = new Set<string>(ITINERARY_INSTRUCTION_PHASES);
let defaultMarkdownCache: Partial<Record<ItineraryInstructionPhase, string>> = {};

export const parseInstructionMarkdown = (phase: ItineraryInstructionPhase, markdown: string): ItineraryPromptTemplate => {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error(`Instruction markdown for ${phase} is empty`);

  const systemMatch = text.match(/^##\s+System\s*$/im);
  const userMatch = text.match(/^##\s+User\s*$/im);
  if (!systemMatch?.index && systemMatch?.index !== 0) throw new Error(`Instruction markdown for ${phase} must include "## System"`);
  if (!userMatch?.index && userMatch?.index !== 0) throw new Error(`Instruction markdown for ${phase} must include "## User"`);
  if (userMatch.index <= systemMatch.index) throw new Error(`Instruction markdown for ${phase} must put "## User" after "## System"`);

  const sysStart = systemMatch.index + systemMatch[0].length;
  const usrStart = userMatch.index + userMatch[0].length;
  const sys = text.slice(sysStart, userMatch.index).trim();
  const usr = text.slice(usrStart).trim();
  if (!sys) throw new Error(`Instruction markdown for ${phase} has an empty system section`);
  if (!usr) throw new Error(`Instruction markdown for ${phase} has an empty user section`);
  return { id: PHASE_TEMPLATE_IDS[phase], sys, usr };
};

const readDefaultMarkdown = (phase: ItineraryInstructionPhase): string => {
  if (defaultMarkdownCache[phase]) return defaultMarkdownCache[phase]!;
  const filePath = path.join(PROMPTS_ROOT, 'prompts', PHASE_FILES[phase]);
  const markdown = fs.readFileSync(filePath, 'utf8');
  defaultMarkdownCache = { ...defaultMarkdownCache, [phase]: markdown };
  return markdown;
};

const readStoredInstructionSet = async (): Promise<StoredInstructionSet> => {
  let row: Awaited<ReturnType<typeof getAdminSetting>>;
  try {
    row = await getAdminSetting(ADMIN_SETTING_KEY);
  } catch (error) {
    // Admin overrides are optional. A missing/unavailable admin_settings table must not
    // prevent the user-facing itinerary pipeline from using the bundled prompts.
    logError('[itinerary-instructions] failed to load admin overrides; using bundled prompts', error);
    return { schemaVersion: 1, phases: {} };
  }
  if (!row?.value) return { schemaVersion: 1, phases: {} };
  try {
    const parsed = JSON.parse(row.value) as StoredInstructionSet;
    return parsed?.schemaVersion === 1 && parsed.phases && typeof parsed.phases === 'object'
      ? parsed
      : { schemaVersion: 1, phases: {} };
  } catch {
    return { schemaVersion: 1, phases: {} };
  }
};

export const listItineraryInstructionDocuments = async (): Promise<ItineraryInstructionDocument[]> => {
  const stored = await readStoredInstructionSet();
  return ITINERARY_INSTRUCTION_PHASES.map((phase) => {
    const override = stored.phases[phase];
    const markdown = override?.markdown ?? readDefaultMarkdown(phase);
    return {
      phase,
      markdown,
      template: parseInstructionMarkdown(phase, markdown),
      source: override ? 'admin' : 'default',
      updatedAt: override?.updatedAt ?? null,
      updatedBy: override?.updatedBy ?? null,
    };
  });
};

export const getItineraryPromptTemplates = async (): Promise<Record<ItineraryInstructionPhase, ItineraryPromptTemplate>> => {
  const docs = await listItineraryInstructionDocuments();
  return Object.fromEntries(docs.map((doc) => [doc.phase, doc.template])) as Record<ItineraryInstructionPhase, ItineraryPromptTemplate>;
};

export const updateItineraryInstructionDocuments = async (params: {
  phases: Partial<Record<ItineraryInstructionPhase, string>>;
  actorId: string;
  reason: string;
}): Promise<ItineraryInstructionDocument[]> => {
  const entries = (Object.entries(params.phases)
    .filter(([phase, markdown]) => phaseSet.has(phase) && typeof markdown === 'string' && markdown.trim())
  ) as Array<[ItineraryInstructionPhase, string]>;
  if (!entries.length) throw new Error('At least one instruction phase markdown document is required');

  for (const [phase, markdown] of entries) {
    parseInstructionMarkdown(phase, markdown);
  }

  const stored = await readStoredInstructionSet();
  const updatedAt = new Date().toISOString();
  const next: StoredInstructionSet = {
    schemaVersion: 1,
    phases: { ...stored.phases },
  };
  for (const [phase, markdown] of entries) {
    next.phases[phase] = { markdown, updatedAt, updatedBy: params.actorId };
  }

  await setAdminSetting({
    key: ADMIN_SETTING_KEY,
    value: JSON.stringify(next),
    updatedBy: params.actorId,
  });
  await writeAuditLog({
    actorUserId: params.actorId,
    action: 'ADMIN_SETTING_UPDATED',
    reason: params.reason,
    afterState: { key: ADMIN_SETTING_KEY, phases: entries.map(([phase]) => phase), updatedAt },
  });
  return listItineraryInstructionDocuments();
};
