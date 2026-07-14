// itinerary-improvements-coding-plan.md Phase 4B ("Deterministic fill + one targeted repair").
//
// Thin days (fewer than THIN_DAY_MIN_ITEMS items) after p2/p3 get filled from data that has
// already been fetched — must-see items the model missed, then the next-best unused shortlist
// item from the same geographic pod — before any additional LLM call is considered. This is pure
// code: zero token cost. Only when deterministic fill can't raise a day to the minimum does the
// caller (itineraryPromptPlanService.ts) spend a single, batched repair call; that call and its
// one-attempt cap live in the caller, not here, since it needs runJsonStage/tokenAcc/captureStages.
import type { AttractionPod } from './geoPodClusteringService';
import { accumulateDayFriction } from './frictionAccumulatorService';
import { DEFAULT_CLOSED_WEEKDAYS_BY_CATEGORY } from './itineraryStructureValidator';

export const THIN_DAY_MIN_ITEMS = 2;
const DEFAULT_MAX_ITEMS_PER_DAY = 5;

export type FillItem = [string, string, string];
export type FillDay = { d?: number; dt: string; b: string; it: FillItem[]; ln?: string[] };
export type FillItinerary = { dy: FillDay[] };

export type ThinDayMustSee = { name: string; destinationName?: string };

export type TransferMinutesLike = { minutes: number };

export type DayFillResult<T> = {
  itinerary: T;
  /** Days that were thin on entry and had at least one item added. */
  filledDayDates: string[];
  /** Days that are still below the minimum after deterministic fill (repair candidates). */
  thinDayDates: string[];
  issues: string[];
};

export type ThinDayRepairPayload = { dt: string; destination: string; existingItems: FillItem[] };

const normalizeName = (value: unknown): string =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const isClosedOnWeekday = (name: string, weekday: number): boolean => {
  const key = normalizeName(name);
  if (!key) return false;
  return Object.entries(DEFAULT_CLOSED_WEEKDAYS_BY_CATEGORY).some(
    ([category, closedDays]) => key.includes(category) && closedDays.includes(weekday)
  );
};

const isRestHubByNote = (day: FillDay): boolean => (day.ln ?? []).some((note) => /rest[\s-]?hub|rest day|fatigue/i.test(note));

/**
 * Fatigue-aware cap for how many items a thin day may receive. Reuses
 * frictionAccumulatorService's scoring so a heavy travel day isn't further loaded even though it
 * is "thin" by item count — per itinerary-improvement-plan.md §4 (Fatigue Accumulator), the same
 * rule enforceFatigueManagement applies later in the pipeline.
 */
const fatigueAwareCap = (params: {
  day: FillDay;
  maxItemsPerDay: number;
  minItemsPerDay: number;
  transferMinutes?: number;
}): number => {
  if (isRestHubByNote(params.day)) return Math.min(params.maxItemsPerDay, params.minItemsPerDay);
  if (typeof params.transferMinutes !== 'number') return params.maxItemsPerDay;
  const friction = accumulateDayFriction({
    transferMinutes: params.transferMinutes,
    transferCount: 0,
    baseChange: false,
    activityMinutes: params.day.it.length * 120,
    walkingKm: 0,
  });
  if (friction.status === 'rest-hub') return Math.min(params.maxItemsPerDay, params.minItemsPerDay);
  if (friction.status === 'lighten') return Math.min(params.maxItemsPerDay, params.minItemsPerDay + 1);
  return params.maxItemsPerDay;
};

/**
 * Deterministic fill for thin days: Priority 1 pulls unused must-see items for the day's
 * destination; Priority 2 pulls the next-best unused shortlist item from the same geographic pod
 * (geoPodClusteringService). Respects weekday-closure heuristics, the existing per-day item cap,
 * and fatigue/rest-hub throttling. Never calls an LLM.
 */
export const fillThinDaysDeterministically = <T extends FillItinerary>(params: {
  itinerary: T;
  mustSees: ThinDayMustSee[];
  podsByDestination: Record<string, AttractionPod[]>;
  transferNotesByDay?: Map<number, TransferMinutesLike[]>;
  minItemsPerDay?: number;
  maxItemsPerDay?: number;
}): DayFillResult<T> => {
  const minItems = Math.max(1, params.minItemsPerDay ?? THIN_DAY_MIN_ITEMS);
  const maxItems = Math.max(minItems, params.maxItemsPerDay ?? DEFAULT_MAX_ITEMS_PER_DAY);
  const output = JSON.parse(JSON.stringify(params.itinerary)) as T;
  const issues: string[] = [];
  const filledDayDates = new Set<string>();

  const usedNames = new Set<string>(output.dy.flatMap((day) => day.it.map((item) => normalizeName(item[2]))));

  const podEntriesByDestination = new Map(
    Object.entries(params.podsByDestination ?? {}).map(([destination, pods]) => [normalizeName(destination), pods])
  );
  const podCandidatesFor = (destination: string) =>
    (podEntriesByDestination.get(normalizeName(destination)) ?? [])
      .flatMap((pod) => pod.items)
      .sort((a, b) => a.rank - b.rank);

  const mustSeesFor = (destination: string): ThinDayMustSee[] =>
    (params.mustSees ?? []).filter(
      (mustSee) => !mustSee.destinationName || normalizeName(mustSee.destinationName) === normalizeName(destination)
    );

  for (const day of output.dy) {
    if (!day || !Array.isArray(day.it)) continue;
    if (day.it.length >= minItems) continue;

    const weekday = Number.isFinite(Date.parse(`${day.dt}T12:00:00Z`))
      ? new Date(`${day.dt}T12:00:00Z`).getUTCDay()
      : null;
    const transferMinutes = typeof day.d === 'number'
      ? (params.transferNotesByDay?.get(day.d) ?? []).reduce((sum, note) => sum + (note.minutes ?? 0), 0)
      : undefined;
    const cap = fatigueAwareCap({ day, maxItemsPerDay: maxItems, minItemsPerDay: minItems, transferMinutes });

    const tryAdd = (name: string, source: 'must-see' | 'pod proximity'): boolean => {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) return false;
      const key = normalizeName(trimmed);
      if (usedNames.has(key)) return false;
      if (weekday !== null && isClosedOnWeekday(trimmed, weekday)) return false;
      if (day.it.length >= cap) return false;
      day.it.push(['D', 'A', trimmed]);
      usedNames.add(key);
      issues.push(`${day.dt}: added "${trimmed}" via ${source} (thin-day recovery).`);
      filledDayDates.add(day.dt);
      return true;
    };

    // Priority 1: Must-See Recovery — unused must-sees for this day's destination.
    for (const mustSee of mustSeesFor(day.b)) {
      if (day.it.length >= minItems || day.it.length >= cap) break;
      tryAdd(mustSee.name, 'must-see');
    }

    // Priority 2: POD Proximity — next-best unused shortlist item from the same geographic pod.
    if (day.it.length < minItems && day.it.length < cap) {
      for (const candidate of podCandidatesFor(day.b)) {
        if (day.it.length >= minItems || day.it.length >= cap) break;
        tryAdd(candidate.name, 'pod proximity');
      }
    }
  }

  const thinDayDates = output.dy.filter((day) => (day.it?.length ?? 0) < minItems).map((day) => day.dt);
  return { itinerary: output, filledDayDates: Array.from(filledDayDates), thinDayDates, issues };
};

/** Builds the minimal payload sent to the single, batched repair call — only the thin days. */
export const buildThinDayRepairPayload = (itinerary: FillItinerary, thinDayDates: string[]): ThinDayRepairPayload[] => {
  const wanted = new Set(thinDayDates);
  return itinerary.dy
    .filter((day) => wanted.has(day.dt))
    .map((day) => ({ dt: day.dt, destination: day.b, existingItems: day.it }));
};

const VALID_TIME_CODES = new Set(['M', 'D', 'E']);
const VALID_ACTIVITY_CODES = new Set(['A', 'R', 'T', 'O', 'E']);

/**
 * Merges the repair call's response back into the itinerary. Defensive against malformed JSON,
 * an empty/non-object response, missing days, and duplicate/oversized item lists — any of those
 * simply leave the corresponding day(s) untouched (still thin), never throw.
 */
export const mergeThinDayRepairResult = <T extends FillItinerary>(params: {
  itinerary: T;
  repaired: unknown;
  minItemsPerDay?: number;
  maxItemsPerDay?: number;
}): { itinerary: T; repairedDayDates: string[]; stillThinDayDates: string[] } => {
  const minItems = Math.max(1, params.minItemsPerDay ?? THIN_DAY_MIN_ITEMS);
  const maxItems = Math.max(minItems, params.maxItemsPerDay ?? DEFAULT_MAX_ITEMS_PER_DAY);
  const output = JSON.parse(JSON.stringify(params.itinerary)) as T;
  const repairedDayDates: string[] = [];
  const byDate = new Map(output.dy.map((day) => [day.dt, day]));
  const usedNames = new Set<string>(output.dy.flatMap((day) => day.it.map((item) => normalizeName(item[2]))));

  const repairedDays =
    params.repaired && typeof params.repaired === 'object' && Array.isArray((params.repaired as { dy?: unknown }).dy)
      ? ((params.repaired as { dy: unknown[] }).dy as unknown[])
      : [];

  for (const raw of repairedDays) {
    if (!raw || typeof raw !== 'object') continue;
    const dt = typeof (raw as { dt?: unknown }).dt === 'string' ? (raw as { dt: string }).dt : null;
    if (!dt) continue;
    const target = byDate.get(dt);
    if (!target) continue;

    const rawItems = Array.isArray((raw as { it?: unknown }).it) ? ((raw as { it: unknown[] }).it as unknown[]) : [];
    const targetExistingNames = new Set(target.it.map((item) => normalizeName(item[2])));
    const sanitized: FillItem[] = [];
    for (const rawItem of rawItems) {
      if (!Array.isArray(rawItem) || rawItem.length < 3) continue;
      const [t, k, textRaw] = rawItem;
      const text = typeof textRaw === 'string' ? textRaw.trim() : '';
      if (!text) continue;
      const key = normalizeName(text);
      if (sanitized.some((item) => normalizeName(item[2]) === key)) continue;
      if (usedNames.has(key) && !targetExistingNames.has(key)) continue;
      sanitized.push([
        typeof t === 'string' && VALID_TIME_CODES.has(t) ? t : 'D',
        typeof k === 'string' && VALID_ACTIVITY_CODES.has(k) ? k : 'A',
        text,
      ]);
      if (sanitized.length >= maxItems) break;
    }

    if (sanitized.length >= minItems && sanitized.length > target.it.length) {
      target.it = sanitized;
      sanitized.forEach((item) => usedNames.add(normalizeName(item[2])));
      repairedDayDates.push(dt);
    }
  }

  const stillThinDayDates = output.dy.filter((day) => day.it.length < minItems).map((day) => day.dt);
  return { itinerary: output, repairedDayDates, stillThinDayDates };
};
