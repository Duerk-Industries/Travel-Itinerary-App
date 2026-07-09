import { loadTravelFieldSpec, type TravelFieldSpec } from '../config/travelFieldSpec';

export type FieldEvaluation = {
  fieldName: string;
  required: boolean;
  typicallyPresent: boolean;
  present: boolean;
  blank: boolean;
  formatName: string | null;
  formatValid: boolean | null;
};

export type CrossFieldEvaluation = {
  rule: string;
  passed: boolean;
};

export type FieldEvaluatorResult = {
  itemType: string;
  fields: FieldEvaluation[];
  crossFieldChecks: CrossFieldEvaluation[];
};

const FIELD_ALIASES: Record<string, string[]> = {
  carrier: ['carrier', 'airline', 'providerVendor', 'vendor'],
  bookingReference: ['bookingReference', 'confirmationNumber', 'reference'],
  check_in_date: ['check_in_date', 'checkInDate'],
  check_out_date: ['check_out_date', 'checkOutDate'],
  total_cost: ['total_cost', 'totalCost'],
  cost_per_night: ['cost_per_night', 'costPerNight'],
  date: ['date', 'activityDate', 'departureDate'],
  startTime: ['startTime', 'activityTime', 'departureTime'],
  passengerName: ['passengerName', 'guestName', 'travelerName'],
  vendor: ['vendor', 'providerVendor'],
};

const getFieldValue = (fields: Record<string, unknown>, fieldName: string): unknown => {
  for (const key of [fieldName, ...(FIELD_ALIASES[fieldName] ?? [])]) {
    if (fields[key] !== undefined && fields[key] !== null) return fields[key];
  }
  return undefined;
};

const isBlank = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const normalizeForFormat = (value: unknown): string => String(value ?? '').trim();

const validateFormat = (value: unknown, formatName: string | null, spec: TravelFieldSpec): boolean | null => {
  if (!formatName) return null;
  const format = spec.formats[formatName];
  if (!format?.pattern) return true;
  return new RegExp(format.pattern).test(normalizeForFormat(value));
};

const parseIsoDate = (value: unknown): number | null => {
  const text = String(value ?? '').trim();
  // Extracted date fields are commonly stored as full ISO 8601 datetimes
  // (see semanticFieldHelpers.ts parseIsoLikeDate), not bare dates — accept
  // both so cross-field checks (e.g. check_out_date > check_in_date) aren't
  // silently skipped against real data.
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(text)) return null;
  const time = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text);
  return Number.isFinite(time) ? time : null;
};

const evaluateCrossFieldRule = (rule: string, fields: Record<string, unknown>): boolean => {
  const match = rule.match(/^([A-Za-z0-9_]+)\s*(>=|>)\s*([A-Za-z0-9_]+)$/);
  if (!match) return true;
  const [, leftName, op, rightName] = match;
  const left = parseIsoDate(getFieldValue(fields, leftName));
  const right = parseIsoDate(getFieldValue(fields, rightName));
  if (left === null || right === null) return true;
  return op === '>' ? left > right : left >= right;
};

export const evaluateFields = (
  itemType: string,
  extractedFields: Record<string, unknown>,
  spec = loadTravelFieldSpec()
): FieldEvaluatorResult => {
  const itemSpec = spec.itemTypes[itemType];
  if (!itemSpec) return { itemType, fields: [], crossFieldChecks: [] };

  const fields = Object.entries(itemSpec.fields).map(([fieldName, rule]) => {
    const value = getFieldValue(extractedFields, fieldName);
    const blank = isBlank(value);
    return {
      fieldName,
      required: Boolean(rule.required),
      typicallyPresent: Boolean(rule.typicallyPresent),
      present: !blank,
      blank,
      formatName: rule.format,
      formatValid: blank ? null : validateFormat(value, rule.format, spec),
    };
  });

  return {
    itemType,
    fields,
    crossFieldChecks: (itemSpec.crossFieldChecks ?? []).map((check) => ({
      rule: check.rule,
      passed: evaluateCrossFieldRule(check.rule, extractedFields),
    })),
  };
};
