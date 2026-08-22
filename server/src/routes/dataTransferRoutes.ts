import { Router } from 'express';
import bodyParser from 'body-parser';
import { createHash, randomUUID } from 'crypto';
import { authenticate } from '../auth';
import {
  ensureUserInTrip,
  getActivityById,
  getLodgingById,
  insertActivity,
  insertLodging,
  listGroupMembers,
  updateActivity,
  updateLodging,
  upsertExpenseForSource,
} from '../db';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { HttpRateLimitExceededError, reserveDataTransferRateLimit } from '../services/httpRateLimitService';
import { normalizeItineraryStatus } from '../utils/itineraryStatus';
import { getCurrentDbProvider } from '../db';
import { queryBlog } from '../db.postgres';
import { getDb as getFirebaseDb } from '../db.firebase';
import { readDto } from '../utils/dtoParse';
import { importActivitiesDto } from './activityDtos';
import { importLodgingsDto } from './lodgingDtos';
import { logInfo, logError } from '../logger';

const router = Router();
router.use(bodyParser.json({ limit: '256kb' }));

type Receipt = { hash: string; response: unknown; createdAt: number };
const receipts = new Map<string, Receipt>();
const pruneReceipts = (): void => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, value] of receipts.entries()) if (value.createdAt < cutoff) receipts.delete(key);
};
const fingerprint = (value: Record<string, unknown>, keys: string[]): string => JSON.stringify(keys.reduce<Record<string, unknown>>((out, key) => { out[key] = String(value[key] ?? '').trim().toLowerCase(); return out; }, {}));
const requestHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): string => String(value ?? '').trim();
const finite = (value: unknown): number => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; };
const isIsoDate = (value: unknown): boolean => {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const date = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate;
};
const isNonNegativeNumber = (value: unknown): boolean => value == null || value === '' || (typeof value === 'number' ? Number.isFinite(value) && value >= 0 : /^\d+(?:\.\d+)?$/.test(text(value)));

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
    if (data.payloadHash !== hash) throw new Error('Import ID has already been used with a different payload.');
    const createdAt = data.createdAt?.toMillis?.() ?? Date.parse(String(data.createdAt ?? ''));
    return { hash: data.payloadHash, response: data.response, createdAt: Number.isFinite(createdAt) ? createdAt : Date.now() };
  }
  if (getCurrentDbProvider() !== 'postgres' && getCurrentDbProvider() !== 'memory') return receipts.get(`${userId}:${tripId}:${entity}:${importId}`) ?? null;
  const result = await queryBlog<any>('SELECT payload_hash as "payloadHash", response, created_at as "createdAt" FROM data_transfer_imports WHERE user_id = $1 AND trip_id = $2 AND entity = $3 AND import_id = $4 LIMIT 1', [userId, tripId, entity, importId]);
  const row = result.rows[0];
  if (!row) return null;
  if (row.payloadHash !== hash) throw new Error('Import ID has already been used with a different payload.');
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

router.post('/activities/import', authenticate, async (req, res) => {
  const startedAt = Date.now();
  const userId = String((req as any).user.userId);
  const role = ((req as any).user.role ?? 'user') as 'user' | 'admin';
  const dto = readDto(importActivitiesDto, req.body ?? {}, res);
  if (!dto) return;
  try {
    await assertCanUseFeature(userId, 'activity_lodging_csv_import', role);
    const membership = await ensureUserInTrip(dto.tripId, userId);
    if (!membership) { res.status(403).json({ error: 'You must be an editor in this trip.' }); return; }
    const key = `${userId}:${dto.tripId}:activities:${dto.importId}`;
    const hash = requestHash(dto);
    const existing = await durableReceipt(userId, dto.tripId, 'activities', dto.importId, hash);
    if (existing) {
      if (existing.hash !== hash) { res.status(409).json({ error: 'Import ID has already been used with a different payload.' }); return; }
      res.json(existing.response); return;
    }
    const invalid: Array<{ sourceRow: number; error: string }> = [];
    for (const row of dto.rows) {
      const fields = row.fields;
      if (row.action === 'update' && !row.existingId) invalid.push({ sourceRow: row.sourceRow, error: 'Update rows require existingId.' });
      if (!text(fields.name) || !text(fields.date)) invalid.push({ sourceRow: row.sourceRow, error: 'Activity name and date are required.' });
      if (!isIsoDate(fields.date)) invalid.push({ sourceRow: row.sourceRow, error: 'Activity date must be a valid ISO date.' });
      if (!isNonNegativeNumber(fields.cost)) invalid.push({ sourceRow: row.sourceRow, error: 'Activity cost must be a finite non-negative number.' });
      if (row.action === 'create' && row.existingId) invalid.push({ sourceRow: row.sourceRow, error: 'Create rows may not include an existingId.' });
      if (row.existingId) {
        const current = await getActivityById(row.existingId);
        if (!current || current.tripId !== dto.tripId) invalid.push({ sourceRow: row.sourceRow, error: 'Activity is not in this trip.' });
        if (current && row.expectedFingerprint && fingerprint(current as any, ['name', 'date', 'startTime', 'startLocation', 'notes']) !== row.expectedFingerprint) invalid.push({ sourceRow: row.sourceRow, error: 'Activity changed since review.' });
      }
    }
    if (invalid.length) { res.status(422).json({ error: 'Import validation failed.', rows: invalid }); return; }
    await reserve(userId, req.ip, 'ACTIVITY_IMPORT_ROWS', dto.rows.length);
    const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const defaultTravelers = members.map((member) => String((member as any).id));
    const records: unknown[] = [];
    for (const row of dto.rows) {
      const fields = row.fields;
      const payload: any = {
        userId, tripId: dto.tripId, status: normalizeItineraryStatus(text(fields.status) || 'Needed'), activityType: text(fields.activityType) || 'Other',
        date: text(fields.date), name: text(fields.name), startLocation: text(fields.startLocation), startTime: text(fields.startTime), duration: text(fields.duration),
        cost: finite(fields.cost), freeCancelBy: text(fields.freeCancelBy) || null, bookedOn: text(fields.bookedOn), reference: text(fields.reference), notes: text(fields.notes),
        paidBy: Array.isArray(fields.paidBy) ? fields.paidBy.map(String) : [], travelerIds: Array.isArray(fields.travelerIds) && fields.travelerIds.length ? fields.travelerIds.map(String) : defaultTravelers,
      };
      const record = row.action === 'update' ? await updateActivity(row.existingId!, userId, payload) : await insertActivity(payload);
      if (!record) throw new Error(`Activity row ${row.sourceRow} could not be saved.`);
      await upsertExpenseForSource({ userId, tripId: dto.tripId, groupId: membership.groupId, expenseDate: record.date, category: 'Activities', amount: Number(record.cost) || 0, payerIds: record.paidBy ?? [], forIds: record.travelerIds ?? defaultTravelers, sourceType: 'activity', sourceId: record.id });
      records.push(record);
    }
    const response = { importId: dto.importId, created: dto.rows.filter((row) => row.action === 'create').length, updated: dto.rows.filter((row) => row.action === 'update').length, records };
    await saveReceipt(userId, dto.tripId, 'activities', dto.importId, hash, response);
    logInfo(`[data-transfer] entity=activities result=success rows=${dto.rows.length} durationMs=${Date.now() - startedAt}`);
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof HttpRateLimitExceededError) { res.setHeader('Retry-After', String(error.retryAfterSeconds)); res.status(429).json({ error: error.message }); return; }
    if (error instanceof ApiLimitExceededError) { res.status(429).json({ error: error.message }); return; }
    if (error instanceof EntitlementError) { res.status(error.code === 'FEATURE_DISABLED' ? 404 : 402).json({ error: error.message, code: error.code }); return; }
    const message = (error as Error).message;
    logError(`[data-transfer] entity=activities result=error durationMs=${Date.now() - startedAt}`);
    res.status(500).json({ error: message });
  }
});

router.post('/lodgings/import', authenticate, async (req, res) => {
  const startedAt = Date.now();
  const userId = String((req as any).user.userId);
  const role = ((req as any).user.role ?? 'user') as 'user' | 'admin';
  const dto = readDto(importLodgingsDto, req.body ?? {}, res);
  if (!dto) return;
  try {
    await assertCanUseFeature(userId, 'activity_lodging_csv_import', role);
    const membership = await ensureUserInTrip(dto.tripId, userId);
    if (!membership) { res.status(403).json({ error: 'You must be an editor in this trip.' }); return; }
    const key = `${userId}:${dto.tripId}:lodgings:${dto.importId}`;
    const hash = requestHash(dto);
    const existing = await durableReceipt(userId, dto.tripId, 'lodgings', dto.importId, hash);
    if (existing) { if (existing.hash !== hash) { res.status(409).json({ error: 'Import ID has already been used with a different payload.' }); return; } res.json(existing.response); return; }
    const invalid: Array<{ sourceRow: number; error: string }> = [];
    for (const row of dto.rows) {
      const fields = row.fields;
      if (row.action === 'update' && !row.existingId) invalid.push({ sourceRow: row.sourceRow, error: 'Update rows require existingId.' });
      if (!text(fields.name) || !text(fields.checkInDate) || !text(fields.checkOutDate)) invalid.push({ sourceRow: row.sourceRow, error: 'Lodging name and dates are required.' });
      if (!isIsoDate(fields.checkInDate) || !isIsoDate(fields.checkOutDate) || text(fields.checkOutDate) <= text(fields.checkInDate)) invalid.push({ sourceRow: row.sourceRow, error: 'Lodging dates must be valid and check-out must follow check-in.' });
      if (!isNonNegativeNumber(fields.totalCost) || !isNonNegativeNumber(fields.costPerNight)) invalid.push({ sourceRow: row.sourceRow, error: 'Lodging costs must be finite non-negative numbers.' });
      if (row.action === 'create' && row.existingId) invalid.push({ sourceRow: row.sourceRow, error: 'Create rows may not include an existingId.' });
      if (row.existingId) {
        const current = await getLodgingById(row.existingId);
        if (!current || current.trip_id !== dto.tripId && (current as any).tripId !== dto.tripId) invalid.push({ sourceRow: row.sourceRow, error: 'Lodging is not in this trip.' });
        if (current && row.expectedFingerprint && fingerprint(current as any, ['name', 'checkInDate', 'checkOutDate', 'address', 'notes']) !== row.expectedFingerprint) invalid.push({ sourceRow: row.sourceRow, error: 'Lodging changed since review.' });
      }
    }
    if (invalid.length) { res.status(422).json({ error: 'Import validation failed.', rows: invalid }); return; }
    await reserve(userId, req.ip, 'LODGING_IMPORT_ROWS', dto.rows.length);
    const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const defaultTravelers = members.map((member) => String((member as any).id));
    const records: unknown[] = [];
    for (const row of dto.rows) {
      const fields = row.fields;
      const paidBy = Array.isArray(fields.paidBy) ? fields.paidBy.map(String) : [];
      const travelers = Array.isArray(fields.travelerIds) && fields.travelerIds.length ? fields.travelerIds.map(String) : (paidBy.length ? paidBy : defaultTravelers);
      const payload: any = { userId, tripId: dto.tripId, status: normalizeItineraryStatus(text(fields.status) || 'Needed'), name: text(fields.name), checkInDate: text(fields.checkInDate), checkOutDate: text(fields.checkOutDate), rooms: Math.max(1, Number(fields.rooms) || 1), refundBy: text(fields.refundBy) || null, totalCost: finite(fields.totalCost), costPerNight: finite(fields.costPerNight), address: text(fields.address), notes: text(fields.notes) || null, features: Array.isArray(fields.features) ? fields.features.map(String).filter(Boolean) : [], paid_by: paidBy, traveler_ids: travelers, imageUrl: null };
      const updatePayload: any = { name: payload.name, status: payload.status, check_in_date: payload.checkInDate, check_out_date: payload.checkOutDate, rooms: payload.rooms, refund_by: payload.refundBy, total_cost: payload.totalCost, cost_per_night: payload.costPerNight, address: payload.address, notes: payload.notes, features: payload.features, paid_by: payload.paid_by, traveler_ids: payload.traveler_ids, trip_id: dto.tripId };
      const record = row.action === 'update' ? await updateLodging(row.existingId!, userId, updatePayload) : await insertLodging(payload);
      if (!record) throw new Error(`Lodging row ${row.sourceRow} could not be saved.`);
      await upsertExpenseForSource({ userId, tripId: dto.tripId, groupId: membership.groupId, expenseDate: (record as any).checkInDate ?? (record as any).check_in_date, category: 'Lodging', amount: Number((record as any).totalCost ?? (record as any).total_cost) || 0, payerIds: (record as any).paidBy ?? [], forIds: (record as any).travelerIds ?? travelers, sourceType: 'lodging', sourceId: record.id });
      records.push(record);
    }
    const response = { importId: dto.importId, created: dto.rows.filter((row) => row.action === 'create').length, updated: dto.rows.filter((row) => row.action === 'update').length, records };
    await saveReceipt(userId, dto.tripId, 'lodgings', dto.importId, hash, response);
    logInfo(`[data-transfer] entity=lodgings result=success rows=${dto.rows.length} durationMs=${Date.now() - startedAt}`);
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof HttpRateLimitExceededError) { res.setHeader('Retry-After', String(error.retryAfterSeconds)); res.status(429).json({ error: error.message }); return; }
    if (error instanceof ApiLimitExceededError) { res.status(429).json({ error: error.message }); return; }
    if (error instanceof EntitlementError) { res.status(error.code === 'FEATURE_DISABLED' ? 404 : 402).json({ error: error.message, code: error.code }); return; }
    const message = (error as Error).message;
    logError(`[data-transfer] entity=lodgings result=error durationMs=${Date.now() - startedAt}`);
    res.status(500).json({ error: message });
  }
});

export default router;
