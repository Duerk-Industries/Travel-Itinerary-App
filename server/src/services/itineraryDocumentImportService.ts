import {
  addItineraryDetail,
  createItineraryRecord,
  ensureUserInTrip,
  getTripById,
  insertActivity,
  insertCarRental,
  insertFlight,
  insertLodging,
  listActivities,
  listCarRentals,
  listFlights,
  listLodgings,
  listItineraries,
  listItineraryDetails,
  updateTripDetails,
} from '../db';
import { createAiCallContext } from '../ai/registry/correlation';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import type { AiCallContext } from '../ai/types/aiChat';
import { getActiveAiProvider, getConfiguredProviderApiKey } from './aiProviderConfigService';
import { estimateAiCostMicros } from '../apis/providerBudgeting';
import { createTtlCache } from '../utils/ttlCache';
import { createHash } from 'crypto';
import { logError } from '../logger';

export const ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY = 'itinerary_document_import';
const CALLER_ID = 'ITINERARY_DOCUMENT_IMPORT';
const MAX_DOCUMENT_CHARS = 60_000;
const ACTIVITY_CHUNK_MAX_CHARS = 8_000;

export type ItineraryDocumentDaySection = {
  day: number | null;
  date: string | null;
  heading: string;
  text: string;
};

const extractionCache = createTtlCache<ExtractedItineraryDocument>({
  defaultTtlMs: 15 * 60 * 1000, // 15 minutes to allow for preview -> confirm
  maxEntries: 100,
});

/** @internal - export for tests only */
export const __clearExtractionCache = (): void => extractionCache.clear();

const getDocumentHash = (text: string, userId: string): string =>
  createHash('sha256').update(`${userId}:${text}`).digest('hex');

export type ItineraryDocumentCandidateType =
  | 'flight'
  | 'rail'
  | 'ferry_bus_transfer'
  | 'hotel'
  | 'car_rental'
  | 'tour_activity';

export type ItineraryDocumentCandidate = {
  type: ItineraryDocumentCandidateType;
  name?: string | null;
  providerVendor?: string | null;
  confirmationNumber?: string | null;
  totalCost?: number | null;
  departureDate?: string | null;
  arrivalDate?: string | null;
  departureLocation?: string | null;
  arrivalLocation?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  carrier?: string | null;
  flightNumber?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  address?: string | null;
  rooms?: number | null;
  pickupDate?: string | null;
  dropoffDate?: string | null;
  pickupLocation?: string | null;
  dropoffLocation?: string | null;
  vehicleType?: string | null;
  activityDate?: string | null;
  activityTime?: string | null;
  duration?: string | null;
  notes?: string | null;
  date?: string | null;
  endDate?: string | null;
  location?: string | null;
  sourceExcerpt?: string;
  day?: number | null;
  flight?: { departureLocation: string | null; arrivalLocation: string | null; carrier: string | null; transferType?: string | null };
  hotel?: { address: string | null };
  carRental?: { pickupLocation: string | null; dropoffLocation: string | null; vendor: string | null };
  activity?: { activityType: string | null; startLocation: string | null };
};

export type ItineraryImportCandidateType = ItineraryDocumentCandidateType;
export type ItineraryImportCandidate = ItineraryDocumentCandidate;
export type ItineraryImportMatch = {
  candidateIndex: number;
  existingId: string;
  existingType: ItineraryImportCandidateType;
  reason: string;
};

export type ExtractedItineraryDocument = {
  candidates: ItineraryDocumentCandidate[];
  unassignedNotes: string;
  dayNotes: Array<{ day: number | null; date: string | null; title: string | null; body: string; sourceExcerpt: string }>;
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};

type ImportResultItemType = ItineraryDocumentCandidateType | 'day_note';

export type ImportDocumentResult = {
  dryRun: boolean;
  added: Array<{ type: ImportResultItemType; id: string | null; name: string; summary: string }>;
  skippedDuplicates: Array<{ type: ImportResultItemType; name: string; summary: string; matchedExistingId: string; reason: string }>;
  skippedUnparseable: Array<{ type: ImportResultItemType; name: string; summary: string; excerpt: string; reason: string }>;
  notesAppended: boolean;
  notesPreview: string | null;
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};
export type ItineraryDocumentImportResult = ImportDocumentResult;

const SYSTEM_PROMPT = `Extract travel reservations and itinerary items from the supplied document.
Return only one JSON object with this shape:
{"candidates":[{"type":"flight|rail|ferry_bus_transfer|hotel|car_rental|tour_activity","name":"text","day":1,"date":"YYYY-MM-DD or null","endDate":"YYYY-MM-DD or null","location":"text or null","notes":"text or null","sourceExcerpt":"source lines","flight":{"departureLocation":null,"arrivalLocation":null,"carrier":null,"transferType":"Flight|Train|Bus|Ferry|Other"},"hotel":{"address":null},"carRental":{"pickupLocation":null,"dropoffLocation":null,"vendor":null},"activity":{"activityType":"Class|Concert/Show|Day Trip|Event|Food & Drink|Fun & Games|Hike|Nightlife|Open Access|Outdoor Activity|Reservation|Shopping|Sights & Landmarks|Spa/Wellness|Ticketed Attraction|Tour","startLocation":null}}],"dayNotes":[{"day":1,"date":"YYYY-MM-DD or null","title":"short label or null","body":"day-specific markdown","sourceExcerpt":"source lines"}],"unassignedNotes":"trip-wide clean markdown"}

For each candidate, include only values explicitly supported by the document. Useful fields are name,
providerVendor, confirmationNumber, totalCost, departureDate, arrivalDate, departureLocation,
arrivalLocation, departureTime, arrivalTime, carrier, flightNumber, checkInDate, checkOutDate,
address, rooms, pickupDate, dropoffDate, pickupLocation, dropoffLocation, vehicleType, activityDate,
activityTime, duration, and notes. Dates must be YYYY-MM-DD. Do not invent or infer structured values.
Prioritize transfers, lodging, car rentals, and trip-wide notes in this pass. A separate activity-recovery pass will
enumerate daily sights and experiences, so do not spend the response budget repeating a long daily activity table.
Put trip-wide practical information (entry rules, packing, payment, safety, logistics, booking priorities) in
unassignedNotes and preserve concrete details. Do not discard useful source content. Do not return an itinerary status.`;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const asNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const monthNumberByName: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const isoForMonthDay = (month: number, day: number, tripStartDate?: string | null, tripEndDate?: string | null): string | null => {
  const startYear = Number(tripStartDate?.slice(0, 4));
  const endYear = Number(tripEndDate?.slice(0, 4));
  if (!Number.isFinite(startYear)) return null;
  let year = startYear;
  if (Number.isFinite(endYear) && endYear > startYear && tripStartDate) {
    const startMonth = Number(tripStartDate.slice(5, 7));
    if (month < startMonth) year = endYear;
  }
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? null : candidate;
};

export const segmentItineraryDocumentDays = (params: {
  documentText: string;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
}): ItineraryDocumentDaySection[] => {
  // Some PDF table extractors place the date's numeric day on the following line
  // ("Nov Tue ...\n10 ..."). Rejoin that narrow date column before finding rows.
  let text = params.documentText.replace(/\r\n?/g, '\n').replace(
    /^([ \t]*)(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)([^\n]*)\n[ \t]*(\d{1,2})([^\n]*)/gim,
    '$1$2 $5 $3$4 $6'
  );
  const headingPattern = /^[ \t]*(?:#{1,4}\s*)?(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\s+)?(?:(?<numericMonth>\d{1,2})\/(?<numericDay>\d{1,2})|(?<monthName>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(?<namedDay>\d{1,2}))(?:\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?)?\b[^\n]*|^[ \t]*(?:#{1,4}\s*)?Day\s+(?<ordinalDay>\d{1,3})\b[^\n]*/gim;
  const firstDay = headingPattern.exec(text);
  headingPattern.lastIndex = 0;
  if (firstDay?.index != null) {
    const appendixPattern = /^[ \t]*(?:#{1,4}\s*)?(?:Practical\s+notes|Lodging|Booking|Hikes(?:\s+at\s+a\s+glance)?|Foliage\s+Timing\s+Check)\s*$/gim;
    appendixPattern.lastIndex = firstDay.index + firstDay[0].length;
    const appendix = appendixPattern.exec(text);
    if (appendix?.index != null) text = text.slice(0, appendix.index);
  }
  const matches = Array.from(text.matchAll(headingPattern));
  if (matches.length < 2) return [];
  return matches.map((match, index) => {
    const groups = match.groups ?? {};
    const month = groups.numericMonth ? Number(groups.numericMonth) : monthNumberByName[String(groups.monthName ?? '').toLowerCase()];
    const monthDay = groups.numericDay ? Number(groups.numericDay) : Number(groups.namedDay);
    const date = month && monthDay ? isoForMonthDay(month, monthDay, params.tripStartDate, params.tripEndDate) : null;
    const explicitDay = groups.ordinalDay ? Number(groups.ordinalDay) : null;
    const tripStart = params.tripStartDate ? Date.parse(`${params.tripStartDate.slice(0, 10)}T00:00:00Z`) : Number.NaN;
    const sectionDate = date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
    const inferredDay = Number.isFinite(tripStart) && Number.isFinite(sectionDate)
      ? Math.round((sectionDate - tripStart) / 86_400_000) + 1
      : null;
    const end = matches[index + 1]?.index ?? text.length;
    return {
      day: explicitDay ?? (inferredDay && inferredDay >= 1 ? inferredDay : index + 1),
      date,
      heading: match[0].trim(),
      text: text.slice(match.index!, end).trim(),
    };
  });
};

const chunkDaySections = (sections: ItineraryDocumentDaySection[]): ItineraryDocumentDaySection[][] => {
  const chunks: ItineraryDocumentDaySection[][] = [];
  let current: ItineraryDocumentDaySection[] = [];
  let currentChars = 0;
  for (const section of sections) {
    if (current.length && currentChars + section.text.length > ACTIVITY_CHUNK_MAX_CHARS) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(section);
    currentChars += section.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
};
const candidateTypes = new Set<ItineraryDocumentCandidateType>([
  'flight', 'rail', 'ferry_bus_transfer', 'hotel', 'car_rental', 'tour_activity',
]);

const parseExtraction = (raw: string, usage: ExtractedItineraryDocument['usage']): ExtractedItineraryDocument => {
  const parsed = JSON.parse(raw) as { candidates?: unknown; dayNotes?: unknown; unassignedNotes?: unknown };
  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates.flatMap((entry): ItineraryDocumentCandidate[] => {
        if (!entry || typeof entry !== 'object') return [];
        const source = entry as Record<string, unknown>;
        if (!candidateTypes.has(source.type as ItineraryDocumentCandidateType)) return [];
        return [{
          type: source.type as ItineraryDocumentCandidateType,
          name: asString(source.name) ?? undefined,
          providerVendor: asString(source.providerVendor),
          confirmationNumber: asString(source.confirmationNumber),
          totalCost: asNumber(source.totalCost),
          departureDate: asString(source.departureDate), arrivalDate: asString(source.arrivalDate),
          departureLocation: asString(source.departureLocation), arrivalLocation: asString(source.arrivalLocation),
          departureTime: asString(source.departureTime), arrivalTime: asString(source.arrivalTime),
          carrier: asString(source.carrier), flightNumber: asString(source.flightNumber),
          checkInDate: asString(source.checkInDate), checkOutDate: asString(source.checkOutDate),
          address: asString(source.address), rooms: asNumber(source.rooms),
          pickupDate: asString(source.pickupDate), dropoffDate: asString(source.dropoffDate),
          pickupLocation: asString(source.pickupLocation), dropoffLocation: asString(source.dropoffLocation),
          vehicleType: asString(source.vehicleType), activityDate: asString(source.activityDate),
          activityTime: asString(source.activityTime), duration: asString(source.duration), notes: asString(source.notes),
          date: asString(source.date), endDate: asString(source.endDate), location: asString(source.location),
          sourceExcerpt: asString(source.sourceExcerpt) ?? '',
          day: asNumber(source.day),
          flight: source.flight && typeof source.flight === 'object' ? {
            departureLocation: asString((source.flight as any).departureLocation),
            arrivalLocation: asString((source.flight as any).arrivalLocation),
            carrier: asString((source.flight as any).carrier),
            transferType: asString((source.flight as any).transferType),
          } : undefined,
          hotel: source.hotel && typeof source.hotel === 'object' ? { address: asString((source.hotel as any).address) } : undefined,
          carRental: source.carRental && typeof source.carRental === 'object' ? {
            pickupLocation: asString((source.carRental as any).pickupLocation),
            dropoffLocation: asString((source.carRental as any).dropoffLocation),
            vendor: asString((source.carRental as any).vendor),
          } : undefined,
          activity: source.activity && typeof source.activity === 'object' ? {
            activityType: asString((source.activity as any).activityType),
            startLocation: asString((source.activity as any).startLocation),
          } : undefined,
        }];
      })
    : [];
  const unassignedNotes = Array.isArray(parsed.unassignedNotes)
    ? parsed.unassignedNotes.map(asString).filter((value): value is string => Boolean(value)).join('\n\n')
    : asString(parsed.unassignedNotes) ?? '';
  const dayNotes = Array.isArray(parsed.dayNotes) ? parsed.dayNotes.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const body = asString(source.body);
    if (!body) return [];
    const parsedDay = asNumber(source.day);
    return [{
      day: parsedDay && parsedDay >= 1 ? Math.round(parsedDay) : null,
      date: asString(source.date),
      title: asString(source.title),
      body,
      sourceExcerpt: asString(source.sourceExcerpt) ?? '',
    }];
  }) : [];
  return { candidates, unassignedNotes, dayNotes, usage };
};

const ACTIVITY_RECOVERY_PROMPT = `Extract activities and day-specific notes from dated itinerary sections.
Return only JSON with this shape:
{"activities":[{"name":"specific named activity","day":1,"date":"YYYY-MM-DD or null","location":"location or null","activityType":"Tour|Hike|Sights & Landmarks|Ticketed Attraction|Day Trip|Food & Drink|Open Access|Outdoor Activity|Event|Reservation","time":"time or null","notes":"useful caveats or null","sourceExcerpt":"source wording"}],"dayNotes":[{"day":1,"date":"YYYY-MM-DD or null","title":"short title","body":"concise markdown","sourceExcerpt":"source wording"}]}

Rules:
- Extract every explicitly named sight, castle, temple, shrine, museum, garden, hike, tour, excursion,
  neighborhood walk, performance, market, or other scheduled experience. Booking status is irrelevant.
- Keep separate named activities as separate records; do not collapse an entire day into one generic activity.
- Preserve the supplied day/date. Never invent a name or date.
- Put useful day-specific content that is not safely a structured activity into dayNotes.
- Every supplied day section containing useful plans must produce at least one activity or dayNote.`;

type ActivityRecoveryResult = {
  candidates: ItineraryDocumentCandidate[];
  dayNotes: ExtractedItineraryDocument['dayNotes'];
  usage: ExtractedItineraryDocument['usage'];
};

const parseActivityRecovery = (
  raw: string,
  usage: ExtractedItineraryDocument['usage']
): ActivityRecoveryResult => {
  const parsed = JSON.parse(raw) as { activities?: unknown; dayNotes?: unknown };
  const candidates = Array.isArray(parsed.activities) ? parsed.activities.flatMap((entry): ItineraryDocumentCandidate[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const name = asString(source.name);
    if (!name) return [];
    return [{
      type: 'tour_activity',
      name,
      day: asNumber(source.day),
      date: asString(source.date),
      activityDate: asString(source.date),
      activityTime: asString(source.time),
      location: asString(source.location),
      notes: asString(source.notes),
      sourceExcerpt: asString(source.sourceExcerpt) ?? '',
      activity: {
        activityType: asString(source.activityType),
        startLocation: asString(source.location),
      },
    }];
  }) : [];
  const dayNotes = Array.isArray(parsed.dayNotes) ? parsed.dayNotes.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const body = asString(source.body);
    if (!body) return [];
    return [{
      day: asNumber(source.day),
      date: asString(source.date),
      title: asString(source.title),
      body,
      sourceExcerpt: asString(source.sourceExcerpt) ?? '',
    }];
  }) : [];
  return { candidates, dayNotes, usage };
};

const mergeActivityRecovery = (
  base: ExtractedItineraryDocument,
  recovered: ActivityRecoveryResult[],
  sections: ItineraryDocumentDaySection[]
): ExtractedItineraryDocument => {
  const candidates = [...base.candidates];
  const dayNotes = [...base.dayNotes];
  let promptTokens = base.usage.promptTokens;
  let completionTokens = base.usage.completionTokens;
  let estimatedCostUsd = base.usage.estimatedCostUsd;
  for (const result of recovered) {
    promptTokens += result.usage.promptTokens;
    completionTokens += result.usage.completionTokens;
    estimatedCostUsd += result.usage.estimatedCostUsd;
    for (const candidate of result.candidates) {
      const duplicate = candidates.some((existing) => existing.type === 'tour_activity'
        && (existing.activityDate ?? existing.date) === (candidate.activityDate ?? candidate.date)
        && overlapsText(existing.name, candidate.name));
      if (!duplicate) candidates.push(candidate);
    }
    for (const note of result.dayNotes) {
      const duplicate = dayNotes.some((existing) => existing.day === note.day && normalize(existing.body) === normalize(note.body));
      if (!duplicate) dayNotes.push(note);
    }
  }

  // Coverage guarantee: if the recovery model could not classify a dated section at all,
  // preserve its source content as a day note instead of silently dropping the day.
  for (const section of sections) {
    const covered = candidates.some((candidate) => candidate.type === 'tour_activity'
      && ((section.date && (candidate.activityDate ?? candidate.date) === section.date) || (section.day && candidate.day === section.day)))
      || dayNotes.some((note) => (section.date && note.date === section.date) || (section.day && note.day === section.day));
    if (!covered) {
      const body = section.text.slice(section.heading.length).trim().slice(0, 2_000);
      if (body) dayNotes.push({ day: section.day, date: section.date, title: section.heading, body, sourceExcerpt: section.text.slice(0, 500) });
    }
  }
  return { ...base, candidates, dayNotes, usage: { promptTokens, completionTokens, estimatedCostUsd } };
};

export const extractItineraryDocumentCandidates = async (params: {
  documentText: string;
  userId: string;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  correlationId?: string;
}): Promise<ExtractedItineraryDocument> => {
  const documentText = params.documentText.trim();
  if (!documentText) throw new Error('Document text is required');
  if (documentText.length > MAX_DOCUMENT_CHARS) throw new Error(`Document text exceeds the ${MAX_DOCUMENT_CHARS}-character limit`);

  const cacheKey = getDocumentHash(documentText, params.userId);
  const cached = extractionCache.get(cacheKey);
  if (cached) return cached;

  const active = await getActiveAiProvider(ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY);
  const apiKey = getConfiguredProviderApiKey(active.provider);
  if (!apiKey) throw new Error(`No API key is configured for ${active.provider}`);
  const provider = await resolveProvider(ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY, CALLER_ID);
  const model = active.model || provider.supportedModels[0];
  const context = createAiCallContext({
    correlationId: params.correlationId,
    featureKey: ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY,
    userId: params.userId,
    provider: provider.id,
    model,
    callerId: CALLER_ID,
  }) as AiCallContext & { apiKey?: string; usageAccountingEnabled?: boolean; usageWindowKey?: string; usageMetadata?: Record<string, unknown> };
  context.apiKey = apiKey;
  context.usageAccountingEnabled = true;
  context.usageWindowKey = new Date().toISOString().slice(0, 7);
  context.usageMetadata = { pipeline: ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY };
  const response = await provider.chatCompletion({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${params.tripStartDate || params.tripEndDate ? `Trip date context: ${params.tripStartDate ?? 'unknown'} through ${params.tripEndDate ?? 'unknown'}\n\n` : ''}${documentText}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 4000,
  }, context);
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('The document extractor returned an empty response');
  let result: ExtractedItineraryDocument;
  try {
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const estimatedMicros = estimateAiCostMicros({ provider: provider.id, model, promptTokens, completionTokens });
    result = parseExtraction(content, { promptTokens, completionTokens, estimatedCostUsd: (estimatedMicros ?? 0) / 1_000_000 });
  } catch {
    throw new Error('The document extractor returned invalid JSON');
  }

  const daySections = segmentItineraryDocumentDays({
    documentText,
    tripStartDate: params.tripStartDate,
    tripEndDate: params.tripEndDate,
  });
  if (daySections.length) {
    const recovered: ActivityRecoveryResult[] = [];
    const chunks = chunkDaySections(daySections);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const activityContext = createAiCallContext({
        correlationId: params.correlationId,
        featureKey: ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY,
        userId: params.userId,
        provider: provider.id,
        model,
        callerId: `${CALLER_ID}_ACTIVITY_RECOVERY`,
      }) as AiCallContext & { apiKey?: string; usageAccountingEnabled?: boolean; usageWindowKey?: string; usageMetadata?: Record<string, unknown> };
      activityContext.apiKey = apiKey;
      activityContext.usageAccountingEnabled = true;
      activityContext.usageWindowKey = new Date().toISOString().slice(0, 7);
      activityContext.usageMetadata = {
        pipeline: ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY,
        stage: 'activity_recovery',
        chunkIndex: index,
        chunkCount: chunks.length,
      };
      const chunkText = chunk.map((section) =>
        `[DAY ${section.day ?? 'unknown'} | DATE ${section.date ?? 'unknown'}]\n${section.text}`
      ).join('\n\n');
      try {
        const activityResponse = await provider.chatCompletion({
          model,
          messages: [
            { role: 'system', content: ACTIVITY_RECOVERY_PROMPT },
            { role: 'user', content: chunkText },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 6000,
        }, activityContext);
        const activityContent = activityResponse.choices?.[0]?.message?.content;
        if (!activityContent) throw new Error('empty activity recovery response');
        const promptTokens = activityResponse.usage?.prompt_tokens ?? 0;
        const completionTokens = activityResponse.usage?.completion_tokens ?? 0;
        const estimatedMicros = estimateAiCostMicros({ provider: provider.id, model, promptTokens, completionTokens });
        recovered.push(parseActivityRecovery(activityContent, {
          promptTokens,
          completionTokens,
          estimatedCostUsd: (estimatedMicros ?? 0) / 1_000_000,
        }));
      } catch (error) {
        logError(`[itinerary-document-import] activity recovery chunk ${index + 1}/${chunks.length} failed`, error);
      }
    }
    result = mergeActivityRecovery(result, recovered, daySections);
  }

  extractionCache.set(cacheKey, result);
  return result;
};

export const extractItineraryDocument = extractItineraryDocumentCandidates;

const normalize = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const overlapsText = (left: unknown, right: unknown): boolean => {
  const a = normalize(left); const b = normalize(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
};
const sharesNameToken = (left: unknown, right: unknown): boolean => {
  const ignored = new Set(['the', 'hotel', 'inn', 'resort', 'and']);
  const leftTokens = normalize(left).split(' ').filter((token) => token.length > 2 && !ignored.has(token));
  const rightTokens = new Set(normalize(right).split(' ').filter((token) => token.length > 2 && !ignored.has(token)));
  return leftTokens.some((token) => rightTokens.has(token));
};
const dayDistance = (left: unknown, right: unknown): number => {
  const a = Date.parse(String(left ?? '')); const b = Date.parse(String(right ?? ''));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86_400_000 : Number.POSITIVE_INFINITY;
};
const rangesOverlap = (aStart: unknown, aEnd: unknown, bStart: unknown, bEnd: unknown): boolean => {
  const a1 = Date.parse(String(aStart ?? '')); const a2 = Date.parse(String(aEnd ?? ''));
  const b1 = Date.parse(String(bStart ?? '')); const b2 = Date.parse(String(bEnd ?? ''));
  return [a1, a2, b1, b2].every(Number.isFinite) && a1 <= b2 && b1 <= a2;
};

export const isDuplicateItineraryCandidate = (
  candidate: ItineraryDocumentCandidate,
  existing: { flights: any[]; lodgings: any[]; activities: any[]; carRentals: any[] }
): boolean => {
  if (candidate.type === 'flight' || candidate.type === 'rail' || candidate.type === 'ferry_bus_transfer') {
    const date = candidate.departureDate ?? candidate.date;
    const departure = candidate.departureLocation ?? candidate.flight?.departureLocation ?? candidate.location;
    const arrival = candidate.arrivalLocation ?? candidate.flight?.arrivalLocation;
    return existing.flights.some((item) => dayDistance(date, item.departureDate) <= 1
      && (overlapsText(departure, item.departureLocation ?? item.departureAirportCode)
        || overlapsText(arrival, item.arrivalLocation ?? item.arrivalAirportCode)));
  }
  if (candidate.type === 'hotel') {
    return existing.lodgings.some((item) => rangesOverlap(candidate.checkInDate ?? candidate.date, candidate.checkOutDate ?? candidate.endDate, item.checkInDate ?? item.check_in_date, item.checkOutDate ?? item.check_out_date)
      && (sharesNameToken(candidate.name ?? candidate.providerVendor, item.name) || overlapsText(candidate.address ?? candidate.hotel?.address, item.address)));
  }
  if (candidate.type === 'tour_activity') {
    return existing.activities.some((item) => (candidate.activityDate ?? candidate.date) === item.date && overlapsText(candidate.name, item.name));
  }
  return existing.carRentals.some((item) => (candidate.pickupDate ?? candidate.date) === item.pickupDate
    && (overlapsText(candidate.providerVendor ?? candidate.carRental?.vendor, item.vendor) || overlapsText(candidate.pickupLocation ?? candidate.carRental?.pickupLocation ?? candidate.location, item.pickupLocation)));
};

export const findExistingTripItemMatches = (
  candidates: ItineraryImportCandidate[],
  existing: { flights: any[]; lodgings: any[]; activities: any[]; carRentals: any[] }
): ItineraryImportMatch[] => candidates.flatMap((candidate, candidateIndex) => {
  const collections = candidate.type === 'hotel'
    ? existing.lodgings
    : candidate.type === 'tour_activity'
      ? existing.activities
      : candidate.type === 'car_rental'
        ? existing.carRentals
        : existing.flights;
  const match = collections.find((item) => isDuplicateItineraryCandidate(candidate, {
    flights: candidate.type === 'flight' || candidate.type === 'rail' || candidate.type === 'ferry_bus_transfer' ? [item] : [],
    lodgings: candidate.type === 'hotel' ? [item] : [],
    activities: candidate.type === 'tour_activity' ? [item] : [],
    carRentals: candidate.type === 'car_rental' ? [item] : [],
  }));
  return match ? [{ candidateIndex, existingId: String(match.id ?? ''), existingType: candidate.type, reason: 'Matches an existing trip item by date and normalized identifying fields' }] : [];
});

const summarize = (candidate: ItineraryDocumentCandidate): string =>
  candidate.name || candidate.flightNumber || candidate.providerVendor || candidate.departureLocation || candidate.pickupLocation || candidate.type.replace(/_/g, ' ');

const validationReason = (candidate: ItineraryDocumentCandidate): string | null => {
  if ((candidate.type === 'flight' || candidate.type === 'rail' || candidate.type === 'ferry_bus_transfer')
    && (!(candidate.departureDate ?? candidate.date) || !(candidate.departureLocation ?? candidate.flight?.departureLocation ?? candidate.location) || !(candidate.arrivalLocation ?? candidate.flight?.arrivalLocation))) return 'Missing departure date or route';
  if (candidate.type === 'hotel' && (!candidate.name || !(candidate.checkInDate ?? candidate.date) || !(candidate.checkOutDate ?? candidate.endDate))) return 'Missing property name or stay dates';
  if (candidate.type === 'tour_activity' && (!candidate.name || !(candidate.activityDate ?? candidate.date))) return 'Missing activity name or date';
  if (candidate.type === 'car_rental' && (!(candidate.pickupDate ?? candidate.date) || !(candidate.pickupLocation ?? candidate.carRental?.pickupLocation ?? candidate.location))) return 'Missing pickup date or location';
  return null;
};

const appendImportedNotes = (current: string | null | undefined, filename: string, notes: string[]): { full: string; section: string } => {
  const safeFilename = filename.trim() || 'document';
  const section = `### Imported from ${safeFilename} — ${new Date().toISOString().slice(0, 10)}\n\n${notes.join('\n\n')}`;
  return { section, full: current?.trim() ? `${current.trim()}\n\n${section}` : section };
};

const dateForTripDay = (startDate: string | null | undefined, day: number | null | undefined): string | null => {
  if (!startDate || !day || day < 1) return null;
  const parsed = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + Math.round(day) - 1);
  return parsed.toISOString().slice(0, 10);
};

const tripDayForDate = (startDate: string | null | undefined, date: string | null | undefined): number | null => {
  if (!startDate || !date) return null;
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const target = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(target)) return null;
  const day = Math.round((target - start) / 86_400_000) + 1;
  return day >= 1 ? day : null;
};

const inferTripDurationDays = (trip: { startDate?: string | null; endDate?: string | null; durationDays?: number | null }, minimumDays: number): number => {
  if (trip.durationDays && trip.durationDays > 0) return Math.max(trip.durationDays, minimumDays);
  if (trip.startDate && trip.endDate) {
    const span = dayDistance(trip.startDate, trip.endDate);
    if (Number.isFinite(span)) return Math.max(Math.round(span) + 1, minimumDays);
  }
  return Math.max(1, minimumDays);
};

const addCandidateToMatchSet = (
  existing: { flights: any[]; lodgings: any[]; activities: any[]; carRentals: any[] },
  candidate: ItineraryDocumentCandidate,
  id: string
): void => {
  if (candidate.type === 'tour_activity') {
    existing.activities.push({ id, name: candidate.name, date: candidate.activityDate ?? candidate.date });
  } else if (candidate.type === 'hotel') {
    existing.lodgings.push({ id, name: candidate.name, address: candidate.address ?? candidate.hotel?.address, checkInDate: candidate.checkInDate ?? candidate.date, checkOutDate: candidate.checkOutDate ?? candidate.endDate });
  } else if (candidate.type === 'car_rental') {
    existing.carRentals.push({ id, pickupDate: candidate.pickupDate ?? candidate.date, vendor: candidate.providerVendor ?? candidate.carRental?.vendor, pickupLocation: candidate.pickupLocation ?? candidate.carRental?.pickupLocation ?? candidate.location });
  } else {
    existing.flights.push({ id, departureDate: candidate.departureDate ?? candidate.date, departureLocation: candidate.departureLocation ?? candidate.flight?.departureLocation ?? candidate.location, arrivalLocation: candidate.arrivalLocation ?? candidate.flight?.arrivalLocation });
  }
};

export const importItineraryDocument = async (params: {
  tripId: string;
  userId: string;
  documentText: string;
  sourceFilename: string;
  dryRun: boolean;
  correlationId?: string;
}): Promise<ImportDocumentResult> => {
  const membership = await ensureUserInTrip(params.tripId, params.userId);
  if (!membership) throw new Error('Not authorized to update this trip');
  const trip = await getTripById(params.tripId);
  if (!trip) throw new Error('Trip not found');
  const [extracted, flights, lodgings, activities, carRentals, itineraries] = await Promise.all([
    extractItineraryDocumentCandidates({ documentText: params.documentText, userId: params.userId, tripStartDate: trip.startDate, tripEndDate: trip.endDate, correlationId: params.correlationId }),
    listFlights(params.userId, params.tripId), listLodgings(params.userId, params.tripId),
    listActivities(params.userId, params.tripId), listCarRentals(params.userId, params.tripId),
    listItineraries(params.userId),
  ]);
  const existing = { flights, lodgings, activities, carRentals };
  const result: ImportDocumentResult = { dryRun: params.dryRun, added: [], skippedDuplicates: [], skippedUnparseable: [], notesAppended: false, notesPreview: null, usage: extracted.usage };

  for (const extractedCandidate of extracted.candidates) {
    const inferredDate = dateForTripDay(trip.startDate, extractedCandidate.day);
    const candidate: ItineraryDocumentCandidate = inferredDate && !extractedCandidate.date
      ? { ...extractedCandidate, date: inferredDate, activityDate: extractedCandidate.activityDate ?? inferredDate }
      : extractedCandidate;
    const summary = summarize(candidate);
    const reason = validationReason(candidate);
    if (reason) { result.skippedUnparseable.push({ type: candidate.type, name: summary, summary, excerpt: candidate.sourceExcerpt ?? '', reason }); continue; }
    const match = findExistingTripItemMatches([candidate], existing)[0];
    if (match) { result.skippedDuplicates.push({ type: candidate.type, name: summary, summary, matchedExistingId: match.existingId, reason: match.reason }); continue; }
    if (params.dryRun) {
      result.added.push({ type: candidate.type, id: null, name: summary, summary });
      addCandidateToMatchSet(existing, candidate, `dry-run:${result.added.length}`);
      continue;
    }
    let created: { id: string };
    if (candidate.type === 'hotel') {
      const checkInDate = candidate.checkInDate ?? candidate.date!;
      const checkOutDate = candidate.checkOutDate ?? candidate.endDate!;
      const nights = Math.max(1, Math.round(dayDistance(checkInDate, checkOutDate)));
      created = await insertLodging({ userId: params.userId, tripId: params.tripId, status: 'Proposed', name: candidate.name!, checkInDate, checkOutDate, rooms: candidate.rooms ?? 1, totalCost: candidate.totalCost ?? 0, costPerNight: (candidate.totalCost ?? 0) / nights, address: candidate.address ?? candidate.hotel?.address ?? candidate.location ?? '', paid_by: [], traveler_ids: [] });
    } else if (candidate.type === 'tour_activity') {
      const activityType = (candidate.activity?.activityType as any) || 'Tour';
      created = await insertActivity({ userId: params.userId, tripId: params.tripId, status: 'Proposed', activityType, date: candidate.activityDate ?? candidate.date!, name: candidate.name!, startLocation: candidate.activity?.startLocation ?? candidate.location ?? candidate.address ?? '', startTime: candidate.activityTime ?? '', duration: candidate.duration ?? '', cost: candidate.totalCost ?? 0, bookedOn: '', reference: candidate.confirmationNumber ?? '', notes: candidate.notes ?? '', paidBy: [], travelerIds: [] });
    } else if (candidate.type === 'car_rental') {
      const pickupDate = candidate.pickupDate ?? candidate.date!;
      created = await insertCarRental({ userId: params.userId, tripId: params.tripId, status: 'Proposed', pickupLocation: candidate.pickupLocation ?? candidate.carRental?.pickupLocation ?? candidate.location!, pickupDate, dropoffLocation: candidate.dropoffLocation ?? candidate.carRental?.dropoffLocation ?? '', dropoffDate: candidate.dropoffDate ?? candidate.endDate ?? pickupDate, reference: candidate.confirmationNumber ?? '', vendor: candidate.providerVendor ?? candidate.carRental?.vendor ?? '', prepaid: '', cost: candidate.totalCost ?? 0, model: candidate.vehicleType ?? '', notes: candidate.notes ?? '', paidBy: [], travelerIds: [] });
    } else {
      const transferType = (candidate.flight?.transferType as any) || (candidate.type === 'flight' ? 'Flight' : candidate.type === 'rail' ? 'Train' : 'Other');
      const departureDate = candidate.departureDate ?? candidate.date!;
      created = await insertFlight({ userId: params.userId, tripId: params.tripId, status: 'Proposed', transferType, passengerName: '', passengerIds: [], departureDate, arrivalDate: candidate.arrivalDate ?? candidate.endDate ?? departureDate, departureLocation: candidate.departureLocation ?? candidate.flight?.departureLocation ?? candidate.location!, departureTime: candidate.departureTime ?? '', arrivalLocation: candidate.arrivalLocation ?? candidate.flight?.arrivalLocation!, arrivalTime: candidate.arrivalTime ?? '', cost: candidate.totalCost ?? 0, carrier: candidate.carrier ?? candidate.flight?.carrier ?? candidate.providerVendor ?? '', flightNumber: candidate.flightNumber ?? '', bookingReference: candidate.confirmationNumber ?? '', paidBy: [] });
    }
    result.added.push({ type: candidate.type, id: created.id, name: summary, summary });
    // Keep the in-memory match set current so duplicate rows produced by different
    // extraction stages in this same import cannot both be written.
    addCandidateToMatchSet(existing, candidate, created.id);
  }

  if (extracted.dayNotes.length) {
    let itinerary = itineraries.find((entry) => entry.tripId === params.tripId) ?? null;
    const resolvedNotes = extracted.dayNotes.map((note) => ({
      ...note,
      day: note.day ?? tripDayForDate(trip.startDate, note.date),
    }));
    let existingDetails = itinerary ? await listItineraryDetails(params.userId, itinerary.id) : [];
    for (const note of resolvedNotes) {
      const name = note.title ?? `Day ${note.day ?? '?'} note`;
      if (!note.day) {
        result.skippedUnparseable.push({ type: 'day_note', name, summary: name, excerpt: note.sourceExcerpt, reason: 'Could not associate this note with a trip day' });
        continue;
      }
      const duplicate = existingDetails.find((detail) => detail.day === note.day
        && detail.kind === 'note'
        && normalize(detail.noteBody ?? detail.activity) === normalize(note.body));
      if (duplicate) {
        result.skippedDuplicates.push({ type: 'day_note', name, summary: name, matchedExistingId: duplicate.id, reason: 'The same note already exists on this day' });
        continue;
      }
      if (params.dryRun) {
        result.added.push({ type: 'day_note', id: null, name, summary: `${name}: ${note.body}` });
        continue;
      }
      if (!itinerary) {
        const minimumDays = Math.max(...resolvedNotes.map((entry) => entry.day ?? 1));
        itinerary = await createItineraryRecord(
          params.userId,
          params.tripId,
          trip.destination?.trim() || trip.name,
          inferTripDurationDays(trip, minimumDays),
          null
        );
      }
      const created = await addItineraryDetail(params.userId, itinerary.id, {
        day: note.day,
        activity: name,
        kind: 'note',
        noteBody: note.body,
      });
      existingDetails = [...existingDetails, created];
      result.added.push({ type: 'day_note', id: created.id, name, summary: `${name}: ${note.body}` });
    }
  }

  if (extracted.unassignedNotes.length) {
    const appended = appendImportedNotes(trip.notes, params.sourceFilename, [extracted.unassignedNotes]);
    result.notesPreview = appended.section;
    if (!params.dryRun) {
      await updateTripDetails(params.userId, params.tripId, { notes: appended.full });
      result.notesAppended = true;
    }
  }
  return result;
};

export const importItineraryDocumentIntoTrip = importItineraryDocument;
