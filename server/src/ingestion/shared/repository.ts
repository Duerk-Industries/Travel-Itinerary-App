import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Pool } from 'pg';
import { getCurrentDbProvider, poolClient, getTripById } from '../../db';
import { getEnvValue } from '../../env';
import {
  INGESTION_LOGIC_VERSION,
  INGESTION_REVIEW_QUEUE_ACTIVE_STATES,
  INGESTION_SIGNED_URL_TTL_SECONDS,
} from '../config';
import type {
  DuplicateDisposition,
  IngestionObservabilitySnapshot,
  IngestionSourceType,
  ImportJobState,
  ParsedItemCandidate,
  ParsedItemReviewState,
  PersistedImportJob,
  PersistedParsedItem,
  UserVisibleFailureCode,
  VirusScanStatus,
} from '../contracts';

type ParsedItemRow = {
  id: string;
  user_id: string;
  import_job_id: string;
  raw_doc_id: string;
  item_type: PersistedParsedItem['itemType'];
  source_type: IngestionSourceType;
  source_date: string | null;
  provider_vendor: string | null;
  traveler_names: string[] | null;
  confirmation_number: string | null;
  start_datetime_utc: string | null;
  end_datetime_utc: string | null;
  original_timezone: string | null;
  timezone_display_hint: string | null;
  raw_source_reference: string;
  confidence_score: string | number;
  review_status: ParsedItemReviewState;
  deduplication_fingerprint: string;
  logic_version: string;
  extracted_fields: Record<string, unknown> | null;
  edited_fields: Record<string, unknown> | null;
  duplicate_disposition: DuplicateDisposition | null;
  duplicate_of_parsed_item_id: string | null;
  duplicate_of_trip_id: string | null;
  assigned_trip_id: string | null;
  assignment_transaction_id: string | null;
  created_at: string;
  updated_at: string;
};

type ImportJobRow = {
  id: string;
  user_id: string;
  ingestion_source_id: string;
  source_type: IngestionSourceType;
  state: ImportJobState;
  idempotency_key: string;
  content_hash: string;
  normalized_content_hash: string | null;
  external_message_id: string;
  original_filename: string;
  mime_type: string;
  failure_code: UserVisibleFailureCode | null;
  failure_reason: string | null;
  correlation_id: string;
  dry_run: boolean;
  retry_count: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  state_changed_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type IngestedDocumentRecord = {
  id: string;
  importJobId: string;
  userId: string;
  sourceType: IngestionSourceType;
  contentHash: string;
  normalizedContentHash: string;
  mimeType: string;
  originalFilename: string;
  rawSourceReference: string;
  contentBytesRef: string;
  normalizedText: string;
  normalizedHtml?: string | null;
  metadata: Record<string, unknown>;
  virusScanStatus: VirusScanStatus;
  virusScannedAt?: string | null;
  virusScanProvider?: string | null;
  deletedRawAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ParseAttemptRecord = {
  importJobId: string;
  stage: string;
  extractorName: string;
  logicVersion: string;
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  outcome: string;
  confidenceScore: number;
  tokensIn: number;
  tokensOut: number;
  modelName?: string | null;
  errorCode?: string | null;
};

type ParseStageLogRecord = {
  importJobId: string;
  stageName: string;
  stageStatus: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  extractorName?: string | null;
  logicVersion?: string | null;
  costEstimate: number;
  errorCode?: string | null;
  errorClass?: string | null;
  piiSafeMessage: string;
  correlationId: string;
};

const SYSTEM_APP_ID = 'WanderBunnies';
const SYSTEM_SENDER_NAME = 'WanderBunnies';
const SYSTEM_SENDER_INITIALS = 'WB';
const schemaReady = new Set<string>();
let firebaseApp: App | null = null;

const nowIso = () => new Date().toISOString();

const encryptionKey = (): Buffer => {
  const secret = getEnvValue('INGESTION_ENCRYPTION_SECRET', {
    defaultValue: getEnvValue('AUTH_SECRET', { defaultValue: 'development-secret' }) || 'development-secret',
  })!;
  return createHash('sha256').update(secret).digest();
};

const encryptToken = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

export const decryptToken = (value: string): string => {
  const buffer = Buffer.from(value, 'base64');
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

const mapImportJobRow = (row: ImportJobRow): PersistedImportJob => ({
  id: row.id,
  userId: row.user_id,
  ingestionSourceId: row.ingestion_source_id,
  sourceType: row.source_type,
  state: row.state,
  idempotencyKey: row.idempotency_key,
  contentHash: row.content_hash,
  normalizedContentHash: row.normalized_content_hash,
  externalMessageId: row.external_message_id,
  originalFilename: row.original_filename,
  mimeType: row.mime_type,
  failureCode: row.failure_code,
  failureReason: row.failure_reason,
  correlationId: row.correlation_id,
  dryRun: row.dry_run,
  retryCount: row.retry_count,
  lastErrorCode: row.last_error_code,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  stateChangedAt: row.state_changed_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

const mapParsedItemRow = (row: ParsedItemRow): PersistedParsedItem => ({
  id: row.id,
  userId: row.user_id,
  importJobId: row.import_job_id,
  rawDocId: row.raw_doc_id,
  itemType: row.item_type,
  sourceType: row.source_type,
  sourceDate: row.source_date,
  providerVendor: row.provider_vendor,
  travelerNames: Array.isArray(row.traveler_names) ? row.traveler_names : [],
  confirmationNumber: row.confirmation_number,
  startDateTimeUtc: row.start_datetime_utc,
  endDateTimeUtc: row.end_datetime_utc,
  originalTimezone: row.original_timezone,
  timezoneDisplayHint: row.timezone_display_hint,
  rawSourceReference: row.raw_source_reference,
  confidenceScore: Number(row.confidence_score ?? 0),
  reviewStatus: row.review_status,
  deduplicationFingerprint: row.deduplication_fingerprint,
  extractedFields: row.extracted_fields ?? {},
  editedFields: row.edited_fields ?? null,
  duplicateDisposition: row.duplicate_disposition ?? null,
  duplicateOfParsedItemId: row.duplicate_of_parsed_item_id ?? null,
  duplicateOfTripId: row.duplicate_of_trip_id ?? null,
  logicVersion: row.logic_version,
  status: row.review_status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  assignedTripId: row.assigned_trip_id ?? null,
  assignmentTransactionId: row.assignment_transaction_id ?? null,
  previouslyDeletedNotice: row.duplicate_disposition === 'PREVIOUSLY_DELETED',
});

const getFirebaseDb = (): Firestore => {
  if (!firebaseApp) {
    if (getApps().length > 0) {
      firebaseApp = getApps()[0]!;
    } else {
      const projectId =
        getEnvValue('GCLOUD_PROJECT_ID') ||
        getEnvValue('FIREBASE_PROJECT_ID') ||
        getEnvValue('GOOGLE_CLOUD_PROJECT');
      const clientEmail = getEnvValue('FIREBASE_CLIENT_EMAIL');
      const privateKey = getEnvValue('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
      const emulator = process.env.FIRESTORE_EMULATOR_HOST;
      if (emulator) {
        firebaseApp = initializeApp({ projectId: projectId || 'travel-itinerary-test' });
      } else if (projectId && clientEmail && privateKey) {
        firebaseApp = initializeApp({
          credential: cert({ projectId, clientEmail, privateKey }),
          projectId,
        });
      } else {
        firebaseApp = initializeApp({ projectId: projectId || 'travel-itinerary-app' });
      }
    }
  }
  const databaseId = getEnvValue('FIRESTORE_DATABASE_ID');
  return databaseId ? getFirestore(firebaseApp!, databaseId) : getFirestore(firebaseApp!);
};

const getPg = (): Pool => poolClient();

const ensurePgSchema = async (): Promise<void> => {
  if (schemaReady.has('postgres')) return;
  const p = getPg();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ingestion_sources (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      provider_connection_id UUID,
      display_name TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, source_type)
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ingestion_source_id UUID NOT NULL REFERENCES ingestion_sources(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      normalized_content_hash TEXT,
      external_message_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      failure_code TEXT,
      failure_reason TEXT,
      correlation_id TEXT NOT NULL,
      dry_run BOOLEAN NOT NULL DEFAULT FALSE,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      state_changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP
    );
  `);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_user_idempotency ON import_jobs(user_id, idempotency_key);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS ingested_documents (
      id UUID PRIMARY KEY,
      import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      normalized_content_hash TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      raw_source_reference TEXT NOT NULL,
      content_bytes_ref TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      normalized_html TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      virus_scan_status TEXT NOT NULL,
      virus_scanned_at TIMESTAMP,
      virus_scan_provider TEXT,
      deleted_raw_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_docs_user_content_hash ON ingested_documents(user_id, content_hash);`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_docs_user_normalized_hash ON ingested_documents(user_id, normalized_content_hash);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS parsed_items (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      raw_doc_id UUID NOT NULL REFERENCES ingested_documents(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_date TIMESTAMP,
      provider_vendor TEXT,
      traveler_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      confirmation_number TEXT,
      start_datetime_utc TIMESTAMP,
      end_datetime_utc TIMESTAMP,
      original_timezone TEXT,
      timezone_display_hint TEXT,
      raw_source_reference TEXT NOT NULL,
      confidence_score NUMERIC NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL,
      deduplication_fingerprint TEXT NOT NULL,
      logic_version TEXT NOT NULL,
      extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      edited_fields JSONB,
      duplicate_disposition TEXT,
      duplicate_of_parsed_item_id UUID,
      duplicate_of_trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      assigned_trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      assignment_transaction_id UUID,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_parsed_items_user_status_created ON parsed_items(user_id, review_status, created_at DESC);`);
  try {
    await p.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_parsed_items_active_fingerprint
      ON parsed_items(user_id, deduplication_fingerprint)
      WHERE review_status <> 'DELETED';
    `);
  } catch {
    // pg-mem does not support partial indexes.
  }
  await p.query(`
    CREATE TABLE IF NOT EXISTS parsed_item_assignments (
      id UUID PRIMARY KEY,
      parsed_item_id UUID NOT NULL REFERENCES parsed_items(id) ON DELETE CASCADE,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      assigned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
      assignment_transaction_id UUID NOT NULL UNIQUE
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS provider_connections (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      encrypted_access_token TEXT,
      encrypted_refresh_token TEXT,
      token_expiry TIMESTAMP,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS usage_metering (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      import_job_id UUID REFERENCES import_jobs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      parser_stage TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_name TEXT,
      token_count_in INTEGER NOT NULL DEFAULT 0,
      token_count_out INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS parse_attempts (
      id UUID PRIMARY KEY,
      import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      extractor_name TEXT NOT NULL,
      logic_version TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      started_at TIMESTAMP NOT NULL,
      completed_at TIMESTAMP NOT NULL,
      outcome TEXT NOT NULL,
      confidence_score NUMERIC NOT NULL DEFAULT 0,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      model_name TEXT,
      error_code TEXT
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS parse_stage_logs (
      log_id UUID PRIMARY KEY,
      import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      stage_name TEXT NOT NULL,
      stage_status TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL,
      completed_at TIMESTAMP NOT NULL,
      duration_ms INTEGER NOT NULL,
      extractor_name TEXT,
      logic_version TEXT,
      cost_estimate NUMERIC NOT NULL DEFAULT 0,
      error_code TEXT,
      error_class TEXT,
      pii_safe_message TEXT NOT NULL,
      correlation_id TEXT NOT NULL
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS extraction_cache (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      logic_version TEXT NOT NULL,
      extraction_result JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, content_hash, logic_version)
    );
  `);
  schemaReady.add('postgres');
};

const ensureFirestoreCollections = async (): Promise<void> => {
  if (schemaReady.has('firebase')) return;
  const db = getFirebaseDb();
  await Promise.all([
    db.collection('ingestion_sources').limit(1).get(),
    db.collection('import_jobs').limit(1).get(),
    db.collection('ingested_documents').limit(1).get(),
  ]);
  schemaReady.add('firebase');
};

export const ensureIngestionRepositoryReady = async (): Promise<void> => {
  const provider = getCurrentDbProvider();
  if (provider === 'firebase') {
    await ensureFirestoreCollections();
    return;
  }
  await ensurePgSchema();
};

const mergeFields = (item: PersistedParsedItem): Record<string, unknown> => ({
  ...(item.extractedFields ?? {}),
  ...(item.editedFields ?? {}),
});

const parseDate = (value: unknown): string | null => {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const toDateOnly = (value: unknown, fallback = nowIso().slice(0, 10)): string => parseDate(value)?.slice(0, 10) ?? fallback;

const toTimeOnly = (value: unknown, fallback = '00:00'): string => {
  const text = String(value ?? '').trim();
  if (/^\d{1,2}:\d{2}/.test(text)) return text.slice(0, 5);
  const iso = parseDate(text);
  if (!iso) return fallback;
  return iso.slice(11, 16);
};

const calculateLodgingCostPerNight = (checkInDate: string, checkOutDate: string, totalCost: number): number => {
  const start = new Date(checkInDate).getTime();
  const end = new Date(checkOutDate).getTime();
  const nights = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  return Number((totalCost / nights).toFixed(2));
};

const mapActivityType = (itemType: PersistedParsedItem['itemType']): string => {
  switch (itemType) {
    case 'restaurant_reservation':
      return 'Food & Drink';
    case 'event_ticket':
      return 'Event';
    case 'tour_activity':
      return 'Tour';
    default:
      return 'Reservation';
  }
};

const getSystemMessageBody = (item: PersistedParsedItem, tripName: string): string => {
  const fields = mergeFields(item);
  const provider = String(fields.providerVendor ?? item.providerVendor ?? 'travel provider').trim();
  const confirmation = String(fields.confirmationNumber ?? item.confirmationNumber ?? '').trim();
  const dateText = String(fields.startDateText ?? item.startDateTimeUtc ?? item.sourceDate ?? '').trim();
  const note = String(fields.notes ?? fields.summary ?? '').trim();
  const parts = [
    `Imported ${item.itemType.replace(/_/g, ' ')} into ${tripName}.`,
    provider ? `Provider: ${provider}.` : '',
    confirmation ? `Confirmation: ${confirmation}.` : '',
    dateText ? `Date: ${dateText}.` : '',
    note ? `Notes: ${note}` : '',
  ].filter(Boolean);
  return parts.join(' ');
};

const ensureTripExists = async (tripId: string): Promise<void> => {
  const trip = await getTripById(tripId);
  if (!trip) {
    throw new Error('Trip not found');
  }
};

const insertAssignmentArtifactsPostgres = async (client: Pool, item: PersistedParsedItem, tripId: string, assignedByUserId: string) => {
  const id = randomUUID();
  const messageId = randomUUID();
  const assignmentTransactionId = randomUUID();
  const trip = await getTripById(tripId);
  const tripName = trip?.name ?? 'trip';
  const fields = mergeFields(item);

  if (item.itemType === 'flight' || item.itemType === 'rail' || item.itemType === 'ferry_bus_transfer') {
    await client.query(
      `INSERT INTO flights (
        id, user_id, trip_id, status, transfer_type, passenger_name, passenger_ids, departure_date,
        departure_location, departure_airport_code, departure_time, arrival_location, arrival_airport_code,
        arrival_date, arrival_time, cost, carrier, flight_number, booking_reference, paid_by
      ) VALUES ($1,$2,$3,'Booked',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        id,
        item.userId,
        tripId,
        item.itemType === 'flight' ? 'Flight' : item.itemType === 'rail' ? 'Train' : 'Ferry',
        (item.travelerNames ?? []).join(', ') || 'Traveler',
        JSON.stringify([]),
        toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        String(fields.departureLocation ?? fields.location ?? ''),
        String(fields.departureAirportCode ?? ''),
        toTimeOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        String(fields.arrivalLocation ?? ''),
        String(fields.arrivalAirportCode ?? ''),
        toDateOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc, toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc)),
        toTimeOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc),
        Number(fields.cost ?? 0),
        String(fields.providerVendor ?? item.providerVendor ?? ''),
        String(fields.flightNumber ?? fields.segmentNumber ?? ''),
        String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        JSON.stringify([]),
      ]
    );
  } else if (item.itemType === 'hotel') {
    const checkInDate = toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc);
    const checkOutDate = toDateOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc, checkInDate);
    const totalCost = Number(fields.totalCost ?? fields.cost ?? 0);
    await client.query(
      `INSERT INTO lodgings (
        id, user_id, trip_id, status, name, check_in_date, check_out_date, rooms, refund_by,
        total_cost, cost_per_night, address, paid_by, traveler_ids
      ) VALUES ($1,$2,$3,'Booked',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        item.userId,
        tripId,
        String(fields.name ?? fields.hotelName ?? item.providerVendor ?? 'Imported lodging'),
        checkInDate,
        checkOutDate,
        Number(fields.rooms ?? 1),
        toDateOnly(fields.refundBy ?? fields.freeCancelBy ?? checkInDate, checkInDate),
        totalCost,
        calculateLodgingCostPerNight(checkInDate, checkOutDate, totalCost),
        String(fields.address ?? fields.location ?? ''),
        JSON.stringify([]),
        JSON.stringify([]),
      ]
    );
  } else if (item.itemType === 'car_rental') {
    await client.query(
      `INSERT INTO car_rentals (
        id, user_id, trip_id, status, pickup_location, pickup_date, dropoff_location, dropoff_date,
        reference, vendor, prepaid, cost, model, notes, paid_by, traveler_ids
      ) VALUES ($1,$2,$3,'Booked',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        item.userId,
        tripId,
        String(fields.pickupLocation ?? ''),
        toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        String(fields.dropoffLocation ?? ''),
        toDateOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc, toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc)),
        String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        String(fields.providerVendor ?? item.providerVendor ?? ''),
        String(fields.prepaid ?? 'unknown'),
        Number(fields.cost ?? 0),
        String(fields.model ?? ''),
        String(fields.notes ?? ''),
        JSON.stringify([]),
        JSON.stringify([]),
      ]
    );
  } else if (item.itemType === 'tour_activity' || item.itemType === 'restaurant_reservation' || item.itemType === 'event_ticket') {
    await client.query(
      `INSERT INTO tours (
        id, user_id, trip_id, status, activity_type, date, name, start_location, start_time,
        duration, cost, free_cancel_by, booked_on, reference, paid_by, traveler_ids
      ) VALUES ($1,$2,$3,'Booked',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        item.userId,
        tripId,
        mapActivityType(item.itemType),
        toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        String(fields.name ?? fields.providerVendor ?? 'Imported activity'),
        String(fields.location ?? fields.startLocation ?? ''),
        toTimeOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        String(fields.duration ?? ''),
        Number(fields.cost ?? 0),
        toDateOnly(fields.freeCancelBy ?? fields.startDateTimeUtc ?? item.startDateTimeUtc),
        nowIso().slice(0, 10),
        String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        JSON.stringify([]),
        JSON.stringify([]),
      ]
    );
  }

  await client.query(
    `INSERT INTO trip_messages (id, app_id, trip_id, sender_id, sender_name, sender_initials, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [messageId, SYSTEM_APP_ID, tripId, assignedByUserId, SYSTEM_SENDER_NAME, SYSTEM_SENDER_INITIALS, getSystemMessageBody(item, tripName)]
  );
  await client.query(
    `INSERT INTO parsed_item_assignments (id, parsed_item_id, trip_id, assigned_by_user_id, assigned_at, assignment_transaction_id)
     VALUES ($1,$2,$3,$4,NOW(),$5)`,
    [randomUUID(), item.id, tripId, assignedByUserId, assignmentTransactionId]
  );
  await client.query(
    `UPDATE parsed_items
     SET review_status = 'ASSIGNED',
         assigned_trip_id = $2,
         assignment_transaction_id = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [item.id, tripId, assignmentTransactionId]
  );
  return { tripRecordId: id, assignmentTransactionId };
};

const insertAssignmentArtifactsFirestore = async (item: PersistedParsedItem, tripId: string, assignedByUserId: string) => {
  const db = getFirebaseDb();
  const assignmentTransactionId = randomUUID();
  const tripRecordId = randomUUID();
  const messageId = randomUUID();
  const trip = await getTripById(tripId);
  const tripName = trip?.name ?? 'trip';
  const fields = mergeFields(item);
  await db.runTransaction(async (tx) => {
    const parsedItemRef = db.collection('parsed_items').doc(item.id);
    const parsedItemDoc = await tx.get(parsedItemRef);
    if (!parsedItemDoc.exists) throw new Error('Parsed item not found');
    const payload: Record<string, unknown> = {
      id: tripRecordId,
      userId: item.userId,
      tripId,
      status: 'Booked',
      createdAt: nowIso(),
    };
    if (item.itemType === 'flight' || item.itemType === 'rail' || item.itemType === 'ferry_bus_transfer') {
      tx.set(db.collection('flights').doc(tripRecordId), {
        ...payload,
        transferType: item.itemType === 'flight' ? 'Flight' : item.itemType === 'rail' ? 'Train' : 'Ferry',
        passengerName: (item.travelerNames ?? []).join(', ') || 'Traveler',
        passengerIds: [],
        departureDate: toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        departureLocation: String(fields.departureLocation ?? ''),
        departureAirportCode: String(fields.departureAirportCode ?? ''),
        departureTime: toTimeOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        arrivalLocation: String(fields.arrivalLocation ?? ''),
        arrivalAirportCode: String(fields.arrivalAirportCode ?? ''),
        arrivalDate: toDateOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc, toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc)),
        arrivalTime: toTimeOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc),
        cost: Number(fields.cost ?? 0),
        carrier: String(fields.providerVendor ?? item.providerVendor ?? ''),
        flightNumber: String(fields.flightNumber ?? ''),
        bookingReference: String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        paidBy: [],
      });
    } else if (item.itemType === 'hotel') {
      const checkInDate = toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc);
      const checkOutDate = toDateOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc, checkInDate);
      const totalCost = Number(fields.totalCost ?? fields.cost ?? 0);
      tx.set(db.collection('lodgings').doc(tripRecordId), {
        ...payload,
        trip_id: tripId,
        name: String(fields.name ?? fields.hotelName ?? item.providerVendor ?? 'Imported lodging'),
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        rooms: Number(fields.rooms ?? 1),
        refund_by: toDateOnly(fields.refundBy ?? fields.freeCancelBy ?? checkInDate, checkInDate),
        total_cost: totalCost,
        cost_per_night: calculateLodgingCostPerNight(checkInDate, checkOutDate, totalCost),
        address: String(fields.address ?? ''),
        paid_by: [],
        traveler_ids: [],
      });
    } else if (item.itemType === 'car_rental') {
      tx.set(db.collection('car_rentals').doc(tripRecordId), {
        ...payload,
        pickupLocation: String(fields.pickupLocation ?? ''),
        pickupDate: toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        dropoffLocation: String(fields.dropoffLocation ?? ''),
        dropoffDate: toDateOnly(fields.endDateTimeUtc ?? item.endDateTimeUtc, toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc)),
        reference: String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        vendor: String(fields.providerVendor ?? item.providerVendor ?? ''),
        prepaid: String(fields.prepaid ?? 'unknown'),
        cost: Number(fields.cost ?? 0),
        model: String(fields.model ?? ''),
        notes: String(fields.notes ?? ''),
        paidBy: [],
        travelerIds: [],
      });
    } else if (item.itemType === 'tour_activity' || item.itemType === 'restaurant_reservation' || item.itemType === 'event_ticket') {
      tx.set(db.collection('tours').doc(tripRecordId), {
        ...payload,
        activityType: mapActivityType(item.itemType),
        date: toDateOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        name: String(fields.name ?? item.providerVendor ?? 'Imported activity'),
        startLocation: String(fields.location ?? fields.startLocation ?? ''),
        startTime: toTimeOnly(fields.startDateTimeUtc ?? item.startDateTimeUtc),
        duration: String(fields.duration ?? ''),
        cost: Number(fields.cost ?? 0),
        freeCancelBy: toDateOnly(fields.freeCancelBy ?? fields.startDateTimeUtc ?? item.startDateTimeUtc),
        bookedOn: nowIso().slice(0, 10),
        reference: String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        paidBy: [],
        travelerIds: [],
      });
    }
    tx.set(db.collection('trip_messages').doc(messageId), {
      id: messageId,
      appId: SYSTEM_APP_ID,
      tripId,
      senderId: assignedByUserId,
      senderName: SYSTEM_SENDER_NAME,
      senderInitials: SYSTEM_SENDER_INITIALS,
      body: getSystemMessageBody(item, tripName),
      createdAt: nowIso(),
    });
    tx.set(db.collection('parsed_item_assignments').doc(assignmentTransactionId), {
      parsedItemId: item.id,
      tripId,
      assignedByUserId,
      assignedAt: nowIso(),
      assignmentTransactionId,
    });
    tx.update(parsedItemRef, {
      reviewStatus: 'ASSIGNED',
      status: 'ASSIGNED',
      assignedTripId: tripId,
      assignmentTransactionId,
      updatedAt: nowIso(),
    });
  });
  return { tripRecordId, assignmentTransactionId };
};

export const getOrCreateIngestionSource = async (userId: string, sourceType: IngestionSourceType): Promise<string> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const existing = await db.collection('ingestion_sources').where('userId', '==', userId).where('sourceType', '==', sourceType).limit(1).get();
    if (!existing.empty) return existing.docs[0].id;
    const id = randomUUID();
    await db.collection('ingestion_sources').doc(id).set({
      userId,
      sourceType,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      metadata: {},
    });
    return id;
  }
  const p = getPg();
  const existing = await p.query<{ id: string }>(
    `SELECT id FROM ingestion_sources WHERE user_id = $1 AND source_type = $2 LIMIT 1`,
    [userId, sourceType]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const id = randomUUID();
  await p.query(
    `INSERT INTO ingestion_sources (id, user_id, source_type, display_name, metadata) VALUES ($1,$2,$3,$4,$5)`,
    [id, userId, sourceType, sourceType, JSON.stringify({})]
  );
  return id;
};

export const getImportJobByIdempotencyKey = async (userId: string, idempotencyKey: string): Promise<PersistedImportJob | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const snap = await db.collection('import_jobs').where('userId', '==', userId).where('idempotencyKey', '==', idempotencyKey).limit(1).get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() as any;
    return {
      id: snap.docs[0].id,
      userId: data.userId,
      ingestionSourceId: data.ingestionSourceId,
      sourceType: data.sourceType,
      state: data.state,
      idempotencyKey: data.idempotencyKey,
      contentHash: data.contentHash,
      normalizedContentHash: data.normalizedContentHash ?? null,
      externalMessageId: data.externalMessageId,
      originalFilename: data.originalFilename,
      mimeType: data.mimeType,
      failureCode: data.failureCode ?? null,
      failureReason: data.failureReason ?? null,
      correlationId: data.correlationId,
      dryRun: Boolean(data.dryRun),
      retryCount: data.retryCount ?? 0,
      lastErrorCode: data.lastErrorCode ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      stateChangedAt: data.stateChangedAt,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
    };
  }
  const p = getPg();
  const { rows } = await p.query<ImportJobRow>(
    `SELECT * FROM import_jobs WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [userId, idempotencyKey]
  );
  return rows[0] ? mapImportJobRow(rows[0]) : null;
};

export const createImportJob = async (params: {
  userId: string;
  ingestionSourceId: string;
  sourceType: IngestionSourceType;
  idempotencyKey: string;
  contentHash: string;
  externalMessageId: string;
  originalFilename: string;
  mimeType: string;
  correlationId: string;
  dryRun: boolean;
}): Promise<PersistedImportJob> => {
  await ensureIngestionRepositoryReady();
  const id = randomUUID();
  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const payload = {
      userId: params.userId,
      ingestionSourceId: params.ingestionSourceId,
      sourceType: params.sourceType,
      state: 'PENDING' as ImportJobState,
      idempotencyKey: params.idempotencyKey,
      contentHash: params.contentHash,
      normalizedContentHash: null,
      externalMessageId: params.externalMessageId,
      originalFilename: params.originalFilename,
      mimeType: params.mimeType,
      failureCode: null,
      failureReason: null,
      correlationId: params.correlationId,
      dryRun: params.dryRun,
      retryCount: 0,
      lastErrorCode: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      stateChangedAt: nowIso(),
      startedAt: null,
      completedAt: null,
    };
    await db.collection('import_jobs').doc(id).set(payload);
    return { id, ...payload };
  }
  const p = getPg();
  const { rows } = await p.query<ImportJobRow>(
    `INSERT INTO import_jobs (
      id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
      external_message_id, original_filename, mime_type, correlation_id, dry_run
    ) VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      id,
      params.userId,
      params.ingestionSourceId,
      params.sourceType,
      params.idempotencyKey,
      params.contentHash,
      params.externalMessageId,
      params.originalFilename,
      params.mimeType,
      params.correlationId,
      params.dryRun,
    ]
  );
  return mapImportJobRow(rows[0]);
};

export const getImportJobById = async (jobId: string): Promise<PersistedImportJob | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const doc = await getFirebaseDb().collection('import_jobs').doc(jobId).get();
    if (!doc.exists) return null;
    const data = doc.data() as any;
    return {
      id: doc.id,
      userId: data.userId,
      ingestionSourceId: data.ingestionSourceId,
      sourceType: data.sourceType,
      state: data.state,
      idempotencyKey: data.idempotencyKey,
      contentHash: data.contentHash,
      normalizedContentHash: data.normalizedContentHash ?? null,
      externalMessageId: data.externalMessageId,
      originalFilename: data.originalFilename,
      mimeType: data.mimeType,
      failureCode: data.failureCode ?? null,
      failureReason: data.failureReason ?? null,
      correlationId: data.correlationId,
      dryRun: Boolean(data.dryRun),
      retryCount: data.retryCount ?? 0,
      lastErrorCode: data.lastErrorCode ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      stateChangedAt: data.stateChangedAt,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
    };
  }
  const { rows } = await getPg().query<ImportJobRow>(`SELECT * FROM import_jobs WHERE id = $1`, [jobId]);
  return rows[0] ? mapImportJobRow(rows[0]) : null;
};

export const updateImportJobState = async (params: {
  jobId: string;
  state: ImportJobState;
  normalizedContentHash?: string | null;
  failureCode?: UserVisibleFailureCode | null;
  failureReason?: string | null;
  lastErrorCode?: string | null;
}): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('import_jobs').doc(params.jobId).set(
      {
        state: params.state,
        normalizedContentHash: typeof params.normalizedContentHash === 'undefined' ? undefined : params.normalizedContentHash,
        failureCode: typeof params.failureCode === 'undefined' ? undefined : params.failureCode,
        failureReason: typeof params.failureReason === 'undefined' ? undefined : params.failureReason,
        lastErrorCode: typeof params.lastErrorCode === 'undefined' ? undefined : params.lastErrorCode,
        updatedAt: nowIso(),
        stateChangedAt: nowIso(),
        startedAt: ['RECEIVED', 'NORMALIZING', 'NORMALIZED', 'EXTRACTING', 'AWAITING_REVIEW'].includes(params.state)
          ? nowIso()
          : undefined,
        completedAt: ['COMPLETED', 'FAILED', 'DEAD_LETTERED', 'DUPLICATE_IGNORED'].includes(params.state) ? nowIso() : undefined,
      },
      { merge: true }
    );
    return;
  }
  await getPg().query(
    `UPDATE import_jobs
     SET state = $2,
         normalized_content_hash = COALESCE($3, normalized_content_hash),
         failure_code = $4,
         failure_reason = $5,
         last_error_code = $6,
         updated_at = CURRENT_TIMESTAMP::timestamp,
         state_changed_at = CURRENT_TIMESTAMP::timestamp,
         started_at = CASE
           WHEN $2 IN ('RECEIVED','NORMALIZING','NORMALIZED','EXTRACTING','AWAITING_REVIEW') AND started_at IS NULL
             THEN CURRENT_TIMESTAMP::timestamp
           ELSE started_at
         END,
         completed_at = CASE
           WHEN $2 IN ('COMPLETED','FAILED','DEAD_LETTERED','DUPLICATE_IGNORED')
             THEN CURRENT_TIMESTAMP::timestamp
           ELSE completed_at
         END
     WHERE id = $1`,
    [params.jobId, params.state, params.normalizedContentHash ?? null, params.failureCode ?? null, params.failureReason ?? null, params.lastErrorCode ?? null]
  );
};

export const listImportJobsForUser = async (userId: string): Promise<PersistedImportJob[]> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb().collection('import_jobs').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(25).get();
    return snap.docs.map((doc) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        userId: data.userId,
        ingestionSourceId: data.ingestionSourceId,
        sourceType: data.sourceType,
        state: data.state,
        idempotencyKey: data.idempotencyKey,
        contentHash: data.contentHash,
        normalizedContentHash: data.normalizedContentHash ?? null,
        externalMessageId: data.externalMessageId,
        originalFilename: data.originalFilename,
        mimeType: data.mimeType,
        failureCode: data.failureCode ?? null,
        failureReason: data.failureReason ?? null,
        correlationId: data.correlationId,
        dryRun: Boolean(data.dryRun),
        retryCount: data.retryCount ?? 0,
        lastErrorCode: data.lastErrorCode ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        stateChangedAt: data.stateChangedAt,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
      };
    });
  }
  const { rows } = await getPg().query<ImportJobRow>(
    `SELECT * FROM import_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
    [userId]
  );
  return rows.map(mapImportJobRow);
};

export const findDocumentByNormalizedHash = async (userId: string, normalizedContentHash: string): Promise<IngestedDocumentRecord | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('ingested_documents')
      .where('userId', '==', userId)
      .where('normalizedContentHash', '==', normalizedContentHash)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() as any;
    return {
      id: doc.id,
      importJobId: data.importJobId,
      userId: data.userId,
      sourceType: data.sourceType,
      contentHash: data.contentHash,
      normalizedContentHash: data.normalizedContentHash,
      mimeType: data.mimeType,
      originalFilename: data.originalFilename,
      rawSourceReference: data.rawSourceReference,
      contentBytesRef: data.contentBytesRef,
      normalizedText: data.normalizedText,
      normalizedHtml: data.normalizedHtml ?? null,
      metadata: data.metadata ?? {},
      virusScanStatus: data.virusScanStatus,
      virusScannedAt: data.virusScannedAt ?? null,
      virusScanProvider: data.virusScanProvider ?? null,
      deletedRawAt: data.deletedRawAt ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
  const { rows } = await getPg().query<any>(
    `SELECT * FROM ingested_documents WHERE user_id = $1 AND normalized_content_hash = $2 LIMIT 1`,
    [userId, normalizedContentHash]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    importJobId: rows[0].import_job_id,
    userId: rows[0].user_id,
    sourceType: rows[0].source_type,
    contentHash: rows[0].content_hash,
    normalizedContentHash: rows[0].normalized_content_hash,
    mimeType: rows[0].mime_type,
    originalFilename: rows[0].original_filename,
    rawSourceReference: rows[0].raw_source_reference,
    contentBytesRef: rows[0].content_bytes_ref,
    normalizedText: rows[0].normalized_text,
    normalizedHtml: rows[0].normalized_html,
    metadata: rows[0].metadata ?? {},
    virusScanStatus: rows[0].virus_scan_status,
    virusScannedAt: rows[0].virus_scanned_at,
    virusScanProvider: rows[0].virus_scan_provider,
    deletedRawAt: rows[0].deleted_raw_at,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  };
};

export const createIngestedDocument = async (record: Omit<IngestedDocumentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<IngestedDocumentRecord> => {
  await ensureIngestionRepositoryReady();
  const id = randomUUID();
  if (getCurrentDbProvider() === 'firebase') {
    const payload = {
      importJobId: record.importJobId,
      userId: record.userId,
      sourceType: record.sourceType,
      contentHash: record.contentHash,
      normalizedContentHash: record.normalizedContentHash,
      mimeType: record.mimeType,
      originalFilename: record.originalFilename,
      rawSourceReference: record.rawSourceReference,
      contentBytesRef: record.contentBytesRef,
      normalizedText: record.normalizedText,
      normalizedHtml: record.normalizedHtml ?? null,
      metadata: record.metadata,
      virusScanStatus: record.virusScanStatus,
      virusScannedAt: record.virusScannedAt ?? null,
      virusScanProvider: record.virusScanProvider ?? null,
      deletedRawAt: record.deletedRawAt ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await getFirebaseDb().collection('ingested_documents').doc(id).set(payload);
    return { id, ...payload };
  }
  const { rows } = await getPg().query<any>(
    `INSERT INTO ingested_documents (
      id, import_job_id, user_id, source_type, content_hash, normalized_content_hash, mime_type,
      original_filename, raw_source_reference, content_bytes_ref, normalized_text, normalized_html,
      metadata, virus_scan_status, virus_scanned_at, virus_scan_provider, deleted_raw_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      id,
      record.importJobId,
      record.userId,
      record.sourceType,
      record.contentHash,
      record.normalizedContentHash,
      record.mimeType,
      record.originalFilename,
      record.rawSourceReference,
      record.contentBytesRef,
      record.normalizedText,
      record.normalizedHtml ?? null,
      JSON.stringify(record.metadata),
      record.virusScanStatus,
      record.virusScannedAt ?? null,
      record.virusScanProvider ?? null,
      record.deletedRawAt ?? null,
    ]
  );
  return {
    id: rows[0].id,
    importJobId: rows[0].import_job_id,
    userId: rows[0].user_id,
    sourceType: rows[0].source_type,
    contentHash: rows[0].content_hash,
    normalizedContentHash: rows[0].normalized_content_hash,
    mimeType: rows[0].mime_type,
    originalFilename: rows[0].original_filename,
    rawSourceReference: rows[0].raw_source_reference,
    contentBytesRef: rows[0].content_bytes_ref,
    normalizedText: rows[0].normalized_text,
    normalizedHtml: rows[0].normalized_html,
    metadata: rows[0].metadata ?? {},
    virusScanStatus: rows[0].virus_scan_status,
    virusScannedAt: rows[0].virus_scanned_at,
    virusScanProvider: rows[0].virus_scan_provider,
    deletedRawAt: rows[0].deleted_raw_at,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  };
};

export const markIngestedDocumentRawDeleted = async (documentId: string): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('ingested_documents').doc(documentId).set({ deletedRawAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    return;
  }
  await getPg().query(`UPDATE ingested_documents SET deleted_raw_at = NOW(), updated_at = NOW() WHERE id = $1`, [documentId]);
};

export const findParsedItemByFingerprint = async (
  userId: string,
  fingerprint: string
): Promise<PersistedParsedItem | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('parsed_items')
      .where('userId', '==', userId)
      .where('deduplicationFingerprint', '==', fingerprint)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() as any;
    return mapParsedItemRow({
      id: doc.id,
      user_id: data.userId,
      import_job_id: data.importJobId,
      raw_doc_id: data.rawDocId,
      item_type: data.itemType,
      source_type: data.sourceType,
      source_date: data.sourceDate ?? null,
      provider_vendor: data.providerVendor ?? null,
      traveler_names: data.travelerNames ?? [],
      confirmation_number: data.confirmationNumber ?? null,
      start_datetime_utc: data.startDateTimeUtc ?? null,
      end_datetime_utc: data.endDateTimeUtc ?? null,
      original_timezone: data.originalTimezone ?? null,
      timezone_display_hint: data.timezoneDisplayHint ?? null,
      raw_source_reference: data.rawSourceReference,
      confidence_score: data.confidenceScore ?? 0,
      review_status: data.reviewStatus,
      deduplication_fingerprint: data.deduplicationFingerprint,
      logic_version: data.logicVersion ?? INGESTION_LOGIC_VERSION,
      extracted_fields: data.extractedFields ?? {},
      edited_fields: data.editedFields ?? null,
      duplicate_disposition: data.duplicateDisposition ?? null,
      duplicate_of_parsed_item_id: data.duplicateOfParsedItemId ?? null,
      duplicate_of_trip_id: data.duplicateOfTripId ?? null,
      assigned_trip_id: data.assignedTripId ?? null,
      assignment_transaction_id: data.assignmentTransactionId ?? null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    });
  }
  const { rows } = await getPg().query<ParsedItemRow>(
    `SELECT * FROM parsed_items WHERE user_id = $1 AND deduplication_fingerprint = $2 ORDER BY updated_at DESC LIMIT 1`,
    [userId, fingerprint]
  );
  return rows[0] ? mapParsedItemRow(rows[0]) : null;
};

export const createParsedItem = async (params: {
  userId: string;
  importJobId: string;
  rawDocId: string;
  candidate: ParsedItemCandidate;
  logicVersion: string;
}): Promise<PersistedParsedItem> => {
  await ensureIngestionRepositoryReady();
  const id = randomUUID();
  if (getCurrentDbProvider() === 'firebase') {
    const payload = {
      userId: params.userId,
      importJobId: params.importJobId,
      rawDocId: params.rawDocId,
      itemType: params.candidate.itemType,
      sourceType: params.candidate.sourceType,
      sourceDate: params.candidate.sourceDate,
      providerVendor: params.candidate.providerVendor,
      travelerNames: params.candidate.travelerNames,
      confirmationNumber: params.candidate.confirmationNumber,
      startDateTimeUtc: params.candidate.startDateTimeUtc,
      endDateTimeUtc: params.candidate.endDateTimeUtc,
      originalTimezone: params.candidate.originalTimezone,
      timezoneDisplayHint: params.candidate.timezoneDisplayHint,
      rawSourceReference: params.candidate.rawSourceReference,
      confidenceScore: params.candidate.confidenceScore,
      reviewStatus: params.candidate.reviewStatus,
      deduplicationFingerprint: params.candidate.deduplicationFingerprint,
      logicVersion: params.logicVersion,
      extractedFields: params.candidate.extractedFields,
      editedFields: params.candidate.editedFields ?? null,
      duplicateDisposition: params.candidate.duplicateDisposition ?? null,
      duplicateOfParsedItemId: params.candidate.duplicateOfParsedItemId ?? null,
      duplicateOfTripId: params.candidate.duplicateOfTripId ?? null,
      assignedTripId: null,
      assignmentTransactionId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: params.candidate.reviewStatus,
    };
    await getFirebaseDb().collection('parsed_items').doc(id).set(payload);
    return mapParsedItemRow({
      id,
      user_id: payload.userId,
      import_job_id: payload.importJobId,
      raw_doc_id: payload.rawDocId,
      item_type: payload.itemType,
      source_type: payload.sourceType,
      source_date: payload.sourceDate,
      provider_vendor: payload.providerVendor,
      traveler_names: payload.travelerNames,
      confirmation_number: payload.confirmationNumber,
      start_datetime_utc: payload.startDateTimeUtc,
      end_datetime_utc: payload.endDateTimeUtc,
      original_timezone: payload.originalTimezone,
      timezone_display_hint: payload.timezoneDisplayHint,
      raw_source_reference: payload.rawSourceReference,
      confidence_score: payload.confidenceScore,
      review_status: payload.reviewStatus,
      deduplication_fingerprint: payload.deduplicationFingerprint,
      logic_version: payload.logicVersion,
      extracted_fields: payload.extractedFields,
      edited_fields: payload.editedFields,
      duplicate_disposition: payload.duplicateDisposition,
      duplicate_of_parsed_item_id: payload.duplicateOfParsedItemId,
      duplicate_of_trip_id: payload.duplicateOfTripId,
      assigned_trip_id: null,
      assignment_transaction_id: null,
      created_at: payload.createdAt,
      updated_at: payload.updatedAt,
    });
  }
  const { rows } = await getPg().query<ParsedItemRow>(
    `INSERT INTO parsed_items (
      id, user_id, import_job_id, raw_doc_id, item_type, source_type, source_date, provider_vendor,
      traveler_names, confirmation_number, start_datetime_utc, end_datetime_utc, original_timezone,
      timezone_display_hint, raw_source_reference, confidence_score, review_status,
      deduplication_fingerprint, logic_version, extracted_fields, edited_fields,
      duplicate_disposition, duplicate_of_parsed_item_id, duplicate_of_trip_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      id,
      params.userId,
      params.importJobId,
      params.rawDocId,
      params.candidate.itemType,
      params.candidate.sourceType,
      params.candidate.sourceDate ? new Date(params.candidate.sourceDate) : null,
      params.candidate.providerVendor ?? null,
      JSON.stringify(params.candidate.travelerNames ?? []),
      params.candidate.confirmationNumber ?? null,
      params.candidate.startDateTimeUtc ? new Date(params.candidate.startDateTimeUtc) : null,
      params.candidate.endDateTimeUtc ? new Date(params.candidate.endDateTimeUtc) : null,
      params.candidate.originalTimezone ?? null,
      params.candidate.timezoneDisplayHint ?? null,
      params.candidate.rawSourceReference,
      params.candidate.confidenceScore,
      params.candidate.reviewStatus,
      params.candidate.deduplicationFingerprint,
      params.logicVersion,
      JSON.stringify(params.candidate.extractedFields ?? {}),
      params.candidate.editedFields ? JSON.stringify(params.candidate.editedFields) : null,
      params.candidate.duplicateDisposition ?? null,
      params.candidate.duplicateOfParsedItemId ?? null,
      params.candidate.duplicateOfTripId ?? null,
    ]
  );
  return mapParsedItemRow(rows[0]);
};

export const listReviewQueueItems = async (userId: string): Promise<PersistedParsedItem[]> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('parsed_items')
      .where('userId', '==', userId)
      .where('reviewStatus', 'in', INGESTION_REVIEW_QUEUE_ACTIVE_STATES)
      .orderBy('updatedAt', 'desc')
      .get();
    return snap.docs.map((doc) => {
      const data = doc.data() as any;
      return mapParsedItemRow({
        id: doc.id,
        user_id: data.userId,
        import_job_id: data.importJobId,
        raw_doc_id: data.rawDocId,
        item_type: data.itemType,
        source_type: data.sourceType,
        source_date: data.sourceDate ?? null,
        provider_vendor: data.providerVendor ?? null,
        traveler_names: data.travelerNames ?? [],
        confirmation_number: data.confirmationNumber ?? null,
        start_datetime_utc: data.startDateTimeUtc ?? null,
        end_datetime_utc: data.endDateTimeUtc ?? null,
        original_timezone: data.originalTimezone ?? null,
        timezone_display_hint: data.timezoneDisplayHint ?? null,
        raw_source_reference: data.rawSourceReference,
        confidence_score: data.confidenceScore ?? 0,
        review_status: data.reviewStatus,
        deduplication_fingerprint: data.deduplicationFingerprint,
        logic_version: data.logicVersion ?? INGESTION_LOGIC_VERSION,
        extracted_fields: data.extractedFields ?? {},
        edited_fields: data.editedFields ?? null,
        duplicate_disposition: data.duplicateDisposition ?? null,
        duplicate_of_parsed_item_id: data.duplicateOfParsedItemId ?? null,
        duplicate_of_trip_id: data.duplicateOfTripId ?? null,
        assigned_trip_id: data.assignedTripId ?? null,
        assignment_transaction_id: data.assignmentTransactionId ?? null,
        created_at: data.createdAt,
        updated_at: data.updatedAt,
      });
    });
  }
  const { rows } = await getPg().query<ParsedItemRow>(
    `SELECT * FROM parsed_items
     WHERE user_id = $1 AND review_status = ANY($2::text[])
     ORDER BY updated_at DESC, id DESC`,
    [userId, INGESTION_REVIEW_QUEUE_ACTIVE_STATES]
  );
  return rows.map(mapParsedItemRow);
};

export const getParsedItemById = async (userId: string, itemId: string): Promise<PersistedParsedItem | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const doc = await getFirebaseDb().collection('parsed_items').doc(itemId).get();
    if (!doc.exists) return null;
    const data = doc.data() as any;
    if (data.userId !== userId) return null;
    return mapParsedItemRow({
      id: doc.id,
      user_id: data.userId,
      import_job_id: data.importJobId,
      raw_doc_id: data.rawDocId,
      item_type: data.itemType,
      source_type: data.sourceType,
      source_date: data.sourceDate ?? null,
      provider_vendor: data.providerVendor ?? null,
      traveler_names: data.travelerNames ?? [],
      confirmation_number: data.confirmationNumber ?? null,
      start_datetime_utc: data.startDateTimeUtc ?? null,
      end_datetime_utc: data.endDateTimeUtc ?? null,
      original_timezone: data.originalTimezone ?? null,
      timezone_display_hint: data.timezoneDisplayHint ?? null,
      raw_source_reference: data.rawSourceReference,
      confidence_score: data.confidenceScore ?? 0,
      review_status: data.reviewStatus,
      deduplication_fingerprint: data.deduplicationFingerprint,
      logic_version: data.logicVersion ?? INGESTION_LOGIC_VERSION,
      extracted_fields: data.extractedFields ?? {},
      edited_fields: data.editedFields ?? null,
      duplicate_disposition: data.duplicateDisposition ?? null,
      duplicate_of_parsed_item_id: data.duplicateOfParsedItemId ?? null,
      duplicate_of_trip_id: data.duplicateOfTripId ?? null,
      assigned_trip_id: data.assignedTripId ?? null,
      assignment_transaction_id: data.assignmentTransactionId ?? null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    });
  }
  const { rows } = await getPg().query<ParsedItemRow>(`SELECT * FROM parsed_items WHERE id = $1 AND user_id = $2`, [itemId, userId]);
  return rows[0] ? mapParsedItemRow(rows[0]) : null;
};

export const updateParsedItemEdits = async (userId: string, itemId: string, editedFields: Record<string, unknown>): Promise<PersistedParsedItem> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const ref = getFirebaseDb().collection('parsed_items').doc(itemId);
    await ref.set({ editedFields, updatedAt: nowIso() }, { merge: true });
    const updated = await getParsedItemById(userId, itemId);
    if (!updated) throw new Error('Parsed item not found');
    return updated;
  }
  const { rows } = await getPg().query<ParsedItemRow>(
    `UPDATE parsed_items SET edited_fields = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [itemId, userId, JSON.stringify(editedFields)]
  );
  if (!rows[0]) throw new Error('Parsed item not found');
  return mapParsedItemRow(rows[0]);
};

export const softDeleteParsedItem = async (userId: string, itemId: string): Promise<PersistedParsedItem> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const ref = getFirebaseDb().collection('parsed_items').doc(itemId);
    await ref.set({ reviewStatus: 'DELETED', status: 'DELETED', updatedAt: nowIso() }, { merge: true });
    const updated = await getParsedItemById(userId, itemId);
    if (!updated) throw new Error('Parsed item not found');
    return updated;
  }
  const { rows } = await getPg().query<ParsedItemRow>(
    `UPDATE parsed_items SET review_status = 'DELETED', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [itemId, userId]
  );
  if (!rows[0]) throw new Error('Parsed item not found');
  return mapParsedItemRow(rows[0]);
};

export const assignParsedItemToTrip = async (userId: string, itemId: string, tripId: string, assignedByUserId: string) => {
  await ensureTripExists(tripId);
  const item = await getParsedItemById(userId, itemId);
  if (!item) throw new Error('Parsed item not found');
  if (item.status === 'ASSIGNED') throw new Error('Parsed item already assigned');
  if (item.status === 'DELETED') throw new Error('Deleted items cannot be assigned');

  if (getCurrentDbProvider() === 'firebase') {
    return insertAssignmentArtifactsFirestore(item, tripId, assignedByUserId);
  }

  const client = getPg();
  await client.query('BEGIN');
  try {
    const result = await insertAssignmentArtifactsPostgres(client, item, tripId, assignedByUserId);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

export const recordUsageMetering = async (params: {
  userId: string;
  importJobId: string;
  sourceType: IngestionSourceType;
  parserStage: string;
  provider: string;
  modelName?: string | null;
  tokenCountIn: number;
  tokenCountOut: number;
  estimatedCostUsd: number;
}): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('usage_metering').doc(randomUUID()).set({ ...params, createdAt: nowIso() });
    return;
  }
  await getPg().query(
    `INSERT INTO usage_metering (id, user_id, import_job_id, source_type, parser_stage, provider, model_name, token_count_in, token_count_out, estimated_cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      params.userId,
      params.importJobId,
      params.sourceType,
      params.parserStage,
      params.provider,
      params.modelName ?? null,
      params.tokenCountIn,
      params.tokenCountOut,
      params.estimatedCostUsd,
    ]
  );
};

export const recordParseAttempt = async (record: ParseAttemptRecord): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('parse_attempts').doc(randomUUID()).set(record);
    return;
  }
  await getPg().query(
    `INSERT INTO parse_attempts (id, import_job_id, stage, extractor_name, logic_version, attempt_number, started_at, completed_at, outcome, confidence_score, tokens_in, tokens_out, model_name, error_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      randomUUID(),
      record.importJobId,
      record.stage,
      record.extractorName,
      record.logicVersion,
      record.attemptNumber,
      record.startedAt,
      record.completedAt,
      record.outcome,
      record.confidenceScore,
      record.tokensIn,
      record.tokensOut,
      record.modelName ?? null,
      record.errorCode ?? null,
    ]
  );
};

export const recordParseStageLog = async (record: ParseStageLogRecord): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('parse_stage_logs').doc(randomUUID()).set({
      logId: randomUUID(),
      ...record,
    });
    return;
  }
  await getPg().query(
    `INSERT INTO parse_stage_logs (log_id, import_job_id, stage_name, stage_status, started_at, completed_at, duration_ms, extractor_name, logic_version, cost_estimate, error_code, error_class, pii_safe_message, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      randomUUID(),
      record.importJobId,
      record.stageName,
      record.stageStatus,
      record.startedAt,
      record.completedAt,
      record.durationMs,
      record.extractorName ?? null,
      record.logicVersion ?? null,
      record.costEstimate,
      record.errorCode ?? null,
      record.errorClass ?? null,
      record.piiSafeMessage,
      record.correlationId,
    ]
  );
};

export const getExtractionCacheEntry = async (userId: string, contentHash: string, logicVersion: string): Promise<Record<string, unknown> | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('extraction_cache')
      .where('userId', '==', userId)
      .where('contentHash', '==', contentHash)
      .where('logicVersion', '==', logicVersion)
      .limit(1)
      .get();
    return snap.empty ? null : ((snap.docs[0].data() as any).extractionResult ?? null);
  }
  const { rows } = await getPg().query<{ extraction_result: Record<string, unknown> }>(
    `SELECT extraction_result FROM extraction_cache WHERE user_id = $1 AND content_hash = $2 AND logic_version = $3 LIMIT 1`,
    [userId, contentHash, logicVersion]
  );
  return rows[0]?.extraction_result ?? null;
};

export const saveExtractionCacheEntry = async (
  userId: string,
  contentHash: string,
  logicVersion: string,
  extractionResult: Record<string, unknown>
): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('extraction_cache').doc(`${userId}_${contentHash}_${logicVersion}`).set({
      userId,
      contentHash,
      logicVersion,
      extractionResult,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return;
  }
  await getPg().query(
    `INSERT INTO extraction_cache (id, user_id, content_hash, logic_version, extraction_result)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, content_hash, logic_version)
     DO UPDATE SET extraction_result = EXCLUDED.extraction_result, updated_at = NOW()`,
    [randomUUID(), userId, contentHash, logicVersion, JSON.stringify(extractionResult)]
  );
};

export const getIngestionObservabilitySnapshot = async (): Promise<IngestionObservabilitySnapshot> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const [jobs, items, attempts, stageLogs, metering, users, userTiers] = await Promise.all([
      db.collection('import_jobs').get(),
      db.collection('parsed_items').get(),
      db.collection('parse_attempts').get(),
      db.collection('parse_stage_logs').get(),
      db.collection('usage_metering').get(),
      db.collection('users').get(),
      db.collection('user_tiers').where('effectiveTo', '==', null).get(),
    ]);
    const tierByUser = new Map<string, string>();
    userTiers.docs.forEach((doc) => tierByUser.set(String((doc.data() as any).userId), String((doc.data() as any).tierKey ?? 'free')));
    const ingestionVolumeBySourceAndTierMap = new Map<string, number>();
    jobs.docs.forEach((doc) => {
      const data = doc.data() as any;
      const key = `${data.sourceType}::${tierByUser.get(String(data.userId)) ?? 'free'}`;
      ingestionVolumeBySourceAndTierMap.set(key, (ingestionVolumeBySourceAndTierMap.get(key) ?? 0) + 1);
    });
    const parseRateByStageMap = new Map<string, { successCount: number; failureCount: number }>();
    attempts.docs.forEach((doc) => {
      const data = doc.data() as any;
      const bucket = parseRateByStageMap.get(String(data.stage)) ?? { successCount: 0, failureCount: 0 };
      if (String(data.outcome).includes('succeeded')) bucket.successCount += 1;
      else bucket.failureCount += 1;
      parseRateByStageMap.set(String(data.stage), bucket);
    });
    const averageLatencyByStageMap = new Map<string, { total: number; count: number }>();
    stageLogs.docs.forEach((doc) => {
      const data = doc.data() as any;
      const bucket = averageLatencyByStageMap.get(String(data.stageName)) ?? { total: 0, count: 0 };
      bucket.total += Number(data.durationMs ?? 0);
      bucket.count += 1;
      averageLatencyByStageMap.set(String(data.stageName), bucket);
    });
    const duplicateCount = items.docs.filter((doc) => String((doc.data() as any).reviewStatus ?? '') === 'DUPLICATE_FLAGGED').length;
    const lowConfidenceCount = items.docs.filter((doc) => String((doc.data() as any).reviewStatus ?? '') === 'LOW_CONFIDENCE').length;
    const retryCount = jobs.docs.reduce((sum, doc) => sum + Number((doc.data() as any).retryCount ?? 0), 0);
    const deadLetterCount = jobs.docs.filter((doc) => String((doc.data() as any).state ?? '') === 'DEAD_LETTERED').length;
    const llmUsageByModelMap = new Map<string, { tokensIn: number; tokensOut: number; estimatedCostUsd: number }>();
    const costPerUserMap = new Map<string, number>();
    metering.docs.forEach((doc) => {
      const data = doc.data() as any;
      const key = `${data.provider}::${data.modelName ?? 'unknown'}`;
      const bucket = llmUsageByModelMap.get(key) ?? { tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 };
      bucket.tokensIn += Number(data.tokenCountIn ?? 0);
      bucket.tokensOut += Number(data.tokenCountOut ?? 0);
      bucket.estimatedCostUsd += Number(data.estimatedCostUsd ?? 0);
      llmUsageByModelMap.set(key, bucket);
      costPerUserMap.set(String(data.userId), (costPerUserMap.get(String(data.userId)) ?? 0) + Number(data.estimatedCostUsd ?? 0));
    });
    return {
      ingestionVolumeBySourceAndTier: Array.from(ingestionVolumeBySourceAndTierMap.entries()).map(([key, count]) => {
        const [sourceType, tierKey] = key.split('::');
        return { sourceType, tierKey, count };
      }),
      parseRateByStage: Array.from(parseRateByStageMap.entries()).map(([stageName, counts]) => ({ stageName, ...counts })),
      duplicateRate: { duplicateCount, totalCount: items.size },
      lowConfidenceRate: { lowConfidenceCount, totalCount: items.size },
      averageLatencyByStage: Array.from(averageLatencyByStageMap.entries()).map(([stageName, value]) => ({
        stageName,
        averageMs: value.count ? Math.round(value.total / value.count) : 0,
      })),
      retryAndDeadLetter: { retryCount, deadLetterCount },
      llmUsageByModel: Array.from(llmUsageByModelMap.entries()).map(([key, value]) => {
        const [provider, modelName] = key.split('::');
        return { provider, modelName, ...value };
      }),
      quotaByUserTier: Array.from(users.docs).map((doc) => ({
        userId: doc.id,
        tierKey: tierByUser.get(doc.id) ?? 'free',
        uploadsUsed: jobs.docs.filter((job) => String((job.data() as any).userId) === doc.id).length,
      })),
      gmailAuthFailures: jobs.docs.filter((doc) => String((doc.data() as any).failureCode ?? '') === 'provider_auth_expired').length,
      webhookSignatureFailures: jobs.docs.filter((doc) => String((doc.data() as any).failureCode ?? '') === 'mailbox_webhook_temporary_failure').length,
      costPerUser: Array.from(costPerUserMap.entries()).map(([userId, estimatedCostUsd]) => ({ userId, estimatedCostUsd })),
    };
  }
  const p = getPg();
  const [volume, stageRates, duplicates, lowConfidence, latency, retryDead, llmUsage, quotaRows, costPerUser] = await Promise.all([
    p.query<{ source_type: string; tier_key: string; count: string }>(
      `SELECT ij.source_type, COALESCE(t.key, 'free') AS tier_key, COUNT(*)::text AS count
       FROM import_jobs ij
       LEFT JOIN user_tiers ut ON ut.user_id = ij.user_id AND ut.effective_to IS NULL
       LEFT JOIN tiers t ON t.id = ut.tier_id
       GROUP BY ij.source_type, COALESCE(t.key, 'free')`
    ),
    p.query<{ stage: string; success_count: string; failure_count: string }>(
      `SELECT stage,
              COUNT(*) FILTER (WHERE outcome LIKE '%succeeded')::text AS success_count,
              COUNT(*) FILTER (WHERE outcome NOT LIKE '%succeeded')::text AS failure_count
       FROM parse_attempts
       GROUP BY stage`
    ),
    p.query<{ duplicate_count: string; total_count: string }>(
      `SELECT COUNT(*) FILTER (WHERE review_status = 'DUPLICATE_FLAGGED')::text AS duplicate_count,
              COUNT(*)::text AS total_count
       FROM parsed_items`
    ),
    p.query<{ low_confidence_count: string; total_count: string }>(
      `SELECT COUNT(*) FILTER (WHERE review_status = 'LOW_CONFIDENCE')::text AS low_confidence_count,
              COUNT(*)::text AS total_count
       FROM parsed_items`
    ),
    p.query<{ stage_name: string; average_ms: string }>(
      `SELECT stage_name, COALESCE(AVG(duration_ms), 0)::text AS average_ms FROM parse_stage_logs GROUP BY stage_name`
    ),
    p.query<{ retry_count: string; dead_letter_count: string }>(
      `SELECT COALESCE(SUM(retry_count), 0)::text AS retry_count,
              COUNT(*) FILTER (WHERE state = 'DEAD_LETTERED')::text AS dead_letter_count
       FROM import_jobs`
    ),
    p.query<{ provider: string; model_name: string | null; tokens_in: string; tokens_out: string; estimated_cost_usd: string }>(
      `SELECT provider, COALESCE(model_name, 'unknown') AS model_name,
              SUM(token_count_in)::text AS tokens_in,
              SUM(token_count_out)::text AS tokens_out,
              SUM(estimated_cost_usd)::text AS estimated_cost_usd
       FROM usage_metering
       GROUP BY provider, COALESCE(model_name, 'unknown')`
    ),
    p.query<{ user_id: string; tier_key: string; uploads_used: string }>(
      `SELECT ij.user_id,
              COALESCE(t.key, 'free') AS tier_key,
              COUNT(*)::text AS uploads_used
       FROM import_jobs ij
       LEFT JOIN user_tiers ut ON ut.user_id = ij.user_id AND ut.effective_to IS NULL
       LEFT JOIN tiers t ON t.id = ut.tier_id
       GROUP BY ij.user_id, COALESCE(t.key, 'free')`
    ),
    p.query<{ user_id: string; estimated_cost_usd: string }>(
      `SELECT user_id, SUM(estimated_cost_usd)::text AS estimated_cost_usd FROM usage_metering GROUP BY user_id`
    ),
  ]);
  return {
    ingestionVolumeBySourceAndTier: volume.rows.map((row) => ({
      sourceType: row.source_type,
      tierKey: row.tier_key,
      count: parseInt(row.count, 10),
    })),
    parseRateByStage: stageRates.rows.map((row) => ({
      stageName: row.stage,
      successCount: parseInt(row.success_count, 10),
      failureCount: parseInt(row.failure_count, 10),
    })),
    duplicateRate: {
      duplicateCount: parseInt(duplicates.rows[0]?.duplicate_count ?? '0', 10),
      totalCount: parseInt(duplicates.rows[0]?.total_count ?? '0', 10),
    },
    lowConfidenceRate: {
      lowConfidenceCount: parseInt(lowConfidence.rows[0]?.low_confidence_count ?? '0', 10),
      totalCount: parseInt(lowConfidence.rows[0]?.total_count ?? '0', 10),
    },
    averageLatencyByStage: latency.rows.map((row) => ({
      stageName: row.stage_name,
      averageMs: Math.round(parseFloat(row.average_ms)),
    })),
    retryAndDeadLetter: {
      retryCount: parseInt(retryDead.rows[0]?.retry_count ?? '0', 10),
      deadLetterCount: parseInt(retryDead.rows[0]?.dead_letter_count ?? '0', 10),
    },
    llmUsageByModel: llmUsage.rows.map((row) => ({
      provider: row.provider,
      modelName: row.model_name ?? 'unknown',
      tokensIn: parseInt(row.tokens_in, 10),
      tokensOut: parseInt(row.tokens_out, 10),
      estimatedCostUsd: parseFloat(row.estimated_cost_usd),
    })),
    quotaByUserTier: quotaRows.rows.map((row) => ({
      userId: row.user_id,
      tierKey: row.tier_key,
      uploadsUsed: parseInt(row.uploads_used, 10),
    })),
    gmailAuthFailures: 0,
    webhookSignatureFailures: 0,
    costPerUser: costPerUser.rows.map((row) => ({
      userId: row.user_id,
      estimatedCostUsd: parseFloat(row.estimated_cost_usd),
    })),
  };
};

export const getReviewQueueSignedUrl = async (_documentId: string): Promise<{ url: string | null; expiresAt: string | null }> => {
  const expiresAt = new Date(Date.now() + INGESTION_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return { url: null, expiresAt };
};

export const deleteUserIngestionData = async (userId: string): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const collections = [
      { name: 'provider_connections', field: 'userId' },
      { name: 'import_jobs', field: 'userId' },
      { name: 'ingested_documents', field: 'userId' },
      { name: 'parsed_items', field: 'userId' },
      { name: 'usage_metering', field: 'userId' },
      { name: 'parse_attempts', field: null },
      { name: 'parse_stage_logs', field: null },
      { name: 'extraction_cache', field: 'userId' },
      { name: 'ingestion_sources', field: 'userId' },
    ];
    for (const collection of collections) {
      if (!collection.field) continue;
      const snap = await db.collection(collection.name).where(collection.field, '==', userId).get().catch(() => null);
      if (!snap) continue;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    const assignmentSnap = await db.collection('parsed_item_assignments').where('assignedByUserId', '==', userId).get().catch(() => null);
    if (assignmentSnap) {
      const batch = db.batch();
      assignmentSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    return;
  }
  const p = getPg();
  await p.query(`DELETE FROM provider_connections WHERE user_id = $1`, [userId]);
  await p.query(`DELETE FROM parsed_item_assignments WHERE assigned_by_user_id = $1`, [userId]);
  await p.query(`DELETE FROM parsed_items WHERE user_id = $1 AND review_status <> 'ASSIGNED'`, [userId]);
  await p.query(`DELETE FROM ingested_documents WHERE user_id = $1`, [userId]);
  await p.query(`DELETE FROM import_jobs WHERE user_id = $1`, [userId]);
  await p.query(`DELETE FROM usage_metering WHERE user_id = $1`, [userId]);
  await p.query(`DELETE FROM extraction_cache WHERE user_id = $1`, [userId]);
  await p.query(`DELETE FROM ingestion_sources WHERE user_id = $1`, [userId]);
};

export const upsertProviderConnection = async (params: {
  userId: string;
  provider: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: string | null;
  scopes: string[];
  metadata?: Record<string, unknown>;
}): Promise<string> => {
  await ensureIngestionRepositoryReady();
  const id = randomUUID();
  const encryptedAccessToken = params.accessToken ? encryptToken(params.accessToken) : null;
  const encryptedRefreshToken = params.refreshToken ? encryptToken(params.refreshToken) : null;
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('provider_connections').doc(id).set({
      userId: params.userId,
      provider: params.provider,
      status: 'connected',
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiry: params.tokenExpiry ?? null,
      scopes: params.scopes,
      metadata: params.metadata ?? {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return id;
  }
  await getPg().query(
    `INSERT INTO provider_connections (id, user_id, provider, status, encrypted_access_token, encrypted_refresh_token, token_expiry, scopes, metadata)
     VALUES ($1,$2,$3,'connected',$4,$5,$6,$7,$8)`,
    [id, params.userId, params.provider, encryptedAccessToken, encryptedRefreshToken, params.tokenExpiry ?? null, JSON.stringify(params.scopes), JSON.stringify(params.metadata ?? {})]
  );
  return id;
};

export const disconnectProviderConnections = async (userId: string, provider?: string): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    let query: FirebaseFirestore.Query = getFirebaseDb().collection('provider_connections').where('userId', '==', userId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snap = await query.get();
    const batch = getFirebaseDb().batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return;
  }
  if (provider) {
    await getPg().query(`DELETE FROM provider_connections WHERE user_id = $1 AND provider = $2`, [userId, provider]);
    return;
  }
  await getPg().query(`DELETE FROM provider_connections WHERE user_id = $1`, [userId]);
};
