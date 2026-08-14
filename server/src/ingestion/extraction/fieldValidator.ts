/**
 * Post-extraction plausibility validation.
 *
 * Every extraction strategy (regex, learned/source-specific, LLM) can produce a
 * value that "looks" extracted but is actually wrong — a garbled airport code, a
 * checkout date before check-in, a cost with a stray extra digit. None of the
 * strategies check this today; they just report whatever they matched at
 * whatever confidence they were hardcoded to report.
 *
 * This runs once, after a strategy has been selected, against the final result.
 * It never invents or corrects a value — it only downgrades confidence and
 * records *why*, so a bad value gets routed to LOW_CONFIDENCE review instead of
 * being silently trusted (or auto-assignable) at whatever confidence the
 * extractor happened to report.
 */
import { INGESTION_CONFIDENCE_REVIEW_READY } from '../config';
import type { ExtractionResult, ParsedItemCandidate } from '../contracts';
import { buildParsedItemFingerprint } from '../shared/hashing';
import { getAirportByIataCode } from '../../db';

const IATA_CODE_PATTERN = /^[A-Z]{3}$/;
const MIN_PLAUSIBLE_YEAR = 2000;
const MAX_PLAUSIBLE_YEAR_AHEAD = 5;
const MAX_PLAUSIBLE_COST = 1_000_000;

const airportExistsCache = new Map<string, Promise<boolean>>();

const airportCodeExists = async (code: string): Promise<boolean> => {
  const normalized = code.toUpperCase();
  if (!airportExistsCache.has(normalized)) {
    airportExistsCache.set(
      normalized,
      getAirportByIataCode(normalized).then((row) => row != null).catch(() => true) // fail-open: a lookup error shouldn't itself flag the item
    );
  }
  return airportExistsCache.get(normalized)!;
};

const isPlausibleYear = (isoDate: string): boolean => {
  const year = new Date(isoDate).getUTCFullYear();
  if (!Number.isFinite(year)) return true; // unparsable — not this check's job to flag
  const maxYear = new Date().getUTCFullYear() + MAX_PLAUSIBLE_YEAR_AHEAD;
  return year >= MIN_PLAUSIBLE_YEAR && year <= maxYear;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.replace(/[,$]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

const validateAirportCode = async (code: unknown, label: string, warnings: string[]): Promise<void> => {
  const value = String(code ?? '').trim().toUpperCase();
  if (!value) return;
  if (!IATA_CODE_PATTERN.test(value)) {
    warnings.push(`${label} "${value}" is not a 3-letter airport code`);
    return;
  }
  if (!(await airportCodeExists(value))) {
    warnings.push(`${label} "${value}" is not a recognized airport code`);
  }
};

const validateDateOrder = (
  startLabel: string,
  start: unknown,
  endLabel: string,
  end: unknown,
  warnings: string[]
): void => {
  const startValue = String(start ?? '').trim();
  const endValue = String(end ?? '').trim();
  if (!startValue || !endValue) return;
  const startMs = Date.parse(startValue);
  const endMs = Date.parse(endValue);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return;
  if (endMs < startMs) {
    warnings.push(`${endLabel} (${endValue}) is before ${startLabel} (${startValue})`);
  }
};

const validateDateField = (label: string, value: unknown, warnings: string[]): void => {
  const strValue = String(value ?? '').trim();
  if (!strValue) return;
  const parsed = Date.parse(strValue);
  if (Number.isNaN(parsed)) return;
  if (!isPlausibleYear(new Date(parsed).toISOString())) {
    warnings.push(`${label} "${strValue}" is outside a plausible date range`);
  }
};

const validateCostField = (label: string, value: unknown, warnings: string[]): void => {
  const numeric = asNumber(value);
  if (numeric == null) return;
  if (numeric < 0) {
    warnings.push(`${label} is negative (${numeric})`);
  } else if (numeric > MAX_PLAUSIBLE_COST) {
    warnings.push(`${label} (${numeric}) is implausibly large`);
  }
};

const validateCandidate = async (candidate: ParsedItemCandidate): Promise<string[]> => {
  const warnings: string[] = [];
  const fields = candidate.extractedFields ?? {};

  if (candidate.itemType === 'flight' || candidate.itemType === 'rail' || candidate.itemType === 'ferry_bus_transfer') {
    await validateAirportCode(fields.departureAirportCode, 'Departure airport code', warnings);
    await validateAirportCode(fields.arrivalAirportCode, 'Arrival airport code', warnings);
  }

  if (candidate.itemType === 'hotel') {
    validateDateOrder('check-in', fields.checkInDate, 'check-out', fields.checkOutDate, warnings);
    validateDateField('Check-in date', fields.checkInDate, warnings);
    validateDateField('Check-out date', fields.checkOutDate, warnings);
  }

  validateDateOrder('start', candidate.startDateTimeUtc, 'end', candidate.endDateTimeUtc, warnings);
  validateDateField('Start date', candidate.startDateTimeUtc, warnings);

  validateCostField('Cost', fields.cost, warnings);
  validateCostField('Total cost', fields.totalCost, warnings);

  return warnings;
};

/**
 * Runs plausibility checks against every parsed item in an extraction result and
 * downgrades confidence (routing the item to LOW_CONFIDENCE review) for any item
 * that fails one. Never mutates field values — only confidence, reviewStatus, and
 * an added `validationWarnings` field explaining what looked wrong, so the review
 * UI can show the user *why* an item needs a second look.
 */
export const validateAndAdjustExtractionResult = async (result: ExtractionResult): Promise<ExtractionResult> => {
  const parsedItems = await Promise.all(
    result.parsedItems.map(async (candidate) => {
      const warnings = await validateCandidate(candidate);
      if (!warnings.length) return candidate;

      const confidenceScore = Math.min(candidate.confidenceScore, INGESTION_CONFIDENCE_REVIEW_READY - 0.01);
      const updated: ParsedItemCandidate = {
        ...candidate,
        confidenceScore,
        reviewStatus: confidenceScore >= INGESTION_CONFIDENCE_REVIEW_READY ? 'READY_FOR_REVIEW' : 'LOW_CONFIDENCE',
        extractedFields: {
          ...candidate.extractedFields,
          validationWarnings: warnings,
        },
      };
      // Fingerprint is derived only from itemType/provider/confirmation/travelers/dates/route,
      // none of which this function touches — but recompute defensively so the fingerprint
      // never silently drifts out of sync with the object it's supposed to identify.
      updated.deduplicationFingerprint = buildParsedItemFingerprint(updated);
      return updated;
    })
  );

  return { ...result, parsedItems };
};
