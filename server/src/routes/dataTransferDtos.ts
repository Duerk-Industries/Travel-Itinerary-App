import { z } from 'zod';

/**
 * Request bodies for the reviewed CSV imports. One envelope for every entity: a client-generated
 * `importId` (the idempotency key), at most 150 rows, and per-row `fields` limited to an allow-list.
 * The envelope and each row are strict, so an unknown key is rejected rather than ignored.
 */
const importDto = (allowedFields: readonly string[]) => {
  const allowed = new Set(allowedFields);
  return z.object({
    tripId: z.uuid('tripId must be a UUID.'),
    importId: z.uuid('importId must be a UUID.'),
    rows: z.array(z.object({
      sourceRow: z.number().int().positive(),
      action: z.enum(['create', 'update']),
      existingId: z.string().trim().optional(),
      expectedFingerprint: z.string().optional(),
      fields: z.record(z.string(), z.unknown()),
    }).strict()).min(1).max(150),
  }).strict().superRefine((value, ctx) => {
    const sourceRows = new Set<number>();
    const updateIds = new Set<string>();
    value.rows.forEach((row, index) => {
      if (sourceRows.has(row.sourceRow)) ctx.addIssue({ code: 'custom', path: ['rows', index, 'sourceRow'], message: 'sourceRow values must be unique.' });
      sourceRows.add(row.sourceRow);
      if (row.action === 'update' && row.existingId) {
        if (updateIds.has(row.existingId)) ctx.addIssue({ code: 'custom', path: ['rows', index, 'existingId'], message: 'An update target may appear only once.' });
        updateIds.add(row.existingId);
      }
      Object.keys(row.fields).forEach((key) => {
        if (!allowed.has(key)) ctx.addIssue({ code: 'custom', path: ['rows', index, 'fields', key], message: `Unknown import field: ${key}.` });
      });
    });
  });
};

export const ACTIVITY_IMPORT_FIELDS = ['status', 'activityType', 'date', 'name', 'startLocation', 'startTime', 'duration', 'cost', 'freeCancelBy', 'bookedOn', 'reference', 'notes', 'paidBy', 'travelerIds'] as const;
export const LODGING_IMPORT_FIELDS = ['status', 'name', 'checkInDate', 'checkOutDate', 'rooms', 'refundBy', 'totalCost', 'costPerNight', 'address', 'notes', 'features', 'paidBy', 'travelerIds'] as const;
export const TRANSFER_IMPORT_FIELDS = ['status', 'transferType', 'departureDate', 'departureTime', 'arrivalDate', 'arrivalTime', 'departureLocation', 'arrivalLocation', 'carrier', 'flightNumber', 'cost', 'reference', 'paidBy', 'travelerIds'] as const;
export const CAR_RENTAL_IMPORT_FIELDS = ['status', 'vendor', 'model', 'pickupDate', 'pickupLocation', 'dropoffDate', 'dropoffLocation', 'prepaid', 'cost', 'reference', 'notes', 'paidBy', 'travelerIds'] as const;
export const DAY_PLAN_IMPORT_FIELDS = ['kind', 'date', 'time', 'title', 'cost', 'body', 'address', 'lat', 'lng', 'checklist', 'position'] as const;

export const importActivitiesDto = importDto(ACTIVITY_IMPORT_FIELDS);
export const importLodgingsDto = importDto(LODGING_IMPORT_FIELDS);
export const importTransfersDto = importDto(TRANSFER_IMPORT_FIELDS);
export const importCarRentalsDto = importDto(CAR_RENTAL_IMPORT_FIELDS);
export const importDayPlanDto = importDto(DAY_PLAN_IMPORT_FIELDS);

export type ImportRowsDto = z.infer<ReturnType<typeof importDto>>;
