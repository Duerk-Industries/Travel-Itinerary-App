import { Router, type Request, type Response } from 'express';
import bodyParser from 'body-parser';
import { createHash, randomUUID } from 'crypto';
import type { ZodTypeAny } from 'zod';
import { authenticate } from '../auth';
import {
  addItineraryDetail,
  createItineraryRecord,
  deleteExpenseForSource,
  ensureUserInTrip,
  getActivityById,
  getCarRentalById,
  getCurrentDbProvider,
  getFlightById,
  getLodgingById,
  getTripById,
  insertActivity,
  insertCarRental,
  insertFlight,
  insertLodging,
  listGroupMembers,
  listItineraries,
  listItineraryDetails,
  updateActivity,
  updateCarRental,
  updateFlight,
  updateItineraryChecklistItem,
  updateItineraryDetail,
  updateLodging,
  upsertExpenseForSource,
} from '../db';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { HttpRateLimitExceededError, reserveDataTransferRateLimit } from '../services/httpRateLimitService';
import { normalizeItineraryStatus } from '../utils/itineraryStatus';
import { queryBlog } from '../db.postgres';
import { getDb as getFirebaseDb } from '../db.firebase';
import { readDto } from '../utils/dtoParse';
import { canonicalTransferType, dataTransferFingerprint, dateOnly, type DataTransferEntity } from '../utils/dataTransferFingerprint';
import { importActivitiesDto, importCarRentalsDto, importDayPlanDto, importLodgingsDto, importTransfersDto, type ImportRowsDto } from './dataTransferDtos';
import { logInfo, logError } from '../logger';

const router = Router();
const jsonBody = bodyParser.json({ limit: '256kb' });

type Receipt = { hash: string; response: unknown; createdAt: number };
const receipts = new Map<string, Receipt>();
const pruneReceipts = (): void => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, value] of receipts.entries()) if (value.createdAt < cutoff) receipts.delete(key);
};
const requestHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): string => String(value ?? '').trim();
const finite = (value: unknown): number => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; };
const has = (fields: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(fields, key);
const isIsoDate = (value: unknown): boolean => {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const date = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate;
};
const isClock = (value: unknown): boolean => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
};
const isNonNegativeNumber = (value: unknown): boolean => value == null || value === '' || (typeof value === 'number' ? Number.isFinite(value) && value >= 0 : /^\d+(?:\.\d+)?$/.test(text(value)));
const dayNumber = (tripStart: unknown, date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dateOnly(tripStart)}T00:00:00Z`)) / 86_400_000) + 1;

/** Thrown when an import id is reused with a different body; the handler answers 409. */
class ImportIdReuseError extends Error {}
const stringArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

type Row = ImportRowsDto['rows'][number];
type Context = {
  userId: string;
  tripId: string;
  groupId: string;
  members: Array<{ id: string; name: string }>;
  trip: any;
  /** Day-plan only: the trip's itinerary record, once resolved or created. */
  itineraryId?: string;
  details?: any[];
};

type EntityConfig = {
  entity: DataTransferEntity;
  /** Receipt key; the first two keep the names used before the other entities existed. */
  receiptEntity: string;
  schema: ZodTypeAny;
  caller: string;
  /** Feature flag that gates the entity itself, on top of activity_lodging_csv_import. */
  flag: string | null;
  /** An additional tier entitlement, if the entity's tab has one. */
  entitlement?: string;
  /** The stored record for an existing id, and the trip it belongs to. */
  load: (id: string, ctx: Context) => Promise<{ record: any; tripId: string } | null>;
  /** Field errors for a row; a partial update only checks the fields it sends. */
  validate: (row: Row, ctx: Context) => string[];
  /** An extra rule on the stored record an update targets. */
  validateExisting?: (record: any) => string | null;
  prepare?: (rows: Row[], ctx: Context) => Promise<void>;
  save: (row: Row, ctx: Context, current: any | null) => Promise<any>;
};

const reserve = async (userId: string, ip: string | undefined, caller: string, rows: number): Promise<void> => {
  await reserveDataTransferRateLimit(userId, ip);
  await reserveApiUsageOrThrow({ provider: 'DATA_TRANSFER_API', caller, units: rows, requireConfiguredLimit: true });
};

const durableReceipt = async (userId: string, tripId: string, entity: string, importId: string, hash: string): Promise<Receipt | null> => {
  pruneReceipts();
  if (getCurrentDbProvider() === 'firebase') {
    const ref = getFirebaseDb().collection('data_transfer_imports').doc(`${userId}_${tripId}_${entity}_${importId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() as any;
    if (data.payloadHash !== hash) throw new ImportIdReuseError('Import ID has already been used with a different payload.');
    const createdAt = data.createdAt?.toMillis?.() ?? Date.parse(String(data.createdAt ?? ''));
    return { hash: data.payloadHash, response: data.response, createdAt: Number.isFinite(createdAt) ? createdAt : Date.now() };
  }
  if (getCurrentDbProvider() !== 'postgres' && getCurrentDbProvider() !== 'memory') return receipts.get(`${userId}:${tripId}:${entity}:${importId}`) ?? null;
  const result = await queryBlog<any>('SELECT payload_hash as "payloadHash", response, created_at as "createdAt" FROM data_transfer_imports WHERE user_id = $1 AND trip_id = $2 AND entity = $3 AND import_id = $4 LIMIT 1', [userId, tripId, entity, importId]);
  const row = result.rows[0];
  if (!row) return null;
  if (row.payloadHash !== hash) throw new ImportIdReuseError('Import ID has already been used with a different payload.');
  return { hash: row.payloadHash, response: row.response, createdAt: new Date(row.createdAt).getTime() };
};

const saveReceipt = async (userId: string, tripId: string, entity: string, importId: string, hash: string, response: unknown): Promise<void> => {
  const key = `${userId}:${tripId}:${entity}:${importId}`;
  receipts.set(key, { hash, response, createdAt: Date.now() });
  if (getCurrentDbProvider() === 'firebase') {
    const ref = getFirebaseDb().collection('data_transfer_imports').doc(`${userId}_${tripId}_${entity}_${importId}`);
    await getFirebaseDb().runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) transaction.create(ref, { payloadHash: hash, response, status: 'completed', createdAt: new Date() });
    });
    return;
  }
  if (getCurrentDbProvider() !== 'postgres' && getCurrentDbProvider() !== 'memory') return;
  await queryBlog('INSERT INTO data_transfer_imports (id, user_id, trip_id, entity, import_id, payload_hash, response) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (user_id, trip_id, entity, import_id) DO NOTHING', [randomUUID(), userId, tripId, entity, importId, hash, JSON.stringify(response)]);
};

// ---------------------------------------------------------------------------------------------
// Activities

const activityMirror = async (record: any, ctx: Context): Promise<void> => {
  if (!record.date) await deleteExpenseForSource('activity', record.id, ctx.userId);
  else await upsertExpenseForSource({ userId: ctx.userId, tripId: ctx.tripId, groupId: ctx.groupId, expenseDate: record.date, category: 'Activities', amount: Number(record.cost) || 0, payerIds: record.paidBy ?? [], forIds: record.travelerIds ?? ctx.members.map((member) => member.id), sourceType: 'activity', sourceId: record.id });
};

const activities: EntityConfig = {
  entity: 'activities',
  receiptEntity: 'activities',
  schema: importActivitiesDto,
  caller: 'ACTIVITY_IMPORT_ROWS',
  flag: null,
  load: async (id) => { const record = await getActivityById(id); return record ? { record, tripId: record.tripId } : null; },
  validate: (row) => {
    const f = row.fields; const errors: string[] = [];
    if ((row.action === 'create' || has(f, 'name')) && !text(f.name)) errors.push('Activity name is required.');
    if (text(f.date) && !isIsoDate(f.date)) errors.push('Activity date must be a valid ISO date.');
    if (!isNonNegativeNumber(f.cost)) errors.push('Activity cost must be a finite non-negative number.');
    if (text(f.freeCancelBy) && !isIsoDate(f.freeCancelBy)) errors.push('Free cancellation date must be a valid ISO date.');
    return errors;
  },
  save: async (row, ctx, current) => {
    const f = row.fields;
    if (row.action === 'update') {
      // An update writes only the columns the file had; a missing column never resets a field.
      const patch: any = {};
      if (has(f, 'status')) patch.status = normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed');
      if (has(f, 'activityType')) patch.activityType = text(f.activityType) || 'Other';
      if (has(f, 'date')) patch.date = text(f.date);
      if (has(f, 'name')) patch.name = text(f.name);
      if (has(f, 'startLocation')) patch.startLocation = text(f.startLocation);
      if (has(f, 'startTime')) patch.startTime = text(f.startTime);
      if (has(f, 'duration')) patch.duration = text(f.duration);
      if (has(f, 'cost')) patch.cost = finite(f.cost);
      if (has(f, 'freeCancelBy')) patch.freeCancelBy = text(f.freeCancelBy) || null;
      if (has(f, 'bookedOn')) patch.bookedOn = text(f.bookedOn);
      if (has(f, 'reference')) patch.reference = text(f.reference);
      if (has(f, 'notes')) patch.notes = text(f.notes);
      if (has(f, 'paidBy')) patch.paidBy = stringArray(f.paidBy);
      if (has(f, 'travelerIds')) patch.travelerIds = stringArray(f.travelerIds);
      const record = await updateActivity(row.existingId!, ctx.userId, patch);
      if (!record) throw new Error(`Activity row ${row.sourceRow} could not be saved.`);
      await activityMirror(record, ctx);
      return record;
    }
    const defaultTravelers = ctx.members.map((member) => member.id);
    const record = await insertActivity({
      userId: ctx.userId, tripId: ctx.tripId, status: normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed'), activityType: (text(f.activityType) || 'Other') as any,
      date: text(f.date), name: text(f.name), startLocation: text(f.startLocation), startTime: text(f.startTime), duration: text(f.duration),
      cost: finite(f.cost), freeCancelBy: text(f.freeCancelBy) || null, bookedOn: text(f.bookedOn), reference: text(f.reference), notes: text(f.notes),
      paidBy: stringArray(f.paidBy), travelerIds: stringArray(f.travelerIds).length ? stringArray(f.travelerIds) : defaultTravelers,
    } as any);
    if (!record) throw new Error(`Activity row ${row.sourceRow} could not be saved.`);
    await activityMirror(record, ctx);
    return record;
  },
};

// ---------------------------------------------------------------------------------------------
// Lodging

const lodgingMirror = async (record: any, ctx: Context, fallbackTravelers: string[]): Promise<void> => {
  await upsertExpenseForSource({ userId: ctx.userId, tripId: ctx.tripId, groupId: ctx.groupId, expenseDate: record.checkInDate ?? record.check_in_date, category: 'Lodging', amount: Number(record.totalCost ?? record.total_cost) || 0, payerIds: record.paidBy ?? [], forIds: record.travelerIds ?? fallbackTravelers, sourceType: 'lodging', sourceId: record.id });
};

const lodgings: EntityConfig = {
  entity: 'lodgings',
  receiptEntity: 'lodgings',
  schema: importLodgingsDto,
  caller: 'LODGING_IMPORT_ROWS',
  flag: null,
  load: async (id) => { const record: any = await getLodgingById(id); return record ? { record, tripId: record.tripId ?? record.trip_id } : null; },
  validate: (row) => {
    const f = row.fields; const errors: string[] = [];
    const create = row.action === 'create';
    if ((create || has(f, 'name')) && !text(f.name)) errors.push('Lodging name is required.');
    if (create && (!text(f.checkInDate) || !text(f.checkOutDate))) errors.push('Lodging dates are required.');
    if ((create || has(f, 'checkInDate')) && !isIsoDate(f.checkInDate)) errors.push('Check-in must be a valid ISO date.');
    if ((create || has(f, 'checkOutDate')) && !isIsoDate(f.checkOutDate)) errors.push('Check-out must be a valid ISO date.');
    if (has(f, 'checkInDate') && has(f, 'checkOutDate') && text(f.checkOutDate) <= text(f.checkInDate)) errors.push('Check-out must follow check-in.');
    if (!isNonNegativeNumber(f.totalCost) || !isNonNegativeNumber(f.costPerNight)) errors.push('Lodging costs must be finite non-negative numbers.');
    return errors;
  },
  save: async (row, ctx, current) => {
    const f = row.fields;
    const defaultTravelers = ctx.members.map((member) => member.id);
    if (row.action === 'update') {
      const patch: any = { trip_id: ctx.tripId };
      if (has(f, 'name')) patch.name = text(f.name);
      if (has(f, 'status')) patch.status = normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed');
      if (has(f, 'checkInDate')) patch.check_in_date = text(f.checkInDate);
      if (has(f, 'checkOutDate')) patch.check_out_date = text(f.checkOutDate);
      if (has(f, 'rooms')) patch.rooms = Math.max(1, Number(f.rooms) || 1);
      if (has(f, 'refundBy')) patch.refund_by = text(f.refundBy) || null;
      if (has(f, 'totalCost')) patch.total_cost = finite(f.totalCost);
      if (has(f, 'costPerNight')) patch.cost_per_night = finite(f.costPerNight);
      if (has(f, 'address')) patch.address = text(f.address);
      if (has(f, 'notes')) patch.notes = text(f.notes) || null;
      if (has(f, 'features')) patch.features = stringArray(f.features);
      if (has(f, 'paidBy')) patch.paid_by = stringArray(f.paidBy);
      if (has(f, 'travelerIds')) patch.traveler_ids = stringArray(f.travelerIds);
      const record = await updateLodging(row.existingId!, ctx.userId, patch);
      if (!record) throw new Error(`Lodging row ${row.sourceRow} could not be saved.`);
      await lodgingMirror(record, ctx, defaultTravelers);
      return record;
    }
    const paidBy = stringArray(f.paidBy);
    const travelers = stringArray(f.travelerIds).length ? stringArray(f.travelerIds) : (paidBy.length ? paidBy : defaultTravelers);
    const record = await insertLodging({
      userId: ctx.userId, tripId: ctx.tripId, status: normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed'), name: text(f.name), checkInDate: text(f.checkInDate),
      checkOutDate: text(f.checkOutDate), rooms: Math.max(1, Number(f.rooms) || 1), refundBy: text(f.refundBy) || null, totalCost: finite(f.totalCost),
      costPerNight: finite(f.costPerNight), address: text(f.address), notes: text(f.notes) || null, features: stringArray(f.features), paid_by: paidBy, traveler_ids: travelers, imageUrl: null,
    } as any);
    if (!record) throw new Error(`Lodging row ${row.sourceRow} could not be saved.`);
    await lodgingMirror(record, ctx, travelers);
    return record;
  },
};

// ---------------------------------------------------------------------------------------------
// Ground transfers (flights are not imported from CSV)

const transferMirror = async (record: any, ctx: Context): Promise<void> => {
  const payers = Array.isArray(record.paidBy) ? record.paidBy : [];
  const passengers = Array.isArray(record.passengerIds) && record.passengerIds.length ? record.passengerIds : payers;
  await upsertExpenseForSource({ userId: ctx.userId, tripId: ctx.tripId, groupId: ctx.groupId, expenseDate: record.departureDate, category: 'Flights', amount: Number(record.cost) || 0, payerIds: payers, forIds: passengers, sourceType: 'flight', sourceId: record.id });
};

const GROUND_TYPES = ['Public Transit', 'Private Transfer', 'Other'];
const groundTransferType = (value: unknown): string | null => {
  const raw = text(value);
  const canonical = canonicalTransferType(raw);
  return canonical !== 'Flight' && GROUND_TYPES.includes(canonical) ? canonical : null;
};

const transfers: EntityConfig = {
  entity: 'transfers',
  receiptEntity: 'transfers',
  schema: importTransfersDto,
  caller: 'TRANSFER_IMPORT_ROWS',
  flag: 'ground_transfer_csv_import',
  load: async (id) => { const record: any = await getFlightById(id); return record ? { record, tripId: record.tripId } : null; },
  validateExisting: (record) => (canonicalTransferType(record.transferType ?? record.transfer_type) === 'Flight' ? 'Flights cannot be changed by CSV import.' : null),
  validate: (row) => {
    const f = row.fields; const errors: string[] = [];
    const create = row.action === 'create';
    if ((create || has(f, 'transferType')) && !groundTransferType(f.transferType)) errors.push('Transfer type must be Public Transit, Private Transfer or Other; flights are not imported from CSV.');
    if ((create || has(f, 'departureLocation')) && !text(f.departureLocation)) errors.push('Departure location is required.');
    if ((create || has(f, 'arrivalLocation')) && !text(f.arrivalLocation)) errors.push('Arrival location is required.');
    if ((create || has(f, 'departureDate')) && !isIsoDate(f.departureDate)) errors.push('Departure date must be a valid ISO date.');
    if (text(f.arrivalDate) && !isIsoDate(f.arrivalDate)) errors.push('Arrival date must be a valid ISO date.');
    for (const key of ['departureTime', 'arrivalTime']) if (text(f[key]) && !isClock(f[key])) errors.push(`${key === 'departureTime' ? 'Departure' : 'Arrival'} time must be HH:mm.`);
    const departureDate = text(f.departureDate); const arrivalDate = text(f.arrivalDate) || departureDate;
    if (departureDate && arrivalDate && isIsoDate(departureDate) && isIsoDate(arrivalDate)) {
      if (arrivalDate < departureDate) errors.push('Arrival is before departure.');
      else if (isClock(f.departureTime) && isClock(f.arrivalTime) && `${arrivalDate}T${text(f.arrivalTime).padStart(5, '0')}` <= `${departureDate}T${text(f.departureTime).padStart(5, '0')}`) errors.push('Arrival must be after departure.');
    }
    if (!isNonNegativeNumber(f.cost)) errors.push('Transfer cost must be a finite non-negative number.');
    return errors;
  },
  save: async (row, ctx) => {
    const f = row.fields;
    if (row.action === 'update') {
      const patch: any = {};
      if (has(f, 'status')) patch.status = normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed');
      if (has(f, 'transferType')) patch.transferType = groundTransferType(f.transferType) ?? 'Other';
      if (has(f, 'departureDate')) patch.departureDate = text(f.departureDate);
      if (has(f, 'departureTime')) patch.departureTime = text(f.departureTime) || '00:00';
      if (has(f, 'arrivalDate')) patch.arrivalDate = text(f.arrivalDate) || text(f.departureDate);
      if (has(f, 'arrivalTime')) patch.arrivalTime = text(f.arrivalTime) || '00:00';
      if (has(f, 'departureLocation')) patch.departureLocation = text(f.departureLocation);
      if (has(f, 'arrivalLocation')) patch.arrivalLocation = text(f.arrivalLocation);
      if (has(f, 'carrier')) patch.carrier = text(f.carrier);
      if (has(f, 'flightNumber')) patch.flightNumber = text(f.flightNumber);
      if (has(f, 'cost')) patch.cost = finite(f.cost);
      if (has(f, 'reference')) patch.bookingReference = text(f.reference);
      if (has(f, 'paidBy')) patch.paidBy = stringArray(f.paidBy);
      const record: any = await updateFlight(row.existingId!, ctx.userId, patch);
      if (!record) throw new Error(`Transfer row ${row.sourceRow} could not be saved.`);
      await transferMirror(record, ctx);
      return record;
    }
    // Travelers default to everyone on the trip, as the other imports do.
    const passengerIds = stringArray(f.travelerIds).length ? stringArray(f.travelerIds) : ctx.members.map((member) => member.id);
    const departureDate = text(f.departureDate);
    const record: any = await insertFlight({
      userId: ctx.userId, tripId: ctx.tripId, status: normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed'), transferType: groundTransferType(f.transferType) as any,
      passengerName: ctx.members.filter((member) => passengerIds.includes(member.id)).map((member) => member.name).join(', ') || 'Passenger', passengerIds,
      departureDate, departureLocation: text(f.departureLocation), departureTime: text(f.departureTime) || '00:00', arrivalLocation: text(f.arrivalLocation),
      arrivalDate: text(f.arrivalDate) || departureDate, arrivalTime: text(f.arrivalTime) || '00:00', cost: finite(f.cost), carrier: text(f.carrier),
      flightNumber: text(f.flightNumber), bookingReference: text(f.reference), paidBy: stringArray(f.paidBy),
    } as any);
    if (!record) throw new Error(`Transfer row ${row.sourceRow} could not be saved.`);
    await transferMirror(record, ctx);
    return record;
  },
};

// ---------------------------------------------------------------------------------------------
// Car rentals

const rentalMirror = async (record: any, ctx: Context): Promise<void> => {
  await upsertExpenseForSource({ userId: ctx.userId, tripId: ctx.tripId, groupId: ctx.groupId, expenseDate: text(record.pickupDate) || new Date().toISOString().slice(0, 10), category: 'Car Rentals', amount: Number(record.cost) || 0, payerIds: Array.isArray(record.paidBy) ? record.paidBy : [], forIds: Array.isArray(record.travelerIds) ? record.travelerIds : [], sourceType: 'car_rental', sourceId: record.id });
};

const carRentals: EntityConfig = {
  entity: 'car-rentals',
  receiptEntity: 'car-rentals',
  schema: importCarRentalsDto,
  caller: 'CAR_RENTAL_IMPORT_ROWS',
  flag: 'car_rental_csv_import',
  entitlement: 'car_rentals',
  load: async (id) => { const record: any = await getCarRentalById(id); return record ? { record, tripId: record.tripId } : null; },
  validate: (row) => {
    const f = row.fields; const errors: string[] = [];
    const create = row.action === 'create';
    if ((create || has(f, 'pickupDate')) && !isIsoDate(f.pickupDate)) errors.push('Pick-up date must be a valid ISO date.');
    if ((create || has(f, 'dropoffDate')) && !isIsoDate(f.dropoffDate)) errors.push('Drop-off date must be a valid ISO date.');
    if (isIsoDate(f.pickupDate) && isIsoDate(f.dropoffDate) && text(f.dropoffDate) < text(f.pickupDate)) errors.push('Drop-off is before pick-up.');
    if ((create || has(f, 'pickupLocation')) && !text(f.pickupLocation)) errors.push('Pick-up location is required.');
    if (!isNonNegativeNumber(f.cost)) errors.push('Car rental cost must be a finite non-negative number.');
    return errors;
  },
  save: async (row, ctx) => {
    const f = row.fields;
    if (row.action === 'update') {
      const patch: any = {};
      if (has(f, 'status')) patch.status = normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed');
      if (has(f, 'vendor')) patch.vendor = text(f.vendor);
      if (has(f, 'model')) patch.model = text(f.model);
      if (has(f, 'pickupDate')) patch.pickupDate = text(f.pickupDate);
      if (has(f, 'pickupLocation')) patch.pickupLocation = text(f.pickupLocation);
      if (has(f, 'dropoffDate')) patch.dropoffDate = text(f.dropoffDate);
      if (has(f, 'dropoffLocation')) patch.dropoffLocation = text(f.dropoffLocation);
      if (has(f, 'prepaid')) patch.prepaid = text(f.prepaid);
      if (has(f, 'cost')) patch.cost = finite(f.cost);
      if (has(f, 'reference')) patch.reference = text(f.reference);
      if (has(f, 'notes')) patch.notes = text(f.notes);
      if (has(f, 'paidBy')) patch.paidBy = stringArray(f.paidBy);
      if (has(f, 'travelerIds')) patch.travelerIds = stringArray(f.travelerIds);
      const record = await updateCarRental(row.existingId!, ctx.userId, patch);
      if (!record) throw new Error(`Car rental row ${row.sourceRow} could not be saved.`);
      await rentalMirror(record, ctx);
      return record;
    }
    const record = await insertCarRental({
      userId: ctx.userId, tripId: ctx.tripId, status: normalizeItineraryStatus(text(f.status) || 'Proposed', 'Proposed'), pickupLocation: text(f.pickupLocation), pickupDate: text(f.pickupDate),
      dropoffLocation: text(f.dropoffLocation), dropoffDate: text(f.dropoffDate), reference: text(f.reference), vendor: text(f.vendor), prepaid: text(f.prepaid), cost: finite(f.cost),
      model: text(f.model), notes: text(f.notes), paidBy: stringArray(f.paidBy), travelerIds: stringArray(f.travelerIds).length ? stringArray(f.travelerIds) : ctx.members.map((member) => member.id),
    } as any);
    if (!record) throw new Error(`Car rental row ${row.sourceRow} could not be saved.`);
    await rentalMirror(record, ctx);
    return record;
  },
};

// ---------------------------------------------------------------------------------------------
// Day-plan items (notes, checklists, places and custom activities on a day)

const DAY_PLAN_KINDS = ['activity', 'place', 'note', 'checklist'];

/** A place keeps its address and coordinates in the body: the import never calls a places API. */
const dayPlanBody = (fields: Record<string, unknown>): string | null => {
  const coordinates = Number.isFinite(Number(fields.lat)) && Number.isFinite(Number(fields.lng)) && fields.lat !== undefined && fields.lng !== undefined ? `Coordinates: ${fields.lat}, ${fields.lng}` : '';
  const parts = [text(fields.body), text(fields.address) ? `Address: ${text(fields.address)}` : '', coordinates].filter(Boolean);
  return parts.length ? parts.join('\n') : null;
};

const dayPlan: EntityConfig = {
  entity: 'day-plan',
  receiptEntity: 'day-plan',
  schema: importDayPlanDto,
  caller: 'DAY_PLAN_IMPORT_ROWS',
  flag: 'day_plan_csv_import',
  load: async (id, ctx) => {
    const record = ctx.details?.find((detail) => detail.id === id);
    return record ? { record, tripId: ctx.tripId } : null;
  },
  validate: (row, ctx) => {
    const f = row.fields; const errors: string[] = [];
    const create = row.action === 'create';
    if ((create || has(f, 'kind')) && !DAY_PLAN_KINDS.includes(text(f.kind))) errors.push('Kind must be activity, place, note or checklist.');
    if ((create || has(f, 'title')) && !text(f.title)) errors.push('Title is required.');
    if (create || has(f, 'date')) {
      if (!isIsoDate(f.date)) errors.push('Date must be a valid ISO date.');
      else if (!ctx.trip?.startDate) errors.push('The trip needs a start date before day-plan items can be imported.');
      else if (dayNumber(ctx.trip.startDate, text(f.date)) < 1) errors.push('This date is before the trip starts.');
    }
    if (text(f.kind) === 'checklist' && create && !(Array.isArray(f.checklist) && f.checklist.length)) errors.push('A checklist needs at least one item.');
    if (f.cost != null && f.cost !== '' && !isNonNegativeNumber(f.cost)) errors.push('Cost must be a finite non-negative number.');
    if (has(f, 'position') && !(Number.isInteger(Number(f.position)) && Number(f.position) > 0)) errors.push('Order must be a positive whole number.');
    return errors;
  },
  prepare: async (rows, ctx) => {
    const itineraries = await listItineraries(ctx.userId);
    const existing = itineraries.find((itinerary) => itinerary.tripId === ctx.tripId);
    if (existing) {
      ctx.itineraryId = existing.id;
      ctx.details = await listItineraryDetails(ctx.userId, existing.id);
    } else {
      ctx.details = [];
    }
  },
  save: async (row, ctx, current) => {
    const f = row.fields;
    if (!ctx.itineraryId) {
      // The first day-plan row on a trip with no itinerary record creates it, sized to the trip.
      const firstDay = dayNumber(ctx.trip.startDate, text(f.date));
      const span = ctx.trip.startDate && ctx.trip.endDate ? dayNumber(ctx.trip.startDate, dateOnly(ctx.trip.endDate)) : 0;
      const created = await createItineraryRecord(ctx.userId, ctx.tripId, ctx.trip.destination?.trim() || ctx.trip.name, Math.max(ctx.trip.durationDays ?? 0, span, firstDay, 1), null);
      ctx.itineraryId = created.id;
    }
    const day = f.date !== undefined ? dayNumber(ctx.trip.startDate, text(f.date)) : undefined;
    if (row.action === 'update') {
      const noteTouched = has(f, 'body') || has(f, 'address') || has(f, 'lat');
      const updated = await updateItineraryDetail(ctx.userId, row.existingId!, {
        day: day ?? current.day,
        time: has(f, 'time') ? (text(f.time) || null) : (current.time ?? null),
        activity: has(f, 'title') ? text(f.title) : current.activity,
        cost: has(f, 'cost') ? (f.cost == null || f.cost === '' ? null : finite(f.cost)) : (current.cost ?? null),
        ...(noteTouched ? { noteBody: dayPlanBody(f) } : {}),
        ...(has(f, 'position') ? { position: Number(f.position) } : {}),
      });
      return updated;
    }
    const kind = text(f.kind) as 'activity' | 'place' | 'note' | 'checklist';
    const items = kind === 'checklist' && Array.isArray(f.checklist) ? (f.checklist as Array<{ label?: unknown; checked?: unknown }>) : [];
    const created = await addItineraryDetail(ctx.userId, ctx.itineraryId!, {
      day: day!, time: text(f.time) || null, activity: text(f.title), cost: f.cost == null || f.cost === '' ? null : finite(f.cost), kind,
      noteBody: kind === 'checklist' ? null : dayPlanBody(f), ...(has(f, 'position') ? { position: Number(f.position) } : {}),
      checklistItems: items.map((item, position) => ({ label: text(item.label), position })).filter((item) => item.label),
    });
    // Checked entries are attributed to the person importing: who ticked them is not portable.
    const labelled = items.filter((item) => text(item.label));
    for (const [index, item] of labelled.entries()) {
      const child = created.checklistItems?.[index];
      if (item.checked === true && child) await updateItineraryChecklistItem(ctx.userId, child.id, { checked: true });
    }
    return created;
  },
};

// ---------------------------------------------------------------------------------------------

const handle = (config: EntityConfig) => async (req: Request, res: Response): Promise<void> => {
  const startedAt = Date.now();
  const userId = String((req as any).user.userId);
  const role = ((req as any).user.role ?? 'user') as 'user' | 'admin';
  const dto = readDto(config.schema, req.body ?? {}, res) as ImportRowsDto | null;
  if (!dto) return;
  try {
    await assertCanUseFeature(userId, 'activity_lodging_csv_import', role);
    if (config.flag) await assertCanUseFeature(userId, config.flag, role);
    if (config.entitlement) await assertCanUseFeature(userId, config.entitlement, role);
    const membership = await ensureUserInTrip(dto.tripId, userId);
    if (!membership) { res.status(403).json({ error: 'You must be an editor in this trip.' }); return; }
    const hash = requestHash(dto);
    const existing = await durableReceipt(userId, dto.tripId, config.receiptEntity, dto.importId, hash);
    if (existing) { res.json(existing.response); return; }
    const trip: any = await getTripById(dto.tripId);
    const memberRows = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const ctx: Context = {
      userId, tripId: dto.tripId, groupId: membership.groupId, trip,
      members: memberRows.map((member: any) => ({ id: String(member.id), name: member.guestName || `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || member.email || 'Passenger' })),
    };
    await config.prepare?.(dto.rows, ctx);

    const invalid: Array<{ sourceRow: number; error: string }> = [];
    const currents = new Map<number, any>();
    for (const row of dto.rows) {
      const add = (error: string) => invalid.push({ sourceRow: row.sourceRow, error });
      config.validate(row, ctx).forEach(add);
      if (row.action === 'update' && !row.existingId) add('Update rows require existingId.');
      if (row.action === 'create' && row.existingId) add('Create rows may not include an existingId.');
      if (row.existingId) {
        const loaded = await config.load(row.existingId, ctx);
        if (!loaded || String(loaded.tripId) !== dto.tripId) { add('Record is not in this trip.'); continue; }
        const stateError = config.validateExisting?.(loaded.record);
        if (stateError) add(stateError);
        if (row.expectedFingerprint && dataTransferFingerprint(config.entity, loaded.record, { tripStart: trip?.startDate ?? null }) !== row.expectedFingerprint) add('Record changed since review.');
        currents.set(row.sourceRow, loaded.record);
      }
    }
    if (invalid.length) { res.status(422).json({ error: 'Import validation failed.', rows: invalid }); return; }
    await reserve(userId, req.ip, config.caller, dto.rows.length);

    const records: unknown[] = [];
    for (const row of dto.rows) records.push(await config.save(row, ctx, currents.get(row.sourceRow) ?? null));
    const response = { importId: dto.importId, created: dto.rows.filter((row) => row.action === 'create').length, updated: dto.rows.filter((row) => row.action === 'update').length, records };
    await saveReceipt(userId, dto.tripId, config.receiptEntity, dto.importId, hash, response);
    logInfo(`[data-transfer] entity=${config.receiptEntity} result=success rows=${dto.rows.length} durationMs=${Date.now() - startedAt}`);
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof HttpRateLimitExceededError) { res.setHeader('Retry-After', String(error.retryAfterSeconds)); res.status(429).json({ error: error.message }); return; }
    if (error instanceof ImportIdReuseError) { res.status(409).json({ error: error.message }); return; }
    if (error instanceof ApiLimitExceededError) { res.status(429).json({ error: error.message }); return; }
    if (error instanceof EntitlementError) { res.status(error.code === 'FEATURE_DISABLED' ? 404 : 402).json({ error: error.message, code: error.code }); return; }
    const message = (error as Error).message;
    logError(`[data-transfer] entity=${config.receiptEntity} result=error durationMs=${Date.now() - startedAt}`);
    res.status(500).json({ error: message });
  }
};

// The 256 KiB body limit applies to these routes only; it is deliberately smaller than the 2 MiB
// file the client accepts, because the transformed rows are much smaller than the CSV text.
router.post('/activities/import', jsonBody, authenticate, handle(activities));
router.post('/lodgings/import', jsonBody, authenticate, handle(lodgings));
router.post('/transfers/import', jsonBody, authenticate, handle(transfers));
router.post('/car-rentals/import', jsonBody, authenticate, handle(carRentals));
router.post('/itineraries/details/import', jsonBody, authenticate, handle(dayPlan));

export default router;
