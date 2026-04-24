import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Pool } from 'pg';
import { getCurrentDbProvider, poolClient, getTripById, upsertExpenseForSource } from '../../db';
import { getEnvValue } from '../../env';
import { fetchFrankfurterExchangeRate } from '../../apis/frankfurterApi';
import {
  INGESTION_LOGIC_VERSION,
  INGESTION_RETRY_POLICY_DEFAULTS,
  INGESTION_RETRY_PROVIDER_GLOBAL,
  INGESTION_REVIEW_QUEUE_ACTIVE_STATES,
  INGESTION_SIGNED_URL_TTL_SECONDS,
} from '../config';
import type {
  DuplicateDisposition,
  IngestionObservabilitySnapshot,
  IngestionSourceType,
  ImportJobState,
  NormalizationQuality,
  ParsedItemCandidate,
  ParsedItemReviewState,
  PersistedImportJob,
  PersistedParsedItem,
  ProviderConnectionRecord,
  QueuedImportProcessorConfig,
  RetryPolicyConfigRecord,
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
  timezone_status: string | null;
  raw_datetime_string: string | null;
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
  next_retry_at: string | null;
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
  normalizationQuality: NormalizationQuality;
  metadata: Record<string, unknown>;
  virusScanStatus: VirusScanStatus;
  virusScannedAt?: string | null;
  virusScanProvider?: string | null;
  deletedRawAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ImportJobPayloadRecord = {
  jobId: string;
  sourceId: string;
  userId: string;
  sourceType: IngestionSourceType;
  externalMessageId: string;
  receivedAt: string;
  originalFilename: string;
  mimeType: string;
  contentBytesRef: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  correlationId: string;
  dryRun: boolean;
  virusScanStatus: VirusScanStatus;
  processorConfig: QueuedImportProcessorConfig;
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

type ProviderConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
  scopes: string[] | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type RetryPolicyRow = {
  provider: string;
  max_attempts: number;
  base_delay_seconds: number;
  max_delay_seconds: number;
  alert_threshold_percent: number;
  updated_at: string;
};

const SYSTEM_APP_ID = 'WanderBunnies';
const SYSTEM_SENDER_NAME = 'WanderBunnies';
const SYSTEM_SENDER_INITIALS = 'WB';
const schemaReady = new Set<string>();
let firebaseApp: App | null = null;

const nowIso = () => new Date().toISOString();

const omitUndefinedFields = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== 'undefined')) as T;

const deepOmitUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((entry) => deepOmitUndefined(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, fieldValue]) => typeof fieldValue !== 'undefined')
        .map(([fieldName, fieldValue]) => [fieldName, deepOmitUndefined(fieldValue)])
    ) as T;
  }
  return value;
};

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
  nextRetryAt: row.next_retry_at,
});

/**
 * Compute the earliest-retry timestamp after a failed run. Pure exponential
 * backoff capped at `maxDelaySeconds` — deterministic (no jitter) in this
 * first slice so tests stay trivial to write; jitter can be layered on when
 * the scheduler ships.
 *
 * @param retryCount Count AFTER the failure (i.e. this is the attempt that
 *   just failed, numbered 1 for the first attempt).
 */
export const computeNextRetryAt = (
  retryCount: number,
  opts: { baseDelaySeconds: number; maxDelaySeconds: number; now?: Date },
): string => {
  const { baseDelaySeconds, maxDelaySeconds } = opts;
  const now = opts.now ?? new Date();
  const attempt = Math.max(1, Math.floor(retryCount));
  const rawSeconds = baseDelaySeconds * Math.pow(2, attempt - 1);
  const bounded = Math.min(Math.max(baseDelaySeconds, rawSeconds), maxDelaySeconds);
  return new Date(now.getTime() + bounded * 1000).toISOString();
};

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
  timezoneStatus: (row.timezone_status as any) ?? 'UNKNOWN',
  rawDatetimeString: row.raw_datetime_string ?? null,
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

const normalizeScopes = (value: ProviderConnectionRow['scopes']): string[] => {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return value.split(/\s+/).filter(Boolean);
    }
  }
  return [];
};

const mapProviderConnectionRow = (row: ProviderConnectionRow): ProviderConnectionRecord => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider,
  status: row.status,
  accessToken: row.encrypted_access_token ? decryptToken(row.encrypted_access_token) : null,
  refreshToken: row.encrypted_refresh_token ? decryptToken(row.encrypted_refresh_token) : null,
  tokenExpiry: row.token_expiry ?? null,
  scopes: normalizeScopes(row.scopes),
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapRetryPolicyRow = (row: RetryPolicyRow): RetryPolicyConfigRecord => ({
  provider: row.provider,
  maxAttempts: Number(row.max_attempts ?? INGESTION_RETRY_POLICY_DEFAULTS.maxAttempts),
  baseDelaySeconds: Number(row.base_delay_seconds ?? INGESTION_RETRY_POLICY_DEFAULTS.baseDelaySeconds),
  maxDelaySeconds: Number(row.max_delay_seconds ?? INGESTION_RETRY_POLICY_DEFAULTS.maxDelaySeconds),
  alertThresholdPercent: Number(row.alert_threshold_percent ?? INGESTION_RETRY_POLICY_DEFAULTS.alertDeadLetterRatePercent),
  updatedAt: row.updated_at,
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
      completed_at TIMESTAMP,
      next_retry_at TIMESTAMP
    );
  `);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_user_idempotency ON import_jobs(user_id, idempotency_key);`);
  // Supports the future retry-with-backoff scheduler: fetch rows where
  // state='FAILED' AND next_retry_at <= NOW() AND retry_count < max_attempts.
  // Column + index shipped separately from the scheduler so the data
  // structure evolves independently.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_next_retry ON import_jobs(next_retry_at);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS import_job_payloads (
      job_id UUID PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      received_at TIMESTAMP NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content_bytes_ref TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      correlation_id TEXT NOT NULL,
      dry_run BOOLEAN NOT NULL DEFAULT FALSE,
      virus_scan_status TEXT NOT NULL,
      processor_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
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
      normalization_quality TEXT NOT NULL DEFAULT 'FULL_TEXT',
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
    CREATE TABLE IF NOT EXISTS ingestion_retry_config (
      provider TEXT PRIMARY KEY,
      max_attempts INTEGER NOT NULL,
      base_delay_seconds INTEGER NOT NULL,
      max_delay_seconds INTEGER NOT NULL,
      alert_threshold_percent INTEGER NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(
    `INSERT INTO ingestion_retry_config (provider, max_attempts, base_delay_seconds, max_delay_seconds, alert_threshold_percent)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider) DO NOTHING`,
    [
      INGESTION_RETRY_PROVIDER_GLOBAL,
      INGESTION_RETRY_POLICY_DEFAULTS.maxAttempts,
      INGESTION_RETRY_POLICY_DEFAULTS.baseDelaySeconds,
      INGESTION_RETRY_POLICY_DEFAULTS.maxDelaySeconds,
      INGESTION_RETRY_POLICY_DEFAULTS.alertDeadLetterRatePercent,
    ]
  );
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
      timezone_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      raw_datetime_string TEXT,
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
  await p.query(`
    CREATE TABLE IF NOT EXISTS learned_source_parsers (
      id UUID PRIMARY KEY,
      source_key TEXT NOT NULL,
      item_type TEXT NOT NULL,
      field_patterns JSONB NOT NULL DEFAULT '{}'::jsonb,
      sample_count INTEGER NOT NULL DEFAULT 1,
      confidence_avg NUMERIC NOT NULL DEFAULT 0,
      last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (source_key, item_type)
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS ingestion_webhook_replay_tokens (
      id UUID PRIMARY KEY,
      provider TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (provider, token_hash)
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS data_deletion_jobs (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      state TEXT NOT NULL,
      counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      failure_reason TEXT,
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_data_deletion_jobs_user ON data_deletion_jobs(user_id);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_data_deletion_jobs_state ON data_deletion_jobs(state);`);
  schemaReady.add('postgres');
};

const ensureFirestoreCollections = async (): Promise<void> => {
  if (schemaReady.has('firebase')) return;
  const db = getFirebaseDb();
  await Promise.all([
    db.collection('ingestion_sources').limit(1).get(),
    db.collection('import_jobs').limit(1).get(),
    db.collection('import_job_payloads').limit(1).get(),
    db.collection('ingested_documents').limit(1).get(),
    db.collection('ingestion_retry_config').limit(1).get(),
    db.collection('ingestion_webhook_replay_tokens').limit(1).get(),
    db.collection('data_deletion_jobs').limit(1).get(),
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

const resolveAssignedDateOnly = (primary: unknown, fallbackValue: unknown, fallback = nowIso().slice(0, 10)): string =>
  toDateOnly(primary ?? fallbackValue, fallback);

const resolveAssignedTimeOnly = (primary: unknown, fallbackValue: unknown, fallback = '00:00'): string => {
  const direct = toTimeOnly(primary, '');
  if (direct) return direct;
  return toTimeOnly(fallbackValue, fallback);
};

const resolveAssignedFlightCost = (fields: Record<string, unknown>): number =>
  Number(fields.totalCost ?? fields.cost ?? 0);

const calculateLodgingCostPerNight = (checkInDate: string, checkOutDate: string, totalCost: number): number => {
  const start = new Date(checkInDate).getTime();
  const end = new Date(checkOutDate).getTime();
  const nights = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  return Number((totalCost / nights).toFixed(2));
};

const normalizeCurrencyCode = (value: unknown): string | null => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
};

const syncAssignedFlightExpense = async (params: {
  item: PersistedParsedItem;
  tripId: string;
  tripRecordId: string;
  matchedMemberIds: string[];
}): Promise<void> => {
  if (params.item.itemType !== 'flight' && params.item.itemType !== 'rail' && params.item.itemType !== 'ferry_bus_transfer') {
    return;
  }
  const trip = await getTripById(params.tripId);
  if (!trip?.groupId) return;
  const fields = mergeFields(params.item);
  const amount = resolveAssignedFlightCost(fields);
  const currency = normalizeCurrencyCode(fields.currency);
  const expenseDate = toDateOnly(fields.startDateTimeUtc ?? params.item.startDateTimeUtc);
  const tripCurrency = normalizeCurrencyCode(trip.currency) ?? 'USD';

  let amountInTripCurrency: number | null | undefined = undefined;
  let exchangeRateToTripCurrency: number | null | undefined = undefined;
  let exchangeRateDate: string | null | undefined = undefined;

  if (amount <= 0) {
    amountInTripCurrency = 0;
    exchangeRateToTripCurrency = currency && currency === tripCurrency ? 1 : null;
  } else if (currency && currency !== tripCurrency) {
    const rate = await fetchFrankfurterExchangeRate({
      caller: 'INGESTION_ASSIGNMENT_FX',
      fromCurrency: currency,
      toCurrency: tripCurrency,
      date: expenseDate,
    }).catch(() => null);
    if (rate) {
      amountInTripCurrency = Number((amount * rate.rate).toFixed(2));
      exchangeRateToTripCurrency = rate.rate;
      exchangeRateDate = rate.date;
    }
  }

  await upsertExpenseForSource({
    userId: params.item.userId,
    tripId: params.tripId,
    groupId: trip.groupId,
    expenseDate,
    category: 'Flights',
    amount,
    currency,
    amountInTripCurrency,
    exchangeRateToTripCurrency,
    exchangeRateDate,
    payerIds: params.matchedMemberIds,
    forIds: params.matchedMemberIds,
    sourceType: 'flight',
    sourceId: params.tripRecordId,
  });
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

/**
 * Match extracted traveler names against trip group members, returning the
 * member row IDs for any that match.  Uses case-insensitive first+last comparison.
 */
const matchTravelerNamesToGroupMemberIds = async (
  travelerNames: string[],
  tripId: string
): Promise<string[]> => {
  if (!travelerNames.length) return [];
  try {
    const trip = await getTripById(tripId);
    if (!trip?.groupId) return [];

    if (getCurrentDbProvider() === 'firebase') {
      const db = getFirebaseDb();
      const snap = await db
        .collection('group_members')
        .where('groupId', '==', trip.groupId)
        .where('removedAt', '==', null)
        .get();
      if (snap.empty) return [];
      const linkedUserIds = Array.from(
        new Set(
          snap.docs
            .map((doc) => String((doc.data() as any).userId ?? '').trim())
            .filter(Boolean)
        )
      );
      const linkedProfiles = new Map<string, any>();
      await Promise.all(
        linkedUserIds.map(async (userId) => {
          const profileSnap = await db.collection('web_users').doc(userId).get();
          if (profileSnap.exists) {
            linkedProfiles.set(userId, profileSnap.data() as any);
          }
        })
      );
      const memberIds: string[] = [];
      for (const doc of snap.docs) {
        const d = doc.data() as any;
        const profile = d.userId ? linkedProfiles.get(String(d.userId)) : null;
        const memberName = [
          d.firstName ?? profile?.firstName ?? '',
          d.lastName ?? profile?.lastName ?? '',
        ].join(' ').trim().toLowerCase();
        const memberTokens = memberName.split(/\s+/).filter(Boolean);
        const guestName = (d.guestName ?? '').trim().toLowerCase();
        const guestTokens = guestName.split(/\s+/).filter(Boolean);
        for (const traveler of travelerNames) {
          const t = traveler.trim().toLowerCase();
          const travelerTokens = t.split(/\s+/).filter(Boolean);
          if ((memberName && t === memberName) || (guestName && t === guestName)) {
            memberIds.push(doc.id);
            break;
          }
          if (memberTokens.length >= 2 && memberTokens.every((tok) => travelerTokens.includes(tok))) {
            memberIds.push(doc.id);
            break;
          }
          if (guestTokens.length >= 2 && guestTokens.every((tok: string) => travelerTokens.includes(tok))) {
            memberIds.push(doc.id);
            break;
          }
        }
      }
      return memberIds;
    }

    // Postgres: join group_members with users/web_users to get full names
    const { rows } = await getPg().query<{ id: string; fullName: string; guestName: string | null }>(
      `SELECT gm.id,
              LOWER(TRIM(COALESCE(gm.first_name, wu.first_name, '') || ' ' || COALESCE(gm.last_name, wu.last_name, ''))) as "fullName",
              LOWER(TRIM(COALESCE(gm.guest_name, ''))) as "guestName"
       FROM group_members gm
       LEFT JOIN web_users wu ON gm.user_id = wu.id
       WHERE gm.group_id = $1 AND gm.removed_at IS NULL`,
      [trip.groupId]
    );
    if (!rows.length) return [];

    const normalizedTravelers = travelerNames.map((n) => n.trim().toLowerCase());
    const matched: string[] = [];
    for (const row of rows) {
      const memberTokens = row.fullName.trim().split(/\s+/).filter(Boolean);
      const guestTokens = (row.guestName ?? '').split(/\s+/).filter(Boolean);
      for (const t of normalizedTravelers) {
        const travelerTokens = t.split(/\s+/).filter(Boolean);
        // Exact match
        if ((row.fullName.trim() && t === row.fullName.trim()) || (row.guestName && t === row.guestName)) {
          matched.push(row.id);
          break;
        }
        // Fuzzy: member's first+last tokens are all contained in the traveler name
        // e.g., member "Bryan Duerk" matches traveler "Bryan Edward Duerk"
        if (memberTokens.length >= 2 && memberTokens.every((tok) => travelerTokens.includes(tok))) {
          matched.push(row.id);
          break;
        }
        if (guestTokens.length >= 2 && guestTokens.every((tok: string) => travelerTokens.includes(tok))) {
          matched.push(row.id);
          break;
        }
      }
    }
    return matched;
  } catch {
    // Best-effort: if matching fails (e.g., pg-mem limitations), return empty
    return [];
  }
};

const insertAssignmentArtifactsPostgres = async (client: Pool, item: PersistedParsedItem, tripId: string, assignedByUserId: string) => {
  const id = randomUUID();
  const messageId = randomUUID();
  const assignmentTransactionId = randomUUID();
  const trip = await getTripById(tripId);
  const tripName = trip?.name ?? 'trip';
  const fields = mergeFields(item);

  // Auto-match extracted traveler names to trip group members
  const matchedMemberIds = await matchTravelerNamesToGroupMemberIds(item.travelerNames ?? [], tripId);
  const departureDate = resolveAssignedDateOnly(fields.departureDate, fields.startDateTimeUtc ?? item.startDateTimeUtc);
  const departureTime = resolveAssignedTimeOnly(fields.departureTime, fields.startDateTimeUtc ?? item.startDateTimeUtc);
  const arrivalDate = resolveAssignedDateOnly(fields.arrivalDate, fields.endDateTimeUtc ?? item.endDateTimeUtc, departureDate);
  const arrivalTime = resolveAssignedTimeOnly(fields.arrivalTime, fields.endDateTimeUtc ?? item.endDateTimeUtc);
  const flightCost = resolveAssignedFlightCost(fields);

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
        JSON.stringify(matchedMemberIds),
        departureDate,
        String(fields.departureLocation ?? fields.location ?? ''),
        String(fields.departureAirportCode ?? ''),
        departureTime,
        String(fields.arrivalLocation ?? ''),
        String(fields.arrivalAirportCode ?? ''),
        arrivalDate,
        arrivalTime,
        flightCost,
        String(fields.providerVendor ?? item.providerVendor ?? ''),
        String(fields.flightNumber ?? fields.segmentNumber ?? ''),
        String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        JSON.stringify(matchedMemberIds),
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
        JSON.stringify(matchedMemberIds),
        JSON.stringify(matchedMemberIds),
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
        JSON.stringify(matchedMemberIds),
        JSON.stringify(matchedMemberIds),
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
        JSON.stringify(matchedMemberIds),
        JSON.stringify(matchedMemberIds),
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
  return { tripRecordId: id, assignmentTransactionId, matchedMemberIds };
};

const insertAssignmentArtifactsFirestore = async (item: PersistedParsedItem, tripId: string, assignedByUserId: string) => {
  const db = getFirebaseDb();
  const assignmentTransactionId = randomUUID();
  const tripRecordId = randomUUID();
  const messageId = randomUUID();
  const trip = await getTripById(tripId);
  const tripName = trip?.name ?? 'trip';
  const fields = mergeFields(item);
  const matchedMemberIds = await matchTravelerNamesToGroupMemberIds(item.travelerNames ?? [], tripId);
  const departureDate = resolveAssignedDateOnly(fields.departureDate, fields.startDateTimeUtc ?? item.startDateTimeUtc);
  const departureTime = resolveAssignedTimeOnly(fields.departureTime, fields.startDateTimeUtc ?? item.startDateTimeUtc);
  const arrivalDate = resolveAssignedDateOnly(fields.arrivalDate, fields.endDateTimeUtc ?? item.endDateTimeUtc, departureDate);
  const arrivalTime = resolveAssignedTimeOnly(fields.arrivalTime, fields.endDateTimeUtc ?? item.endDateTimeUtc);
  const flightCost = resolveAssignedFlightCost(fields);
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
        passengerIds: matchedMemberIds,
        departureDate,
        departureLocation: String(fields.departureLocation ?? ''),
        departureAirportCode: String(fields.departureAirportCode ?? ''),
        departureTime,
        arrivalLocation: String(fields.arrivalLocation ?? ''),
        arrivalAirportCode: String(fields.arrivalAirportCode ?? ''),
        arrivalDate,
        arrivalTime,
        cost: flightCost,
        carrier: String(fields.providerVendor ?? item.providerVendor ?? ''),
        flightNumber: String(fields.flightNumber ?? ''),
        bookingReference: String(fields.confirmationNumber ?? item.confirmationNumber ?? ''),
        paidBy: matchedMemberIds,
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
        paidBy: matchedMemberIds,
        travelerIds: matchedMemberIds,
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
        paidBy: matchedMemberIds,
        travelerIds: matchedMemberIds,
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
  return { tripRecordId, assignmentTransactionId, matchedMemberIds };
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

export const saveImportJobPayload = async (record: Omit<ImportJobPayloadRecord, 'createdAt' | 'updatedAt'>): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('import_job_payloads').doc(record.jobId).set({
      ...record,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return;
  }
  await getPg().query(
    `INSERT INTO import_job_payloads (
      job_id, source_id, user_id, source_type, external_message_id, received_at, original_filename, mime_type,
      content_bytes_ref, content_hash, metadata, correlation_id, dry_run, virus_scan_status, processor_config
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (job_id) DO UPDATE
     SET source_id = EXCLUDED.source_id,
         user_id = EXCLUDED.user_id,
         source_type = EXCLUDED.source_type,
         external_message_id = EXCLUDED.external_message_id,
         received_at = EXCLUDED.received_at,
         original_filename = EXCLUDED.original_filename,
         mime_type = EXCLUDED.mime_type,
         content_bytes_ref = EXCLUDED.content_bytes_ref,
         content_hash = EXCLUDED.content_hash,
         metadata = EXCLUDED.metadata,
         correlation_id = EXCLUDED.correlation_id,
         dry_run = EXCLUDED.dry_run,
         virus_scan_status = EXCLUDED.virus_scan_status,
         processor_config = EXCLUDED.processor_config,
         updated_at = CURRENT_TIMESTAMP::timestamp`,
    [
      record.jobId,
      record.sourceId,
      record.userId,
      record.sourceType,
      record.externalMessageId,
      record.receivedAt,
      record.originalFilename,
      record.mimeType,
      record.contentBytesRef,
      record.contentHash,
      JSON.stringify(record.metadata),
      record.correlationId,
      record.dryRun,
      record.virusScanStatus,
      JSON.stringify(record.processorConfig),
    ]
  );
};

export const getImportJobPayload = async (jobId: string): Promise<ImportJobPayloadRecord | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const doc = await getFirebaseDb().collection('import_job_payloads').doc(jobId).get();
    if (!doc.exists) return null;
    const data = doc.data() as any;
    return {
      jobId: doc.id,
      sourceId: String(data.sourceId),
      userId: String(data.userId),
      sourceType: data.sourceType,
      externalMessageId: String(data.externalMessageId),
      receivedAt: String(data.receivedAt),
      originalFilename: String(data.originalFilename),
      mimeType: String(data.mimeType),
      contentBytesRef: String(data.contentBytesRef),
      contentHash: String(data.contentHash),
      metadata: data.metadata ?? {},
      correlationId: String(data.correlationId),
      dryRun: Boolean(data.dryRun),
      virusScanStatus: data.virusScanStatus,
      processorConfig: {
        allowSmallLlm: Boolean(data.processorConfig?.allowSmallLlm),
        allowLargeLlm: Boolean(data.processorConfig?.allowLargeLlm),
        logicVersion: String(data.processorConfig?.logicVersion ?? INGESTION_LOGIC_VERSION),
        enforceFutureDated: Boolean(data.processorConfig?.enforceFutureDated),
      },
      createdAt: String(data.createdAt),
      updatedAt: String(data.updatedAt),
    };
  }
  const { rows } = await getPg().query<any>(`SELECT * FROM import_job_payloads WHERE job_id = $1 LIMIT 1`, [jobId]);
  if (!rows[0]) return null;
  return {
    jobId: rows[0].job_id,
    sourceId: rows[0].source_id,
    userId: rows[0].user_id,
    sourceType: rows[0].source_type,
    externalMessageId: rows[0].external_message_id,
    receivedAt: rows[0].received_at,
    originalFilename: rows[0].original_filename,
    mimeType: rows[0].mime_type,
    contentBytesRef: rows[0].content_bytes_ref,
    contentHash: rows[0].content_hash,
    metadata: rows[0].metadata ?? {},
    correlationId: rows[0].correlation_id,
    dryRun: rows[0].dry_run,
    virusScanStatus: rows[0].virus_scan_status,
    processorConfig: {
      allowSmallLlm: Boolean(rows[0].processor_config?.allowSmallLlm ?? rows[0].processor_config?.allow_small_llm),
      allowLargeLlm: Boolean(rows[0].processor_config?.allowLargeLlm ?? rows[0].processor_config?.allow_large_llm),
      logicVersion: String(rows[0].processor_config?.logicVersion ?? rows[0].processor_config?.logic_version ?? INGESTION_LOGIC_VERSION),
      enforceFutureDated: Boolean(rows[0].processor_config?.enforceFutureDated ?? rows[0].processor_config?.enforce_future_dated),
    },
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  };
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

/**
 * State-gated requeue. Only jobs in terminal failure states (`DEAD_LETTERED`
 * or `FAILED`) can be pushed back to `PENDING` — active-state jobs and
 * successfully-terminal jobs are rejected by returning `null` with no side
 * effect. This closes the known gap from the first dead-letter test pass
 * (non-state-gated requeue accepted any state, including AWAITING_REVIEW).
 *
 * The admin dead-letter re-drive endpoint filters its inputs to
 * `state='DEAD_LETTERED'` before calling this, so it's unaffected. Manual
 * retry flows for FAILED manual uploads still go through this path —
 * `shouldRetryFailedManualUpload` in orchestrator.ts filters by FAILED
 * before calling `requeueImportJob`, so it keeps working.
 */
const REQUEUEABLE_STATES: ReadonlyArray<ImportJobState> = ['DEAD_LETTERED', 'FAILED'];

export const requeueImportJob = async (jobId: string): Promise<PersistedImportJob | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const ref = getFirebaseDb().collection('import_jobs').doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    if (!REQUEUEABLE_STATES.includes(data.state as ImportJobState)) return null;
    await ref.set(
      {
        state: 'PENDING',
        retryCount: Number(data.retryCount ?? 0) + 1,
        failureCode: null,
        failureReason: null,
        lastErrorCode: null,
        completedAt: null,
        updatedAt: nowIso(),
        stateChangedAt: nowIso(),
      },
      { merge: true }
    );
    return getImportJobById(jobId);
  }
  const { rows } = await getPg().query<ImportJobRow>(
    `UPDATE import_jobs
     SET state = 'PENDING',
         retry_count = retry_count + 1,
         failure_code = NULL,
         failure_reason = NULL,
         last_error_code = NULL,
         completed_at = NULL,
         updated_at = CURRENT_TIMESTAMP::timestamp,
         state_changed_at = CURRENT_TIMESTAMP::timestamp
     WHERE id = $1
       AND state IN ('DEAD_LETTERED', 'FAILED')
     RETURNING *`,
    [jobId]
  );
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

  // On a FAILED transition, compute the earliest-retry timestamp from the
  // current retry_count. DEAD_LETTERED is terminal, so it clears next_retry_at.
  // Any other state leaves next_retry_at alone.
  let nextRetryAt: string | null | undefined = undefined;
  if (params.state === 'FAILED') {
    // Need current retry_count to compute backoff. Read it; fallback to 1.
    const existing = await getImportJobById(params.jobId);
    const retryCount = (existing?.retryCount ?? 0) + 1; // +1 because this failure is the N+1st attempt
    const policy = await getRetryPolicyConfig();
    nextRetryAt = computeNextRetryAt(retryCount, {
      baseDelaySeconds: policy.baseDelaySeconds,
      maxDelaySeconds: policy.maxDelaySeconds,
    });
  } else if (params.state === 'DEAD_LETTERED' || params.state === 'COMPLETED' || params.state === 'DUPLICATE_IGNORED') {
    nextRetryAt = null;
  }

  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('import_jobs').doc(params.jobId).set(
      omitUndefinedFields({
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
        nextRetryAt,
      }),
      { merge: true }
    );
    return;
  }
  const p = getPg();
  await p.query(
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

  // Write next_retry_at only when this transition either stamps or clears
  // it. Undefined means "don't touch the column" — we issue no UPDATE.
  if (typeof nextRetryAt !== 'undefined') {
    await p.query(
      `UPDATE import_jobs SET next_retry_at = $2 WHERE id = $1`,
      [params.jobId, nextRetryAt],
    );
  }
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

export const listDeadLetterImportJobs = async (params?: {
  sourceType?: IngestionSourceType;
  startedAfter?: string | null;
  endedBefore?: string | null;
}): Promise<PersistedImportJob[]> => {
  await ensureIngestionRepositoryReady();
  const sourceType = params?.sourceType ?? null;
  const startedAfter = params?.startedAfter ?? null;
  const endedBefore = params?.endedBefore ?? null;
  if (getCurrentDbProvider() === 'firebase') {
    let query: FirebaseFirestore.Query = getFirebaseDb().collection('import_jobs').where('state', '==', 'DEAD_LETTERED');
    if (sourceType) query = query.where('sourceType', '==', sourceType);
    const snap = await query.get();
    return snap.docs
      .map((doc) => {
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
        } satisfies PersistedImportJob;
      })
      .filter((job) => (!startedAfter || job.updatedAt >= startedAfter) && (!endedBefore || job.updatedAt <= endedBefore));
  }
  const values: unknown[] = [];
  const conditions = [`state = 'DEAD_LETTERED'`];
  if (sourceType) {
    values.push(sourceType);
    conditions.push(`source_type = $${values.length}`);
  }
  if (startedAfter) {
    values.push(startedAfter);
    conditions.push(`updated_at >= $${values.length}`);
  }
  if (endedBefore) {
    values.push(endedBefore);
    conditions.push(`updated_at <= $${values.length}`);
  }
  const { rows } = await getPg().query<ImportJobRow>(
    `SELECT * FROM import_jobs WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`,
    values
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
      normalizationQuality: data.normalizationQuality ?? 'FULL_TEXT',
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
    normalizationQuality: rows[0].normalization_quality ?? 'FULL_TEXT',
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
      normalizationQuality: record.normalizationQuality,
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
      normalization_quality, metadata, virus_scan_status, virus_scanned_at, virus_scan_provider, deleted_raw_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
      record.normalizationQuality,
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
      normalizationQuality: rows[0].normalization_quality ?? 'FULL_TEXT',
      metadata: rows[0].metadata ?? {},
    virusScanStatus: rows[0].virus_scan_status,
    virusScannedAt: rows[0].virus_scanned_at,
    virusScanProvider: rows[0].virus_scan_provider,
    deletedRawAt: rows[0].deleted_raw_at,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  };
};

export const getIngestedDocumentById = async (documentId: string): Promise<IngestedDocumentRecord | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const doc = await getFirebaseDb().collection('ingested_documents').doc(documentId).get();
    if (!doc.exists) return null;
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
      normalizationQuality: data.normalizationQuality ?? 'FULL_TEXT',
      metadata: data.metadata ?? {},
      virusScanStatus: data.virusScanStatus,
      virusScannedAt: data.virusScannedAt ?? null,
      virusScanProvider: data.virusScanProvider ?? null,
      deletedRawAt: data.deletedRawAt ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
  const { rows } = await getPg().query<any>(`SELECT * FROM ingested_documents WHERE id = $1 LIMIT 1`, [documentId]);
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
    normalizationQuality: rows[0].normalization_quality ?? 'FULL_TEXT',
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
      .get();
    if (snap.empty) return null;
    const doc = [...snap.docs].sort((a, b) =>
      String((b.data() as any).updatedAt ?? '').localeCompare(String((a.data() as any).updatedAt ?? ''))
    )[0]!;
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
      timezone_status: data.timezoneStatus ?? 'UNKNOWN',
      raw_datetime_string: data.rawDatetimeString ?? null,
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
    const payload = deepOmitUndefined({
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
      timezoneStatus: params.candidate.timezoneStatus ?? 'UNKNOWN',
      rawDatetimeString: params.candidate.rawDatetimeString ?? null,
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
    });
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
      timezone_status: payload.timezoneStatus,
      raw_datetime_string: payload.rawDatetimeString,
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
      timezone_status, raw_datetime_string, timezone_display_hint, raw_source_reference,
      confidence_score, review_status, deduplication_fingerprint, logic_version,
      extracted_fields, edited_fields,
      duplicate_disposition, duplicate_of_parsed_item_id, duplicate_of_trip_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
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
      params.candidate.timezoneStatus ?? 'UNKNOWN',
      params.candidate.rawDatetimeString ?? null,
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
      .get();
    return snap.docs
      .filter((doc) => INGESTION_REVIEW_QUEUE_ACTIVE_STATES.includes(String((doc.data() as any).reviewStatus ?? '') as any))
      .sort((a, b) => String((b.data() as any).updatedAt ?? '').localeCompare(String((a.data() as any).updatedAt ?? '')))
      .map((doc) => {
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
          timezone_status: data.timezoneStatus ?? 'UNKNOWN',
          raw_datetime_string: data.rawDatetimeString ?? null,
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
      timezone_status: data.timezoneStatus ?? 'UNKNOWN',
      raw_datetime_string: data.rawDatetimeString ?? null,
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
    const result = await insertAssignmentArtifactsFirestore(item, tripId, assignedByUserId);
    await syncAssignedFlightExpense({ item, tripId, tripRecordId: result.tripRecordId, matchedMemberIds: result.matchedMemberIds });
    return result;
  }

  const client = getPg();
  await client.query('BEGIN');
  try {
    const result = await insertAssignmentArtifactsPostgres(client, item, tripId, assignedByUserId);
    await client.query('COMMIT');
    await syncAssignedFlightExpense({ item, tripId, tripRecordId: result.tripRecordId, matchedMemberIds: result.matchedMemberIds });
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
      extractionResult: deepOmitUndefined(extractionResult),
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

export const clearExtractionCache = async (): Promise<{ deleted: number }> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb().collection('extraction_cache').limit(500).get();
    if (snap.empty) return { deleted: 0 };
    const batch = getFirebaseDb().batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return { deleted: snap.docs.length };
  }
  const result = await getPg().query(`DELETE FROM extraction_cache`);
  return { deleted: result.rowCount ?? 0 };
};

export const claimWebhookReplayToken = async (provider: string, token: string): Promise<boolean> => {
  await ensureIngestionRepositoryReady();
  const tokenHash = createHash('sha256').update(`${provider}::${token}`).digest('hex');
  if (getCurrentDbProvider() === 'firebase') {
    const docId = `${provider}_${tokenHash}`;
    const ref = getFirebaseDb().collection('ingestion_webhook_replay_tokens').doc(docId);
    try {
      await ref.create({
        provider,
        tokenHash,
        createdAt: nowIso(),
      });
      return true;
    } catch {
      return false;
    }
  }

  const p = getPg();
  try {
    await p.query(
      `INSERT INTO ingestion_webhook_replay_tokens (id, provider, token_hash) VALUES ($1,$2,$3)`,
      [randomUUID(), provider, tokenHash]
    );
    return true;
  } catch {
    return false;
  }
};

export const getIngestionObservabilitySnapshot = async (): Promise<IngestionObservabilitySnapshot> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const [jobs, items, attempts, stageLogs, metering, users, userTiers, providerConnections] = await Promise.all([
      db.collection('import_jobs').get(),
      db.collection('parsed_items').get(),
      db.collection('parse_attempts').get(),
      db.collection('parse_stage_logs').get(),
      db.collection('usage_metering').get(),
      db.collection('users').get(),
      db.collection('user_tiers').where('effectiveTo', '==', null).get(),
      db.collection('provider_connections').get(),
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
      gmailAuthFailures: providerConnections.docs.filter((doc) => {
        const data = doc.data() as any;
        return String(data.provider ?? '') === 'gmail' && String(data.status ?? '') === 'AUTH_EXPIRED';
      }).length,
      webhookSignatureFailures: jobs.docs.filter((doc) => String((doc.data() as any).failureCode ?? '') === 'mailbox_webhook_temporary_failure').length,
      costPerUser: Array.from(costPerUserMap.entries()).map(([userId, estimatedCostUsd]) => ({ userId, estimatedCostUsd })),
    };
  }
  const p = getPg();
  const [volume, stageRates, duplicates, lowConfidence, latency, retryDead, llmUsage, quotaRows, costPerUser, gmailAuthFailures] = await Promise.all([
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
    p.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM provider_connections WHERE provider = 'gmail' AND status = 'AUTH_EXPIRED'`
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
    gmailAuthFailures: parseInt(gmailAuthFailures.rows[0]?.count ?? '0', 10),
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
      { name: 'import_job_payloads', field: 'userId' },
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
  await p.query(`DELETE FROM import_job_payloads WHERE user_id = $1`, [userId]);
  await p.query(`DELETE FROM ingestion_sources WHERE user_id = $1`, [userId]);
};

export const getRetryPolicyConfig = async (provider = INGESTION_RETRY_PROVIDER_GLOBAL): Promise<RetryPolicyConfigRecord> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const specific = await getFirebaseDb().collection('ingestion_retry_config').doc(provider).get();
    if (specific.exists) {
      const data = specific.data() as any;
      return {
        provider,
        maxAttempts: Number(data.maxAttempts ?? INGESTION_RETRY_POLICY_DEFAULTS.maxAttempts),
        baseDelaySeconds: Number(data.baseDelaySeconds ?? INGESTION_RETRY_POLICY_DEFAULTS.baseDelaySeconds),
        maxDelaySeconds: Number(data.maxDelaySeconds ?? INGESTION_RETRY_POLICY_DEFAULTS.maxDelaySeconds),
        alertThresholdPercent: Number(data.alertThresholdPercent ?? INGESTION_RETRY_POLICY_DEFAULTS.alertDeadLetterRatePercent),
        updatedAt: String(data.updatedAt ?? nowIso()),
      };
    }
    if (provider !== INGESTION_RETRY_PROVIDER_GLOBAL) {
      return getRetryPolicyConfig(INGESTION_RETRY_PROVIDER_GLOBAL);
    }
    return {
      provider,
      maxAttempts: INGESTION_RETRY_POLICY_DEFAULTS.maxAttempts,
      baseDelaySeconds: INGESTION_RETRY_POLICY_DEFAULTS.baseDelaySeconds,
      maxDelaySeconds: INGESTION_RETRY_POLICY_DEFAULTS.maxDelaySeconds,
      alertThresholdPercent: INGESTION_RETRY_POLICY_DEFAULTS.alertDeadLetterRatePercent,
      updatedAt: nowIso(),
    };
  }
  const { rows } = await getPg().query<RetryPolicyRow>(
    `SELECT * FROM ingestion_retry_config WHERE provider = $1 LIMIT 1`,
    [provider]
  );
  if (rows[0]) return mapRetryPolicyRow(rows[0]);
  if (provider !== INGESTION_RETRY_PROVIDER_GLOBAL) {
    return getRetryPolicyConfig(INGESTION_RETRY_PROVIDER_GLOBAL);
  }
  return {
    provider,
    maxAttempts: INGESTION_RETRY_POLICY_DEFAULTS.maxAttempts,
    baseDelaySeconds: INGESTION_RETRY_POLICY_DEFAULTS.baseDelaySeconds,
    maxDelaySeconds: INGESTION_RETRY_POLICY_DEFAULTS.maxDelaySeconds,
    alertThresholdPercent: INGESTION_RETRY_POLICY_DEFAULTS.alertDeadLetterRatePercent,
    updatedAt: nowIso(),
  };
};

export const upsertRetryPolicyConfig = async (record: {
  provider?: string;
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  alertThresholdPercent: number;
}): Promise<RetryPolicyConfigRecord> => {
  await ensureIngestionRepositoryReady();
  const provider = record.provider ?? INGESTION_RETRY_PROVIDER_GLOBAL;
  if (getCurrentDbProvider() === 'firebase') {
    const payload = {
      provider,
      maxAttempts: record.maxAttempts,
      baseDelaySeconds: record.baseDelaySeconds,
      maxDelaySeconds: record.maxDelaySeconds,
      alertThresholdPercent: record.alertThresholdPercent,
      updatedAt: nowIso(),
    };
    await getFirebaseDb().collection('ingestion_retry_config').doc(provider).set(payload, { merge: true });
    return payload;
  }
  const { rows } = await getPg().query<RetryPolicyRow>(
    `INSERT INTO ingestion_retry_config (provider, max_attempts, base_delay_seconds, max_delay_seconds, alert_threshold_percent, updated_at)
     VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP::timestamp)
     ON CONFLICT (provider)
     DO UPDATE SET
       max_attempts = EXCLUDED.max_attempts,
       base_delay_seconds = EXCLUDED.base_delay_seconds,
       max_delay_seconds = EXCLUDED.max_delay_seconds,
       alert_threshold_percent = EXCLUDED.alert_threshold_percent,
       updated_at = CURRENT_TIMESTAMP::timestamp
     RETURNING *`,
    [provider, record.maxAttempts, record.baseDelaySeconds, record.maxDelaySeconds, record.alertThresholdPercent]
  );
  return mapRetryPolicyRow(rows[0]);
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
  await disconnectProviderConnections(params.userId, params.provider);
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

export const getProviderConnection = async (userId: string, provider: string): Promise<ProviderConnectionRecord | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('provider_connections')
      .where('userId', '==', userId)
      .where('provider', '==', provider)
      .get();
    if (snap.empty) return null;
    const latest = snap.docs
      .slice()
      .sort((a, b) => String((b.data() as any).updatedAt ?? '').localeCompare(String((a.data() as any).updatedAt ?? '')))[0];
    if (!latest) return null;
    const data = latest.data() as any;
    return {
      id: latest.id,
      userId: data.userId,
      provider: data.provider,
      status: data.status ?? 'connected',
      accessToken: data.encryptedAccessToken ? decryptToken(String(data.encryptedAccessToken)) : null,
      refreshToken: data.encryptedRefreshToken ? decryptToken(String(data.encryptedRefreshToken)) : null,
      tokenExpiry: data.tokenExpiry ?? null,
      scopes: Array.isArray(data.scopes) ? data.scopes.map((entry: unknown) => String(entry)) : [],
      metadata: data.metadata ?? {},
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
  const { rows } = await getPg().query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE user_id = $1 AND provider = $2 ORDER BY updated_at DESC LIMIT 1`,
    [userId, provider]
  );
  return rows[0] ? mapProviderConnectionRow(rows[0]) : null;
};

export const listProviderConnections = async (userId: string): Promise<ProviderConnectionRecord[]> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb().collection('provider_connections').where('userId', '==', userId).get();
    return snap.docs.map((doc) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        userId: data.userId,
        provider: data.provider,
        status: data.status ?? 'connected',
        accessToken: data.encryptedAccessToken ? decryptToken(String(data.encryptedAccessToken)) : null,
        refreshToken: data.encryptedRefreshToken ? decryptToken(String(data.encryptedRefreshToken)) : null,
        tokenExpiry: data.tokenExpiry ?? null,
        scopes: Array.isArray(data.scopes) ? data.scopes.map((entry: unknown) => String(entry)) : [],
        metadata: data.metadata ?? {},
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } satisfies ProviderConnectionRecord;
    });
  }
  const { rows } = await getPg().query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.map(mapProviderConnectionRow);
};

export const updateProviderConnectionStatus = async (params: {
  userId: string;
  provider: string;
  status: string;
  metadata?: Record<string, unknown>;
}): Promise<ProviderConnectionRecord | null> => {
  await ensureIngestionRepositoryReady();
  const existing = await getProviderConnection(params.userId, params.provider);
  if (!existing) return null;
  const metadata = { ...(existing.metadata ?? {}), ...(params.metadata ?? {}) };
  if (getCurrentDbProvider() === 'firebase') {
    await getFirebaseDb().collection('provider_connections').doc(existing.id).set(
      {
        status: params.status,
        metadata,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    return getProviderConnection(params.userId, params.provider);
  }
  const { rows } = await getPg().query<ProviderConnectionRow>(
    `UPDATE provider_connections
     SET status = $3, metadata = $4, updated_at = CURRENT_TIMESTAMP::timestamp
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [existing.id, params.userId, params.status, JSON.stringify(metadata)]
  );
  return rows[0] ? mapProviderConnectionRow(rows[0]) : null;
};

/**
 * Returns the subset of provider_connections for a given provider across all
 * users. Used by the scheduled-polling service to discover connections that
 * may be due for a sync tick. Status filtering (connected vs AUTH_EXPIRED)
 * is left to the caller because the polling service wants to both skip and
 * surface expired connections.
 */
export const listProviderConnectionsByProvider = async (provider: string): Promise<ProviderConnectionRecord[]> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('provider_connections')
      .where('provider', '==', provider)
      .get();
    return snap.docs.map((doc) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        userId: data.userId,
        provider: data.provider,
        status: data.status ?? 'connected',
        accessToken: data.encryptedAccessToken ? decryptToken(String(data.encryptedAccessToken)) : null,
        refreshToken: data.encryptedRefreshToken ? decryptToken(String(data.encryptedRefreshToken)) : null,
        tokenExpiry: data.tokenExpiry ?? null,
        scopes: Array.isArray(data.scopes) ? data.scopes.map((entry: unknown) => String(entry)) : [],
        metadata: data.metadata ?? {},
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } satisfies ProviderConnectionRecord;
    });
  }
  const { rows } = await getPg().query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE provider = $1 ORDER BY updated_at ASC`,
    [provider]
  );
  return rows.map(mapProviderConnectionRow);
};

/**
 * Writes a merged metadata patch onto a provider_connections row without
 * changing `status`. Used by the polling service to advance `lastPolledAt`
 * and record tick outcomes without touching auth fields.
 */
export const mergeProviderConnectionMetadata = async (
  connectionId: string,
  patch: Record<string, unknown>,
): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const docRef = getFirebaseDb().collection('provider_connections').doc(connectionId);
    const snap = await docRef.get();
    if (!snap.exists) return;
    const current = (snap.data() as any)?.metadata ?? {};
    await docRef.set(
      { metadata: { ...current, ...patch }, updatedAt: nowIso() },
      { merge: true },
    );
    return;
  }
  const { rows } = await getPg().query<ProviderConnectionRow>(
    `SELECT * FROM provider_connections WHERE id = $1`,
    [connectionId]
  );
  if (!rows[0]) return;
  const current = (rows[0] as any).metadata ?? {};
  const merged = { ...current, ...patch };
  await getPg().query(
    `UPDATE provider_connections SET metadata = $2, updated_at = CURRENT_TIMESTAMP::timestamp WHERE id = $1`,
    [connectionId, JSON.stringify(merged)]
  );
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

/**
 * Provider → ingestion source_type mapping. Used to cascade ingestion data
 * removal when a provider is disconnected. If the provider isn't mapped here
 * (e.g. manual uploads, forwarded mailbox), there is nothing to cascade.
 */
const PROVIDER_TO_INGESTION_SOURCE_TYPE: Record<string, IngestionSourceType> = {
  gmail: 'GMAIL_IMPORT',
};

export interface IngestionProviderCascadeCounts {
  parsedItemsDeleted: number;
  documentsDeleted: number;
  jobsDeleted: number;
  sourcesDeleted: number;
}

/**
 * Delete every ingestion record originating from a given provider for a user.
 *
 * Scoped by `(user_id, source_type)` so only the requesting user's data for
 * that provider is removed. Downstream rows (ingested_documents, parsed_items,
 * import_job_payloads) are removed explicitly rather than relying on FK
 * cascade so the same path works under pg-mem and Firestore.
 */
export const deleteUserIngestionDataForProvider = async (
  userId: string,
  provider: string,
): Promise<IngestionProviderCascadeCounts> => {
  await ensureIngestionRepositoryReady();
  const sourceType = PROVIDER_TO_INGESTION_SOURCE_TYPE[provider];
  if (!sourceType) {
    return { parsedItemsDeleted: 0, documentsDeleted: 0, jobsDeleted: 0, sourcesDeleted: 0 };
  }

  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const deleteWhere = async (collection: string, field: string): Promise<number> => {
      const snap = await db
        .collection(collection)
        .where('userId', '==', userId)
        .where(field, '==', sourceType)
        .get()
        .catch(() => null);
      if (!snap) return 0;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      return snap.docs.length;
    };
    const parsedItemsDeleted = await deleteWhere('parsed_items', 'sourceType');
    const documentsDeleted = await deleteWhere('ingested_documents', 'sourceType');
    await deleteWhere('import_job_payloads', 'sourceType');
    const jobsDeleted = await deleteWhere('import_jobs', 'sourceType');
    const sourcesDeleted = await deleteWhere('ingestion_sources', 'sourceType');
    return { parsedItemsDeleted, documentsDeleted, jobsDeleted, sourcesDeleted };
  }

  const p = getPg();
  const countQuery = async (table: string): Promise<number> => {
    const { rows } = await p.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE user_id = $1 AND source_type = $2`,
      [userId, sourceType],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  };

  const [parsedItemsDeleted, documentsDeleted, jobsDeleted, sourcesDeleted] = await Promise.all([
    countQuery('parsed_items'),
    countQuery('ingested_documents'),
    countQuery('import_jobs'),
    countQuery('ingestion_sources'),
  ]);

  await p.query(
    `DELETE FROM parsed_items WHERE user_id = $1 AND source_type = $2`,
    [userId, sourceType],
  );
  await p.query(
    `DELETE FROM ingested_documents WHERE user_id = $1 AND source_type = $2`,
    [userId, sourceType],
  );
  await p.query(
    `DELETE FROM import_job_payloads WHERE user_id = $1 AND source_type = $2`,
    [userId, sourceType],
  );
  await p.query(
    `DELETE FROM import_jobs WHERE user_id = $1 AND source_type = $2`,
    [userId, sourceType],
  );
  await p.query(
    `DELETE FROM ingestion_sources WHERE user_id = $1 AND source_type = $2`,
    [userId, sourceType],
  );

  return { parsedItemsDeleted, documentsDeleted, jobsDeleted, sourcesDeleted };
};

/**
 * Retention sweep: drop `import_job_payloads` rows whose parent job has been
 * in `DEAD_LETTERED` terminal state and completed before the given cutoff.
 * The parent `import_jobs` row is preserved (and so are `ingested_documents`
 * and `parsed_items` — those are user-visible artifacts). Only the raw
 * payload bytes, which are unreachable and unreusable past the retention
 * window, are removed.
 *
 * Returns the number of payload rows deleted.
 */
export const deletePayloadsForDeadLetteredJobsOlderThan = async (
  cutoffIso: string,
): Promise<number> => {
  await ensureIngestionRepositoryReady();

  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const snap = await db
      .collection('import_jobs')
      .where('state', '==', 'DEAD_LETTERED')
      .get();
    const eligibleIds = snap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const completedAt = data.completedAt ?? null;
        if (!completedAt) return false;
        return String(completedAt) < cutoffIso;
      })
      .map((doc) => doc.id);
    let deleted = 0;
    for (const jobId of eligibleIds) {
      const ref = db.collection('import_job_payloads').doc(jobId);
      const existing = await ref.get();
      if (!existing.exists) continue;
      await ref.delete();
      deleted += 1;
    }
    return deleted;
  }

  const p = getPg();
  // pg-mem is fine with `IN (subselect)` but struggles with `NOT EXISTS`, so
  // we phrase the eligibility filter as a plain IN subselect.
  const { rowCount } = await p.query(
    `DELETE FROM import_job_payloads
     WHERE job_id IN (
       SELECT id FROM import_jobs
       WHERE state = 'DEAD_LETTERED'
         AND completed_at IS NOT NULL
         AND completed_at < $1
     )`,
    [cutoffIso],
  );
  return rowCount ?? 0;
};

/**
 * Returns the count of `import_jobs` grouped by `state`. Used by the
 * metrics-service tick to emit `ingestion_jobs_by_state` gauges for
 * per-instance queue-depth visibility in the `/metrics` scrape output.
 */
export const countImportJobsByState = async (): Promise<Record<string, number>> => {
  await ensureIngestionRepositoryReady();

  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb().collection('import_jobs').get();
    const counts: Record<string, number> = {};
    for (const doc of snap.docs) {
      const state = String((doc.data() as any).state ?? 'UNKNOWN');
      counts[state] = (counts[state] ?? 0) + 1;
    }
    return counts;
  }

  const { rows } = await getPg().query<{ state: string; count: string }>(
    `SELECT state, COUNT(*)::text AS count FROM import_jobs GROUP BY state`,
  );
  return Object.fromEntries(rows.map((r) => [r.state, parseInt(r.count, 10)]));
};

/**
 * Retention dry-run: return the row-count that would be deleted/tombstoned
 * by the real sweep without mutating any row. Used by the admin
 * "retention preview" endpoint so operators can see the blast radius of a
 * retention window change before applying it.
 */
export interface RetentionPreviewCounts {
  deadLetterPayloadsEligible: number;
  normalizedTextEligible: number;
}

export const countRetentionEligibleRows = async (
  cutoffIso: string,
): Promise<RetentionPreviewCounts> => {
  await ensureIngestionRepositoryReady();

  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    // Dead-letter payloads eligibility: DEAD_LETTERED jobs older than cutoff
    // whose payload doc still exists.
    const dlJobsSnap = await db
      .collection('import_jobs')
      .where('state', '==', 'DEAD_LETTERED')
      .get();
    const dlEligibleIds = dlJobsSnap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const completedAt = data.completedAt ?? null;
        return completedAt && String(completedAt) < cutoffIso;
      })
      .map((doc) => doc.id);
    let deadLetterPayloadsEligible = 0;
    for (const jobId of dlEligibleIds) {
      const exists = await db.collection('import_job_payloads').doc(jobId).get();
      if (exists.exists) deadLetterPayloadsEligible += 1;
    }

    // Normalized-text eligibility: terminal jobs older than cutoff whose
    // docs haven't been tombstoned.
    const terminalJobsSnap = await db
      .collection('import_jobs')
      .where('state', 'in', ['DEAD_LETTERED', 'COMPLETED', 'DUPLICATE_IGNORED'])
      .get();
    const terminalEligibleIds = terminalJobsSnap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const completedAt = data.completedAt ?? null;
        return completedAt && String(completedAt) < cutoffIso;
      })
      .map((doc) => doc.id);
    let normalizedTextEligible = 0;
    for (const jobId of terminalEligibleIds) {
      const docsSnap = await db
        .collection('ingested_documents')
        .where('importJobId', '==', jobId)
        .get();
      for (const docSnap of docsSnap.docs) {
        if (!(docSnap.data() as any).deletedRawAt) normalizedTextEligible += 1;
      }
    }
    return { deadLetterPayloadsEligible, normalizedTextEligible };
  }

  const p = getPg();
  const dlRes = await p.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM import_job_payloads
     WHERE job_id IN (
       SELECT id FROM import_jobs
       WHERE state = 'DEAD_LETTERED' AND completed_at IS NOT NULL AND completed_at < $1
     )`,
    [cutoffIso],
  );
  const textRes = await p.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ingested_documents
     WHERE deleted_raw_at IS NULL
       AND import_job_id IN (
         SELECT id FROM import_jobs
         WHERE state IN ('DEAD_LETTERED','COMPLETED','DUPLICATE_IGNORED')
           AND completed_at IS NOT NULL AND completed_at < $1
       )`,
    [cutoffIso],
  );
  return {
    deadLetterPayloadsEligible: parseInt(dlRes.rows[0]?.count ?? '0', 10),
    normalizedTextEligible: parseInt(textRes.rows[0]?.count ?? '0', 10),
  };
};

/**
 * Retention step 2: tombstone `ingested_documents.normalized_text` (+
 * `normalized_html`) for jobs that reached a terminal state more than the
 * retention window ago. The document row itself stays so that user-visible
 * artifacts (parsed_items references) still resolve, but the large normalized
 * text/html blobs — which are no longer needed after the parse has already
 * produced items — are emptied. `deleted_raw_at` is stamped so a second
 * tombstone pass over the same rows is a no-op.
 *
 * Returns the number of ingested_documents rows updated.
 */
export const tombstoneNormalizedTextForTerminalJobsOlderThan = async (
  cutoffIso: string,
): Promise<number> => {
  await ensureIngestionRepositoryReady();

  if (getCurrentDbProvider() === 'firebase') {
    const db = getFirebaseDb();
    const snap = await db
      .collection('import_jobs')
      .where('state', 'in', ['DEAD_LETTERED', 'COMPLETED', 'DUPLICATE_IGNORED'])
      .get();
    const eligibleJobIds = snap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const completedAt = data.completedAt ?? null;
        if (!completedAt) return false;
        return String(completedAt) < cutoffIso;
      })
      .map((doc) => doc.id);

    let tombstoned = 0;
    for (const jobId of eligibleJobIds) {
      const docsSnap = await db
        .collection('ingested_documents')
        .where('importJobId', '==', jobId)
        .get();
      for (const docSnap of docsSnap.docs) {
        const data = docSnap.data() as any;
        if (data.deletedRawAt) continue; // already tombstoned
        await docSnap.ref.set(
          {
            normalizedText: '',
            normalizedHtml: null,
            deletedRawAt: nowIso(),
            updatedAt: nowIso(),
          },
          { merge: true },
        );
        tombstoned += 1;
      }
    }
    return tombstoned;
  }

  const p = getPg();
  // pg-mem IN-subselect works; the join would also work but keep IN for parity
  // with Priority 15 step 1.
  const { rowCount } = await p.query(
    `UPDATE ingested_documents
     SET normalized_text = '',
         normalized_html = NULL,
         deleted_raw_at = NOW(),
         updated_at = CURRENT_TIMESTAMP::timestamp
     WHERE deleted_raw_at IS NULL
       AND import_job_id IN (
         SELECT id FROM import_jobs
         WHERE state IN ('DEAD_LETTERED','COMPLETED','DUPLICATE_IGNORED')
           AND completed_at IS NOT NULL
           AND completed_at < $1
       )`,
    [cutoffIso],
  );
  return rowCount ?? 0;
};

// ── Data-deletion jobs ──────────────────────────────────────────────────────

export type DataDeletionJobState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface DataDeletionJobRecord {
  id: string;
  userId: string;
  provider: string;
  state: DataDeletionJobState;
  counts: IngestionProviderCascadeCounts | null;
  failureReason: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const mapDataDeletionRow = (row: any): DataDeletionJobRecord => ({
  id: String(row.id),
  userId: String(row.user_id),
  provider: String(row.provider),
  state: row.state as DataDeletionJobState,
  counts: row.counts && typeof row.counts === 'object' && Object.keys(row.counts).length ? (row.counts as IngestionProviderCascadeCounts) : null,
  failureReason: row.failure_reason ?? null,
  requestedAt: parseDate(row.requested_at) ?? nowIso(),
  startedAt: parseDate(row.started_at),
  completedAt: parseDate(row.completed_at),
  createdAt: parseDate(row.created_at) ?? nowIso(),
  updatedAt: parseDate(row.updated_at) ?? nowIso(),
});

const mapDataDeletionDoc = (id: string, data: any): DataDeletionJobRecord => ({
  id,
  userId: String(data.userId ?? ''),
  provider: String(data.provider ?? ''),
  state: (data.state ?? 'pending') as DataDeletionJobState,
  counts: data.counts && typeof data.counts === 'object' && Object.keys(data.counts).length ? (data.counts as IngestionProviderCascadeCounts) : null,
  failureReason: data.failureReason ?? null,
  requestedAt: data.requestedAt ?? data.createdAt ?? nowIso(),
  startedAt: data.startedAt ?? null,
  completedAt: data.completedAt ?? null,
  createdAt: data.createdAt ?? nowIso(),
  updatedAt: data.updatedAt ?? nowIso(),
});

export const createDataDeletionJob = async (userId: string, provider: string): Promise<DataDeletionJobRecord> => {
  await ensureIngestionRepositoryReady();
  const id = randomUUID();
  const now = nowIso();
  if (getCurrentDbProvider() === 'firebase') {
    const payload = {
      userId,
      provider,
      state: 'pending' as DataDeletionJobState,
      counts: {},
      failureReason: null,
      requestedAt: now,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await getFirebaseDb().collection('data_deletion_jobs').doc(id).set(payload);
    return mapDataDeletionDoc(id, payload);
  }
  const { rows } = await getPg().query(
    `INSERT INTO data_deletion_jobs (id, user_id, provider, state, counts, requested_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', '{}'::jsonb, NOW(), NOW(), NOW())
     RETURNING *`,
    [id, userId, provider]
  );
  return mapDataDeletionRow(rows[0]);
};

export const markDataDeletionJobRunning = async (jobId: string): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const now = nowIso();
    await getFirebaseDb().collection('data_deletion_jobs').doc(jobId).update({
      state: 'running',
      startedAt: now,
      updatedAt: now,
    });
    return;
  }
  await getPg().query(
    `UPDATE data_deletion_jobs SET state = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1`,
    [jobId]
  );
};

export const markDataDeletionJobSucceeded = async (
  jobId: string,
  counts: IngestionProviderCascadeCounts,
): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const now = nowIso();
    await getFirebaseDb().collection('data_deletion_jobs').doc(jobId).update({
      state: 'succeeded',
      counts,
      completedAt: now,
      updatedAt: now,
    });
    return;
  }
  await getPg().query(
    `UPDATE data_deletion_jobs SET state = 'succeeded', counts = $2::jsonb, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [jobId, JSON.stringify(counts)]
  );
};

export const markDataDeletionJobFailed = async (jobId: string, reason: string): Promise<void> => {
  await ensureIngestionRepositoryReady();
  const truncatedReason = reason.length > 500 ? reason.slice(0, 500) : reason;
  if (getCurrentDbProvider() === 'firebase') {
    const now = nowIso();
    await getFirebaseDb().collection('data_deletion_jobs').doc(jobId).update({
      state: 'failed',
      failureReason: truncatedReason,
      completedAt: now,
      updatedAt: now,
    });
    return;
  }
  await getPg().query(
    `UPDATE data_deletion_jobs SET state = 'failed', failure_reason = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [jobId, truncatedReason]
  );
};

export const getDataDeletionJob = async (jobId: string): Promise<DataDeletionJobRecord | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb().collection('data_deletion_jobs').doc(jobId).get();
    if (!snap.exists) return null;
    return mapDataDeletionDoc(snap.id, snap.data());
  }
  const { rows } = await getPg().query(`SELECT * FROM data_deletion_jobs WHERE id = $1`, [jobId]);
  if (!rows[0]) return null;
  return mapDataDeletionRow(rows[0]);
};

export const listDataDeletionJobsForUser = async (userId: string): Promise<DataDeletionJobRecord[]> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('data_deletion_jobs')
      .where('userId', '==', userId)
      .get();
    return snap.docs
      .map((doc) => mapDataDeletionDoc(doc.id, doc.data()))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }
  const { rows } = await getPg().query(
    `SELECT * FROM data_deletion_jobs WHERE user_id = $1 ORDER BY requested_at DESC`,
    [userId]
  );
  return rows.map(mapDataDeletionRow);
};

export const listDataDeletionJobs = async (filters: {
  state?: DataDeletionJobState;
  userId?: string;
  limit?: number;
}): Promise<DataDeletionJobRecord[]> => {
  await ensureIngestionRepositoryReady();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  if (getCurrentDbProvider() === 'firebase') {
    let query: FirebaseFirestore.Query = getFirebaseDb().collection('data_deletion_jobs');
    if (filters.state) query = query.where('state', '==', filters.state);
    if (filters.userId) query = query.where('userId', '==', filters.userId);
    const snap = await query.get();
    return snap.docs
      .map((doc) => mapDataDeletionDoc(doc.id, doc.data()))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit);
  }
  const where: string[] = [];
  const params: any[] = [];
  if (filters.state) {
    params.push(filters.state);
    where.push(`state = $${params.length}`);
  }
  if (filters.userId) {
    params.push(filters.userId);
    where.push(`user_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await getPg().query(
    `SELECT * FROM data_deletion_jobs ${whereSql} ORDER BY requested_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(mapDataDeletionRow);
};

// ── Learned source parsers ──────────────────────────────────────────────────

export interface LearnedParserRecord {
  id: string;
  sourceKey: string;
  itemType: string;
  fieldPatterns: Record<string, string>;
  sampleCount: number;
  confidenceAvg: number;
  lastUpdatedAt: string;
  createdAt: string;
}

export const getLearnedParser = async (sourceKey: string, itemType: string): Promise<LearnedParserRecord | null> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('learned_source_parsers')
      .where('sourceKey', '==', sourceKey)
      .where('itemType', '==', itemType)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const d = doc.data() as any;
    return {
      id: doc.id,
      sourceKey: d.sourceKey,
      itemType: d.itemType,
      fieldPatterns: d.fieldPatterns ?? {},
      sampleCount: d.sampleCount ?? 1,
      confidenceAvg: d.confidenceAvg ?? 0,
      lastUpdatedAt: d.lastUpdatedAt ?? d.createdAt,
      createdAt: d.createdAt,
    };
  }
  const { rows } = await getPg().query<any>(
    `SELECT * FROM learned_source_parsers WHERE source_key = $1 AND item_type = $2 LIMIT 1`,
    [sourceKey, itemType]
  );
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    sourceKey: rows[0].source_key,
    itemType: rows[0].item_type,
    fieldPatterns: rows[0].field_patterns ?? {},
    sampleCount: rows[0].sample_count,
    confidenceAvg: parseFloat(rows[0].confidence_avg),
    lastUpdatedAt: rows[0].last_updated_at,
    createdAt: rows[0].created_at,
  };
};

export const upsertLearnedParser = async (
  sourceKey: string,
  itemType: string,
  fieldPatterns: Record<string, string>,
  confidenceAvg: number
): Promise<void> => {
  await ensureIngestionRepositoryReady();
  if (getCurrentDbProvider() === 'firebase') {
    const snap = await getFirebaseDb()
      .collection('learned_source_parsers')
      .where('sourceKey', '==', sourceKey)
      .where('itemType', '==', itemType)
      .limit(1)
      .get();
    if (snap.empty) {
      await getFirebaseDb().collection('learned_source_parsers').doc(randomUUID()).set({
        sourceKey,
        itemType,
        fieldPatterns,
        sampleCount: 1,
        confidenceAvg,
        lastUpdatedAt: nowIso(),
        createdAt: nowIso(),
      });
    } else {
      const doc = snap.docs[0];
      const prev = doc.data() as any;
      const newCount = (prev.sampleCount ?? 1) + 1;
      const newAvg = ((prev.confidenceAvg ?? 0) * (prev.sampleCount ?? 1) + confidenceAvg) / newCount;
      await doc.ref.set({
        ...prev,
        fieldPatterns,
        sampleCount: newCount,
        confidenceAvg: newAvg,
        lastUpdatedAt: nowIso(),
      }, { merge: true });
    }
    return;
  }
  await getPg().query(
    `INSERT INTO learned_source_parsers (id, source_key, item_type, field_patterns, sample_count, confidence_avg, last_updated_at, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, NOW(), NOW())
     ON CONFLICT (source_key, item_type)
     DO UPDATE SET
       field_patterns = $4,
       sample_count = learned_source_parsers.sample_count + 1,
       confidence_avg = (learned_source_parsers.confidence_avg * learned_source_parsers.sample_count + $5) / (learned_source_parsers.sample_count + 1),
       last_updated_at = NOW()`,
    [randomUUID(), sourceKey, itemType, JSON.stringify(fieldPatterns), confidenceAvg]
  );
};
