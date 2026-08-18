import {
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
  updateTripDetails,
} from '../db';
import { createAiCallContext } from '../ai/registry/correlation';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import type { AiCallContext } from '../ai/types/aiChat';
import { getActiveAiProvider, getConfiguredProviderApiKey } from './aiProviderConfigService';
import { estimateAiCostMicros } from '../apis/providerBudgeting';

export const ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY = 'itinerary_document_import';
const CALLER_ID = 'ITINERARY_DOCUMENT_IMPORT';
const MAX_DOCUMENT_CHARS = 40_000;

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
  flight?: { departureLocation: string | null; arrivalLocation: string | null; carrier: string | null };
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
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};

export type ImportDocumentResult = {
  dryRun: boolean;
  added: Array<{ type: ItineraryDocumentCandidateType; id: string | null; name: string; summary: string }>;
  skippedDuplicates: Array<{ type: ItineraryDocumentCandidateType; name: string; summary: string; matchedExistingId: string; reason: string }>;
  skippedUnparseable: Array<{ type: ItineraryDocumentCandidateType; name: string; summary: string; excerpt: string; reason: string }>;
  notesAppended: boolean;
  notesPreview: string | null;
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};
export type ItineraryDocumentImportResult = ImportDocumentResult;

const SYSTEM_PROMPT = `Extract travel reservations and itinerary items from the supplied document.
Return only one JSON object with this shape:
{"candidates":[{"type":"flight|rail|ferry_bus_transfer|hotel|car_rental|tour_activity","name":"text","date":"YYYY-MM-DD or null","endDate":"YYYY-MM-DD or null","location":"text or null","notes":"text or null","sourceExcerpt":"source lines","flight":{"departureLocation":null,"arrivalLocation":null,"carrier":null},"hotel":{"address":null},"carRental":{"pickupLocation":null,"dropoffLocation":null,"vendor":null},"activity":{"activityType":null,"startLocation":null}}],"unassignedNotes":"clean markdown"}

For each candidate, include only values explicitly supported by the document. Useful fields are name,
providerVendor, confirmationNumber, totalCost, departureDate, arrivalDate, departureLocation,
arrivalLocation, departureTime, arrivalTime, carrier, flightNumber, checkInDate, checkOutDate,
address, rooms, pickupDate, dropoffDate, pickupLocation, dropoffLocation, vehicleType, activityDate,
activityTime, duration, and notes. Dates must be YYYY-MM-DD. Do not invent or infer structured values.
Do not return an itinerary status. Put useful prose that cannot be structured into unassignedNotes.`;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const asNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const candidateTypes = new Set<ItineraryDocumentCandidateType>([
  'flight', 'rail', 'ferry_bus_transfer', 'hotel', 'car_rental', 'tour_activity',
]);

const parseExtraction = (raw: string, usage: ExtractedItineraryDocument['usage']): ExtractedItineraryDocument => {
  const parsed = JSON.parse(raw) as { candidates?: unknown; unassignedNotes?: unknown };
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
          flight: source.flight && typeof source.flight === 'object' ? {
            departureLocation: asString((source.flight as any).departureLocation),
            arrivalLocation: asString((source.flight as any).arrivalLocation),
            carrier: asString((source.flight as any).carrier),
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
  return { candidates, unassignedNotes, usage };
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
  try {
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const estimatedMicros = estimateAiCostMicros({ provider: provider.id, model, promptTokens, completionTokens });
    return parseExtraction(content, { promptTokens, completionTokens, estimatedCostUsd: (estimatedMicros ?? 0) / 1_000_000 });
  } catch {
    throw new Error('The document extractor returned invalid JSON');
  }
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
  const [extracted, flights, lodgings, activities, carRentals] = await Promise.all([
    extractItineraryDocumentCandidates({ documentText: params.documentText, userId: params.userId, tripStartDate: trip.startDate, tripEndDate: trip.endDate, correlationId: params.correlationId }),
    listFlights(params.userId, params.tripId), listLodgings(params.userId, params.tripId),
    listActivities(params.userId, params.tripId), listCarRentals(params.userId, params.tripId),
  ]);
  const existing = { flights, lodgings, activities, carRentals };
  const result: ImportDocumentResult = { dryRun: params.dryRun, added: [], skippedDuplicates: [], skippedUnparseable: [], notesAppended: false, notesPreview: null, usage: extracted.usage };

  for (const candidate of extracted.candidates) {
    const summary = summarize(candidate);
    const reason = validationReason(candidate);
    if (reason) { result.skippedUnparseable.push({ type: candidate.type, name: summary, summary, excerpt: candidate.sourceExcerpt ?? '', reason }); continue; }
    const match = findExistingTripItemMatches([candidate], existing)[0];
    if (match) { result.skippedDuplicates.push({ type: candidate.type, name: summary, summary, matchedExistingId: match.existingId, reason: match.reason }); continue; }
    if (params.dryRun) { result.added.push({ type: candidate.type, id: null, name: summary, summary }); continue; }
    let created: { id: string };
    if (candidate.type === 'hotel') {
      const checkInDate = candidate.checkInDate ?? candidate.date!;
      const checkOutDate = candidate.checkOutDate ?? candidate.endDate!;
      const nights = Math.max(1, Math.round(dayDistance(checkInDate, checkOutDate)));
      created = await insertLodging({ userId: params.userId, tripId: params.tripId, status: 'Proposed', name: candidate.name!, checkInDate, checkOutDate, rooms: candidate.rooms ?? 1, totalCost: candidate.totalCost ?? 0, costPerNight: (candidate.totalCost ?? 0) / nights, address: candidate.address ?? candidate.hotel?.address ?? candidate.location ?? '', paid_by: [], traveler_ids: [] });
    } else if (candidate.type === 'tour_activity') {
      created = await insertActivity({ userId: params.userId, tripId: params.tripId, status: 'Proposed', activityType: 'Tour', date: candidate.activityDate ?? candidate.date!, name: candidate.name!, startLocation: candidate.activity?.startLocation ?? candidate.location ?? candidate.address ?? '', startTime: candidate.activityTime ?? '', duration: candidate.duration ?? '', cost: candidate.totalCost ?? 0, bookedOn: '', reference: candidate.confirmationNumber ?? '', notes: candidate.notes ?? '', paidBy: [], travelerIds: [] });
    } else if (candidate.type === 'car_rental') {
      const pickupDate = candidate.pickupDate ?? candidate.date!;
      created = await insertCarRental({ userId: params.userId, tripId: params.tripId, status: 'Proposed', pickupLocation: candidate.pickupLocation ?? candidate.carRental?.pickupLocation ?? candidate.location!, pickupDate, dropoffLocation: candidate.dropoffLocation ?? candidate.carRental?.dropoffLocation ?? '', dropoffDate: candidate.dropoffDate ?? candidate.endDate ?? pickupDate, reference: candidate.confirmationNumber ?? '', vendor: candidate.providerVendor ?? candidate.carRental?.vendor ?? '', prepaid: '', cost: candidate.totalCost ?? 0, model: candidate.vehicleType ?? '', notes: candidate.notes ?? '', paidBy: [], travelerIds: [] });
    } else {
      const transferType = candidate.type === 'flight' ? 'Flight' : candidate.type === 'rail' ? 'Train' : 'Other';
      const departureDate = candidate.departureDate ?? candidate.date!;
      created = await insertFlight({ userId: params.userId, tripId: params.tripId, status: 'Proposed', transferType, passengerName: '', passengerIds: [], departureDate, arrivalDate: candidate.arrivalDate ?? candidate.endDate ?? departureDate, departureLocation: candidate.departureLocation ?? candidate.flight?.departureLocation ?? candidate.location!, departureTime: candidate.departureTime ?? '', arrivalLocation: candidate.arrivalLocation ?? candidate.flight?.arrivalLocation!, arrivalTime: candidate.arrivalTime ?? '', cost: candidate.totalCost ?? 0, carrier: candidate.carrier ?? candidate.flight?.carrier ?? candidate.providerVendor ?? '', flightNumber: candidate.flightNumber ?? '', bookingReference: candidate.confirmationNumber ?? '', paidBy: [] });
    }
    result.added.push({ type: candidate.type, id: created.id, name: summary, summary });
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
