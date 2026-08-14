import {
  TripLogisticsOverlaySchema,
  type BaseStay,
  type DayVariant,
  type RoadTripConflict,
  type TimedRouteDay,
  type TravelLeg,
  type TripLogisticsOverlay,
} from '../schemas/itineraryCacheSchemas';

type DateLike = string | null | undefined;

export type RoadTripLodgingInput = {
  id?: string;
  name?: string;
  address?: string;
  checkInDate?: DateLike;
  checkOutDate?: DateLike;
};

export type RoadTripTransferInput = {
  id?: string;
  transferType?: string;
  departureDate?: DateLike;
  arrivalDate?: DateLike;
  departureTime?: string;
  arrivalTime?: string;
  departureLocation?: string;
  arrivalLocation?: string;
};

export type RoadTripActivityInput = {
  id?: string;
  date?: DateLike;
  name?: string;
  duration?: string | number;
  startTime?: string;
};

export type RoadTripCarRentalInput = {
  pickupDate?: DateLike;
  dropoffDate?: DateLike;
};

export type RoadTripCorridorInput = {
  fromLocationId: string;
  toLocationId: string;
  minutes: number;
  mode?: TravelLeg['mode'];
  confidence?: TravelLeg['confidence'];
};

export type RoadTripDeadlineInput = {
  date: string;
  at: string;
  reasonCode: string;
  requiredSlackMinutes?: number;
};

export type RoadTripVariantInput = {
  variantId: string;
  date: string;
  labelReasonCode: string;
  blockIds?: string[];
  activityNames?: string[];
  legIds?: string[];
  estimatedMinutes?: number;
  conditions?: DayVariant['conditions'];
  exclusiveGroup?: string;
  tradeoffReasonCodes?: string[];
};

export type RoadTripPlannerInput = {
  destinations: string[];
  startDate?: DateLike;
  endDate?: DateLike;
  lodgings?: RoadTripLodgingInput[];
  transfers?: RoadTripTransferInput[];
  activities?: RoadTripActivityInput[];
  carRentals?: RoadTripCarRentalInput[];
  corridors?: RoadTripCorridorInput[];
  deadlines?: RoadTripDeadlineInput[];
  variants?: RoadTripVariantInput[];
  enableTimedRoutes?: boolean;
  enableDayVariants?: boolean;
  maxBases?: number;
  maxLegs?: number;
};

export type RoadTripHints = Pick<RoadTripPlannerInput, 'corridors' | 'deadlines' | 'variants'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^(\d{2}):(\d{2})$/;
const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_SLACK_MINUTES = 60;
const DEFAULT_HEURISTIC_MINUTES = 120;
const MAX_DAYS = 31;

const safe = (value: unknown): string => String(value ?? '').trim();
const isIsoDate = (value: unknown): value is string => typeof value === 'string' && ISO_DATE.test(value);

const normalizeLocationId = (value: unknown): string => safe(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120) || 'unknown_location';

const parseDateUtc = (value: DateLike): Date | null => {
  if (!isIsoDate(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const addDays = (date: string, amount: number): string => {
  const parsed = parseDateUtc(date);
  if (!parsed) return date;
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
};

const dateRange = (start: string, end: string): string[] => {
  const first = parseDateUtc(start);
  const last = parseDateUtc(end);
  if (!first || !last || last <= first) return [];
  const result: string[] = [];
  for (let cursor = new Date(first); cursor < last && result.length < MAX_DAYS; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
};

const minutesFromTime = (value: unknown): number | null => {
  const match = safe(value).match(ISO_TIME);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const parseDurationMinutes = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = safe(value).toLowerCase();
  if (!text) return 120;
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] ?? 0);
  const minutes = Number(text.match(/(\d+)\s*m/)?.[1] ?? 0);
  if (hours || minutes) return Math.max(0, Math.round(hours * 60 + minutes));
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 120;
};

const toIsoDateTime = (date: string, minutes: number): string => {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mins = String(clamped % 60).padStart(2, '0');
  return `${date}T${hours}:${mins}:00.000Z`;
};

const transferMode = (value: unknown): TravelLeg['mode'] => {
  const normalized = safe(value).toLowerCase();
  if (normalized.includes('train') || normalized.includes('rail')) return 'rail';
  if (normalized.includes('bus')) return 'bus';
  if (normalized.includes('flight') || normalized.includes('air')) return 'flight';
  if (normalized.includes('private') || normalized.includes('car') || normalized.includes('drive')) return 'drive';
  return 'other';
};

const dateBounds = (input: RoadTripPlannerInput): { start: string; end: string } | null => {
  const itemDates = [
    ...(input.lodgings ?? []).flatMap((item) => [item.checkInDate, item.checkOutDate]),
    ...(input.transfers ?? []).flatMap((item) => [item.departureDate, item.arrivalDate]),
    ...(input.activities ?? []).map((item) => item.date),
  ].filter(isIsoDate).sort();
  const start = isIsoDate(input.startDate) ? input.startDate : itemDates[0];
  const latest = isIsoDate(input.endDate) ? input.endDate : itemDates[itemDates.length - 1];
  const hasExclusiveLodgingEnd = Boolean(latest && (input.lodgings ?? []).some((item) => item.checkOutDate === latest));
  const end = latest
    ? (isIsoDate(input.endDate) || hasExclusiveLodgingEnd ? latest : addDays(latest, 1))
    : start
      ? addDays(start, 1)
      : undefined;
  if (!start || !end || !dateRange(start, end).length) return null;
  return { start, end };
};

const buildBaseStays = (input: RoadTripPlannerInput, bounds: { start: string; end: string }, conflicts: RoadTripConflict[]): BaseStay[] => {
  const maxBases = Math.max(1, Math.min(16, Math.floor(input.maxBases ?? 16)));
  const lodgings = (input.lodgings ?? [])
    .filter((item) => isIsoDate(item.checkInDate) && isIsoDate(item.checkOutDate) && item.checkInDate! < item.checkOutDate!)
    .sort((a, b) => String(a.checkInDate).localeCompare(String(b.checkInDate)))
    .slice(0, maxBases);

  if (lodgings.length) {
    return lodgings.map((lodging, index) => ({
      baseStayId: `base_${index + 1}_${normalizeLocationId(lodging.address || lodging.name).slice(0, 40)}`,
      locationId: normalizeLocationId(lodging.address || lodging.name || input.destinations[index] || `base_${index + 1}`),
      startDate: lodging.checkInDate!,
      endDate: lodging.checkOutDate!,
      ...(safe(lodging.id) ? { lodgingItemId: safe(lodging.id) } : {}),
      source: 'trip_lodging' as const,
    }));
  }

  const destinations = input.destinations.map(normalizeLocationId).filter(Boolean).slice(0, maxBases);
  const days = dateRange(bounds.start, bounds.end);
  if (!destinations.length || !days.length) {
    conflicts.push({ code: 'MISSING_BASE', message: 'No dated lodging or explicit destination base is available.', required: true });
    return [];
  }
  const result: BaseStay[] = [];
  const daysPerBase = Math.max(1, Math.ceil(days.length / destinations.length));
  destinations.forEach((destination, index) => {
    const startIndex = index * daysPerBase;
    if (startIndex >= days.length) return;
    const endIndex = Math.min(days.length, (index + 1) * daysPerBase);
    result.push({
      baseStayId: `base_${index + 1}_${destination.slice(0, 40)}`,
      locationId: destination,
      startDate: days[startIndex],
      endDate: days[endIndex] ?? addDays(bounds.end, 0),
      source: 'trip_destination',
    });
  });
  if (!result.length) conflicts.push({ code: 'MISSING_BASE', message: 'No base stay could be formed from the supplied trip dates.', required: true });
  return result;
};

const findCorridor = (from: string, to: string, corridors: RoadTripCorridorInput[]): RoadTripCorridorInput | undefined =>
  corridors.find((candidate) => normalizeLocationId(candidate.fromLocationId) === from && normalizeLocationId(candidate.toLocationId) === to) ??
  corridors.find((candidate) => normalizeLocationId(candidate.fromLocationId) === to && normalizeLocationId(candidate.toLocationId) === from);

const estimateLegMinutes = (from: BaseStay, to: BaseStay, input: RoadTripPlannerInput): { minutes: number; source: TravelLeg['source']; confidence: TravelLeg['confidence']; mode: TravelLeg['mode'] } => {
  const corridor = findCorridor(from.locationId, to.locationId, input.corridors ?? []);
  if (corridor && Number.isFinite(corridor.minutes) && corridor.minutes > 0) {
    return { minutes: Math.min(24 * 60, Math.round(corridor.minutes)), source: 'static_corridor', confidence: corridor.confidence ?? 'estimated', mode: corridor.mode ?? 'drive' };
  }
  return { minutes: DEFAULT_HEURISTIC_MINUTES, source: 'heuristic', confidence: 'low', mode: 'drive' };
};

const findSuppliedTransfer = (from: BaseStay, to: BaseStay, transfers: RoadTripTransferInput[]): RoadTripTransferInput | undefined => {
  const fromId = normalizeLocationId(from.locationId);
  const toId = normalizeLocationId(to.locationId);
  return transfers.find((transfer) => {
    const departure = normalizeLocationId(transfer.departureLocation);
    const arrival = normalizeLocationId(transfer.arrivalLocation);
    return (departure === fromId || fromId.includes(departure) || departure.includes(fromId)) &&
      (arrival === toId || toId.includes(arrival) || arrival.includes(toId));
  });
};

const buildTravelLegs = (bases: BaseStay[], input: RoadTripPlannerInput, conflicts: RoadTripConflict[]): TravelLeg[] => {
  const result: TravelLeg[] = [];
  const maxLegs = Math.max(0, Math.min(32, Math.floor(input.maxLegs ?? 32)));
  for (let index = 0; index < bases.length - 1 && result.length < maxLegs; index += 1) {
    const from = bases[index];
    const to = bases[index + 1];
    if (from.locationId === to.locationId) continue;
    const supplied = findSuppliedTransfer(from, to, input.transfers ?? []);
    const estimate = estimateLegMinutes(from, to, input);
    const transferMinutes = supplied
      ? Math.max(1, (minutesFromTime(supplied.arrivalTime) ?? 120) - (minutesFromTime(supplied.departureTime) ?? 0))
      : estimate.minutes;
    const mode = supplied ? transferMode(supplied.transferType) : estimate.mode;
    const source = supplied ? 'supplied_transfer' as const : estimate.source;
    const confidence = supplied ? 'verified' as const : estimate.confidence;
    const leg: TravelLeg = {
      legId: `leg_${index + 1}_${from.baseStayId}_${to.baseStayId}`.slice(0, 80),
      fromBaseStayId: from.baseStayId,
      toBaseStayId: to.baseStayId,
      mode,
      estimatedMinutes: Math.min(24 * 60, Math.round(transferMinutes)),
      bufferMultiplier: source === 'heuristic' ? 1.5 : 1.25,
      source,
      confidence,
    };
    const departureDate = supplied?.departureDate;
    const arrivalDate = supplied?.arrivalDate;
    if (isIsoDate(departureDate) && isIsoDate(arrivalDate)) {
      leg.latestArrival = toIsoDateTime(arrivalDate, minutesFromTime(supplied?.arrivalTime) ?? 18 * 60);
    }
    if (mode === 'drive') {
      const rental = (input.carRentals ?? []).find((item) => isIsoDate(item.pickupDate) && isIsoDate(item.dropoffDate) && item.pickupDate! <= to.startDate && to.endDate <= item.dropoffDate!);
      if ((input.carRentals ?? []).length && !rental) {
        conflicts.push({ code: 'TRANSPORT_WINDOW', date: to.startDate, message: `Driving leg into ${to.locationId} is outside the supplied car-rental window.`, required: true });
      }
    }
    result.push(leg);
  }
  return result;
};

const activityCheckpoint = (activity: RoadTripActivityInput, index: number, date: string) => ({
  checkpointId: `activity_${index}_${normalizeLocationId(activity.name).slice(0, 50)}`.slice(0, 100),
  ...(isIsoDate(date) && minutesFromTime(activity.startTime) !== null ? { earliestStart: toIsoDateTime(date, minutesFromTime(activity.startTime)!) } : {}),
  durationMinutes: Math.min(MINUTES_PER_DAY, parseDurationMinutes(activity.duration)),
  required: false,
  cutPriority: index,
});

const buildTimedRouteDays = (bases: BaseStay[], legs: TravelLeg[], input: RoadTripPlannerInput, conflicts: RoadTripConflict[]): { days: TimedRouteDay[]; driving: TripLogisticsOverlay['drivingSummary'] } => {
  const dates = dateRange(dateBounds(input)?.start ?? bases[0]?.startDate ?? '', dateBounds(input)?.end ?? bases[bases.length - 1]?.endDate ?? '');
  const legByDate = new Map<string, TravelLeg[]>();
  legs.forEach((leg) => {
    const toBase = bases.find((base) => base.baseStayId === leg.toBaseStayId);
    if (!toBase) return;
    const bucket = legByDate.get(toBase.startDate) ?? [];
    bucket.push(leg);
    legByDate.set(toBase.startDate, bucket);
  });
  const activityByDate = new Map<string, RoadTripActivityInput[]>();
  (input.activities ?? []).forEach((activity) => {
    if (!isIsoDate(activity.date)) return;
    const bucket = activityByDate.get(activity.date) ?? [];
    bucket.push(activity);
    activityByDate.set(activity.date, bucket);
  });
  const deadlines = new Map((input.deadlines ?? []).filter((item) => isIsoDate(item.date)).map((item) => [item.date, item]));
  const result: TimedRouteDay[] = [];
  const driving: TripLogisticsOverlay['drivingSummary'] = [];
  for (const date of dates) {
    const dayLegs = legByDate.get(date) ?? [];
    const deadline = deadlines.get(date);
    const requiredSlackMinutes = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(deadline?.requiredSlackMinutes ?? (dayLegs.length ? DEFAULT_SLACK_MINUTES : 0))));
    const checkpoints = [
      ...dayLegs.map((leg, index) => ({ checkpointId: leg.legId, durationMinutes: Math.ceil(leg.estimatedMinutes * leg.bufferMultiplier), required: true, cutPriority: 0, _index: index })),
      ...(activityByDate.get(date) ?? []).map((activity, index) => ({ ...activityCheckpoint(activity, index, date), _index: index + dayLegs.length })),
    ].map(({ _index: _ignored, ...checkpoint }) => checkpoint);
    const hardDeadline = deadline ? { at: toIsoDateTime(date, minutesFromTime(deadline.at) ?? 18 * 60), reasonCode: deadline.reasonCode.slice(0, 80) || 'USER_DEADLINE' } : undefined;
    let plannedMinutes = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.durationMinutes, 0) + requiredSlackMinutes;
    const availableMinutes = hardDeadline ? (minutesFromTime(deadline?.at) ?? 18 * 60) : MINUTES_PER_DAY;
    const mutable = [...checkpoints];
    while (plannedMinutes > availableMinutes) {
      const optional = mutable.filter((checkpoint) => !checkpoint.required).sort((a, b) => (b.cutPriority ?? 0) - (a.cutPriority ?? 0))[0];
      if (!optional) break;
      const index = mutable.indexOf(optional);
      mutable.splice(index, 1);
      plannedMinutes -= optional.durationMinutes;
    }
    if (plannedMinutes > availableMinutes) {
      conflicts.push({ code: 'DEADLINE_INFEASIBLE', date, message: `Required route checkpoints cannot reach the deadline with ${requiredSlackMinutes} minutes of slack.`, required: true });
    }
    if (mutable.length || hardDeadline || dayLegs.length) {
      result.push({ date, ...(hardDeadline ? { hardDeadline } : {}), requiredSlackMinutes, checkpoints: mutable });
    }
    if (dayLegs.length) {
      driving.push({ date, legIds: dayLegs.map((leg) => leg.legId), bufferedMinutes: dayLegs.reduce((sum, leg) => sum + Math.ceil(leg.estimatedMinutes * leg.bufferMultiplier), 0), requiredSlackMinutes, confidence: dayLegs.some((leg) => leg.confidence === 'low') ? 'low' : dayLegs.some((leg) => leg.confidence === 'estimated') ? 'estimated' : 'verified' });
    }
  }
  return { days: result, driving };
};

const buildVariants = (input: RoadTripPlannerInput, activities: RoadTripActivityInput[], legs: TravelLeg[]): { variants: DayVariant[]; active: string[] } => {
  const variants: DayVariant[] = [];
  for (const inputVariant of input.variants ?? []) {
    const blockIds = inputVariant.blockIds?.slice(0, 40) ?? (inputVariant.activityNames ?? []).map((name) => `activity_${normalizeLocationId(name)}`).slice(0, 40);
    variants.push({
      variantId: inputVariant.variantId.slice(0, 100),
      labelReasonCode: inputVariant.labelReasonCode.slice(0, 80),
      blockIds,
      legIds: (inputVariant.legIds ?? []).slice(0, 16),
      estimatedMinutes: Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(inputVariant.estimatedMinutes ?? activities.filter((item) => inputVariant.activityNames?.includes(safe(item.name))).reduce((sum, item) => sum + parseDurationMinutes(item.duration), 0) + legs.filter((leg) => inputVariant.legIds?.includes(leg.legId)).reduce((sum, leg) => sum + leg.estimatedMinutes, 0)))),
      conditions: (inputVariant.conditions ?? ['dry']).slice(0, 8),
      exclusiveGroup: (inputVariant.exclusiveGroup ?? `day_${inputVariant.date}`).slice(0, 100),
      tradeoffReasonCodes: (inputVariant.tradeoffReasonCodes ?? []).slice(0, 8),
    });
  }
  if (!variants.length) {
    const dates = Array.from(new Set(activities.map((activity) => safe(activity.date)).filter(isIsoDate))).sort();
    dates.forEach((date) => {
      const dayActivities = activities.filter((activity) => safe(activity.date) === date);
      const activityNames = dayActivities.map((activity) => safe(activity.name)).filter(Boolean);
      variants.push({
        variantId: `day_${date}_baseline`,
        labelReasonCode: 'BASELINE_DAY',
        blockIds: activityNames.map((name) => `activity_${normalizeLocationId(name)}`).slice(0, 40),
        legIds: [],
        estimatedMinutes: Math.min(MINUTES_PER_DAY, dayActivities.reduce((sum, activity) => sum + parseDurationMinutes(activity.duration), 0)),
        conditions: ['dry'],
        exclusiveGroup: `day_${date}`,
        tradeoffReasonCodes: [],
      });
    });
  }
  const active: string[] = [];
  const groups = new Set(variants.map((variant) => variant.exclusiveGroup));
  groups.forEach((group) => {
    const selected = variants.find((variant) => variant.exclusiveGroup === group);
    if (selected) active.push(selected.variantId);
  });
  return { variants, active };
};

export const buildRoadTripLogisticsOverlay = (input: RoadTripPlannerInput): TripLogisticsOverlay => {
  const conflicts: RoadTripConflict[] = [];
  const bounds = dateBounds(input);
  if (!bounds) {
    return TripLogisticsOverlaySchema.parse({ schemaVersion: 'road-trip-lite-v1', baseStays: [], travelLegs: [], timedRouteDays: [], dayVariants: [], activeVariantIds: [], conflicts: [{ code: 'MISSING_BASE', message: 'Road-trip planning needs valid trip dates or dated itinerary items.', required: true }], daysByBase: [], drivingSummary: [] });
  }
  const baseStays = buildBaseStays(input, bounds, conflicts);
  const travelLegs = buildTravelLegs(baseStays, input, conflicts);
  const timed = input.enableTimedRoutes === false ? { days: [], driving: [] as TripLogisticsOverlay['drivingSummary'] } : buildTimedRouteDays(baseStays, travelLegs, input, conflicts);
  const variantResult = input.enableDayVariants === false ? { variants: [], active: [] } : buildVariants(input, input.activities ?? [], travelLegs);
  const days = dateRange(bounds.start, bounds.end);
  const daysByBase = baseStays.map((base) => ({ baseStayId: base.baseStayId, dates: days.filter((date) => date >= base.startDate && date < base.endDate) }));
  for (const date of days) {
    if (!daysByBase.some((entry) => entry.dates.includes(date))) {
      conflicts.push({ code: 'MISSING_BASE', date, message: `No base stay covers ${date}.`, required: false });
    }
  }
  return TripLogisticsOverlaySchema.parse({ schemaVersion: 'road-trip-lite-v1', baseStays, travelLegs, timedRouteDays: timed.days, dayVariants: variantResult.variants, activeVariantIds: variantResult.active, conflicts, daysByBase, drivingSummary: timed.driving });
};

/** Compact, deterministic presentation for clients that do not yet have a
 * dedicated road-trip summary component. It intentionally exposes no private
 * lodging IDs or exact reservation data. */
export const renderRoadTripSummaryMarkdown = (overlay: TripLogisticsOverlay): string => {
  if (!overlay.baseStays.length && !overlay.conflicts.length) return '';
  const lines = ['## Road-trip logistics', '', '### Days by base', ''];
  for (const entry of overlay.daysByBase) {
    const base = overlay.baseStays.find((candidate) => candidate.baseStayId === entry.baseStayId);
    if (!base) continue;
    lines.push(`- **${base.locationId}**: ${entry.dates[0] ?? base.startDate} → ${entry.dates.at(-1) ?? base.endDate}`);
  }
  if (overlay.drivingSummary.length) {
    lines.push('', '### Driving and deadlines', '');
    for (const summary of overlay.drivingSummary) {
      const deadline = overlay.timedRouteDays.find((day) => day.date === summary.date)?.hardDeadline;
      lines.push(`- **${summary.date}**: ${summary.bufferedMinutes} min buffered driving; ${summary.requiredSlackMinutes} min slack${deadline ? ` before ${deadline.reasonCode}` : ''} (${summary.confidence} estimate).`);
    }
  }
  if (overlay.dayVariants.length > 1) {
    lines.push('', '### Whole-day options', '');
    const active = new Set(overlay.activeVariantIds);
    for (const variant of overlay.dayVariants) {
      lines.push(`- ${active.has(variant.variantId) ? 'Selected' : 'Alternative'}: ${variant.labelReasonCode} (${variant.estimatedMinutes} min)`);
    }
  }
  const requiredConflicts = overlay.conflicts.filter((conflict) => conflict.required);
  if (requiredConflicts.length) {
    lines.push('', '> **Needs attention:** ' + requiredConflicts.map((conflict) => conflict.message).join(' '));
  }
  return lines.join('\n');
};
