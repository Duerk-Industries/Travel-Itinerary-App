// server/src/db.ts
import { Pool, PoolClient } from 'pg';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import {
  Flight,
  Group,
  GroupMember,
  Trait,
  Trip,
  User,
  UserRole,
  WebUser,
  Lodging,
  Activity,
  CarRental,
  Itinerary,
  ItineraryDetail,
  ItineraryDetailKind,
  ItineraryChecklistItem,
  PlaceDetailsCache,
  LocationRecord,
  AttractionCatalogEntry,
  AttractionShortlistBlob,
  TripActivity,
  TripActivityType,
  TripComment,
  Tier,
  Feature,
  TierEntitlement,
  TierLimit,
  UserTier,
  FeatureFlag,
  UsageCounter,
  AuditLogEntry,
  AuditAction,
  TripChatMessage,
  TripMessageRead,
  PackingListItem,
  PackingListTraveler,
  TripPackingList,
} from './types';
import { logError, logInfo } from './logger';
import { getEnvFlag, getEnvValue } from './env';
import { downloadAirportDatasetForDailyRefresh } from './apis/airportDatasetCallers';
import { normalizeAirportDataset, searchBundledAirportDataset } from './services/airportCatalog';
import fs from 'fs';
import path from 'path';
import { getReservedUsernames } from './config/authFlags';
import { getApiLimitsConfig } from './config/apiLimits';
import { DEFAULT_PACKING_LIST_ITEMS } from './config/defaultPackingList';


type PoolCtor = typeof Pool;
let PoolFactory: PoolCtor = Pool;
let pool: Pool | null = null;
type QueryRunner = Pick<Pool, 'query'>;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const formatDate = (value: any) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
};
const FOLLOW_CODE_LENGTH = 6;
const FOLLOW_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRIP_SHARE_TOKEN_BYTES = 24;
const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const normalizeLoginIdentifier = (value: string): string => value.trim().toLowerCase();
const isEmailLikeIdentifier = (value: string): boolean => value.includes('@');
const USERNAME_MAX_LEN = 30;
const USERNAME_ALLOWED_REGEX = /^[a-z0-9_-]{1,30}$/;

const normalizeUsername = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, USERNAME_MAX_LEN);

const extractEmailLocalPart = (email: string): string => {
  const normalized = normalizeEmail(email);
  const local = normalized.split('@')[0] ?? normalized;
  return normalizeUsername(local);
};

const buildUsernameBase = (firstName: string, lastName: string, email: string): string => {
  const combined = normalizeUsername(`${firstName}${lastName}`);
  if (combined.length > 0) return combined;
  const local = extractEmailLocalPart(email);
  if (local.length > 0) return local;
  return 'user';
};

const appendUsernameSuffix = (base: string, suffix: number): string => {
  const suffixText = String(suffix);
  const maxBaseLength = USERNAME_MAX_LEN - suffixText.length;
  const truncatedBase = base.slice(0, Math.max(1, maxBaseLength));
  return `${truncatedBase}${suffixText}`;
};

const isReservedUsername = (value: string): boolean => {
  const reserved = getReservedUsernames();
  return reserved.includes(value.toLowerCase());
};

const isUsernameAvailable = async (p: QueryRunner, normalizedUsername: string, excludeUserId?: string): Promise<boolean> => {
  const { rows } = await p.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE username_normalized = $1
       AND ($2::uuid IS NULL OR id <> $2)
     LIMIT 1`,
    [normalizedUsername, excludeUserId ?? null]
  );
  return rows.length === 0;
};

const generateUniqueUsername = async (
  p: QueryRunner,
  firstName: string,
  lastName: string,
  email: string,
  preferredUsername?: string,
  excludeUserId?: string
): Promise<string> => {
  const normalizedPreferred = preferredUsername ? normalizeUsername(preferredUsername) : '';
  let base = normalizedPreferred || buildUsernameBase(firstName, lastName, email);
  if (!base) base = 'user';

  let candidate = base.slice(0, USERNAME_MAX_LEN);
  let counter = 2;
  while (
    !USERNAME_ALLOWED_REGEX.test(candidate) ||
    isReservedUsername(candidate) ||
    !(await isUsernameAvailable(p, candidate, excludeUserId))
  ) {
    candidate = appendUsernameSuffix(base, counter);
    counter += 1;
    if (counter > 100000) {
      throw new Error('Unable to generate a unique username');
    }
  }
  return candidate;
};

const generateFollowCode = (): string => {
  const bytes = randomBytes(FOLLOW_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < FOLLOW_CODE_LENGTH; i += 1) {
    out += FOLLOW_CODE_CHARS[bytes[i] % FOLLOW_CODE_CHARS.length];
  }
  return out;
};

const generateTripShareToken = (): string => randomBytes(TRIP_SHARE_TOKEN_BYTES).toString('base64url');

const TRIP_ACTIVITY_TYPES: TripActivityType[] = [
  'TRIP_CREATED',
  'FOLLOW_ADDED',
  'FOLLOW_REMOVED',
  'ITINERARY_ITEM_ADDED',
  'ITINERARY_ITEM_UPDATED',
  'ITINERARY_ITEM_DELETED',
  'FLIGHT_ADDED',
  'LODGING_ADDED',
  'TOUR_ADDED',
  'NOTE_ADDED',
];

const normalizePackingText = (value: string): string => value.trim().replace(/\s+/g, ' ');

const normalizePackingKey = (category: string, label: string): string =>
  `${normalizePackingText(category).toLowerCase()}::${normalizePackingText(label).toLowerCase()}`;

const sanitizePackingItems = (items: Array<{ id?: string; category?: unknown; label?: unknown }>): Array<{ id?: string; category: string; label: string; position: number }> => {
  const seen = new Set<string>();
  const sanitized: Array<{ id?: string; category: string; label: string; position: number }> = [];
  for (const item of Array.isArray(items) ? items : []) {
    const category = typeof item.category === 'string' ? normalizePackingText(item.category) : '';
    const label = typeof item.label === 'string' ? normalizePackingText(item.label) : '';
    if (!category || !label) continue;
    const key = normalizePackingKey(category, label);
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : undefined,
      category,
      label,
      position: sanitized.length,
    });
  }
  return sanitized;
};

export const setPoolFactory = (factory: PoolCtor): void => {
  PoolFactory = factory;
  // Reset to ensure new connections use the overridden Pool implementation.
  if (pool) {
    pool.end().catch(() => undefined);
    pool = null;
  }
};


function getPool(): Pool {
  if (!pool) {
    const cs = getEnvValue('DATABASE_URL');


    // Fail fast with a clear error instead of the SCRAM message
    if (typeof cs !== 'string' || cs.trim().length === 0) {
      throw new Error(
        `DATABASE_URL is missing or not a string. Got type=${typeof cs}, value=${String(
          cs
        )}. Set DATABASE_URL in server/.env (or root .env) before starting the server.`
      );
    }

    if (typeof cs === 'string' && cs.startsWith('pg-mem://')) {
      const { newDb, DataType } = require('pg-mem') as typeof import('pg-mem');
      const { randomUUID } = require('crypto') as typeof import('crypto');
      const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
      const pgMem = db.adapters.createPg();
      db.public.registerFunction({ name: 'to_char', args: [DataType.date, DataType.text], returns: DataType.text, implementation: formatDate });
      db.public.registerFunction({ name: 'to_char', args: [DataType.timestamp, DataType.text], returns: DataType.text, implementation: formatDate });
      db.public.registerFunction({
        name: 'nullif',
        args: [DataType.text, DataType.text],
        returns: DataType.text,
        implementation: (value: string | null, compare: string | null) => {
          if (value == null) return null;
          return value === compare ? null : value;
        },
      });
      db.public.registerFunction({
        name: 'replace',
        args: [DataType.text, DataType.text, DataType.text],
        returns: DataType.text,
        implementation: (value: string | null, find: string | null, replaceWith: string | null) => {
          if (value == null || find == null || replaceWith == null) return value;
          return value.split(find).join(replaceWith);
        },
      });
      db.public.registerFunction({ name: 'uuid_generate_v4', args: [], returns: DataType.uuid, implementation: () => randomUUID() });
      PoolFactory = pgMem.Pool;
    }

    pool = new PoolFactory({ connectionString: cs });
  }
  return pool;
}

export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

const seedUniversalPackingDefaults = async (p: QueryRunner): Promise<void> => {
  const existing = await p.query(`SELECT COUNT(*)::int as count FROM universal_packing_list_items`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;
  for (let index = 0; index < DEFAULT_PACKING_LIST_ITEMS.length; index += 1) {
    const item = DEFAULT_PACKING_LIST_ITEMS[index];
    await p.query(
      `INSERT INTO universal_packing_list_items (id, category, label, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (category, label) DO NOTHING`,
      [randomUUID(), item.category, item.label, index]
    );
  }
};

const ensurePackingListForUserWithRunner = async (p: QueryRunner, userId: string): Promise<void> => {
  const existing = await p.query(`SELECT 1 FROM user_packing_list_items WHERE user_id = $1 LIMIT 1`, [userId]);
  if (existing.rowCount) return;
  const defaults = await p.query<{ category: string; label: string; position: number }>(
    `SELECT category, label, position
     FROM universal_packing_list_items
     ORDER BY position, category, label`
  );
  for (const item of defaults.rows) {
    await p.query(
      `INSERT INTO user_packing_list_items (id, user_id, category, label, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, category, label) DO NOTHING`,
      [randomUUID(), userId, item.category, item.label, Number(item.position ?? 0)]
    );
  }
};

const backfillUserPackingLists = async (p: QueryRunner): Promise<void> => {
  let usersWithoutLists;
  try {
    usersWithoutLists = await p.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM user_packing_list_items up WHERE up.user_id = u.id
       )`
    );
  } catch (err) {
    const message = String((err as Error)?.message ?? '');
    if (/column "?u\.id"? does not exist|column "?id"? does not exist/i.test(message)) {
      return;
    }
    throw err;
  }
  for (const user of usersWithoutLists.rows) {
    await ensurePackingListForUserWithRunner(p, user.id);
  }
};

const mergeUserPackingListIntoTripWithRunner = async (p: QueryRunner, tripId: string, userId: string): Promise<void> => {
  await ensurePackingListForUserWithRunner(p, userId);
  const existingRows = await p.query<{ category: string; label: string; position: number }>(
    `SELECT category, label, position FROM trip_packing_list_items WHERE trip_id = $1`,
    [tripId]
  );
  const existing = new Set(existingRows.rows.map((row) => normalizePackingKey(row.category, row.label)));
  let nextPosition = existingRows.rows.reduce((max, row) => Math.max(max, Number(row.position ?? 0)), -1) + 1;
  const userItems = await p.query<PackingListItem>(
    `SELECT id, category, label, position FROM user_packing_list_items WHERE user_id = $1 ORDER BY position, category, label`,
    [userId]
  );
  for (const item of userItems.rows) {
    const key = normalizePackingKey(item.category, item.label);
    if (existing.has(key)) continue;
    existing.add(key);
    await p.query(
      `INSERT INTO trip_packing_list_items (id, trip_id, category, label, position, source_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (trip_id, category, label) DO NOTHING`,
      [randomUUID(), tripId, normalizePackingText(item.category), normalizePackingText(item.label), nextPosition, userId]
    );
    nextPosition += 1;
  }
};

const ensureTripPackingListWithRunner = async (p: QueryRunner, tripId: string): Promise<void> => {
  const existing = await p.query(`SELECT 1 FROM trip_packing_list_items WHERE trip_id = $1 LIMIT 1`, [tripId]);
  if (existing.rowCount) return;
  const members = await p.query<{ userId: string }>(
    `SELECT gm.user_id as "userId"
     FROM trips t
     JOIN group_members gm ON gm.group_id = t.group_id
     WHERE t.id = $1 AND gm.user_id IS NOT NULL AND gm.removed_at IS NULL
     ORDER BY gm.created_at`,
    [tripId]
  );
  for (const member of members.rows) {
    await mergeUserPackingListIntoTripWithRunner(p, tripId, member.userId);
  }
  const added = await p.query(`SELECT 1 FROM trip_packing_list_items WHERE trip_id = $1 LIMIT 1`, [tripId]);
  if (added.rowCount) return;
  await p.query(
    `INSERT INTO trip_packing_list_items (id, trip_id, category, label, position)
     SELECT uuid_generate_v4(), $1, category, label, position
     FROM universal_packing_list_items
     ORDER BY position, category, label`,
    [tripId]
  );
};

const mergeUserPackingListIntoGroupTripsWithRunner = async (p: QueryRunner, groupId: string, userId: string): Promise<void> => {
  const trips = await p.query<{ id: string }>(`SELECT id FROM trips WHERE group_id = $1`, [groupId]);
  for (const trip of trips.rows) {
    await mergeUserPackingListIntoTripWithRunner(p, trip.id, userId);
  }
};

// Initialize database schema, migrations, and seed airport data on startup.
export const initDb = async (): Promise<void> => {
  const p = getPool();

  // Skip or ignore extension creation when running against in-memory pg-mem.
  try {
    await p.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  } catch (err) {
    if (process.env.USE_IN_MEMORY_DB === '1' || process.env.NODE_ENV === 'test') {
      // pg-mem doesn't support extensions; safe to skip in tests.
    } else {
      throw err;
    }
  }


  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      username_normalized TEXT,
      provider TEXT NOT NULL,
      google_id TEXT,
      picture TEXT,
      first_name TEXT,
      last_name TEXT,
      email_verified BOOLEAN DEFAULT TRUE,
      email_verified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username_normalized TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized ON users(username_normalized);`);


  await p.query(`
    CREATE TABLE IF NOT EXISTS web_users (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      home_address TEXT,
      preferred_airport TEXT,
      map_preference TEXT,
      appearance_preference TEXT,
      temperature_unit TEXT,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      first_login_at TIMESTAMP,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Backward compatibility if the table already exists
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS middle_name TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS home_address TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS preferred_airport TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS map_preference TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS appearance_preference TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS temperature_unit TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS salt TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMP;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS age INTEGER;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS gender TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT FALSE;`);

  // `email_verifications` now lives in
  // server/migrations/20260426_add_email_verifications.sql — auto-applied by
  // the runtime migration runner on boot. The drift-guard snapshot no longer
  // lists this table.

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_emails (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      email_normalized TEXT NOT NULL UNIQUE,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, email_normalized)
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_email_verifications (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_normalized TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_user_email_verifications_user ON user_email_verifications(user_id);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_user_email_verifications_email ON user_email_verifications(email_normalized);`);
  await p.query(`ALTER TABLE user_emails ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;`);
  await p.query(`ALTER TABLE user_emails ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;`);
  await p.query(`ALTER TABLE user_emails ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;`);
  await p.query(`ALTER TABLE user_emails ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_emails_normalized ON user_emails(email_normalized);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails(user_id);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS traits (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
  `);
  await p.query(`ALTER TABLE traits ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;`);
  await p.query(`ALTER TABLE traits ADD COLUMN IF NOT EXISTS notes TEXT;`);
  await p.query(`ALTER TABLE traits ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_traits_user_name ON traits(user_id, name);`);


  await p.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      invite_email TEXT,
      claimed_at TIMESTAMP,
      removed_at TIMESTAMP,
      guest_name TEXT,
      first_name TEXT,
      last_name TEXT,
      added_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (group_id, user_id)
    );
  `);
  // Backfill columns for existing installs where group_members predates invite support.
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS invite_email TEXT;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS guest_name TEXT;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS added_by UUID;`);
  await p.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS group_invites (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      trip_id UUID,
      inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      invitee_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`ALTER TABLE group_invites ALTER COLUMN invitee_user_id DROP NOT NULL;`);
  await p.query(`ALTER TABLE group_invites ADD COLUMN IF NOT EXISTS trip_id UUID;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS family_relationships (
      id UUID PRIMARY KEY,
      requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relative_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (requester_id, relative_id)
    );
  `);

  // `fellow_travelers` now lives in
  // server/migrations/20260426_add_fellow_travelers.sql — auto-applied by
  // the runtime migration runner on boot. The previously-required
  // `ADD COLUMN IF NOT EXISTS email` ALTER is folded into the migration's
  // CREATE TABLE since the table is now born with the column on first
  // apply. The drift-guard snapshot no longer lists this table.

  await p.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      destination TEXT,
      location_ids JSONB DEFAULT '[]'::jsonb,
      start_date DATE,
      end_date DATE,
      start_month INTEGER,
      start_year INTEGER,
      duration_days INTEGER,
      currency TEXT DEFAULT 'USD',
      covered_by JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS description TEXT;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination TEXT;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS location_ids JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date DATE;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date DATE;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_month INTEGER;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_year INTEGER;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS duration_days INTEGER;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS covered_by JSONB DEFAULT '{}'::jsonb;`);
  await p.query(`UPDATE trips SET currency = 'USD' WHERE currency IS NULL;`);
  await p.query(`UPDATE trips SET covered_by = '{}'::jsonb WHERE covered_by IS NULL;`);
  await p.query(`UPDATE trips SET location_ids = '[]'::jsonb WHERE location_ids IS NULL;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS universal_packing_list_items (
      id UUID PRIMARY KEY,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (category, label)
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_packing_list_items (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, category, label)
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_packing_list_items (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      source_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (trip_id, category, label)
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_packing_item_checks (
      item_id UUID NOT NULL REFERENCES trip_packing_list_items(id) ON DELETE CASCADE,
      traveler_id UUID NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
      packed BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (item_id, traveler_id)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_user_packing_user ON user_packing_list_items(user_id, position);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_packing_trip ON trip_packing_list_items(trip_id, position);`);
  await seedUniversalPackingDefaults(p);
  await backfillUserPackingLists(p);

  await p.query(`
    CREATE TABLE IF NOT EXISTS follow_codes (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TIMESTAMP,
      max_uses INTEGER,
      uses_count INTEGER NOT NULL DEFAULT 0,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      revoked_at TIMESTAMP
    );
  `);
  await p.query(`ALTER TABLE follow_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await p.query(`ALTER TABLE follow_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER;`);
  await p.query(`ALTER TABLE follow_codes ADD COLUMN IF NOT EXISTS uses_count INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE follow_codes ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_follow_codes_trip_id ON follow_codes(trip_id);`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_codes_code ON follow_codes(code);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_followers (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      follower_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'follower',
      follow_code_id UUID REFERENCES follow_codes(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      last_viewed_at TIMESTAMP,
      UNIQUE (trip_id, follower_user_id)
    );
  `);
  await p.query(`ALTER TABLE trip_followers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'follower';`);
  await p.query(`ALTER TABLE trip_followers ADD COLUMN IF NOT EXISTS follow_code_id UUID REFERENCES follow_codes(id) ON DELETE SET NULL;`);
  await p.query(`ALTER TABLE trip_followers ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP;`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_followers_trip_id ON trip_followers(trip_id);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_followers_user_id ON trip_followers(follower_user_id);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_share_invites (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      invitee_email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      token_hash TEXT,
      expires_at TIMESTAMP,
      accepted_at TIMESTAMP,
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE CASCADE;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS invitee_user_id UUID REFERENCES users(id) ON DELETE CASCADE;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS role TEXT;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS token_hash TEXT;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();`);
  await p.query(`ALTER TABLE trip_share_invites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();`);
  await p.query(`UPDATE trip_share_invites SET role = COALESCE(role, 'follower') WHERE role IS NULL;`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_share_invites_trip_id ON trip_share_invites(trip_id);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_share_invites_email ON trip_share_invites(LOWER(invitee_email));`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_share_invites_status ON trip_share_invites(status);`);
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_share_invites_pending_unique
     ON trip_share_invites(trip_id, LOWER(invitee_email), role)
     WHERE status = 'pending' AND revoked_at IS NULL`
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_activity (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE trip_activity ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await p.query(`ALTER TABLE trip_activity ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL;`);
  try {
    await p.query(
      `ALTER TABLE trip_activity
       ADD CONSTRAINT chk_trip_activity_type
       CHECK (type IN ('TRIP_CREATED','FOLLOW_ADDED','FOLLOW_REMOVED','ITINERARY_ITEM_ADDED','ITINERARY_ITEM_UPDATED','ITINERARY_ITEM_DELETED','FLIGHT_ADDED','LODGING_ADDED','TOUR_ADDED','NOTE_ADDED'))`
    );
  } catch (err: any) {
    const code = String(err?.code ?? '');
    const message = String(err?.message ?? '').toLowerCase();
    if (code !== '42710' && !message.includes('already exists') && !message.includes('duplicate')) {
      throw err;
    }
  }
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_activity_trip_created ON trip_activity(trip_id, created_at DESC, id DESC);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_comments (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_comments_trip_created ON trip_comments(trip_id, created_at DESC, id DESC);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_messages (
      id UUID PRIMARY KEY,
      app_id TEXT NOT NULL DEFAULT 'WanderBunnies',
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      sender_initials TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_messages_trip_created ON trip_messages(trip_id, created_at ASC, id ASC);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id UUID NOT NULL REFERENCES trip_messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );
  `);

  // `chat_read_watermarks` now lives in
  // server/migrations/20260425_add_chat_read_watermarks.sql — first proof
  // of the Priority 10 inline→migrations cutover pattern. Auto-applied by
  // the runner invoked at the end of initDb.

  await p.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      category TEXT,
      name TEXT NOT NULL,
      address TEXT,
      search_name TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_file TEXT,
      source_row_hash TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_locations_source_type ON locations(source_type);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_locations_search_name ON locations(search_name);`);
  // Composite index for attraction catalog queries that filter by source_type + destinationKey
  await p.query(`CREATE INDEX IF NOT EXISTS idx_locations_attraction_dest_key ON locations(source_type, (LOWER(COALESCE(payload->>'destinationKey', ''))));`);
  // Partial index on category for shortlist blob lookups
  await p.query(`CREATE INDEX IF NOT EXISTS idx_locations_shortlist_blob ON locations(id) WHERE source_type = 'attraction_shortlist_blob';`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_removals (
      trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      removed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (trip_id, user_id)
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS flights (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Booked',
      transfer_type TEXT NOT NULL DEFAULT 'Flight',
      passenger_name TEXT NOT NULL,
      passenger_ids JSONB DEFAULT '[]'::jsonb,
      departure_date DATE NOT NULL,
      departure_location TEXT,
      departure_airport_code TEXT,
      departure_time TEXT NOT NULL,
      arrival_location TEXT,
      arrival_airport_code TEXT,
      layover_location TEXT,
      layover_location_code TEXT,
      layover_duration TEXT,
      arrival_date DATE,
      arrival_time TEXT NOT NULL,
      cost NUMERIC NOT NULL,
      carrier TEXT NOT NULL,
      flight_number TEXT NOT NULL,
      booking_reference TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS flight_shares (
      flight_id UUID REFERENCES flights(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (flight_id, user_id)
    );
  `);

  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS departure_location TEXT;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS departure_airport_code TEXT;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS arrival_location TEXT;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS arrival_airport_code TEXT;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS layover_location_code TEXT;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS arrival_date DATE;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(id) ON DELETE SET NULL;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Booked';`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS transfer_type TEXT NOT NULL DEFAULT 'Flight';`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS passenger_ids JSONB DEFAULT '[]'::jsonb;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS lodgings (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Booked',
      name TEXT NOT NULL,
      check_in_date DATE NOT NULL,
      check_out_date DATE NOT NULL,
      rooms INTEGER NOT NULL DEFAULT 1,
      refund_by DATE,
      total_cost NUMERIC NOT NULL DEFAULT 0,
      cost_per_night NUMERIC NOT NULL DEFAULT 0,
      address TEXT,
      place_id TEXT,
      paid_by JSONB DEFAULT '[]'::jsonb,
      traveler_ids JSONB DEFAULT '[]'::jsonb,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS rooms INTEGER NOT NULL DEFAULT 1;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS refund_by DATE;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS cost_per_night NUMERIC NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS address TEXT;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS place_id TEXT;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Booked';`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS traveler_ids JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS image_url TEXT;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS tours (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Booked',
      date DATE NOT NULL,
      name TEXT NOT NULL,
      start_location TEXT,
      start_time TEXT,
      duration TEXT,
      cost NUMERIC NOT NULL DEFAULT 0,
      free_cancel_by DATE,
      booked_on TEXT,
      reference TEXT,
      notes TEXT,
      paid_by JSONB DEFAULT '[]'::jsonb,
      traveler_ids JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS traveler_ids JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS booked_on TEXT;`);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Booked';`);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'Tour';`);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS notes TEXT;`);
  await p.query(`UPDATE tours SET activity_type = 'Tour' WHERE activity_type IS NULL OR COALESCE(activity_type, '') = '';`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS car_rentals (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Booked',
      pickup_location TEXT,
      pickup_date DATE,
      dropoff_location TEXT,
      dropoff_date DATE,
      reference TEXT,
      vendor TEXT,
      prepaid TEXT,
      cost NUMERIC NOT NULL DEFAULT 0,
      model TEXT,
      notes TEXT,
      paid_by JSONB DEFAULT '[]'::jsonb,
      traveler_ids JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE car_rentals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Booked';`);
  await p.query(`ALTER TABLE car_rentals ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE car_rentals ADD COLUMN IF NOT EXISTS traveler_ids JSONB DEFAULT '[]'::jsonb;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS item_votes (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      item_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (item_type, item_id, user_id)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_item_votes_trip_type_item ON item_votes(trip_id, item_type, item_id);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS airports (
      iata_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      country TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE airports ADD COLUMN IF NOT EXISTS iata_code TEXT;`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_airports_iata_code ON airports(iata_code);`);

  // `place_details_cache` now lives in
  // server/migrations/20260426_add_place_details_cache.sql — auto-applied by
  // the runtime migration runner on boot. The drift-guard snapshot no
  // longer lists this table.
  await p.query(`
    CREATE TABLE IF NOT EXISTS place_lookup_cache (
      query_key TEXT PRIMARY KEY,
      place_id TEXT NOT NULL,
      name TEXT NOT NULL,
      likelihood NUMERIC NOT NULL DEFAULT 0,
      fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS itineraries (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      days INTEGER NOT NULL,
      budget NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE itineraries ADD COLUMN IF NOT EXISTS budget NUMERIC;`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS itinerary_details (
      id UUID PRIMARY KEY,
      itinerary_id UUID NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
      day INTEGER NOT NULL,
      time TEXT,
      activity TEXT NOT NULL,
      cost NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // server/migrations/20260427_add_itinerary_detail_reactions.sql — auto-applied
  // by the runtime migration runner below. The table FKs to itinerary_details so
  // it must run after the inline create above; the migration runner handles that
  // ordering on a fresh DB by virtue of file lexical order.

  await p.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expense_date DATE NOT NULL,
      category TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount_in_trip_currency NUMERIC,
      exchange_rate_to_trip_currency NUMERIC,
      exchange_rate_date DATE,
      payer_ids JSONB DEFAULT '[]'::jsonb,
      for_ids JSONB DEFAULT '[]'::jsonb,
      source_type TEXT,
      source_id TEXT,
      vendor TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (source_type, source_id)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_expenses_trip_date ON expenses(trip_id, expense_date);`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_in_trip_currency NUMERIC;`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS exchange_rate_to_trip_currency NUMERIC;`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS exchange_rate_date DATE;`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor TEXT;`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trip_payments (
      id UUID PRIMARY KEY,
      trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payer_id UUID NOT NULL,
      receiver_id UUID NOT NULL,
      payment_date DATE NOT NULL,
      amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_trip_payments_trip ON trip_payments(trip_id, payment_date);`);

  // ---- Entitlement system tables ----

  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  try {
    await p.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE role <> 'user';`);
  } catch {
    // pg-mem doesn't support partial indexes; safe to skip in tests.
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS tiers (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      key          TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      rank         INTEGER NOT NULL UNIQUE,
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS features (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      key             TEXT NOT NULL UNIQUE,
      description     TEXT NOT NULL DEFAULT '',
      default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS tier_entitlements (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tier_id    UUID NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
      feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      is_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (tier_id, feature_id)
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS tier_limits (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tier_id     UUID NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
      limit_key   TEXT NOT NULL,
      limit_value INTEGER NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (tier_id, limit_key)
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_tiers (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier_id        UUID NOT NULL REFERENCES tiers(id),
      source         TEXT NOT NULL DEFAULT 'system',
      reason         TEXT,
      assigned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
      effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
      effective_to   TIMESTAMP,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  try {
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_user_tiers_current
        ON user_tiers(user_id, effective_from DESC)
        WHERE effective_to IS NULL;
    `);
  } catch {
    // pg-mem doesn't support partial indexes; safe to skip in tests.
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      key        TEXT NOT NULL UNIQUE,
      enabled    BOOLEAN NOT NULL DEFAULT FALSE,
      scope      TEXT NOT NULL DEFAULT 'global',
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS usage_counters (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      metric_key TEXT NOT NULL,
      window_key TEXT NOT NULL,
      count      BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, metric_key, window_key)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_usage_counters_user_metric ON usage_counters(user_id, metric_key, window_key);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS api_usage_counters (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider   TEXT NOT NULL,
      caller     TEXT NOT NULL,
      scope      TEXT NOT NULL,
      window_key TEXT NOT NULL,
      count      BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (scope, provider, caller, window_key)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_counters_lookup ON api_usage_counters(provider, scope, caller, window_key);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS api_cost_counters (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider      TEXT NOT NULL,
      window_key    TEXT NOT NULL,
      amount_micros BIGINT NOT NULL DEFAULT 0,
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (provider, window_key)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_api_cost_counters_lookup ON api_cost_counters(provider, window_key);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
      metric_key TEXT NOT NULL,
      amount     INTEGER NOT NULL DEFAULT 1,
      metadata   JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_usage_events_user_metric_created ON usage_events(user_id, metric_key, created_at DESC);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS generation_idempotency (
      key        TEXT PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id    TEXT NOT NULL,
      usage_key  TEXT,
      window_key TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      result_ref TEXT,
      response_body JSONB,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    );
  `);
  await p.query(`ALTER TABLE generation_idempotency ADD COLUMN IF NOT EXISTS usage_key TEXT;`);
  await p.query(`ALTER TABLE generation_idempotency ADD COLUMN IF NOT EXISTS window_key TEXT;`);
  await p.query(`ALTER TABLE generation_idempotency ADD COLUMN IF NOT EXISTS response_body JSONB;`);
  await p.query(`ALTER TABLE generation_idempotency ADD COLUMN IF NOT EXISTS error_message TEXT;`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_gen_idempotency_user ON generation_idempotency(user_id, created_at DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_gen_idempotency_usage ON generation_idempotency(user_id, usage_key, window_key, status);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
      target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action         TEXT NOT NULL,
      before_state   JSONB,
      after_state    JSONB,
      reason         TEXT,
      ip_address     TEXT,
      user_agent     TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor_user_id, created_at DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_user_id, created_at DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action, created_at DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);`);

  // Run pending migrations BEFORE the USE_IN_MEMORY_DB cleanup block below
  // so migration-backed tables (cut over from inline CREATE TABLE) exist in
  // time for the DELETE-ALL test-isolation sweep to touch them.
  if (getEnvFlag('INGESTION_MIGRATIONS_ON_BOOT', { defaultValue: true })) {
    try {
      const { runMigrations } = require('./migrations/runner') as typeof import('./migrations/runner');
      const pathMod = require('node:path') as typeof import('node:path');
      const migrationsDir = pathMod.join(__dirname, '..', 'migrations');
      const client = { query: (sql: string, params?: unknown[]) => p.query(sql, params as any) };
      await runMigrations({ client, dir: migrationsDir });
    } catch (err) {
      const { logError } = require('./logger') as typeof import('./logger');
      logError('[migrations] auto-apply on initDb failed', err);
      throw err;
    }
  }

  if (process.env.USE_IN_MEMORY_DB === '1') {
    // Clear data between test runs while keeping schema intact. Each DELETE
    // is best-effort: tables that haven't been created yet (e.g. because a
    // migration is disabled via INGESTION_MIGRATIONS_ON_BOOT=false) are
    // ignored so the init path stays composable across test modes.
    const del = async (tbl: string): Promise<void> => {
      try { await p.query(`DELETE FROM ${tbl}`); } catch { /* table absent, skip */ }
    };
    await del('audit_log');
    await del('generation_idempotency');
    await del('api_cost_counters');
    await del('api_usage_counters');
    await del('usage_events');
    await del('usage_counters');
    await del('user_tiers');
    await del('tier_entitlements');
    await del('tier_limits');
    await del('feature_flags');
    await del('tiers');
    await del('features');
    await del('message_reads');
    await del('trip_messages');
    await del('trip_comments');
    await del('trip_activity');
    await del('itinerary_detail_reactions');
    await del('itinerary_checklist_items');
    await del('itinerary_details');
    await del('itineraries');
    await del('tours');
    await del('car_rentals');
    await del('item_votes');
    await del('lodgings');
    await del('flight_shares');
    await del('flights');
    await del('expenses');
    await del('trips');
    await del('place_details_cache');
    await del('place_lookup_cache');
    await del('group_invites');
    await del('group_members');
    await del('groups');
    await del('traits');
    await del('family_relationships');
    await del('fellow_travelers');
    await del('user_email_verifications');
    await del('user_emails');
    await del('web_users');
    await del('users');
  }

  // Seed tiers (individual parameterized inserts to avoid pg-mem uuid evaluation issues)
  for (const [key, displayName, rank] of [['free', 'Free', 1], ['premium', 'Premium', 2], ['pro', 'Pro', 3]] as const) {
    await p.query(
      `INSERT INTO tiers (id, key, display_name, rank) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
      [randomUUID(), key, displayName, rank]
    );
  }

  // Seed features
  const featureSeedRows: Array<[string, string, boolean]> = [
    ['ai_itinerary_generation', 'AI-powered itinerary generation',   true],
    ['csv_export',              'Export cost reports as CSV',         true],
    ['car_rentals',             'Car rental tracking',                true],
    ['trip_sharing',            'Share trips with other users',       true],
    ['trip_following',          'Follow trips as read-only observer', true],
    ['cost_tracking',           'Expense and cost tracking',          true],
    ['multiple_groups',         'Create more than one group',         true],
    ['trip_creation',           'Create new trips',                   true],
  ];
  for (const [key, description, defaultEnabled] of featureSeedRows) {
    await p.query(
      `INSERT INTO features (id, key, description, default_enabled) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
      [randomUUID(), key, description, defaultEnabled]
    );
  }

  const featureIdCache: Record<string, string> = {};
  const tierIdCache: Record<string, string> = {};
  for (const [key] of featureSeedRows) {
    const { rows } = await p.query<{ id: string }>(`SELECT id FROM features WHERE key = $1`, [key]);
    if (rows[0]?.id) {
      featureIdCache[key] = rows[0].id;
    }
  }

  const tierEntitlementSeeds: Array<[string, string, boolean]> = [
    ['free', 'ai_itinerary_generation', true],
    ['free', 'csv_export', true],
    ['free', 'car_rentals', true],
    ['free', 'trip_sharing', true],
    ['free', 'trip_following', true],
    ['free', 'cost_tracking', false],
    ['free', 'multiple_groups', true],
    ['free', 'trip_creation', true],
    ['premium', 'cost_tracking', true],
    ['pro', 'cost_tracking', true],
  ];
  for (const [tierKey, featureKey, isAllowed] of tierEntitlementSeeds) {
    if (!tierIdCache[tierKey]) {
      const { rows } = await p.query<{ id: string }>(`SELECT id FROM tiers WHERE key = $1`, [tierKey]);
      if (!rows.length) continue;
      tierIdCache[tierKey] = rows[0].id;
    }
    const featureId = featureIdCache[featureKey];
    if (!featureId) continue;
    await p.query(
      `INSERT INTO tier_entitlements (id, tier_id, feature_id, is_allowed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tier_id, feature_id) DO NOTHING`,
      [randomUUID(), tierIdCache[tierKey], featureId, isAllowed]
    );
  }

  // Seed tier limits — fetch tier IDs then insert directly (pg-mem compatible)
  const tierLimitSeeds: Array<[string, string, number]> = [
    ['free',    'max_active_trips',                    3],
    ['free',    'max_travelers_per_trip',              6],
    ['free',    'ai_itinerary_generations_per_month',  5],
    ['premium', 'max_active_trips',                    250],
    ['premium', 'max_travelers_per_trip',              200],
    ['premium', 'ai_itinerary_generations_per_month', -1],
    ['pro',     'max_active_trips',                    250],
    ['pro',     'max_travelers_per_trip',              200],
    ['pro',     'ai_itinerary_generations_per_month', -1],
  ];
  for (const [tierKey, limitKey, limitValue] of tierLimitSeeds) {
    if (!tierIdCache[tierKey]) {
      const { rows } = await p.query<{ id: string }>(`SELECT id FROM tiers WHERE key = $1`, [tierKey]);
      if (!rows.length) continue;
      tierIdCache[tierKey] = rows[0].id;
    }
    await p.query(
      `INSERT INTO tier_limits (id, tier_id, limit_key, limit_value) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tier_id, limit_key) DO NOTHING`,
      [randomUUID(), tierIdCache[tierKey], limitKey, limitValue]
    );
  }

  // Seed feature flags
  for (const key of ['ai_itinerary_generation', 'csv_export', 'car_rentals', 'trip_sharing', 'trip_following', 'cost_tracking', 'multiple_groups', 'trip_creation']) {
    await p.query(
      `INSERT INTO feature_flags (id, key, enabled) VALUES ($1, $2, true) ON CONFLICT (key) DO NOTHING`,
      [randomUUID(), key]
    );
  }

  // Assign free tier to all existing users without an active user_tiers row
  {
    const { rows: usersNeedingTier } = await p.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       LEFT JOIN user_tiers ut ON ut.user_id = u.id AND ut.effective_to IS NULL
       WHERE ut.id IS NULL`
    );
    const { rows: freeTierRows } = await p.query<{ id: string }>(`SELECT id FROM tiers WHERE key = 'free'`);
    const freeTierId = freeTierRows[0]?.id;
    if (freeTierId) {
      for (const user of usersNeedingTier) {
        await p.query(
          `INSERT INTO user_tiers (id, user_id, tier_id, source) VALUES ($1, $2, $3, 'system')
           ON CONFLICT DO NOTHING`,
          [randomUUID(), user.id, freeTierId]
        );
      }
    }
  }

  // Backfill usernames for existing rows and ensure user_emails has a canonical primary email for each user.
  const usersWithoutUsername = await p.query<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>(
    `SELECT id,
            email,
            first_name as "firstName",
            last_name as "lastName"
     FROM users
     WHERE username_normalized IS NULL OR username_normalized = ''`
  );
  for (const user of usersWithoutUsername.rows) {
    const username = await generateUniqueUsername(
      p,
      user.firstName ?? '',
      user.lastName ?? '',
      user.email
    );
    await p.query(
      `UPDATE users
       SET username = $1,
           username_normalized = $2
       WHERE id = $3`,
      [username, username, user.id]
    );
  }

  const existingUserEmails = await p.query<{
    id: string;
    email: string;
    emailVerified: boolean | null;
    emailVerifiedAt: string | null;
  }>(
    `SELECT id,
            email,
            email_verified as "emailVerified",
            email_verified_at as "emailVerifiedAt"
     FROM users`
  );
  for (const user of existingUserEmails.rows) {
    await upsertUserEmail(p, user.id, user.email, {
      isPrimary: true,
      isVerified: Boolean(user.emailVerified ?? true),
      verifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : null,
    });
  }

  // Migration runner already fired above (right after inline bootstrap,
  // before the USE_IN_MEMORY_DB cleanup). This kept-legacy comment block
  // documents the rationale: run migrations AFTER the inline CREATE TABLE
  // IF NOT EXISTS path so the `schema_migrations` ledger stays separate
  // from the historical bootstrap. Disable via
  // INGESTION_MIGRATIONS_ON_BOOT=false when running against a DB where
  // migrations are applied out-of-band (e.g. a prod migration job).
};


export const findOrCreateUser = async (
  email: string,
  provider: User['provider']
): Promise<User> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const existing = await p.query<User>(
    `SELECT u.*
     FROM users u
     JOIN user_emails ue ON ue.user_id = u.id
     WHERE ue.email_normalized = $1
     LIMIT 1`,
    [normalizedEmail]
  );
  if (existing.rows.length) return existing.rows[0];
  const id = randomUUID();
  const username = await generateUniqueUsername(p, '', '', normalizedEmail);
  await p.query(
    `INSERT INTO users (id, email, username, username_normalized, provider, email_verified)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, normalizedEmail, username, username, provider]
  );
  await upsertUserEmail(p, id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
  await ensurePackingListForUserWithRunner(p, id);
  return { id, email: normalizedEmail, provider, emailVerified: true, role: 'user' };
};

type Queryable = Pick<Pool, 'query'>;

const upsertUserEmail = async (
  db: Queryable,
  userId: string,
  email: string,
  options: { isPrimary?: boolean; isVerified?: boolean; verifiedAt?: Date | null } = {}
): Promise<void> => {
  const normalizedEmail = normalizeEmail(email);
  const isPrimary = options.isPrimary ?? false;
  const isVerified = options.isVerified ?? false;
  const verifiedAt = options.verifiedAt ?? (isVerified ? new Date() : null);

  await db.query(
    `INSERT INTO user_emails (id, user_id, email, email_normalized, is_primary, is_verified, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email_normalized) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         email = EXCLUDED.email,
         is_verified = CASE WHEN EXCLUDED.is_verified THEN TRUE ELSE user_emails.is_verified END,
         verified_at = CASE
           WHEN EXCLUDED.is_verified THEN COALESCE(EXCLUDED.verified_at, user_emails.verified_at, NOW())
           ELSE user_emails.verified_at
         END`,
    [randomUUID(), userId, email, normalizedEmail, isPrimary, isVerified, verifiedAt]
  );

  if (isPrimary) {
    await db.query(`UPDATE user_emails SET is_primary = (email_normalized = $2) WHERE user_id = $1`, [userId, normalizedEmail]);
  }
};

const ensureOwnerUserRow = async (db: Queryable, ownerId: string): Promise<void> => {
  const existing = await db.query(`SELECT id FROM users WHERE id = $1`, [ownerId]);
  if (existing.rowCount) return;
  const webUser = await db.query<{ email: string }>(`SELECT email FROM web_users WHERE id = $1`, [ownerId]);
  const email = webUser.rows[0]?.email;
  if (!email) {
    throw new Error('User not found. Please log in again.');
  }
  const username = await generateUniqueUsername(db, '', '', email);
  await db.query(
    `INSERT INTO users (id, email, username, username_normalized, provider, email_verified)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [ownerId, email, username, username, 'email']
  );
  await upsertUserEmail(db, ownerId, email, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
  await ensurePackingListForUserWithRunner(db, ownerId);
};

export const ensureDefaultGroupForUser = async (userId: string, email: string): Promise<void> => {
  const p = getPool();
  await ensureOwnerUserRow(p, userId);
  const { rows: webUserRows } = await p.query<{ first_name: string }>(
    `SELECT first_name FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const firstName = webUserRows[0]?.first_name?.trim();
  const displayName = firstName || email;
  const name = `${displayName}'s Group`;
  const legacyName = `${email}'s Group`;
  const existing = await p.query<{ id: string; name: string }>(
    `SELECT id, name FROM groups WHERE owner_id = $1 AND (name = $2 OR name = $3) LIMIT 1`,
    [userId, name, legacyName]
  );
  if (existing.rowCount) {
    if (existing.rows[0].name !== name) {
      await p.query(`UPDATE groups SET name = $1 WHERE id = $2`, [name, existing.rows[0].id]);
    }
    // ensure membership
    await p.query(
      `INSERT INTO group_members (id, group_id, user_id, added_by)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [randomUUID(), existing.rows[0].id, userId]
    );
    return;
  }
  const groupId = randomUUID();
  await p.query(`INSERT INTO groups (id, owner_id, name) VALUES ($1, $2, $3)`, [groupId, userId, name]);
  await p.query(
    `INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $3)`,
    [randomUUID(), groupId, userId]
  );
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const { rows } = await p.query<User>(
    `SELECT u.*
     FROM users u
     JOIN user_emails ue ON ue.user_id = u.id
     WHERE ue.email_normalized = $1
     LIMIT 1`,
    [normalizedEmail]
  );
  const row = rows[0] as any;
  if (!row) return null;
  return { ...row, passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [] };
};

export const findUserByIdentifier = async (identifier: string): Promise<User | null> => {
  const p = getPool();
  const normalized = normalizeLoginIdentifier(identifier);
  if (!normalized) return null;
  const usingEmail = isEmailLikeIdentifier(normalized);
  const { rows } = await p.query<User>(
    `SELECT u.*
     FROM users u
     LEFT JOIN user_emails ue ON ue.user_id = u.id AND ue.email_normalized = $1
     WHERE ($2::boolean = true AND ue.email_normalized IS NOT NULL)
        OR ($2::boolean = false AND u.username_normalized = $1)
     LIMIT 1`,
    [normalized, usingEmail]
  );
  const row = rows[0] as any;
  if (!row) return null;
  return { ...row, passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [] };
};

export type AccountEmail = {
  email: string;
  isPrimary: boolean;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string | null;
};


const hashPassword = (password: string, salt: string): string => {
  return scryptSync(password, salt, 64).toString('hex');
};


export const createWebUser = async (
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  usernameInput?: string
): Promise<WebUser> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);

  const existingUser = await p.query<{ id: string; emailVerified: boolean }>(
    `SELECT u.id, COALESCE(u.email_verified, TRUE) as "emailVerified"
     FROM users u
     JOIN user_emails ue ON ue.user_id = u.id
     WHERE ue.email_normalized = $1
     LIMIT 1`,
    [normalizedEmail]
  );
  if (existingUser.rows.length) {
    const user = existingUser.rows[0];
    const existingWebUser = await p.query(`SELECT 1 FROM web_users WHERE id = $1`, [user.id]);
    if (existingWebUser.rowCount) {
      const err = new Error('User already exists');
      (err as any).code = 'USER_EXISTS';
      throw err;
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    await p.query(
      `INSERT INTO web_users (id, email, first_name, last_name, password_hash, salt, password_setup_required)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
      [user.id, normalizedEmail, firstName, lastName, passwordHash, salt]
    );
    const username = await generateUniqueUsername(p, firstName, lastName, normalizedEmail, usernameInput, user.id);
    await p.query(
      `UPDATE users
       SET username = COALESCE(username, $1),
           username_normalized = COALESCE(username_normalized, $2),
           first_name = COALESCE($3, first_name),
           last_name = COALESCE($4, last_name),
           email = COALESCE($5, email),
           email_verified = COALESCE(email_verified, TRUE),
           email_verified_at = CASE WHEN COALESCE(email_verified, TRUE) THEN COALESCE(email_verified_at, NOW()) ELSE email_verified_at END
       WHERE id = $6`,
      [username, username, firstName, lastName, normalizedEmail, user.id]
    );
    await upsertUserEmail(p, user.id, normalizedEmail, {
      isPrimary: true,
      isVerified: Boolean(user.emailVerified),
      verifiedAt: user.emailVerified ? new Date() : null,
    });
    await ensurePackingListForUserWithRunner(p, user.id);
    return { id: user.id, email: normalizedEmail, firstName, lastName, emailVerified: user.emailVerified };
  }

  const id = randomUUID();
  const username = await generateUniqueUsername(p, firstName, lastName, normalizedEmail, usernameInput);
  await p.query(
    `INSERT INTO users (id, email, username, username_normalized, provider, email_verified)
     VALUES ($1, $2, $3, $4, 'email', false)`,
    [id, normalizedEmail, username, username]
  );

  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  await p.query(
    `INSERT INTO web_users (id, email, first_name, last_name, password_hash, salt, password_setup_required)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
    [id, normalizedEmail, firstName, lastName, passwordHash, salt]
  );
  await upsertUserEmail(p, id, normalizedEmail, { isPrimary: true, isVerified: false });
  await ensurePackingListForUserWithRunner(p, id);

  return { id, email: normalizedEmail, firstName, lastName, emailVerified: false };
};

export const ensureWebPasswordAccountForOAuth = async (
  userId: string,
  email: string,
  firstName?: string,
  lastName?: string
): Promise<{ requiresPasswordSetup: boolean }> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const existing = await p.query<{ passwordSetupRequired: boolean }>(
    `SELECT password_setup_required as "passwordSetupRequired" FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (existing.rows.length) {
    await upsertUserEmail(p, userId, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
    await ensurePackingListForUserWithRunner(p, userId);
    return { requiresPasswordSetup: Boolean(existing.rows[0].passwordSetupRequired) };
  }

  const salt = randomBytes(16).toString('hex');
  const randomSecret = randomBytes(32).toString('hex');
  const passwordHash = hashPassword(randomSecret, salt);
  await p.query(
    `INSERT INTO web_users (id, email, first_name, last_name, password_hash, salt, password_setup_required)
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), $5, $6, TRUE)`,
    [userId, normalizedEmail, firstName ?? '', lastName ?? '', passwordHash, salt]
  );
  await upsertUserEmail(p, userId, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
  await ensurePackingListForUserWithRunner(p, userId);
  return { requiresPasswordSetup: true };
};


export const verifyWebUserCredentials = async (
  identifier: string,
  password: string
): Promise<WebUser | null> => {
  const p = getPool();
  const normalizedIdentifier = normalizeLoginIdentifier(identifier);
  if (!normalizedIdentifier) return null;
  const loginWithEmail = isEmailLikeIdentifier(normalizedIdentifier);


  const { rows } = await p.query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    passwordHash: string;
    salt: string;
    emailVerified: boolean;
  }>(
    `SELECT wu.id,
            wu.email,
            wu.first_name,
            wu.last_name,
            wu.password_hash as "passwordHash",
            wu.salt,
            COALESCE(u.email_verified, TRUE) as "emailVerified"
     FROM web_users wu
     JOIN users u ON u.id = wu.id
     LEFT JOIN user_emails ue
       ON ue.user_id = u.id
      AND ue.email_normalized = $1
     WHERE ($2::boolean = true AND ue.email_normalized IS NOT NULL)
        OR ($2::boolean = false AND u.username_normalized = $1)
     LIMIT 1`,
    [normalizedIdentifier, loginWithEmail]
  );


  if (!rows.length) return null;


  const [{ id, email, first_name, last_name, passwordHash, salt, emailVerified }] = rows;
  const providedHash = hashPassword(password, salt);


  const storedBuffer = Buffer.from(passwordHash, 'hex');
  const providedBuffer = Buffer.from(providedHash, 'hex');


  if (
    storedBuffer.length === providedBuffer.length &&
    timingSafeEqual(storedBuffer, providedBuffer)
  ) {
    return { id, email, firstName: first_name, lastName: last_name, emailVerified };
  }


  return null;
};

export const getUserById = async (userId: string): Promise<User | null> => {
  const p = getPool();
  const { rows } = await p.query<User>(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return rows[0] ?? null;
};

export const recordWebUserLogin = async (userId: string): Promise<{ firstLogin: boolean }> => {
  const p = getPool();
  const { rows } = await p.query<{ firstLogin: boolean }>(
    `
    WITH current AS (
      SELECT first_login_at FROM web_users WHERE id = $1
    ),
    updated AS (
      UPDATE web_users
      SET last_login_at = NOW(),
          first_login_at = COALESCE(first_login_at, NOW())
      WHERE id = $1
      RETURNING first_login_at
    )
    SELECT COALESCE(current.first_login_at IS NULL, false) as "firstLogin" FROM current
    `,
    [userId]
  );
  return { firstLogin: rows[0]?.firstLogin ?? false };
};

export const createEmailVerification = async (
  userId: string,
  ttlHours = 24
): Promise<{ token: string; expiresAt: string }> => {
  const p = getPool();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO email_verifications (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, tokenHash, expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
};

export const getPendingEmailVerification = async (
  userId: string
): Promise<{ id: string; expiresAt: string } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ id: string; expiresAt: string }>(
    `SELECT id, expires_at as "expiresAt"
     FROM email_verifications
     WHERE user_id = $1 AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
};

export const consumeEmailVerificationToken = async (
  token: string
): Promise<{ id: string; userId: string; email: string; expiresAt: string } | null> => {
  const p = getPool();
  const tokenHash = hashToken(token);
  const { rows } = await p.query<{ id: string; userId: string; email: string; expiresAt: string }>(
    `SELECT ev.id,
            ev.user_id as "userId",
            u.email as "email",
            ev.expires_at as "expiresAt"
     FROM email_verifications ev
     JOIN users u ON u.id = ev.user_id
     WHERE ev.token_hash = $1 AND ev.used_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] ?? null;
};

export const markEmailVerificationUsed = async (verificationId: string): Promise<void> => {
  const p = getPool();
  await p.query(`UPDATE email_verifications SET used_at = NOW() WHERE id = $1`, [verificationId]);
};

export const markUserEmailVerified = async (userId: string): Promise<void> => {
  const p = getPool();
  await p.query(`UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1`, [userId]);
  await p.query(
    `UPDATE user_emails
     SET is_verified = TRUE,
         verified_at = COALESCE(verified_at, NOW())
     WHERE user_id = $1
       AND (is_primary = TRUE OR email_normalized = (SELECT LOWER(email) FROM users WHERE id = $1))`,
    [userId]
  );
};

export const listUserEmails = async (userId: string): Promise<AccountEmail[]> => {
  const p = getPool();
  const { rows } = await p.query<{
    email: string;
    isPrimary: boolean;
    isVerified: boolean;
    verifiedAt: string | null;
    createdAt: string | null;
  }>(
    `SELECT email,
            is_primary as "isPrimary",
            is_verified as "isVerified",
            verified_at as "verifiedAt",
            created_at as "createdAt"
     FROM user_emails
     WHERE user_id = $1
     ORDER BY is_primary DESC, created_at ASC, email ASC`,
    [userId]
  );
  return rows;
};

export const addUserEmail = async (userId: string, email: string): Promise<AccountEmail> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const existing = await p.query<{ userId: string }>(
    `SELECT user_id as "userId"
     FROM user_emails
     WHERE email_normalized = $1
     LIMIT 1`,
    [normalizedEmail]
  );
  if (existing.rowCount && existing.rows[0].userId !== userId) {
    const err = new Error('Email is already associated with another account');
    (err as any).code = 'EMAIL_TAKEN';
    throw err;
  }

  await upsertUserEmail(p, userId, normalizedEmail, { isPrimary: false, isVerified: false, verifiedAt: null });
  const { rows } = await p.query<{
    email: string;
    isPrimary: boolean;
    isVerified: boolean;
    verifiedAt: string | null;
    createdAt: string | null;
  }>(
    `SELECT email,
            is_primary as "isPrimary",
            is_verified as "isVerified",
            verified_at as "verifiedAt",
            created_at as "createdAt"
     FROM user_emails
     WHERE user_id = $1 AND email_normalized = $2
     LIMIT 1`,
    [userId, normalizedEmail]
  );
  return rows[0];
};

export const createUserEmailVerification = async (
  userId: string,
  email: string,
  ttlHours = 24
): Promise<{ token: string; expiresAt: string }> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const owned = await p.query(
    `SELECT 1
     FROM user_emails
     WHERE user_id = $1 AND email_normalized = $2
     LIMIT 1`,
    [userId, normalizedEmail]
  );
  if (!owned.rowCount) {
    const err = new Error('Email is not associated with this account');
    (err as any).code = 'EMAIL_NOT_FOUND';
    throw err;
  }
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO user_email_verifications (id, user_id, email_normalized, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), userId, normalizedEmail, tokenHash, expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
};

export const consumeUserEmailVerificationToken = async (
  token: string
): Promise<{ id: string; userId: string; email: string; expiresAt: string } | null> => {
  const p = getPool();
  const tokenHash = hashToken(token);
  const { rows } = await p.query<{ id: string; userId: string; email: string; expiresAt: string }>(
    `SELECT uv.id,
            uv.user_id as "userId",
            ue.email as "email",
            uv.expires_at as "expiresAt"
     FROM user_email_verifications uv
     JOIN user_emails ue
       ON ue.user_id = uv.user_id
      AND ue.email_normalized = uv.email_normalized
     WHERE uv.token_hash = $1
       AND uv.used_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] ?? null;
};

export const markUserEmailVerificationUsed = async (verificationId: string): Promise<void> => {
  const p = getPool();
  await p.query(`UPDATE user_email_verifications SET used_at = NOW() WHERE id = $1`, [verificationId]);
};

export const markAccountEmailVerified = async (userId: string, email: string): Promise<void> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  await p.query(
    `UPDATE user_emails
     SET is_verified = TRUE,
         verified_at = COALESCE(verified_at, NOW())
     WHERE user_id = $1 AND email_normalized = $2`,
    [userId, normalizedEmail]
  );
};

export const setPrimaryUserEmail = async (userId: string, email: string): Promise<AccountEmail[]> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const { rows } = await p.query<{ isVerified: boolean }>(
    `SELECT is_verified as "isVerified"
     FROM user_emails
     WHERE user_id = $1 AND email_normalized = $2
     LIMIT 1`,
    [userId, normalizedEmail]
  );
  if (!rows.length || !rows[0].isVerified) {
    const err = new Error('Email must be linked and verified before it can be set as primary');
    (err as any).code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }
  await p.query(`UPDATE user_emails SET is_primary = (email_normalized = $2) WHERE user_id = $1`, [userId, normalizedEmail]);
  await p.query(`UPDATE users SET email = $2, email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, [
    userId,
    normalizedEmail,
  ]);
  await p.query(`UPDATE web_users SET email = $2 WHERE id = $1`, [userId, normalizedEmail]);
  return listUserEmails(userId);
};

export const removeUserEmail = async (userId: string, email: string): Promise<AccountEmail[]> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  const { rows } = await p.query<{ isPrimary: boolean }>(
    `SELECT is_primary as "isPrimary"
     FROM user_emails
     WHERE user_id = $1 AND email_normalized = $2
     LIMIT 1`,
    [userId, normalizedEmail]
  );
  if (!rows.length) {
    const err = new Error('Email not found on this account');
    (err as any).code = 'EMAIL_NOT_FOUND';
    throw err;
  }
  if (rows[0].isPrimary) {
    const err = new Error('Primary email cannot be deleted');
    (err as any).code = 'PRIMARY_EMAIL_IMMUTABLE';
    throw err;
  }
  const verifiedRemaining = await p.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM user_emails
     WHERE user_id = $1 AND is_verified = TRUE AND email_normalized <> $2`,
    [userId, normalizedEmail]
  );
  if (Number(verifiedRemaining.rows[0]?.count ?? 0) < 1) {
    const err = new Error('At least one verified email must remain on the account');
    (err as any).code = 'LAST_VERIFIED_EMAIL_REQUIRED';
    throw err;
  }
  await p.query(`DELETE FROM user_email_verifications WHERE user_id = $1 AND email_normalized = $2 AND used_at IS NULL`, [userId, normalizedEmail]);
  await p.query(`DELETE FROM user_emails WHERE user_id = $1 AND email_normalized = $2`, [userId, normalizedEmail]);
  return listUserEmails(userId);
};

export const deleteUserRecord = async (userId: string): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM web_users WHERE id = $1`, [userId]);
  await p.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

export const getWebUserProfile = async (
  userId: string
): Promise<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  homeAddress?: string | null;
  preferredAirport?: string | null;
  mapPreference?: 'google' | 'apple' | 'waze' | null;
  appearancePreference?: 'light' | 'dark' | 'auto' | null;
  temperatureUnit?: 'fahrenheit' | 'celsius' | null;
} | null> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    home_address: string | null;
    preferred_airport: string | null;
    map_preference: string | null;
    appearance_preference: string | null;
    temperature_unit: string | null;
  }>(
    `SELECT id, email, first_name, last_name, home_address, preferred_airport, map_preference, appearance_preference, temperature_unit FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (rows.length) {
    const row = rows[0];
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      homeAddress: row.home_address ?? null,
      preferredAirport: row.preferred_airport ?? null,
      mapPreference: row.map_preference === 'google' || row.map_preference === 'apple' || row.map_preference === 'waze' ? row.map_preference : null,
      appearancePreference: row.appearance_preference === 'light' || row.appearance_preference === 'dark' || row.appearance_preference === 'auto' ? row.appearance_preference : null,
      temperatureUnit: row.temperature_unit === 'fahrenheit' || row.temperature_unit === 'celsius' ? row.temperature_unit : null,
    };
  }

  const { rows: userRows } = await p.query<{ id: string; email: string; first_name: string; last_name: string }>(
    `SELECT id, email, first_name, last_name FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (userRows.length) {
    const row = userRows[0];
    return { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name };
  }

  return null;
};

export const updateWebUserProfile = async (
  userId: string,
  updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
    homeAddress?: string;
    preferredAirport?: string;
    mapPreference?: string;
    appearancePreference?: string;
    temperatureUnit?: string;
  }
): Promise<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  homeAddress?: string | null;
  preferredAirport?: string | null;
  mapPreference?: 'google' | 'apple' | 'waze' | null;
  appearancePreference?: 'light' | 'dark' | 'auto' | null;
  temperatureUnit?: 'fahrenheit' | 'celsius' | null;
}> => {
  const p = getPool();
  const client = await p.connect();
  const normalizedEmailUpdate = updates.email ? normalizeEmail(updates.email) : null;
  try {
    await client.query('BEGIN');
    if (normalizedEmailUpdate) {
      const emailInUse = await client.query<{ userId: string }>(
        `SELECT user_id as "userId"
         FROM user_emails
         WHERE email_normalized = $1
         LIMIT 1`,
        [normalizedEmailUpdate]
      );
      if (emailInUse.rowCount && emailInUse.rows[0].userId !== userId) {
        const err = new Error('Email already in use');
        (err as any).code = 'EMAIL_TAKEN';
        throw err;
      }
      const linked = await client.query<{ isVerified: boolean }>(
        `SELECT is_verified as "isVerified"
         FROM user_emails
         WHERE user_id = $1 AND email_normalized = $2
         LIMIT 1`,
        [userId, normalizedEmailUpdate]
      );
      if (!linked.rowCount || !linked.rows[0].isVerified) {
        const err = new Error('Email must be linked and verified before setting it as primary');
        (err as any).code = 'EMAIL_NOT_VERIFIED';
        throw err;
      }
    }

    const normalizedMapPreference =
      updates.mapPreference === 'google' || updates.mapPreference === 'apple' || updates.mapPreference === 'waze'
        ? updates.mapPreference
        : null;
    const normalizedAppearancePreference =
      updates.appearancePreference === 'light' || updates.appearancePreference === 'dark' || updates.appearancePreference === 'auto'
        ? updates.appearancePreference
        : null;
    const normalizedTemperatureUnit =
      updates.temperatureUnit === 'fahrenheit' || updates.temperatureUnit === 'celsius'
        ? updates.temperatureUnit
        : null;

    const { rows } = await client.query(
      `
      UPDATE web_users
      SET
        first_name = COALESCE($2, first_name),
        last_name = COALESCE($3, last_name),
        home_address = CASE WHEN $4::text IS NULL THEN home_address ELSE NULLIF($4::text, '') END,
        preferred_airport = CASE WHEN $5::text IS NULL THEN preferred_airport ELSE NULLIF($5::text, '') END,
        map_preference = CASE WHEN $6::text IS NULL THEN map_preference ELSE NULLIF($6::text, '') END,
        appearance_preference = CASE WHEN $7::text IS NULL THEN appearance_preference ELSE NULLIF($7::text, '') END,
        temperature_unit = CASE WHEN $8::text IS NULL THEN temperature_unit ELSE NULLIF($8::text, '') END
      WHERE id = $1
      RETURNING
        id,
        email,
        first_name as "firstName",
        last_name as "lastName",
        home_address as "homeAddress",
        preferred_airport as "preferredAirport",
        map_preference as "mapPreference",
        appearance_preference as "appearancePreference",
        temperature_unit as "temperatureUnit"
    `,
      [
        userId,
        updates.firstName ?? null,
        updates.lastName ?? null,
        typeof updates.homeAddress === 'string' ? updates.homeAddress.trim() : null,
        typeof updates.preferredAirport === 'string' ? updates.preferredAirport.trim() : null,
        normalizedMapPreference,
        normalizedAppearancePreference,
        normalizedTemperatureUnit,
      ]
    );

    if (!rows.length) {
      throw new Error('User not found');
    }

    if (normalizedEmailUpdate) {
      await client.query(`UPDATE user_emails SET is_primary = (email_normalized = $2) WHERE user_id = $1`, [userId, normalizedEmailUpdate]);
      await client.query(`UPDATE users SET email = $2, email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, [
        userId,
        normalizedEmailUpdate,
      ]);
      await client.query(`UPDATE web_users SET email = $2 WHERE id = $1`, [userId, normalizedEmailUpdate]);
      rows[0].email = normalizedEmailUpdate;
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const updateWebUserPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query<{
    password_hash: string;
    salt: string;
  }>(
    `SELECT password_hash, salt
     FROM web_users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  if (!rows.length) {
    throw new Error('User not found');
  }
  const { password_hash, salt } = rows[0];
  const expected = Buffer.from(password_hash, 'hex');
  const provided = Buffer.from(hashPassword(currentPassword, salt), 'hex');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    const err = new Error('Invalid current password');
    (err as any).code = 'INVALID_PASSWORD';
    throw err;
  }

  const newSalt = randomBytes(16).toString('hex');
  const newHash = hashPassword(newPassword, newSalt);
  await p.query(`UPDATE web_users SET password_hash = $1, salt = $2, password_setup_required = FALSE WHERE id = $3`, [newHash, newSalt, userId]);
};

export const setInitialWebUserPassword = async (userId: string, newPassword: string): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query<{ passwordSetupRequired: boolean }>(
    `SELECT password_setup_required as "passwordSetupRequired" FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (!rows.length) {
    throw new Error('User not found');
  }
  if (!rows[0].passwordSetupRequired) {
    const err = new Error('Initial password setup is not required');
    (err as any).code = 'PASSWORD_SETUP_NOT_REQUIRED';
    throw err;
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  await p.query(
    `UPDATE web_users
     SET password_hash = $1, salt = $2, password_setup_required = FALSE
     WHERE id = $3`,
    [passwordHash, salt, userId]
  );
};

export const isPasswordSetupRequired = async (userId: string): Promise<boolean> => {
  const p = getPool();
  const { rows } = await p.query<{ passwordSetupRequired: boolean }>(
    `SELECT password_setup_required as "passwordSetupRequired" FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return Boolean(rows[0]?.passwordSetupRequired);
};

export const deleteWebUserAndCleanup = async (userId: string): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Move ownership to another member for shared groups; solo groups will be deleted via cascade when the user is removed.
    const { rows: ownedGroups } = await client.query<{ id: string }>(
      `
      SELECT id
      FROM groups
      WHERE owner_id = $1
    `,
      [userId]
    );
    for (const g of ownedGroups) {
      const { rows } = await client.query<{ userId: string }>(
        `
        SELECT user_id as "userId"
        FROM group_members
        WHERE group_id = $1 AND user_id IS NOT NULL AND user_id <> $2
        ORDER BY created_at ASC
        LIMIT 1
      `,
        [g.id, userId]
      );
      const newOwner = rows[0]?.userId ?? null;
      if (newOwner) {
        await client.query(`UPDATE groups SET owner_id = $2 WHERE id = $1`, [g.id, newOwner]);
      }
    }

    // Ensure memberships added by this user are retained by reassigning added_by to the new owner (or the member themself).
    const { rows: membershipsAddedByUser } = await client.query<{
      groupId: string;
      userId: string | null;
      addedBy: string | null;
    }>(
      `
      SELECT group_id as "groupId", user_id as "userId", added_by as "addedBy"
      FROM group_members
      WHERE added_by = $1
    `,
      [userId]
    );
    for (const membership of membershipsAddedByUser) {
      const { rows } = await client.query<{ ownerId: string | null }>(
        `SELECT owner_id as "ownerId" FROM groups WHERE id = $1 LIMIT 1`,
        [membership.groupId]
      );
      const nextAddedBy = rows[0]?.ownerId ?? membership.userId ?? membership.addedBy;
      if (nextAddedBy && nextAddedBy !== membership.addedBy) {
        await client.query(
          `
          UPDATE group_members
          SET added_by = $3
          WHERE group_id = $1 AND (
            (user_id = $2) OR
            (user_id IS NULL AND $2 IS NULL)
          )
        `,
          [membership.groupId, membership.userId, nextAddedBy]
        );
      }
    }

    // Trips where this user is the only non-guest member should be removed entirely.
    const { rows: memberGroups } = await client.query<{ groupId: string }>(
      `SELECT group_id as "groupId" FROM group_members WHERE user_id = $1`,
      [userId]
    );
    const tripIds: string[] = [];
    for (const membership of memberGroups) {
      const { rows: otherMembers } = await client.query<{ count: string }>(
        `
        SELECT COUNT(*)::text as "count"
        FROM group_members
        WHERE group_id = $1
          AND user_id IS NOT NULL
          AND user_id <> $2
      `,
        [membership.groupId, userId]
      );
      if (Number(otherMembers[0]?.count ?? '0') > 0) {
        continue;
      }
      const { rows: groupTrips } = await client.query<{ id: string }>(
        `SELECT id FROM trips WHERE group_id = $1`,
        [membership.groupId]
      );
      tripIds.push(...groupTrips.map((trip) => trip.id));
    }
    if (tripIds.length) {
      await client.query(`DELETE FROM flights WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
      await client.query(`DELETE FROM lodgings WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
      await client.query(`DELETE FROM tours WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
      await client.query(`DELETE FROM itineraries WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
      await client.query(`DELETE FROM trips WHERE id = ANY($1::uuid[])`, [tripIds]);
    }

    await client.query(`DELETE FROM fellow_travelers WHERE owner_id = $1`, [userId]);

    // Remove auth rows last so cascades clean up related data.
    await client.query(`DELETE FROM web_users WHERE id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


// Insert a new flight row, normalizing airport codes and returning the created flight.
export const insertFlight = async (
  flight: Omit<Flight, 'id' | 'sharedWith'>
): Promise<Flight> => {
  const p = getPool();

  const normalizeCode = (code?: string | null) => (code ? code.toUpperCase() : null);
  const departureCode = normalizeCode(flight.departureLocation ?? flight.departureAirportCode);
  const arrivalCode = normalizeCode(flight.arrivalLocation ?? flight.arrivalAirportCode);
  const layoverCode = normalizeCode(flight.layoverLocation ?? flight.layoverLocationCode);


  const id = randomUUID();
  const query = `INSERT INTO flights (
    id, user_id, trip_id, status, transfer_type, passenger_name, passenger_ids, departure_date, departure_location, departure_airport_code, departure_time,
    arrival_location, arrival_airport_code, layover_location, layover_location_code, layover_duration,
    arrival_date, arrival_time, cost, carrier, flight_number, booking_reference, paid_by
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
  RETURNING
    id,
    user_id as "userId",
    trip_id as "tripId",
    status,
    transfer_type as "transferType",
    passenger_name as "passengerName",
    passenger_ids,
    departure_date as "departureDate",
    departure_location as "departureLocation",
    departure_airport_code as "departureAirportCode",
    departure_time as "departureTime",
    arrival_location as "arrivalLocation",
    arrival_airport_code as "arrivalAirportCode",
    layover_location as "layoverLocation",
    layover_location_code as "layoverLocationCode",
    layover_duration as "layoverDuration",
    arrival_date as "arrivalDate",
    arrival_time as "arrivalTime",
    cost,
    carrier,
    flight_number as "flightNumber",
    booking_reference as "bookingReference",
    paid_by`;


  const values = [
    id,
    flight.userId,
    flight.tripId,
    flight.status,
    (flight as any).transferType ?? 'Flight',
    flight.passengerName,
    JSON.stringify(flight.passengerIds ?? []),
    flight.departureDate,
    departureCode,
    departureCode,
    flight.departureTime,
    arrivalCode,
    arrivalCode,
    layoverCode,
    layoverCode,
    flight.layoverDuration ?? null,
    flight.arrivalDate ?? flight.departureDate,
    flight.arrivalTime,
    flight.cost,
    flight.carrier,
    flight.flightNumber,
    flight.bookingReference,
    JSON.stringify(flight.paidBy ?? []),
  ];

  const { rows } = await p.query<Flight>(query, values);
  const row = rows[0] as any;
  return {
    ...(row as Flight),
    paidBy: Array.isArray(row.paid_by) ? row.paid_by : [],
    passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [],
    passengerName: (row as any).passengerName ?? row.passenger_name ?? flight.passengerName,
    arrivalDate: (row as any).arrivalDate ?? row.arrival_date ?? flight.arrivalDate ?? flight.departureDate,
  };
};


export const deleteFlight = async (flightId: string, userId: string): Promise<void> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    const { rows } = await p.query(
      `
        SELECT f.id
        FROM flights f
        JOIN trips t ON t.id = f.trip_id
        JOIN group_members gm ON gm.group_id = t.group_id
        WHERE f.id = $1
          AND gm.user_id = $2
      `,
      [flightId, userId]
    );
    if (!rows.length) return;
    await p.query(
      `
        DELETE FROM flights
        WHERE id = $1
      `,
      [flightId]
    );
    return;
  }
  await p.query(
    `
      DELETE FROM flights f
      USING trips t
      WHERE f.id = $1
        AND t.id = f.trip_id
        -- allow deletion by any member of the trip's group
        AND EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $2
        )
    `,
    [flightId, userId]
  );
};

export const updateFlight = async (
  flightId: string,
  userId: string,
  updates: Partial<Flight>
): Promise<Flight> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  const normalizeCode = (code?: string | null) => (code ? code.toUpperCase() : null);
  const departureCode = normalizeCode(updates.departureLocation ?? updates.departureAirportCode);
  const arrivalCode = normalizeCode(updates.arrivalLocation ?? updates.arrivalAirportCode);
  const layoverCode = normalizeCode(updates.layoverLocation ?? updates.layoverLocationCode);
  const safePaidBy = Array.isArray(updates.paidBy) ? updates.paidBy.filter(Boolean) : null;
  const normalizedPassengerIds = Array.isArray(updates.passengerIds)
    ? updates.passengerIds.map((id: any) => String(id))
    : null;

  if (useInMemory) {
    const { rows } = await p.query(
      `UPDATE flights
       SET passenger_name = COALESCE($1, passenger_name),
           status = COALESCE($2, status),
           transfer_type = COALESCE($3, transfer_type),
           departure_date = COALESCE($4, departure_date),
           departure_location = COALESCE($5, departure_location),
           departure_airport_code = COALESCE($6, departure_airport_code),
           departure_time = COALESCE($7, departure_time),
           arrival_location = COALESCE($8, arrival_location),
           arrival_airport_code = COALESCE($9, arrival_airport_code),
           layover_location = COALESCE($10, layover_location),
           layover_location_code = COALESCE($11, layover_location_code),
           layover_duration = COALESCE($12, layover_duration),
           arrival_date = COALESCE($13, arrival_date),
           arrival_time = COALESCE($14, arrival_time),
           cost = COALESCE($15, cost),
           carrier = COALESCE($16, carrier),
           flight_number = COALESCE($17, flight_number),
           booking_reference = COALESCE($18, booking_reference),
           paid_by = COALESCE($19::jsonb, paid_by),
           passenger_ids = COALESCE($20::jsonb, passenger_ids)
      WHERE id = $21 AND user_id = $22
      RETURNING *`,
      [
        updates.passengerName ?? null,
        updates.status ?? null,
        (updates as any).transferType ?? null,
        updates.departureDate ?? null,
        departureCode,
        departureCode,
        updates.departureTime ?? null,
        arrivalCode,
        arrivalCode,
        layoverCode,
        layoverCode,
        updates.layoverDuration ?? null,
        updates.arrivalDate ?? null,
        updates.arrivalTime ?? null,
        typeof updates.cost === 'number' ? updates.cost : null,
        updates.carrier ?? null,
        updates.flightNumber ?? null,
        updates.bookingReference ?? null,
        Array.isArray(updates.paidBy) ? JSON.stringify(safePaidBy ?? []) : null,
        normalizedPassengerIds ? JSON.stringify(normalizedPassengerIds) : null,
        flightId,
        userId,
      ]
    );
    if (!rows.length) throw new Error('Flight not found');
    const row = rows[0] as any;
    const tripId = row.tripId ?? row.trip_id ?? updates.tripId ?? null;
    return {
      ...(row as Flight),
      tripId,
      departureDate: (row as any).departureDate ?? row.departure_date ?? updates.departureDate ?? null,
      paidBy: Array.isArray(row.paid_by) ? row.paid_by : [],
      passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [],
      passengerName: (row as any).passengerName ?? row.passenger_name,
      arrivalDate: (row as any).arrivalDate ?? row.arrival_date ?? updates.arrivalDate ?? null,
    };
  }

  const { rows } = await p.query<Flight>(
    `UPDATE flights f
     SET passenger_name = COALESCE($1, f.passenger_name),
         status = COALESCE($2, f.status),
         transfer_type = COALESCE($3, f.transfer_type),
         departure_date = COALESCE($4, f.departure_date),
         departure_location = COALESCE($5, f.departure_location),
         departure_airport_code = COALESCE($6, f.departure_airport_code),
         departure_time = COALESCE($7, f.departure_time),
         arrival_location = COALESCE($8, f.arrival_location),
         arrival_airport_code = COALESCE($9, f.arrival_airport_code),
         layover_location = COALESCE($10, f.layover_location),
         layover_location_code = COALESCE($11, f.layover_location_code),
         layover_duration = COALESCE($12, f.layover_duration),
         arrival_date = COALESCE($13, f.arrival_date),
         arrival_time = COALESCE($14, f.arrival_time),
         cost = COALESCE($15, f.cost),
         carrier = COALESCE($16, f.carrier),
         flight_number = COALESCE($17, f.flight_number),
         booking_reference = COALESCE($18, f.booking_reference),
         paid_by = COALESCE($19::jsonb, f.paid_by),
         passenger_ids = COALESCE($20::jsonb, f.passenger_ids)
    FROM trips t
    WHERE f.id = $21
      AND t.id = f.trip_id
      -- allow edits by any member of the trip's group
      AND t.group_id IN (SELECT group_id FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $22)
    RETURNING f.*`,
    [
      updates.passengerName,
      updates.status ?? null,
      (updates as any).transferType ?? null,
      updates.departureDate,
      departureCode,
      departureCode,
      updates.departureTime,
      arrivalCode,
      arrivalCode,
      layoverCode,
      layoverCode,
      updates.layoverDuration ?? null,
      updates.arrivalDate ?? null,
      updates.arrivalTime ?? null,
      typeof updates.cost === 'number' ? updates.cost : null,
      updates.carrier ?? null,
      updates.flightNumber ?? null,
      updates.bookingReference ?? null,
      Array.isArray(updates.paidBy) ? JSON.stringify(safePaidBy ?? []) : null,
      normalizedPassengerIds ? JSON.stringify(normalizedPassengerIds) : null,
      flightId,
      userId,
    ]
  );
  if (!rows.length) throw new Error('Flight not found');
  const row = rows[0] as any;
  const tripId = row.tripId ?? row.trip_id ?? updates.tripId ?? null;
  return {
    ...(row as Flight),
    tripId,
    departureDate: (row as any).departureDate ?? row.departure_date ?? updates.departureDate ?? null,
    paidBy: Array.isArray(row.paid_by) ? row.paid_by : [],
    passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [],
    passengerName: (row as any).passengerName ?? row.passenger_name,
    arrivalDate: (row as any).arrivalDate ?? row.arrival_date ?? updates.arrivalDate ?? null,
  };
};

export const ensureUserInTrip = async (tripId: string, userId: string): Promise<{ groupId: string } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ groupId: string }>(
    `SELECT t.group_id as "groupId"
     FROM trips t
     JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = $2 AND gm.removed_at IS NULL
     WHERE t.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM trip_removals tr WHERE tr.trip_id = $1 AND tr.user_id = $2
       )`,
    [tripId, userId]
  );
  return rows[0] ?? null;
};

export const ensureUserCanReadTrip = async (
  tripId: string,
  userId: string
): Promise<{ groupId: string; access: 'member' | 'follower' } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ groupId: string; access: 'member' | 'follower' }>(
    `SELECT t.group_id as "groupId", 'member'::text as "access"
     FROM trips t
     JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = $2 AND gm.removed_at IS NULL
     WHERE t.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM trip_removals tr WHERE tr.trip_id = $1 AND tr.user_id = $2
       )
     UNION
     SELECT t.group_id as "groupId", 'follower'::text as "access"
     FROM trips t
     JOIN trip_followers tf ON tf.trip_id = t.id AND tf.follower_user_id = $2
     WHERE t.id = $1
     LIMIT 1`,
    [tripId, userId]
  );
  return rows[0] ?? null;
};

export const writeActivity = async (
  tripId: string,
  actorUserId: string | null,
  type: TripActivityType,
  title: string,
  summary: string,
  metadata: Record<string, any> = {}
): Promise<TripActivity> => {
  if (!TRIP_ACTIVITY_TYPES.includes(type)) {
    throw new Error(`Unsupported activity type: ${type}`);
  }
  const p = getPool();
  const { rows } = await p.query<TripActivity>(
    `INSERT INTO trip_activity (id, trip_id, actor_user_id, type, title, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id,
               trip_id as "tripId",
               actor_user_id as "actorUserId",
               type,
               title,
               summary,
               metadata,
               created_at as "createdAt"`,
    [randomUUID(), tripId, actorUserId, type, title.trim(), summary.trim(), JSON.stringify(metadata ?? {})]
  );
  return rows[0];
};

export const listTripActivity = async (
  tripId: string,
  options?: { limit?: number; cursor?: { createdAt: string; id: string } | null }
): Promise<{ events: TripActivity[]; nextCursor: string | null }> => {
  const p = getPool();
  const limit = Math.min(Math.max(Number(options?.limit ?? 20), 1), 100);
  const cursorCreatedAt = options?.cursor?.createdAt ?? null;
  const cursorId = options?.cursor?.id ?? null;
  const { rows } = await p.query<TripActivity>(
    `SELECT id,
            trip_id as "tripId",
            actor_user_id as "actorUserId",
            type,
            title,
            summary,
            metadata,
            created_at as "createdAt"
     FROM trip_activity
     WHERE trip_id = $1
       AND (
         $2::timestamp IS NULL
         OR created_at < $2::timestamp
         OR (created_at = $2::timestamp AND id < $3)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [tripId, cursorCreatedAt, cursorId, limit + 1]
  );

  const hasNext = rows.length > limit;
  const events = hasNext ? rows.slice(0, limit) : rows;
  const last = events[events.length - 1];
  const nextCursor = hasNext && last ? `${new Date(last.createdAt).toISOString()}::${last.id}` : null;
  return { events, nextCursor };
};

export const listTripComments = async (tripId: string): Promise<TripComment[]> => {
  const p = getPool();
  const { rows } = await p.query<TripComment>(
    `SELECT c.id,
            c.trip_id as "tripId",
            c.actor_user_id as "actorUserId",
            c.body,
            c.created_at as "createdAt",
            CASE
              WHEN COALESCE(wu.first_name, '') <> '' OR COALESCE(wu.last_name, '') <> ''
                THEN CONCAT(COALESCE(wu.first_name, ''), CASE WHEN COALESCE(wu.last_name, '') <> '' THEN CONCAT(' ', wu.last_name) ELSE '' END)
              ELSE u.email
            END as "authorName",
            u.email as "authorEmail"
     FROM trip_comments c
     JOIN users u ON u.id = c.actor_user_id
     LEFT JOIN web_users wu ON wu.id = c.actor_user_id
     WHERE c.trip_id = $1
     ORDER BY c.created_at ASC, c.id ASC`,
    [tripId]
  );
  return rows;
};

export const addTripComment = async (
  tripId: string,
  actorUserId: string,
  body: string
): Promise<TripComment> => {
  const p = getPool();
  const text = String(body ?? '').trim();
  if (!text) throw new Error('Comment body is required');
  const { rows } = await p.query<TripComment>(
    `INSERT INTO trip_comments (id, trip_id, actor_user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id,
               trip_id as "tripId",
               actor_user_id as "actorUserId",
               body,
               created_at as "createdAt"`,
    [randomUUID(), tripId, actorUserId, text]
  );
  const created = rows[0];
  const withAuthor = await listTripComments(tripId);
  return withAuthor.find((comment) => comment.id === created.id) ?? created;
};

export const getTripFollowCode = async (
  userId: string,
  tripId: string
): Promise<{ id: string; tripId: string; code: string; status: string; createdAt: string }> => {
  const p = getPool();
  const owner = await p.query(
    `SELECT 1
     FROM trips t
     JOIN groups g ON g.id = t.group_id
     WHERE t.id = $1 AND g.owner_id = $2
     LIMIT 1`,
    [tripId, userId]
  );
  if (!owner.rowCount) throw new Error('Not authorized to manage follow codes');

  const existing = await p.query<{ id: string; tripId: string; code: string; status: string; createdAt: string }>(
    `SELECT id,
            trip_id as "tripId",
            code,
            status,
            created_at as "createdAt"
     FROM follow_codes
     WHERE trip_id = $1
       AND status = 'active'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW()::timestamp)
     ORDER BY created_at DESC
     LIMIT 1`,
    [tripId]
  );
  if (existing.rowCount) return existing.rows[0];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateFollowCode();
    const id = randomUUID();
    try {
      const { rows } = await p.query<{ id: string; tripId: string; code: string; status: string; createdAt: string }>(
        `INSERT INTO follow_codes (id, trip_id, code, status, created_by)
         VALUES ($1, $2, $3, 'active', $4)
         RETURNING id,
                   trip_id as "tripId",
                   code,
                   status,
                   created_at as "createdAt"`,
        [id, tripId, code, userId]
      );
      return rows[0];
    } catch (err: any) {
      if (String(err?.code) !== '23505') throw err;
    }
  }

  throw new Error('Unable to create follow code. Try again.');
};

export const followTripByCode = async (
  userId: string,
  inviteCode: string
): Promise<{ trip: { id: string; name: string; destination?: string | null }; inviterName: string | null; alreadyFollowing: boolean }> => {
  const p = getPool();
  const code = String(inviteCode ?? '').trim().toUpperCase();
  if (!code) throw new Error('inviteCode is required');

  const codeRow = await p.query<{
    id: string;
    tripId: string;
    maxUses: number | null;
    usesCount: number;
  }>(
    `SELECT id,
            trip_id as "tripId",
            max_uses as "maxUses",
            uses_count as "usesCount"
     FROM follow_codes
     WHERE code = $1
       AND status = 'active'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW()::timestamp)
     LIMIT 1`,
    [code]
  );
  if (!codeRow.rowCount) throw new Error('Invalid or expired follow code');

  const followCode = codeRow.rows[0];
  const inserted = await p.query(
    `INSERT INTO trip_followers (id, trip_id, follower_user_id, follow_code_id, role)
     VALUES ($1, $2, $3, $4, 'follower')
     ON CONFLICT (trip_id, follower_user_id) DO NOTHING`,
    [randomUUID(), followCode.tripId, userId, followCode.id]
  );
  const alreadyFollowing = !inserted.rowCount;

  if (!alreadyFollowing) {
    await p.query(
      `UPDATE follow_codes
       SET uses_count = uses_count + 1
       WHERE id = $1
         AND (max_uses IS NULL OR uses_count < max_uses)`,
      [followCode.id]
    );
  }

  const tripRow = await p.query<{ id: string; name: string; destination: string | null; inviterName: string | null }>(
    `SELECT t.id,
            t.name,
            t.destination,
            CASE
              WHEN COALESCE(wu.first_name, '') <> '' OR COALESCE(wu.last_name, '') <> ''
                THEN CONCAT(COALESCE(wu.first_name, ''), CASE WHEN COALESCE(wu.last_name, '') <> '' THEN CONCAT(' ', wu.last_name) ELSE '' END)
              ELSE u.email
            END as "inviterName"
     FROM trips t
     JOIN groups g ON g.id = t.group_id
     JOIN users u ON u.id = g.owner_id
     LEFT JOIN web_users wu ON wu.id = g.owner_id
     WHERE t.id = $1
     LIMIT 1`,
    [followCode.tripId]
  );
  if (!tripRow.rowCount) throw new Error('Trip not found');

  if (!alreadyFollowing) {
    await writeActivity(
      followCode.tripId,
      userId,
      'FOLLOW_ADDED',
      'New follower',
      'A user started following this trip.',
      { inviteCode: code, followerUserId: userId }
    );
  }

  return {
    trip: {
      id: tripRow.rows[0].id,
      name: tripRow.rows[0].name,
      destination: tripRow.rows[0].destination,
    },
    inviterName: tripRow.rows[0].inviterName,
    alreadyFollowing,
  };
};

export const listFollowedTrips = async (
  userId: string
): Promise<Array<{ tripId: string; tripName: string; destination?: string | null; inviterName?: string | null }>> => {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT t.id as "tripId",
            t.name as "tripName",
            t.destination,
            CASE
              WHEN COALESCE(wu.first_name, '') <> '' OR COALESCE(wu.last_name, '') <> ''
                THEN CONCAT(COALESCE(wu.first_name, ''), CASE WHEN COALESCE(wu.last_name, '') <> '' THEN CONCAT(' ', wu.last_name) ELSE '' END)
              ELSE u.email
            END as "inviterName"
     FROM trip_followers tf
     JOIN trips t ON t.id = tf.trip_id
     JOIN groups g ON g.id = t.group_id
     JOIN users u ON u.id = g.owner_id
     LEFT JOIN web_users wu ON wu.id = g.owner_id
     WHERE tf.follower_user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.group_id = t.group_id AND gm.user_id = $1 AND gm.removed_at IS NULL
       )
     ORDER BY tf.created_at DESC`,
    [userId]
  );
  return rows as Array<{ tripId: string; tripName: string; destination?: string | null; inviterName?: string | null }>;
};

export const unfollowTrip = async (userId: string, tripId: string): Promise<void> => {
  const p = getPool();
  const removed = await p.query(`DELETE FROM trip_followers WHERE trip_id = $1 AND follower_user_id = $2`, [tripId, userId]);
  if (removed.rowCount) {
    await writeActivity(
      tripId,
      userId,
      'FOLLOW_REMOVED',
      'Follower left',
      'A user unfollowed this trip.',
      { followerUserId: userId }
    );
  }
};

const getTripOwnerContext = async (
  client: Pool | PoolClient,
  tripId: string,
  userId: string
): Promise<{ tripId: string; groupId: string } | null> => {
  const { rows } = await client.query<{ tripId: string; groupId: string }>(
    `SELECT t.id as "tripId", t.group_id as "groupId"
     FROM trips t
     JOIN groups g ON g.id = t.group_id
     WHERE t.id = $1 AND g.owner_id = $2
     LIMIT 1`,
    [tripId, userId]
  );
  return rows[0] ?? null;
};

export const listTripShareInvites = async (
  userId: string,
  tripId: string
): Promise<
  Array<{
    id: string;
    tripId: string;
    inviteeEmail: string;
    inviteeUserId: string | null;
    role: 'member' | 'follower';
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    expiresAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>
> => {
  const p = getPool();
  const context = await getTripOwnerContext(p, tripId, userId);
  if (!context) throw new Error('Not authorized to manage trip sharing');
  const { rows } = await p.query<{
    id: string;
    tripId: string;
    inviteeEmail: string;
    inviteeUserId: string | null;
    role: 'member' | 'follower';
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    expiresAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT id,
            trip_id as "tripId",
            invitee_email as "inviteeEmail",
            invitee_user_id as "inviteeUserId",
            role,
            status,
            expires_at as "expiresAt",
            accepted_at as "acceptedAt",
            created_at as "createdAt",
            updated_at as "updatedAt"
     FROM trip_share_invites
     WHERE trip_id = $1
     ORDER BY created_at DESC`,
    [tripId]
  );
  return rows;
};

export const createTripShareInvite = async (
  inviterId: string,
  tripId: string,
  inviteeEmailRaw: string,
  role: 'member' | 'follower',
  expiresInDays = 14
): Promise<{
  invite: {
    id: string;
    tripId: string;
    inviteeEmail: string;
    inviteeUserId: string | null;
    role: 'member' | 'follower';
    status: 'pending' | 'accepted';
    createdAt: string;
  };
  token?: string;
  autoApplied: boolean;
}> => {
  const p = getPool();
  const email = normalizeEmail(inviteeEmailRaw);
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const context = await getTripOwnerContext(client, tripId, inviterId);
    if (!context) throw new Error('Not authorized to manage trip sharing');

    const duplicate = await client.query<{
      id: string;
      tripId: string;
      inviteeEmail: string;
      inviteeUserId: string | null;
      role: 'member' | 'follower';
      status: 'pending' | 'accepted';
      createdAt: string;
    }>(
      `SELECT id,
              trip_id as "tripId",
              invitee_email as "inviteeEmail",
              invitee_user_id as "inviteeUserId",
              role,
              status,
              created_at as "createdAt"
       FROM trip_share_invites
       WHERE trip_id = $1
         AND LOWER(invitee_email) = LOWER($2)
         AND role = $3
         AND status = 'pending'
         AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [tripId, email, role]
    );
    if (duplicate.rowCount) {
      await client.query('COMMIT');
      return { invite: duplicate.rows[0], autoApplied: false };
    }

    const userRow = await client.query<{ id: string }>(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    const userId = userRow.rows[0]?.id ?? null;
    const token = generateTripShareToken();
    const tokenHash = hashToken(token);
    const status: 'pending' = 'pending';
    const expiresAt = new Date(Date.now() + Math.max(1, expiresInDays) * 24 * 60 * 60 * 1000);

    const { rows } = await client.query<{
      id: string;
      tripId: string;
      inviteeEmail: string;
      inviteeUserId: string | null;
      role: 'member' | 'follower';
      status: 'pending' | 'accepted';
      createdAt: string;
    }>(
      `INSERT INTO trip_share_invites
       (id, trip_id, group_id, inviter_id, invitee_user_id, invitee_email, role, status, token_hash, expires_at, accepted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NOW())
       RETURNING id,
                 trip_id as "tripId",
                 invitee_email as "inviteeEmail",
                 invitee_user_id as "inviteeUserId",
                 role,
                 status,
                 created_at as "createdAt"`,
      [randomUUID(), tripId, context.groupId, inviterId, userId, email, role, status, tokenHash, expiresAt]
    );

    await client.query('COMMIT');
    return { invite: rows[0], token, autoApplied: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const acceptTripShareInvite = async (
  userId: string,
  emailRaw: string,
  token: string
): Promise<{ tripId: string; role: 'member' | 'follower' }> => {
  const p = getPool();
  const email = normalizeEmail(emailRaw);
  const tokenHash = hashToken(token);
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const inviteRows = await client.query<{
      id: string;
      tripId: string;
      groupId: string;
      inviteeEmail: string;
      role: 'member' | 'follower';
      status: 'pending' | 'accepted' | 'revoked' | 'expired';
      expiresAt: string | null;
    }>(
      `SELECT id,
              trip_id as "tripId",
              group_id as "groupId",
              invitee_email as "inviteeEmail",
              role,
              status,
              expires_at as "expiresAt"
       FROM trip_share_invites
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );
    if (!inviteRows.rowCount) throw new Error('Invite not found');
    const invite = inviteRows.rows[0];
    if (invite.status !== 'pending') throw new Error('Invite is no longer pending');
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
      await client.query(
        `UPDATE trip_share_invites
         SET status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [invite.id]
      );
      await client.query('COMMIT');
      throw new Error('Invite has expired');
    }
    if (normalizeEmail(invite.inviteeEmail) !== email) throw new Error('Invite email does not match this account');

    if (invite.role === 'member') {
      await client.query(
        `INSERT INTO group_members (id, group_id, user_id, added_by)
         SELECT $1, $2, $3, inviter_id
         FROM trip_share_invites
         WHERE id = $4
         ON CONFLICT (group_id, user_id) DO UPDATE
         SET removed_at = NULL`,
        [randomUUID(), invite.groupId, userId, invite.id]
      );
      await client.query(`DELETE FROM trip_followers WHERE trip_id = $1 AND follower_user_id = $2`, [invite.tripId, userId]);
    } else {
      const isMember = await client.query(
        `SELECT 1
         FROM group_members
         WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL
         LIMIT 1`,
        [invite.groupId, userId]
      );
      if (!isMember.rowCount) {
        await client.query(
          `INSERT INTO trip_followers (id, trip_id, follower_user_id, role)
           VALUES ($1, $2, $3, 'follower')
           ON CONFLICT (trip_id, follower_user_id) DO NOTHING`,
          [randomUUID(), invite.tripId, userId]
        );
      }
    }

    await client.query(
      `UPDATE trip_share_invites
       SET status = 'accepted',
           invitee_user_id = $2,
           accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [invite.id, userId]
    );
    if (invite.role === 'member') {
      await mergeUserPackingListIntoTripWithRunner(client, invite.tripId, userId);
    }

    await client.query('COMMIT');
    return { tripId: invite.tripId, role: invite.role };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const listPendingTripShareInvitesForUser = async (
  userId: string,
  emailRaw?: string | null
): Promise<
  Array<{
    id: string;
    tripId: string;
    tripName: string;
    destination?: string | null;
    inviteeEmail: string;
    role: 'member' | 'follower';
    status: 'pending';
    createdAt: string;
    expiresAt: string | null;
    inviterEmail?: string | null;
    inviterFirstName?: string | null;
    inviterLastName?: string | null;
  }>
> => {
  const p = getPool();
  const email = normalizeEmail(emailRaw ?? '');
  const { rows } = await p.query(
    `SELECT tsi.id,
            tsi.trip_id as "tripId",
            t.name as "tripName",
            t.destination,
            tsi.invitee_email as "inviteeEmail",
            tsi.role,
            tsi.status,
            tsi.created_at as "createdAt",
            tsi.expires_at as "expiresAt",
            inviter.email as "inviterEmail",
            wu.first_name as "inviterFirstName",
            wu.last_name as "inviterLastName"
     FROM trip_share_invites tsi
     JOIN trips t ON t.id = tsi.trip_id
     JOIN users inviter ON inviter.id = tsi.inviter_id
     LEFT JOIN web_users wu ON wu.id = tsi.inviter_id
     WHERE tsi.status = 'pending'
       AND tsi.revoked_at IS NULL
       AND (tsi.expires_at IS NULL OR tsi.expires_at > NOW()::timestamp)
       AND (tsi.invitee_user_id = $1 OR ($2 <> '' AND LOWER(tsi.invitee_email) = $2))
     ORDER BY tsi.created_at DESC`,
    [userId, email]
  );
  return rows as Array<{
    id: string;
    tripId: string;
    tripName: string;
    destination?: string | null;
    inviteeEmail: string;
    role: 'member' | 'follower';
    status: 'pending';
    createdAt: string;
    expiresAt: string | null;
    inviterEmail?: string | null;
    inviterFirstName?: string | null;
    inviterLastName?: string | null;
  }>;
};

export const acceptTripShareInviteById = async (
  userId: string,
  emailRaw: string,
  inviteId: string
): Promise<{ tripId: string; role: 'member' | 'follower' }> => {
  const p = getPool();
  const email = normalizeEmail(emailRaw);
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const inviteRows = await client.query<{
      id: string;
      tripId: string;
      groupId: string;
      inviteeEmail: string;
      role: 'member' | 'follower';
      status: 'pending' | 'accepted' | 'revoked' | 'expired';
      expiresAt: string | null;
    }>(
      `SELECT id,
              trip_id as "tripId",
              group_id as "groupId",
              invitee_email as "inviteeEmail",
              role,
              status,
              expires_at as "expiresAt"
       FROM trip_share_invites
       WHERE id = $1
         AND (invitee_user_id = $2 OR LOWER(invitee_email) = LOWER($3))
       LIMIT 1`,
      [inviteId, userId, email]
    );
    if (!inviteRows.rowCount) throw new Error('Invite not found');
    const invite = inviteRows.rows[0];
    if (invite.status !== 'pending') throw new Error('Invite is no longer pending');
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
      await client.query(
        `UPDATE trip_share_invites
         SET status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [invite.id]
      );
      await client.query('COMMIT');
      throw new Error('Invite has expired');
    }
    if (normalizeEmail(invite.inviteeEmail) !== email) throw new Error('Invite email does not match this account');

    if (invite.role === 'member') {
      await client.query(
        `INSERT INTO group_members (id, group_id, user_id, added_by)
         SELECT $1, $2, $3, inviter_id
         FROM trip_share_invites
         WHERE id = $4
         ON CONFLICT (group_id, user_id) DO UPDATE
         SET removed_at = NULL`,
        [randomUUID(), invite.groupId, userId, invite.id]
      );
      await client.query(`DELETE FROM trip_followers WHERE trip_id = $1 AND follower_user_id = $2`, [invite.tripId, userId]);
    } else {
      const isMember = await client.query(
        `SELECT 1
         FROM group_members
         WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL
         LIMIT 1`,
        [invite.groupId, userId]
      );
      if (!isMember.rowCount) {
        await client.query(
          `INSERT INTO trip_followers (id, trip_id, follower_user_id, role)
           VALUES ($1, $2, $3, 'follower')
           ON CONFLICT (trip_id, follower_user_id) DO NOTHING`,
          [randomUUID(), invite.tripId, userId]
        );
      }
    }

    await client.query(
      `UPDATE trip_share_invites
       SET status = 'accepted',
           invitee_user_id = $2,
           accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [invite.id, userId]
    );
    if (invite.role === 'member') {
      await mergeUserPackingListIntoTripWithRunner(client, invite.tripId, userId);
    }

    await client.query('COMMIT');
    return { tripId: invite.tripId, role: invite.role };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const rejectTripShareInvite = async (userId: string, emailRaw: string, inviteId: string): Promise<void> => {
  const p = getPool();
  const email = normalizeEmail(emailRaw);
  const result = await p.query(
    `UPDATE trip_share_invites
     SET status = 'revoked',
         revoked_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending'
       AND revoked_at IS NULL
       AND (invitee_user_id = $2 OR LOWER(invitee_email) = LOWER($3))`,
    [inviteId, userId, email]
  );
  if (!result.rowCount) {
    throw new Error('Invite not found');
  }
};

export const revokeTripShareInvite = async (userId: string, tripId: string, inviteId: string): Promise<void> => {
  const p = getPool();
  const context = await getTripOwnerContext(p, tripId, userId);
  if (!context) throw new Error('Not authorized to manage trip sharing');
  await p.query(
    `UPDATE trip_share_invites
     SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND trip_id = $2 AND status = 'pending'`,
    [inviteId, tripId]
  );
};

export const updateTripDetails = async (
  userId: string,
  tripId: string,
  updates: {
    description?: string | null;
    destination?: string | null;
    locationIds?: string[];
    startDate?: string | null;
    endDate?: string | null;
    startMonth?: number | null;
    startYear?: number | null;
    durationDays?: number | null;
    dateMode?: 'range' | 'month';
    currency?: string | null;
  }
): Promise<Trip> => {
  const p = getPool();
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to update this trip');

  const { rows } = await p.query<Trip>(
    `UPDATE trips
     SET description = COALESCE($1, description),
         destination = COALESCE($2, destination),
         location_ids = COALESCE($3::jsonb, location_ids),
         start_date = CASE WHEN $7 = 'range' THEN $4::date WHEN $7 = 'month' THEN NULL ELSE start_date END,
         end_date = CASE WHEN $7 = 'range' THEN $5::date WHEN $7 = 'month' THEN NULL ELSE end_date END,
         start_month = CASE WHEN $7 = 'month' THEN $8::int WHEN $7 = 'range' THEN NULL ELSE start_month END,
         start_year = CASE WHEN $7 = 'month' THEN $9::int WHEN $7 = 'range' THEN NULL ELSE start_year END,
         duration_days = CASE WHEN $7 = 'month' THEN $10::int WHEN $7 = 'range' THEN NULL ELSE duration_days END,
         currency = COALESCE($11, currency)
     WHERE id = $6
     RETURNING id,
       group_id as "groupId",
       name,
       description,
       destination,
       COALESCE(location_ids, '[]'::jsonb) as "locationIds",
       start_date as "startDate",
       end_date as "endDate",
       start_month as "startMonth",
       start_year as "startYear",
       duration_days as "durationDays",
       currency,
       covered_by as "coveredBy",
       created_at as "createdAt"`,
    [
      updates.description ?? null,
      updates.destination ?? null,
      Array.isArray(updates.locationIds) ? JSON.stringify(updates.locationIds) : null,
      updates.startDate ?? null,
      updates.endDate ?? null,
      tripId,
      updates.dateMode ?? null,
      updates.startMonth ?? null,
      updates.startYear ?? null,
      updates.durationDays ?? null,
      updates.currency ?? null,
    ]
  );
  if (!rows.length) throw new Error('Trip not found');
  return rows[0];
};

export const getTripCovering = async (userId: string, tripId: string): Promise<Record<string, string>> => {
  const p = getPool();
  const membership = await ensureUserCanReadTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to view this trip');
  const { rows } = await p.query<{ coveredBy: Record<string, string> | null }>(
    `SELECT covered_by as "coveredBy" FROM trips WHERE id = $1`,
    [tripId]
  );
  if (!rows.length) throw new Error('Trip not found');
  return rows[0].coveredBy ?? {};
};

export const updateTripCovering = async (
  userId: string,
  tripId: string,
  coveredBy: Record<string, string>
): Promise<Record<string, string>> => {
  const p = getPool();
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to update this trip');
  const { rows } = await p.query<{ coveredBy: Record<string, string> | null }>(
    `UPDATE trips SET covered_by = $1 WHERE id = $2 RETURNING covered_by as "coveredBy"`,
    [coveredBy ?? {}, tripId]
  );
  if (!rows.length) throw new Error('Trip not found');
  return rows[0].coveredBy ?? {};
};

export const getFlightForUser = async (flightId: string, userId: string): Promise<Flight | null> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';

  if (useInMemory) {
    const { rows } = await p.query<Flight>(
      `SELECT id,
              user_id as "userId",
              trip_id as "tripId",
              status,
              transfer_type as "transferType",
              passenger_name as "passengerName",
              COALESCE(passenger_ids, '[]'::jsonb) as passenger_ids,
              departure_date as "departureDate",
              departure_location as "departureLocation",
              departure_airport_code as "departureAirportCode",
              departure_time as "departureTime",
              arrival_location as "arrivalLocation",
              arrival_airport_code as "arrivalAirportCode",
              layover_location as "layoverLocation",
              layover_location_code as "layoverLocationCode",
              layover_duration as "layoverDuration",
              arrival_date as "arrivalDate",
              arrival_time as "arrivalTime",
              cost,
              carrier,
              flight_number as "flightNumber",
              booking_reference as "bookingReference",
              COALESCE(paid_by, '[]'::jsonb) as paid_by
       FROM flights
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [flightId, userId]
    );
    const row = rows[0] as any;
    if (!row) return null;
    return {
      ...(row as any),
      passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [],
      paidBy: Array.isArray(row.paid_by) ? row.paid_by : [],
      arrivalDate: (row as any).arrivalDate ?? row.arrival_date ?? null,
    };
  }

  const { rows } = await p.query<Flight>(
    `SELECT
       f.id,
       f.user_id as "userId",
       f.trip_id as "tripId",
       f.status,
       f.transfer_type as "transferType",
       f.passenger_name as "passengerName",
       f.departure_date as "departureDate",
       f.departure_location as "departureLocation",
       f.departure_airport_code as "departureAirportCode",
       f.departure_time as "departureTime",
       f.arrival_location as "arrivalLocation",
       f.arrival_airport_code as "arrivalAirportCode",
       f.layover_location as "layoverLocation",
       f.layover_location_code as "layoverLocationCode",
       f.layover_duration as "layoverDuration",
       f.arrival_date as "arrivalDate",
       f.arrival_time as "arrivalTime",
       COALESCE(f.passenger_ids, '[]'::jsonb) as passenger_ids,
       f.cost,
       f.carrier,
       f.flight_number as "flightNumber",
       f.booking_reference as "bookingReference",
       CASE
         WHEN apd.iata_code IS NOT NULL THEN
           COALESCE(NULLIF(apd.city, ''), apd.name, apd.iata_code) || ' (' || apd.iata_code || ')'
         ELSE f.departure_location
       END as "departureAirportLabel",
       CASE
         WHEN apa.iata_code IS NOT NULL THEN
           COALESCE(NULLIF(apa.city, ''), apa.name, apa.iata_code) || ' (' || apa.iata_code || ')'
         ELSE f.arrival_location
       END as "arrivalAirportLabel",
       CASE
         WHEN apl.iata_code IS NOT NULL THEN
           COALESCE(NULLIF(apl.city, ''), apl.name, apl.iata_code) || ' (' || apl.iata_code || ')'
         ELSE f.layover_location
       END as "layoverAirportLabel"
     FROM flights f
     LEFT JOIN airports apd ON apd.iata_code = f.departure_location
     LEFT JOIN airports apa ON apa.iata_code = f.arrival_location
     LEFT JOIN airports apl ON apl.iata_code = f.layover_location
     WHERE f.id = $1 AND f.user_id = $2
     LIMIT 1`,
    [flightId, userId]
  );

  const row = rows[0] as any;
  if (!row) return null;
  return {
    ...(row as Flight),
    passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [],
    paidBy: Array.isArray(row.paid_by) ? row.paid_by : [],
    arrivalDate: (row as any).arrivalDate ?? row.arrival_date ?? null,
  };
};

export const getFlightById = async (flightId: string): Promise<Flight | null> => {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT
       f.id,
       f.user_id as "userId",
       f.trip_id as "tripId",
       f.status,
       f.transfer_type as "transferType",
       f.passenger_name as "passengerName",
       COALESCE(f.passenger_ids, '[]'::jsonb) as passenger_ids,
       f.departure_date as "departureDate",
       f.arrival_date as "arrivalDate",
       f.departure_location as "departureLocation",
       f.departure_airport_code as "departureAirportCode",
       f.departure_time as "departureTime",
       f.arrival_location as "arrivalLocation",
       f.arrival_airport_code as "arrivalAirportCode",
       f.layover_location as "layoverLocation",
       f.layover_location_code as "layoverLocationCode",
       f.layover_duration as "layoverDuration",
       f.arrival_time as "arrivalTime",
       f.cost,
       f.carrier,
       f.flight_number as "flightNumber",
       f.booking_reference as "bookingReference",
       COALESCE(f.paid_by, '[]'::jsonb) as "paidBy"
     FROM flights f
     WHERE f.id = $1
     LIMIT 1`,
    [flightId]
  );
  const row = rows[0] as any;
  if (!row) return null;
  return {
    ...(row as Flight),
    passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [],
    paidBy: Array.isArray(row.paidBy) ? row.paidBy : [],
  };
};


export const listFlights = async (userId: string, tripId?: string): Promise<Flight[]> => {
  // Return flights for the given trip that the requesting user can see (anyone in the trip's group).
  const p = getPool();

  if (process.env.USE_IN_MEMORY_DB === '1') {
    const { rows } = await p.query(
      `
      SELECT id,
             user_id as "userId",
             trip_id as "tripId",
             status,
             transfer_type as "transferType",
             passenger_name as "passengerName",
             COALESCE(passenger_ids, '[]'::jsonb) as passenger_ids,
             departure_date as "departureDate",
             arrival_date as "arrivalDate",
             departure_time as "departureTime",
             arrival_time as "arrivalTime",
             carrier,
             flight_number as "flightNumber",
             booking_reference as "bookingReference",
             cost,
             COALESCE(paid_by, '[]'::jsonb) as "paidBy"
      FROM flights
      WHERE ($2::uuid IS NULL OR trip_id = $2)
        AND trip_id IN (
          SELECT t.id
          FROM trips t
          JOIN group_members gm ON gm.group_id = t.group_id
          WHERE gm.user_id = $1
            AND gm.removed_at IS NULL
          UNION
          SELECT tf.trip_id
          FROM trip_followers tf
          WHERE tf.follower_user_id = $1
        )
      ORDER BY departure_date DESC
      `,
      [userId, tripId ?? null]
    );
    return rows as any;
  }

  const { rows } = await p.query<Flight>(
    `SELECT f.*,
      t.group_id as "groupId",
      ARRAY(
        SELECT us.email
        FROM flight_shares fs
        JOIN users us ON fs.user_id = us.id
        WHERE fs.flight_id = f.id
      ) as "sharedWith",
      EXISTS (
        SELECT 1
        FROM group_members gm
        LEFT JOIN users u ON gm.user_id = u.id
        LEFT JOIN web_users wu ON gm.user_id = wu.id
        WHERE gm.group_id = t.group_id
          AND (
            EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(f.passenger_ids, '[]'::jsonb)) pid(val)
              WHERE gm.id = pid.val::uuid
            )
            OR LOWER(gm.guest_name) = LOWER(f.passenger_name)
            OR LOWER(u.email) = LOWER(f.passenger_name)
            OR LOWER(CONCAT(wu.first_name, ' ', wu.last_name)) = LOWER(f.passenger_name)
          )
      ) as "passengerInGroup",
      CASE
        WHEN apd.iata_code IS NOT NULL THEN
          COALESCE(NULLIF(apd.city, ''), apd.name, apd.iata_code) || ' (' || apd.iata_code || ')'
        ELSE f.departure_location
      END as departure_airport_label,
      CASE
        WHEN apa.iata_code IS NOT NULL THEN
          COALESCE(NULLIF(apa.city, ''), apa.name, apa.iata_code) || ' (' || apa.iata_code || ')'
        ELSE f.arrival_location
      END as arrival_airport_label,
      CASE
        WHEN apl.iata_code IS NOT NULL THEN
          COALESCE(NULLIF(apl.city, ''), apl.name, apl.iata_code) || ' (' || apl.iata_code || ')'
        ELSE f.layover_location
      END as layover_airport_label,
      COALESCE(f.paid_by, '[]'::jsonb) as "paidBy",
      COALESCE(f.passenger_ids, '[]'::jsonb) as passenger_ids
     FROM flights f
     JOIN trips t ON f.trip_id = t.id
     LEFT JOIN airports apd ON apd.iata_code = f.departure_location
     LEFT JOIN airports apa ON apa.iata_code = f.arrival_location
     LEFT JOIN airports apl ON apl.iata_code = f.layover_location
     WHERE ($2::uuid IS NULL OR f.trip_id = $2)
       -- authorize by shared trip membership or explicit trip following
       AND (
         EXISTS (
           SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $1 AND gm.removed_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM trip_followers tf WHERE tf.trip_id = t.id AND tf.follower_user_id = $1
         )
       )
     ORDER BY f.departure_date DESC`,
    [userId, tripId ?? null]
  );


  return rows.map((r: any) => ({
    ...(r as Flight),
    paidBy: Array.isArray(r.paidBy) ? r.paidBy : [],
    passengerIds: Array.isArray(r.passenger_ids) ? r.passenger_ids : [],
    arrivalDate: (r as any).arrivalDate ?? (r as any).arrival_date ?? null,
  }));
};

export const listLodgings = async (userId: string, tripId?: string | null): Promise<Lodging[]> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT l.id,
             l.user_id as "userId",
             l.trip_id as "tripId",
             l.status,
             l.name,
             l.check_in_date as "checkInDate",
             l.check_out_date as "checkOutDate",
             l.rooms,
             l.refund_by as "refundBy",
             l.total_cost as "totalCost",
             l.cost_per_night as "costPerNight",
             l.address,
             l.place_id as "placeId",
             COALESCE(l.paid_by, '[]'::jsonb) as "paid_by",
             COALESCE(l.traveler_ids, '[]'::jsonb) as "traveler_ids",
             l.image_url as "imageUrl",
             l.created_at as "createdAt"
      FROM lodgings l
      JOIN trips t ON l.trip_id = t.id
      LEFT JOIN group_members gm
        ON gm.group_id = t.group_id
       AND gm.user_id = $1
       AND gm.removed_at IS NULL
      LEFT JOIN trip_followers tf
        ON tf.trip_id = t.id
       AND tf.follower_user_id = $1
      WHERE ($2::uuid IS NULL OR l.trip_id = $2)
        AND (gm.id IS NOT NULL OR tf.id IS NOT NULL)
      ORDER BY l.check_in_date ASC
    `,
    [userId, tripId ?? null]
  );
  return rows.map((r: any) => {
    const paidBy = Array.isArray(r.paid_by) ? r.paid_by : [];
    const travelerIds = Array.isArray(r.traveler_ids) ? r.traveler_ids : [];
    return {
      ...(r as Lodging),
      paid_by: paidBy,
      paidBy,
      traveler_ids: travelerIds,
      travelerIds,
    } as Lodging & { paidBy: string[]; travelerIds: string[] };
  });
};

export const getLodgingById = async (lodgingId: string): Promise<(Lodging & { tripId?: string; paidBy?: string[]; travelerIds?: string[] }) | null> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT l.id,
             l.user_id as "userId",
             l.trip_id as "tripId",
             l.status,
             l.name,
             l.check_in_date as "checkInDate",
             l.check_out_date as "checkOutDate",
             l.rooms,
             l.refund_by as "refundBy",
             l.total_cost as "totalCost",
             l.cost_per_night as "costPerNight",
             l.address,
             l.place_id as "placeId",
             COALESCE(l.paid_by, '[]'::jsonb) as "paid_by",
             COALESCE(l.traveler_ids, '[]'::jsonb) as "traveler_ids",
             l.image_url as "imageUrl",
             l.created_at as "createdAt"
      FROM lodgings l
      WHERE l.id = $1
      LIMIT 1
    `,
    [lodgingId]
  );
  const row = rows[0] as any;
  if (!row) return null;
  const paidBy = Array.isArray(row.paid_by) ? row.paid_by : [];
  const travelerIds = Array.isArray(row.traveler_ids) ? row.traveler_ids : [];
  return {
    ...(row as any),
    paid_by: paidBy,
    paidBy,
    traveler_ids: travelerIds,
    travelerIds,
  };
};

export const insertLodging = async (lodging: {
  userId: string;
  tripId: string;
  status: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  refundBy?: string | null;
  totalCost: number;
  costPerNight: number;
  address?: string;
  place_id?: string;
  paid_by?: string[];
  traveler_ids?: string[];
  imageUrl?: string | null;
}): Promise<Lodging> => {
  const p = getPool();
  const id = randomUUID();
  const { rows } = await p.query(
    `
      INSERT INTO lodgings (
        id, user_id, trip_id, status, name, check_in_date, check_out_date, rooms, refund_by, total_cost, cost_per_night, address, place_id, paid_by, traveler_ids, image_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id,
                user_id as "userId",
                trip_id as "tripId",
                status,
                name,
                check_in_date as "checkInDate",
                check_out_date as "checkOutDate",
                rooms,
                refund_by as "refundBy",
                total_cost as "totalCost",
                cost_per_night as "costPerNight",
                address,
                place_id as "placeId",
                COALESCE(paid_by, '[]'::jsonb) as "paid_by",
                COALESCE(traveler_ids, '[]'::jsonb) as "traveler_ids",
                image_url as "imageUrl",
                created_at as "createdAt"
    `,
    [
      id,
      lodging.userId,
      lodging.tripId,
      lodging.status,
      lodging.name,
      lodging.checkInDate,
      lodging.checkOutDate,
      lodging.rooms,
      lodging.refundBy ?? null,
      lodging.totalCost,
      lodging.costPerNight,
      lodging.address ?? '',
      lodging.place_id ?? null,
      JSON.stringify(lodging.paid_by ?? []),
      JSON.stringify(lodging.traveler_ids ?? []),
      lodging.imageUrl ?? null,
    ]
  );
  const row = rows[0] as any;
  const paidBy = Array.isArray(row.paid_by) ? row.paid_by : [];
  const travelerIds = Array.isArray(row.traveler_ids) ? row.traveler_ids : [];
  return {
    ...(row as Lodging),
    paid_by: paidBy,
    paidBy,
    traveler_ids: travelerIds,
    travelerIds,
  } as Lodging & { paidBy: string[]; travelerIds: string[] };
};

// Delete a lodging row when the caller belongs to the trip's group.
export const deleteLodging = async (lodgingId: string, userId: string): Promise<void> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    const { rows } = await p.query(
      `
        SELECT l.id
        FROM lodgings l
        JOIN trips t ON t.id = l.trip_id
        JOIN group_members gm ON gm.group_id = t.group_id
        WHERE l.id = $1
          AND gm.user_id = $2
      `,
      [lodgingId, userId]
    );
    if (!rows.length) return;
    await p.query(`DELETE FROM lodgings WHERE id = $1`, [lodgingId]);
    return;
  }
  await p.query(
    `
      DELETE FROM lodgings l
      USING trips t
      WHERE l.id = $1
        AND t.id = l.trip_id
        -- allow deletion by any member of the trip's group
        AND EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $2
        )
    `,
    [lodgingId, userId]
  );
};

// Update lodging fields when the caller belongs to the trip's group.
export const updateLodging = async (
  lodgingId: string,
  userId: string,
  updates: Partial<Lodging>
): Promise<Lodging | null> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';

  const baseParams = [
    lodgingId,
    userId,
    updates.name ?? null,
    updates.status ?? null,
    updates.check_in_date ?? null,
    updates.check_out_date ?? null,
    updates.rooms ?? null,
    typeof updates.refund_by === 'undefined' ? null : updates.refund_by,
    updates.total_cost ?? null,
    updates.cost_per_night ?? null,
    updates.address ?? null,
    updates.place_id ?? null,
    updates.imageUrl ?? null,
    typeof updates.paid_by !== 'undefined' ? JSON.stringify(updates.paid_by ?? []) : null,
    typeof updates.traveler_ids !== 'undefined' ? JSON.stringify(updates.traveler_ids ?? []) : null,
    updates.trip_id ?? null,
  ];

  const { rows } = await p.query<Lodging>(
    useInMemory
      ? `
        UPDATE lodgings
        SET
          name = COALESCE($3, name),
          status = COALESCE($4, status),
          check_in_date = COALESCE($5, check_in_date),
          check_out_date = COALESCE($6, check_out_date),
          rooms = COALESCE($7, rooms),
          refund_by = COALESCE($8, refund_by),
          total_cost = COALESCE($9, total_cost),
          cost_per_night = COALESCE($10, cost_per_night),
          address = COALESCE($11, address),
          place_id = COALESCE($12, place_id),
          image_url = COALESCE($13, image_url),
          paid_by = COALESCE($14::jsonb, paid_by),
          traveler_ids = COALESCE($15::jsonb, traveler_ids),
          trip_id = COALESCE($16, trip_id)
        WHERE id = $1
        RETURNING
          id,
          user_id as "userId",
          trip_id as "tripId",
          status,
          name,
          check_in_date as "checkInDate",
          check_out_date as "checkOutDate",
          rooms,
          refund_by as "refundBy",
          total_cost as "totalCost",
          cost_per_night as "costPerNight",
          address,
          place_id as "placeId",
          COALESCE(paid_by, '[]'::jsonb) as "paid_by",
          COALESCE(traveler_ids, '[]'::jsonb) as "traveler_ids",
          image_url as "imageUrl",
          created_at as "createdAt"
      `
      : `
        UPDATE lodgings l
        SET
          name = COALESCE($3, l.name),
          status = COALESCE($4, l.status),
          check_in_date = COALESCE($5, l.check_in_date),
          check_out_date = COALESCE($6, l.check_out_date),
          rooms = COALESCE($7, l.rooms),
          refund_by = COALESCE($8, l.refund_by),
          total_cost = COALESCE($9, l.total_cost),
          cost_per_night = COALESCE($10, l.cost_per_night),
          address = COALESCE($11, l.address),
          place_id = COALESCE($12, l.place_id),
          image_url = COALESCE($13, l.image_url),
          paid_by = COALESCE($14::jsonb, l.paid_by),
          traveler_ids = COALESCE($15::jsonb, l.traveler_ids),
          trip_id = COALESCE($16, l.trip_id)
        FROM trips t
        WHERE l.id = $1
          AND t.id = COALESCE($16, l.trip_id)
          -- allow edits by any member of the trip's group
          AND t.group_id IN (SELECT group_id FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $2)
        RETURNING
          l.id,
          l.user_id as "userId",
          l.trip_id as "tripId",
          l.status,
          l.name,
          l.check_in_date as "checkInDate",
          l.check_out_date as "checkOutDate",
          l.rooms,
          l.refund_by as "refundBy",
          l.total_cost as "totalCost",
          l.cost_per_night as "costPerNight",
          l.address,
          l.place_id as "placeId",
          COALESCE(l.paid_by, '[]'::jsonb) as "paid_by",
          COALESCE(l.traveler_ids, '[]'::jsonb) as "traveler_ids",
          l.image_url as "imageUrl",
          l.created_at as "createdAt"
      `,
    baseParams
  );
  if (!rows.length) return null;
  const row = rows[0] as any;
  const paidBy = Array.isArray(row.paid_by) ? row.paid_by : [];
  const travelerIds = Array.isArray(row.traveler_ids) ? row.traveler_ids : [];
  return {
    ...(row as Lodging),
    paid_by: paidBy,
    paidBy,
    traveler_ids: travelerIds,
    travelerIds,
  } as Lodging & { paidBy: string[]; travelerIds: string[] };
};
export const listActivities = async (userId: string, tripId?: string): Promise<Activity[]> => {
  // Return tours for the given trip that the requesting user can see (anyone in the trip's group).
  const p = getPool();
  const { rows } = await p.query<Activity>(
    `
    SELECT
      tu.id,
      tu.user_id as "userId",
      tu.trip_id as "tripId",
      tu.status,
      COALESCE(NULLIF(tu.activity_type, ''), 'Tour') as "activityType",
      to_char(tu.date, 'YYYY-MM-DD') as date,
      tu.name,
      tu.start_location as "startLocation",
      tu.start_time as "startTime",
      tu.duration,
      tu.cost::numeric as cost,
      to_char(tu.free_cancel_by, 'YYYY-MM-DD') as "freeCancelBy",
      tu.booked_on as "bookedOn",
      tu.reference,
      tu.notes,
      COALESCE(tu.paid_by, '[]'::jsonb) as "paidBy",
      COALESCE(tu.traveler_ids, '[]'::jsonb) as "travelerIds",
      tu.created_at as "createdAt"
    FROM tours tu
    JOIN trips t ON tu.trip_id = t.id
    LEFT JOIN group_members gm
      ON gm.group_id = t.group_id
     AND gm.user_id = $1
     AND gm.removed_at IS NULL
    LEFT JOIN trip_followers tf
      ON tf.trip_id = t.id
     AND tf.follower_user_id = $1
    WHERE ($2::uuid IS NULL OR tu.trip_id = $2)
      AND (gm.id IS NOT NULL OR tf.id IS NOT NULL)
    ORDER BY tu.date ASC, tu.created_at DESC
    `,
    [userId, tripId ?? null]
  );
  return rows.map((r) => ({
    ...r,
    paidBy: Array.isArray((r as any).paidBy) ? (r as any).paidBy : [],
    travelerIds: Array.isArray((r as any).travelerIds) ? (r as any).travelerIds : [],
  }));
};

export const getActivityById = async (id: string): Promise<Activity | null> => {
  const p = getPool();
  const { rows } = await p.query<Activity>(
    `
    SELECT
      tu.id,
      tu.user_id as "userId",
      tu.trip_id as "tripId",
      tu.status,
      COALESCE(NULLIF(tu.activity_type, ''), 'Tour') as "activityType",
      to_char(tu.date, 'YYYY-MM-DD') as date,
      tu.name,
      tu.start_location as "startLocation",
      tu.start_time as "startTime",
      tu.duration,
      tu.cost::numeric as cost,
      to_char(tu.free_cancel_by, 'YYYY-MM-DD') as "freeCancelBy",
      tu.booked_on as "bookedOn",
      tu.reference,
      tu.notes,
      COALESCE(tu.paid_by, '[]'::jsonb) as "paidBy",
      COALESCE(tu.traveler_ids, '[]'::jsonb) as "travelerIds",
      tu.created_at as "createdAt"
    FROM tours tu
    WHERE tu.id = $1
    LIMIT 1
    `,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    paidBy: Array.isArray((row as any).paidBy) ? (row as any).paidBy : [],
    travelerIds: Array.isArray((row as any).travelerIds) ? (row as any).travelerIds : [],
  };
};

export const insertActivity = async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<Activity> => {
  const p = getPool();
  const id = randomUUID();
  const paidBy = JSON.stringify(activity.paidBy ?? []);
  const travelerIds = JSON.stringify(activity.travelerIds ?? []);
  const { rows } = await p.query<Activity>(
    `
    INSERT INTO tours (
      id, user_id, trip_id, status, activity_type, date, name, start_location, start_time, duration, cost, free_cancel_by, booked_on, reference, notes, paid_by, traveler_ids
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
    )
    RETURNING
      id,
      user_id as "userId",
      trip_id as "tripId",
      status,
      COALESCE(NULLIF(activity_type, ''), 'Tour') as "activityType",
      to_char(date, 'YYYY-MM-DD') as date,
      name,
      start_location as "startLocation",
      start_time as "startTime",
      duration,
      cost::numeric as cost,
      to_char(free_cancel_by, 'YYYY-MM-DD') as "freeCancelBy",
      booked_on as "bookedOn",
      reference,
      notes,
      COALESCE(paid_by, '[]'::jsonb) as "paidBy",
      COALESCE(traveler_ids, '[]'::jsonb) as "travelerIds",
      created_at as "createdAt"
    `,
    [
      id,
      activity.userId,
      activity.tripId,
      activity.status,
      activity.activityType ?? 'Tour',
      activity.date,
      activity.name,
      activity.startLocation,
      activity.startTime,
      activity.duration,
      activity.cost,
      activity.freeCancelBy ?? null,
      activity.bookedOn,
      activity.reference,
      activity.notes ?? '',
      paidBy,
      travelerIds,
    ]
  );
  const row = rows[0];
  return {
    ...row,
    paidBy: Array.isArray((row as any).paidBy) ? (row as any).paidBy : [],
    travelerIds: Array.isArray((row as any).travelerIds) ? (row as any).travelerIds : [],
  };
};

export const updateActivity = async (id: string, userId: string, activity: Partial<Activity>): Promise<Activity | null> => {
  const p = getPool();
  const paidBy = typeof activity.paidBy !== 'undefined' ? JSON.stringify(activity.paidBy ?? []) : undefined;
  const travelerIds =
    typeof activity.travelerIds !== 'undefined' ? JSON.stringify(activity.travelerIds ?? []) : undefined;
  const { rows } = await p.query<Activity>(
    `
    UPDATE tours
    SET
      status = COALESCE($3, status),
      activity_type = COALESCE($4, activity_type),
      date = COALESCE($5, date),
      name = COALESCE($6, name),
      start_location = COALESCE($7, start_location),
      start_time = COALESCE($8, start_time),
      duration = COALESCE($9, duration),
      cost = COALESCE($10, cost),
      free_cancel_by = COALESCE($11, free_cancel_by),
      booked_on = COALESCE($12, booked_on),
      reference = COALESCE($13, reference),
      notes = COALESCE($14, notes),
      paid_by = COALESCE($15::jsonb, paid_by),
      traveler_ids = COALESCE($16::jsonb, traveler_ids)
    WHERE id = $1 AND user_id = $2
    RETURNING
      id,
      user_id as "userId",
      trip_id as "tripId",
      status,
      COALESCE(NULLIF(activity_type, ''), 'Tour') as "activityType",
      to_char(date, 'YYYY-MM-DD') as date,
      name,
      start_location as "startLocation",
      start_time as "startTime",
      duration,
      cost::numeric as cost,
      to_char(free_cancel_by, 'YYYY-MM-DD') as "freeCancelBy",
      booked_on as "bookedOn",
      reference,
      notes,
      COALESCE(paid_by, '[]'::jsonb) as "paidBy",
      COALESCE(traveler_ids, '[]'::jsonb) as "travelerIds",
      created_at as "createdAt"
    `,
    [
      id,
      userId,
      activity.status ?? null,
      activity.activityType ?? null,
      activity.date ?? null,
      activity.name ?? null,
      activity.startLocation ?? null,
      activity.startTime ?? null,
      activity.duration ?? null,
      activity.cost ?? null,
      activity.freeCancelBy ?? null,
      activity.bookedOn ?? null,
      activity.reference ?? null,
      activity.notes ?? null,
      paidBy ?? null,
      travelerIds ?? null,
    ]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    paidBy: Array.isArray((row as any).paidBy) ? (row as any).paidBy : [],
    travelerIds: Array.isArray((row as any).travelerIds) ? (row as any).travelerIds : [],
  };
};

export const deleteActivity = async (tourId: string, userId: string): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM tours WHERE id = $1 AND user_id = $2`, [tourId, userId]);
};

export const listCarRentals = async (userId: string, tripId?: string): Promise<CarRental[]> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT c.id,
             c.user_id as "userId",
             c.trip_id as "tripId",
             c.status,
             c.pickup_location as "pickupLocation",
             to_char(c.pickup_date, 'YYYY-MM-DD') as "pickupDate",
             c.dropoff_location as "dropoffLocation",
             to_char(c.dropoff_date, 'YYYY-MM-DD') as "dropoffDate",
             c.reference,
             c.vendor,
             c.prepaid,
             c.cost::numeric as cost,
             c.model,
             c.notes,
             COALESCE(c.paid_by, '[]'::jsonb) as "paidBy",
             COALESCE(c.traveler_ids, '[]'::jsonb) as "travelerIds",
             c.created_at as "createdAt"
      FROM car_rentals c
      JOIN trips t ON c.trip_id = t.id
      LEFT JOIN group_members gm
        ON gm.group_id = t.group_id
       AND gm.user_id = $1
       AND gm.removed_at IS NULL
      LEFT JOIN trip_followers tf
        ON tf.trip_id = t.id
       AND tf.follower_user_id = $1
      WHERE ($2::uuid IS NULL OR c.trip_id = $2)
        AND (gm.id IS NOT NULL OR tf.id IS NOT NULL)
      ORDER BY c.pickup_date ASC, c.created_at DESC
    `,
    [userId, tripId ?? null]
  );
  return rows.map((row: any) => ({
    ...(row as CarRental),
    paidBy: Array.isArray(row.paidBy) ? row.paidBy : [],
    travelerIds: Array.isArray(row.travelerIds) ? row.travelerIds : [],
  }));
};

export const getCarRentalById = async (id: string): Promise<CarRental | null> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT c.id,
             c.user_id as "userId",
             c.trip_id as "tripId",
             c.status,
             c.pickup_location as "pickupLocation",
             to_char(c.pickup_date, 'YYYY-MM-DD') as "pickupDate",
             c.dropoff_location as "dropoffLocation",
             to_char(c.dropoff_date, 'YYYY-MM-DD') as "dropoffDate",
             c.reference,
             c.vendor,
             c.prepaid,
             c.cost::numeric as cost,
             c.model,
             c.notes,
             COALESCE(c.paid_by, '[]'::jsonb) as "paidBy",
             COALESCE(c.traveler_ids, '[]'::jsonb) as "travelerIds",
             c.created_at as "createdAt"
      FROM car_rentals c
      WHERE c.id = $1
      LIMIT 1
    `,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0] as any;
  return {
    ...(row as CarRental),
    paidBy: Array.isArray(row.paidBy) ? row.paidBy : [],
    travelerIds: Array.isArray(row.travelerIds) ? row.travelerIds : [],
  };
};

export const insertCarRental = async (rental: Omit<CarRental, 'id' | 'createdAt'>): Promise<CarRental> => {
  const p = getPool();
  const id = randomUUID();
  const { rows } = await p.query(
    `
      INSERT INTO car_rentals (
        id, user_id, trip_id, status, pickup_location, pickup_date, dropoff_location, dropoff_date,
        reference, vendor, prepaid, cost, model, notes, paid_by, traveler_ids
      )
      VALUES (
        $1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, NULLIF($8, '')::date, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb
      )
      RETURNING id,
                user_id as "userId",
                trip_id as "tripId",
                status,
                pickup_location as "pickupLocation",
                to_char(pickup_date, 'YYYY-MM-DD') as "pickupDate",
                dropoff_location as "dropoffLocation",
                to_char(dropoff_date, 'YYYY-MM-DD') as "dropoffDate",
                reference,
                vendor,
                prepaid,
                cost::numeric as cost,
                model,
                notes,
                COALESCE(paid_by, '[]'::jsonb) as "paidBy",
                COALESCE(traveler_ids, '[]'::jsonb) as "travelerIds",
                created_at as "createdAt"
    `,
    [
      id,
      rental.userId,
      rental.tripId,
      rental.status,
      rental.pickupLocation ?? '',
      rental.pickupDate ?? '',
      rental.dropoffLocation ?? '',
      rental.dropoffDate ?? '',
      rental.reference ?? '',
      rental.vendor ?? '',
      rental.prepaid ?? '',
      Number(rental.cost) || 0,
      rental.model ?? '',
      rental.notes ?? '',
      JSON.stringify(rental.paidBy ?? []),
      JSON.stringify(rental.travelerIds ?? []),
    ]
  );
  const row = rows[0] as any;
  return {
    ...(row as CarRental),
    paidBy: Array.isArray(row.paidBy) ? row.paidBy : [],
    travelerIds: Array.isArray(row.travelerIds) ? row.travelerIds : [],
  };
};

export const updateCarRental = async (id: string, userId: string, updates: Partial<CarRental>): Promise<CarRental | null> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      UPDATE car_rentals c
      SET
        status = COALESCE($3, c.status),
        pickup_location = COALESCE($4, c.pickup_location),
        pickup_date = COALESCE(NULLIF($5, '')::date, c.pickup_date),
        dropoff_location = COALESCE($6, c.dropoff_location),
        dropoff_date = COALESCE(NULLIF($7, '')::date, c.dropoff_date),
        reference = COALESCE($8, c.reference),
        vendor = COALESCE($9, c.vendor),
        prepaid = COALESCE($10, c.prepaid),
        cost = COALESCE($11, c.cost),
        model = COALESCE($12, c.model),
        notes = COALESCE($13, c.notes),
        paid_by = COALESCE($14::jsonb, c.paid_by),
        traveler_ids = COALESCE($15::jsonb, c.traveler_ids)
      FROM trips t
      WHERE c.id = $1
        AND t.id = c.trip_id
        AND EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = t.group_id
            AND gm.user_id = $2
            AND gm.removed_at IS NULL
        )
      RETURNING c.id,
                c.user_id as "userId",
                c.trip_id as "tripId",
                c.status,
                c.pickup_location as "pickupLocation",
                to_char(c.pickup_date, 'YYYY-MM-DD') as "pickupDate",
                c.dropoff_location as "dropoffLocation",
                to_char(c.dropoff_date, 'YYYY-MM-DD') as "dropoffDate",
                c.reference,
                c.vendor,
                c.prepaid,
                c.cost::numeric as cost,
                c.model,
                c.notes,
                COALESCE(c.paid_by, '[]'::jsonb) as "paidBy",
                COALESCE(c.traveler_ids, '[]'::jsonb) as "travelerIds",
                c.created_at as "createdAt"
    `,
    [
      id,
      userId,
      updates.status ?? null,
      updates.pickupLocation ?? null,
      updates.pickupDate ?? null,
      updates.dropoffLocation ?? null,
      updates.dropoffDate ?? null,
      updates.reference ?? null,
      updates.vendor ?? null,
      updates.prepaid ?? null,
      typeof updates.cost === 'undefined' ? null : Number(updates.cost),
      updates.model ?? null,
      updates.notes ?? null,
      typeof updates.paidBy === 'undefined' ? null : JSON.stringify(updates.paidBy ?? []),
      typeof updates.travelerIds === 'undefined' ? null : JSON.stringify(updates.travelerIds ?? []),
    ]
  );
  if (!rows.length) return null;
  const row = rows[0] as any;
  return {
    ...(row as CarRental),
    paidBy: Array.isArray(row.paidBy) ? row.paidBy : [],
    travelerIds: Array.isArray(row.travelerIds) ? row.travelerIds : [],
  };
};

export const deleteCarRental = async (id: string, userId: string): Promise<void> => {
  const p = getPool();
  await p.query(
    `
      DELETE FROM car_rentals c
      USING trips t
      WHERE c.id = $1
        AND c.trip_id = t.id
        AND EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = t.group_id
            AND gm.user_id = $2
            AND gm.removed_at IS NULL
        )
    `,
    [id, userId]
  );
};

type VoteItemType = 'flight' | 'lodging' | 'activity' | 'car_rental';
type ReactionKind = 'vote' | 'rating';
const reactionItemTypeKey = (itemType: VoteItemType, kind: ReactionKind): string =>
  kind === 'rating' ? `${itemType}:rating` : itemType;

export const castItemVote = async (
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  itemId: string,
  value: 1 | -1,
  kind: ReactionKind = 'vote'
): Promise<void> => {
  const p = getPool();
  const itemTypeKey = reactionItemTypeKey(itemType, kind);
  await p.query(
    `
      INSERT INTO item_votes (id, trip_id, item_type, item_id, user_id, value, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (item_type, item_id, user_id)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [randomUUID(), tripId, itemTypeKey, itemId, userId, value]
  );
};

export const getItemVoteSummaries = async (
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  itemIds: string[],
  kind: ReactionKind = 'vote'
): Promise<Record<string, { netVotes: number; userVote: -1 | 1 | null }>> => {
  const normalizedIds = Array.from(new Set((itemIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (!normalizedIds.length) return {};
  const p = getPool();
  const itemTypeKey = reactionItemTypeKey(itemType, kind);
  const { rows } = await p.query(
    `
      SELECT item_id::text as "itemId",
             COALESCE(SUM(value), 0)::int as "netVotes",
             MAX(CASE WHEN user_id = $1 THEN value ELSE NULL END)::int as "userVote"
      FROM item_votes
      WHERE trip_id = $2
        AND item_type = $3
        AND item_id = ANY($4::uuid[])
      GROUP BY item_id
    `,
    [userId, tripId, itemTypeKey, normalizedIds]
  );
  const result: Record<string, { netVotes: number; userVote: -1 | 1 | null }> = {};
  normalizedIds.forEach((id) => {
    result[id] = { netVotes: 0, userVote: null };
  });
  const requestedIdByKey = new Map(normalizedIds.map((id) => [id.toLowerCase(), id]));
  rows.forEach((row: any) => {
    const itemId = String(row.itemId);
    const resultKey = requestedIdByKey.get(itemId.toLowerCase()) ?? itemId;
    result[resultKey] = {
      netVotes: Number(row.netVotes) || 0,
      userVote: row.userVote === 1 || row.userVote === -1 ? row.userVote : null,
    };
  });
  return result;
};

export const getItineraryDetailContext = async (
  detailId: string
): Promise<{ tripId: string; itineraryId: string } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string; itineraryId: string }>(
    `SELECT i.trip_id as "tripId", d.itinerary_id as "itineraryId"
     FROM itinerary_details d
     JOIN itineraries i ON i.id = d.itinerary_id
     WHERE d.id = $1`,
    [detailId]
  );
  return rows[0] ?? null;
};

export const castItineraryDetailReaction = async (
  userId: string,
  tripId: string,
  detailId: string,
  value: 1 | -1
): Promise<void> => {
  const p = getPool();
  await p.query(
    `
      INSERT INTO itinerary_detail_reactions (id, trip_id, detail_id, user_id, value, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (detail_id, user_id)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [randomUUID(), tripId, detailId, userId, value]
  );
};

export const clearItineraryDetailReaction = async (
  userId: string,
  detailId: string
): Promise<void> => {
  const p = getPool();
  await p.query(
    `DELETE FROM itinerary_detail_reactions WHERE detail_id = $1 AND user_id = $2`,
    [detailId, userId]
  );
};

export const getItineraryDetailReactionSummaries = async (
  userId: string,
  detailIds: string[]
): Promise<Record<string, { score: number; upCount: number; downCount: number; userValue: 1 | -1 | null }>> => {
  const normalizedIds = Array.from(new Set((detailIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
  const result: Record<string, { score: number; upCount: number; downCount: number; userValue: 1 | -1 | null }> = {};
  normalizedIds.forEach((id) => {
    result[id] = { score: 0, upCount: 0, downCount: 0, userValue: null };
  });
  if (!normalizedIds.length) return result;
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT detail_id::text as "detailId",
             COALESCE(SUM(value), 0)::int as "score",
             COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int as "upCount",
             COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int as "downCount",
             MAX(CASE WHEN user_id = $1 THEN value ELSE NULL END)::int as "userValue"
      FROM itinerary_detail_reactions
      WHERE detail_id = ANY($2::uuid[])
      GROUP BY detail_id
    `,
    [userId, normalizedIds]
  );
  rows.forEach((row: any) => {
    result[row.detailId] = {
      score: Number(row.score) || 0,
      upCount: Number(row.upCount) || 0,
      downCount: Number(row.downCount) || 0,
      userValue: row.userValue === 1 || row.userValue === -1 ? row.userValue : null,
    };
  });
  return result;
};

const resolveTripCurrency = async (tripId: string): Promise<string> => {
  const p = getPool();
  const { rows } = await p.query<{ currency: string | null }>(`SELECT currency FROM trips WHERE id = $1`, [tripId]);
  return rows[0]?.currency ?? 'USD';
};

export const listExpenses = async (userId: string, tripId?: string | null): Promise<any[]> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT e.id,
             e.trip_id as "tripId",
             e.group_id as "groupId",
             e.user_id as "userId",
             to_char(e.expense_date, 'YYYY-MM-DD') as "expenseDate",
             e.category,
             e.amount::numeric as amount,
             e.currency,
             e.amount_in_trip_currency::numeric as "amountInTripCurrency",
             e.exchange_rate_to_trip_currency::numeric as "exchangeRateToTripCurrency",
             to_char(e.exchange_rate_date, 'YYYY-MM-DD') as "exchangeRateDate",
             COALESCE(e.payer_ids, '[]'::jsonb) as "payerIds",
             COALESCE(e.for_ids, '[]'::jsonb) as "forIds",
             e.source_type as "sourceType",
             e.source_id as "sourceId",
             e.vendor,
             e.notes,
             e.created_at as "createdAt"
      FROM expenses e
      JOIN trips t ON e.trip_id = t.id
      WHERE ($2::uuid IS NULL OR e.trip_id = $2)
        AND t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
      ORDER BY e.expense_date ASC, e.created_at DESC
    `,
    [userId, tripId ?? null]
  );
  const normalizeJsonArray = (value: any): string[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      const numericKeys = keys.filter((key) => String(Number(key)) === key);
      if (numericKeys.length === keys.length) {
        return numericKeys
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => value[key])
          .filter(Boolean);
      }
    }
    return [];
  };
  return rows.map((row: any) => ({
    ...row,
    payerIds: normalizeJsonArray(row.payerIds),
    forIds: normalizeJsonArray(row.forIds),
  }));
};

export const insertExpense = async (expense: {
  userId: string;
  tripId: string;
  groupId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency?: string | null;
  amountInTripCurrency?: number | null;
  exchangeRateToTripCurrency?: number | null;
  exchangeRateDate?: string | null;
  payerIds?: string[];
  forIds?: string[];
  sourceType?: string | null;
  sourceId?: string | null;
  vendor?: string | null;
  notes?: string | null;
}): Promise<any> => {
  const p = getPool();
  const id = randomUUID();
  const tripCurrency = await resolveTripCurrency(expense.tripId);
  const currency = expense.currency ?? tripCurrency;
  const amountInTripCurrency =
    expense.amountInTripCurrency ??
    (currency === tripCurrency ? expense.amount ?? 0 : null);
  const exchangeRateToTripCurrency =
    expense.exchangeRateToTripCurrency ??
    (currency === tripCurrency ? 1 : null);
  const { rows } = await p.query(
    `
      INSERT INTO expenses (
        id, trip_id, group_id, user_id, expense_date, category, amount, currency, amount_in_trip_currency, exchange_rate_to_trip_currency, exchange_rate_date,
        payer_ids, for_ids, source_type, source_id, vendor, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::jsonb, $13::jsonb, $14, $15, $16, $17
      )
      RETURNING
        id,
        trip_id as "tripId",
        group_id as "groupId",
        user_id as "userId",
        to_char(expense_date, 'YYYY-MM-DD') as "expenseDate",
        category,
        amount::numeric as amount,
        currency,
        amount_in_trip_currency::numeric as "amountInTripCurrency",
        exchange_rate_to_trip_currency::numeric as "exchangeRateToTripCurrency",
        to_char(exchange_rate_date, 'YYYY-MM-DD') as "exchangeRateDate",
        COALESCE(payer_ids, '[]'::jsonb) as "payerIds",
        COALESCE(for_ids, '[]'::jsonb) as "forIds",
        source_type as "sourceType",
        source_id as "sourceId",
        vendor,
        notes,
        created_at as "createdAt"
    `,
    [
      id,
      expense.tripId,
      expense.groupId,
      expense.userId,
      expense.expenseDate,
      expense.category,
      expense.amount ?? 0,
      currency,
      amountInTripCurrency,
      exchangeRateToTripCurrency,
      expense.exchangeRateDate ?? null,
      JSON.stringify(expense.payerIds ?? []),
      JSON.stringify(expense.forIds ?? []),
      expense.sourceType ?? null,
      expense.sourceId ?? null,
      expense.vendor ?? null,
      expense.notes ?? null,
    ]
  );
  const row = rows[0] as any;
  return {
    ...row,
    payerIds: Array.isArray(row.payerIds) ? row.payerIds : [],
    forIds: Array.isArray(row.forIds) ? row.forIds : [],
  };
};

export const upsertExpenseForSource = async (expense: {
  userId: string;
  tripId: string;
  groupId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency?: string | null;
  amountInTripCurrency?: number | null;
  exchangeRateToTripCurrency?: number | null;
  exchangeRateDate?: string | null;
  payerIds?: string[];
  forIds?: string[];
  sourceType: string;
  sourceId: string;
  vendor?: string | null;
  notes?: string | null;
}): Promise<any> => {
  const p = getPool();
  const tripCurrency = await resolveTripCurrency(expense.tripId);
  const currency = expense.currency ?? tripCurrency;
  const amountInTripCurrency =
    expense.amountInTripCurrency ??
    (currency === tripCurrency ? expense.amount ?? 0 : null);
  const exchangeRateToTripCurrency =
    expense.exchangeRateToTripCurrency ??
    (currency === tripCurrency ? 1 : null);
  const { rows } = await p.query(
    `
      INSERT INTO expenses (
        id, trip_id, group_id, user_id, expense_date, category, amount, currency, amount_in_trip_currency, exchange_rate_to_trip_currency, exchange_rate_date,
        payer_ids, for_ids, source_type, source_id, vendor, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::jsonb, $13::jsonb, $14, $15, $16, $17
      )
      ON CONFLICT (source_type, source_id)
      DO UPDATE SET
        trip_id = EXCLUDED.trip_id,
        group_id = EXCLUDED.group_id,
        user_id = EXCLUDED.user_id,
        expense_date = EXCLUDED.expense_date,
        category = EXCLUDED.category,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        amount_in_trip_currency = EXCLUDED.amount_in_trip_currency,
        exchange_rate_to_trip_currency = EXCLUDED.exchange_rate_to_trip_currency,
        exchange_rate_date = EXCLUDED.exchange_rate_date,
        payer_ids = EXCLUDED.payer_ids,
        for_ids = EXCLUDED.for_ids,
        vendor = EXCLUDED.vendor,
        notes = EXCLUDED.notes
      RETURNING
        id,
        trip_id as "tripId",
        group_id as "groupId",
        user_id as "userId",
        to_char(expense_date, 'YYYY-MM-DD') as "expenseDate",
        category,
        amount::numeric as amount,
        currency,
        amount_in_trip_currency::numeric as "amountInTripCurrency",
        exchange_rate_to_trip_currency::numeric as "exchangeRateToTripCurrency",
        to_char(exchange_rate_date, 'YYYY-MM-DD') as "exchangeRateDate",
        COALESCE(payer_ids, '[]'::jsonb) as "payerIds",
        COALESCE(for_ids, '[]'::jsonb) as "forIds",
        source_type as "sourceType",
        source_id as "sourceId",
        vendor,
        notes,
        created_at as "createdAt"
    `,
    [
      randomUUID(),
      expense.tripId,
      expense.groupId,
      expense.userId,
      expense.expenseDate,
      expense.category,
      expense.amount ?? 0,
      currency,
      amountInTripCurrency,
      exchangeRateToTripCurrency,
      expense.exchangeRateDate ?? null,
      JSON.stringify(expense.payerIds ?? []),
      JSON.stringify(expense.forIds ?? []),
      expense.sourceType,
      expense.sourceId,
      expense.vendor ?? null,
      expense.notes ?? null,
    ]
  );
  const row = rows[0] as any;
  return {
    ...row,
    payerIds: Array.isArray(row.payerIds) ? row.payerIds : [],
    forIds: Array.isArray(row.forIds) ? row.forIds : [],
  };
};

export const deleteExpense = async (expenseId: string, userId: string): Promise<void> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    await p.query(`DELETE FROM expenses WHERE id = $1`, [expenseId]);
    return;
  }
  await p.query(
    `
      DELETE FROM expenses e
      USING trips t
      WHERE e.id = $1
        AND t.id = e.trip_id
        AND EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $2
        )
    `,
    [expenseId, userId]
  );
};

export const deleteExpenseForSource = async (sourceType: string, sourceId: string, userId: string): Promise<void> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    await p.query(`DELETE FROM expenses WHERE source_type = $1 AND source_id = $2`, [sourceType, sourceId]);
    return;
  }
  await p.query(
    `
      DELETE FROM expenses e
      USING trips t
      WHERE e.source_type = $1
        AND e.source_id = $2
        AND t.id = e.trip_id
        AND EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $3
        )
    `,
    [sourceType, sourceId, userId]
  );
};

export const listTripPayments = async (userId: string, tripId: string): Promise<any[]> => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT tp.id,
             tp.trip_id as "tripId",
             tp.group_id as "groupId",
             tp.recorded_by as "recordedBy",
             tp.payer_id as "payerId",
             tp.receiver_id as "receiverId",
             to_char(tp.payment_date, 'YYYY-MM-DD') as "paymentDate",
             tp.amount_cents as "amountCents",
             tp.currency,
             tp.notes,
             tp.created_at as "createdAt"
      FROM trip_payments tp
      JOIN trips t ON tp.trip_id = t.id
      WHERE tp.trip_id = $2
        AND t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
      ORDER BY tp.payment_date DESC, tp.created_at DESC
    `,
    [userId, tripId]
  );
  return rows.map((row: any) => ({
    ...row,
    amountCents: Number(row.amountCents) || 0,
  }));
};

export const insertTripPayment = async (payment: {
  tripId: string;
  groupId: string;
  recordedBy: string;
  payerId: string;
  receiverId: string;
  paymentDate: string;
  amountCents: number;
  currency?: string | null;
  notes?: string | null;
}): Promise<any> => {
  const p = getPool();
  const id = randomUUID();
  const tripCurrency = await resolveTripCurrency(payment.tripId);
  const currency = payment.currency ?? tripCurrency ?? 'USD';
  const { rows } = await p.query(
    `
      INSERT INTO trip_payments (
        id, trip_id, group_id, recorded_by, payer_id, receiver_id, payment_date, amount_cents, currency, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)
      RETURNING
        id,
        trip_id as "tripId",
        group_id as "groupId",
        recorded_by as "recordedBy",
        payer_id as "payerId",
        receiver_id as "receiverId",
        to_char(payment_date, 'YYYY-MM-DD') as "paymentDate",
        amount_cents as "amountCents",
        currency,
        notes,
        created_at as "createdAt"
    `,
    [
      id,
      payment.tripId,
      payment.groupId,
      payment.recordedBy,
      payment.payerId,
      payment.receiverId,
      payment.paymentDate,
      payment.amountCents,
      currency,
      payment.notes ?? null,
    ]
  );
  const row = rows[0] as any;
  return { ...row, amountCents: Number(row.amountCents) || 0 };
};

export const deleteTripPayment = async (paymentId: string, userId: string): Promise<void> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    const { rows } = await p.query(
      `SELECT tp.id FROM trip_payments tp
       JOIN trips t ON tp.trip_id = t.id
       WHERE tp.id = $1
         AND t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $2)`,
      [paymentId, userId]
    );
    if (!rows.length) throw new Error('Payment not found');
    await p.query(`DELETE FROM trip_payments WHERE id = $1`, [paymentId]);
    return;
  }
  const { rowCount } = await p.query(
    `
      DELETE FROM trip_payments tp
      USING trips t
      WHERE tp.id = $1
        AND t.id = tp.trip_id
        AND EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $2
        )
    `,
    [paymentId, userId]
  );
  if (!rowCount) throw new Error('Payment not found');
};


export const shareFlight = async (
  flightId: string,
  ownerId: string,
  sharedEmail: string
): Promise<void> => {
  const p = getPool();


  const flight = await p.query(`SELECT 1 FROM flights WHERE id = $1 AND user_id = $2`, [flightId, ownerId]);
  if (!flight.rowCount) throw new Error('Flight not found');


  const user = await findOrCreateUser(sharedEmail, 'email');


  await p.query(
    `INSERT INTO flight_shares (flight_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (flight_id, user_id) DO NOTHING`,
    [flightId, user.id]
  );
};

export const listGroupMembers = async (
  groupId: string,
  userId: string
): Promise<
  Array<{
    id: string;
    userId?: string | null;
    guestName?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    preferredAirport?: string | null;
    isGroupOwner?: boolean;
    status?: string;
    removedAt?: string | null;
  }>
> => {
  const p = getPool();
  const membership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
    [groupId, userId]
  );
  if (!membership.rowCount) throw new Error('Not authorized to view members');

  const { rows } = await p.query(
    `SELECT gm.id,
            gm.user_id as "userId",
            gm.guest_name as "guestName",
            COALESCE(u.email, gm.invite_email) as "email",
            COALESCE(gm.first_name, wu.first_name, wu_pending.first_name) as "firstName",
            COALESCE(gm.last_name, wu.last_name, wu_pending.last_name) as "lastName",
            COALESCE(wu.preferred_airport, wu_pending.preferred_airport) as "preferredAirport",
            CASE WHEN gm.user_id = g.owner_id THEN true ELSE false END as "isGroupOwner",
            gm.removed_at as "removedAt",
            CASE
              WHEN gm.removed_at IS NOT NULL THEN 'removed'
              WHEN gm.user_id IS NULL THEN 'pending'
              WHEN gm.invite_email IS NOT NULL AND gm.claimed_at IS NULL THEN 'pending'
              ELSE 'active'
            END as status
     FROM group_members gm
     JOIN groups g ON g.id = gm.group_id
     LEFT JOIN users u ON gm.user_id = u.id
     LEFT JOIN web_users wu ON gm.user_id = wu.id
     LEFT JOIN users u_pending ON gm.user_id IS NULL AND LOWER(u_pending.email) = LOWER(gm.invite_email)
     LEFT JOIN web_users wu_pending ON u_pending.id = wu_pending.id
     WHERE gm.group_id = $1 AND gm.removed_at IS NULL
     ORDER BY gm.created_at DESC`,
    [groupId]
  );
  const { rows: inviteRows } = await p.query(
    `SELECT gi.id,
            u.id as "userId",
            gi.invitee_email as "guestName",
            gi.invitee_email as "email",
            wu.first_name as "firstName",
            wu.last_name as "lastName",
            wu.preferred_airport as "preferredAirport",
            CASE WHEN u.id = g.owner_id THEN true ELSE false END as "isGroupOwner",
            gi.status
     FROM group_invites gi
     JOIN groups g ON g.id = gi.group_id
     LEFT JOIN users u ON LOWER(u.email) = LOWER(gi.invitee_email)
     LEFT JOIN web_users wu ON u.id = wu.id
     WHERE gi.group_id = $1 AND gi.status = 'pending'
     ORDER BY gi.created_at DESC`,
    [groupId]
  );
  const combined = [...rows, ...inviteRows];
  combined.forEach((m) => {
    if (!m.firstName && !m.lastName && m.guestName) {
      const parts = m.guestName.trim().split(/\s+/);
      if (parts.length >= 2) {
        m.firstName = parts[0];
        m.lastName = parts.slice(1).join(' ');
      }
    }
  });
  return combined;
};

export const listGroupsForUser = async (
  userId: string,
  sort: 'created' | 'name' = 'created'
): Promise<Array<Group & { members: GroupMember[]; invites: { id: string; inviteeEmail: string; status: string }[] }>> => {
  const p = getPool();
  const orderBy = sort === 'name' ? 'g.name ASC' : 'g.created_at DESC';

  const groupsResult = await p.query<Group>(
    `SELECT g.id, g.owner_id as "ownerId", g.name, g.created_at as "createdAt"
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1 AND gm.removed_at IS NULL
     GROUP BY g.id, g.owner_id, g.name, g.created_at
     ORDER BY ${orderBy}`,
    [userId]
  );

  const groupIds = groupsResult.rows.map((g) => g.id);
  if (!groupIds.length) return [];

  const membersResult = await p.query<GroupMember>(
    `SELECT gm.id,
            gm.group_id as "groupId",
            gm.user_id as "userId",
            gm.guest_name as "guestName",
            COALESCE(gm.first_name, wu.first_name, wu_pending.first_name, u.first_name, u_pending.first_name) as "firstName",
            COALESCE(gm.last_name, wu.last_name, wu_pending.last_name, u.last_name, u_pending.last_name) as "lastName",
            gm.added_by as "addedBy",
            gm.created_at as "createdAt",
            COALESCE(wu.email, wu_pending.email, u.email, u_pending.email, gm.invite_email) as "userEmail",
            COALESCE(wu.email, wu_pending.email, u.email, u_pending.email, gm.invite_email) as "email"
     FROM group_members gm
     LEFT JOIN web_users wu ON gm.user_id = wu.id
     LEFT JOIN users u ON gm.user_id = u.id
     LEFT JOIN users u_pending ON gm.user_id IS NULL AND LOWER(u_pending.email) = LOWER(gm.invite_email)
     LEFT JOIN web_users wu_pending ON u_pending.id = wu_pending.id
     WHERE gm.group_id = ANY($1::uuid[])
     ORDER BY gm.created_at DESC`,
    [groupIds]
  );

  const invitesResult = await p.query<{ id: string; groupId: string; inviteeEmail: string; status: string }>(
    `SELECT gi.id, gi.group_id as "groupId", gi.invitee_email as "inviteeEmail", gi.status
     FROM group_invites gi
     WHERE gi.group_id = ANY($1::uuid[]) AND gi.status = 'pending'`,
    [groupIds]
  );

  const allUsers =
    process.env.USE_IN_MEMORY_DB === '1'
      ? ((await p.query<{ id: string; email: string }>('SELECT id, email FROM users'))).rows
      : [];

  return groupsResult.rows.map((g) => {
    let members = membersResult.rows
      .filter((m) => m.groupId === g.id)
      .map((m) => ({
        ...m,
        userEmail: (m as any).userEmail ?? null,
        email: (m as any).userEmail ?? null,
      }));

    if (process.env.USE_IN_MEMORY_DB === '1') {
      const userEmails = new Set(members.map((m) => m.userEmail).filter(Boolean));
      for (const u of allUsers as any[]) {
        if (!userEmails.has(u.email)) {
          members.push({
            id: u.id,
            groupId: g.id,
            userId: u.id,
            guestName: null,
            firstName: null,
            lastName: null,
            addedBy: g.ownerId,
            createdAt: new Date().toISOString(),
            userEmail: u.email,
            email: u.email,
          } as any);
        }
      }
    }

    return {
      ...g,
      members,
      invites: invitesResult.rows.filter((i) => i.groupId === g.id),
    };
  });
};

export const addGroupMember = async (
  ownerId: string,
  groupId: string,
  member: { email?: string; guestName?: string; firstName?: string; lastName?: string }
): Promise<{ inviteId?: string; email?: string }> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows: groupRows } = await client.query(
      `SELECT 1 FROM groups g
       WHERE g.id = $1
         AND (g.owner_id = $2 OR EXISTS (
           SELECT 1 FROM group_members gm WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.removed_at IS NULL
         ))`,
      [groupId, ownerId]
    );
    if (!groupRows.length) throw new Error('Group not found or not a member');

    const emailValue = member.email && member.email.trim();
    if (emailValue) {
      const normalizedEmail = emailValue.toLowerCase();
      const user = await findUserByEmail(normalizedEmail);
      const firstName = member.firstName?.trim() || null;
      const lastName = member.lastName?.trim() || null;
      if (user) {
        const { rowCount: activeMember } = await client.query(
          `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL LIMIT 1`,
          [groupId, user.id]
        );
        if (activeMember) {
          await client.query('COMMIT');
          return {};
        }

        const existingPending = await client.query(
          `SELECT id FROM group_members WHERE group_id = $1 AND invite_email = $2`,
          [groupId, normalizedEmail]
        );
        if (!existingPending.rowCount) {
          await client.query(
            `INSERT INTO group_members (id, group_id, invite_email, guest_name, first_name, last_name, added_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [randomUUID(), groupId, normalizedEmail, member.guestName ?? null, firstName, lastName, ownerId]
          );
        } else {
          await client.query(
            `UPDATE group_members
             SET removed_at = NULL,
                 guest_name = COALESCE($1, guest_name),
                 first_name = COALESCE($2, first_name),
                 last_name = COALESCE($3, last_name)
             WHERE id = $4`,
            [member.guestName ?? null, firstName, lastName, existingPending.rows[0].id]
          );
        }

        const existingInvite = await client.query(
          `SELECT id FROM group_invites WHERE group_id = $1 AND LOWER(invitee_email) = LOWER($2) AND status = 'pending'`,
          [groupId, normalizedEmail]
        );
        if (existingInvite.rowCount) {
          await client.query('COMMIT');
          return { inviteId: existingInvite.rows[0].id, email: normalizedEmail };
        }

        const inviteId = randomUUID();
        await client.query(
          `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT DO NOTHING`,
          [inviteId, groupId, ownerId, user.id, normalizedEmail]
        );
        await client.query('COMMIT');
        return { inviteId, email: normalizedEmail };
      }

      const existingPending = await client.query(
        `SELECT id FROM group_members WHERE group_id = $1 AND invite_email = $2`,
        [groupId, normalizedEmail]
      );
      if (!existingPending.rowCount) {
        await client.query(
          `INSERT INTO group_members (id, group_id, invite_email, guest_name, first_name, last_name, added_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
          [randomUUID(), groupId, normalizedEmail, member.guestName ?? null, firstName, lastName, ownerId]
        );
      } else {
        await client.query(
          `UPDATE group_members
           SET removed_at = NULL,
               guest_name = COALESCE($1, guest_name),
               first_name = COALESCE($2, first_name),
               last_name = COALESCE($3, last_name)
           WHERE id = $4`,
          [member.guestName ?? null, firstName, lastName, existingPending.rows[0].id]
        );
      }

      const existingInvite = await client.query(
        `SELECT id FROM group_invites WHERE group_id = $1 AND LOWER(invitee_email) = LOWER($2) AND status = 'pending'`,
        [groupId, normalizedEmail]
      );
      if (existingInvite.rowCount) {
        await client.query('COMMIT');
        return { inviteId: existingInvite.rows[0].id, email: normalizedEmail };
      }

      const inviteId = randomUUID();
      await client.query(
        `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT DO NOTHING`,
        [inviteId, groupId, ownerId, null, normalizedEmail]
      );
      await client.query('COMMIT');
      return { inviteId, email: normalizedEmail };
    }

    if (member.guestName && member.guestName.trim()) {
      const firstName = member.firstName?.trim() || null;
      const lastName = member.lastName?.trim() || null;
      await client.query(
        `INSERT INTO group_members (id, group_id, guest_name, first_name, last_name, added_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), groupId, member.guestName.trim(), firstName, lastName, ownerId]
      );
      await client.query('COMMIT');
      return {};
    }

    throw new Error('Provide an email or guest name');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const removeGroupMember = async (
  requesterId: string,
  groupId: string,
  memberId: string
): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows: groupRows } = await client.query(
      `SELECT owner_id as "ownerId" FROM groups WHERE id = $1`,
      [groupId]
    );
    if (!groupRows.length) throw new Error('Group not found');

    const { rowCount: isAuthorized } = await client.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, requesterId]
    );
    if (!isAuthorized) throw new Error('Not authorized to remove members');

    const { rows: memberRows } = await client.query(
      `SELECT user_id as "userId" FROM group_members WHERE id = $1 AND group_id = $2`,
      [memberId, groupId]
    );
    if (!memberRows.length) throw new Error('Member not found');
    if (memberRows[0].userId === groupRows[0].ownerId) throw new Error('Owner cannot be removed');

    const removeResult = await client.query(
      `UPDATE group_members SET removed_at = NOW() WHERE id = $1 AND group_id = $2`,
      [memberId, groupId]
    );

    const { rows: requesterRows } = await client.query(
      `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, requesterId]
    );

    const { rows: remainingMemberRows } = await client.query(
      `SELECT id FROM group_members WHERE group_id = $1 AND removed_at IS NULL`,
      [groupId]
    );
    const remainingIds = remainingMemberRows.map((r) => r.id);
    const { rows: tripRows } = await client.query(`SELECT id FROM trips WHERE group_id = $1`, [groupId]);
    const tripIds = tripRows.map((r) => r.id);
    const fallbackPayerId = requesterRows[0]?.id ?? remainingIds[0] ?? null;

    if (tripIds.length) {
      const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
      if (useInMemory) {
        const jsonbRemoveMemberExpr = (column: string) => `
          COALESCE(
            (
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(COALESCE(${column}::text, '[]'), ',"' || $2 || '"', ''),
                        ', \"' || $2 || '\"',
                        ''
                      ),
                      '"' || $2 || '", ',
                      ''
                    ),
                    '"' || $2 || '",',
                    ''
                  ),
                  '"' || $2 || '"',
                  ''
                ),
                '"' || $2 || '" ',
                ''
              )
            ),
            '[]'
          )::jsonb
        `;

        const updatePaidByForTable = async (table: 'flights' | 'lodgings' | 'tours', tripId: string) => {
          await client.query(
            `
            UPDATE ${table}
            SET paid_by = ${jsonbRemoveMemberExpr('paid_by')}
            WHERE trip_id = $1
            `,
            [tripId, memberId]
          );
          if (fallbackPayerId) {
            await client.query(
              `
              UPDATE ${table}
              SET paid_by = $2::jsonb
              WHERE trip_id = $1
                AND COALESCE(paid_by::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')
              `,
              [tripId, JSON.stringify([fallbackPayerId])]
            );
          }
        };

        const updateTravelerIdsForLodgings = async (tripId: string) => {
          await client.query(
            `
            UPDATE lodgings
            SET traveler_ids = ${jsonbRemoveMemberExpr('traveler_ids')}
            WHERE trip_id = $1
            `,
            [tripId, memberId]
          );
          await client.query(
            `
            DELETE FROM lodgings
            WHERE trip_id = $1
              AND COALESCE(traveler_ids::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')
            `,
            [tripId]
          );
        };

        for (const tripId of tripIds) {
          await client.query(
            `
            UPDATE flights
            SET passenger_ids = ${jsonbRemoveMemberExpr('passenger_ids')}
            WHERE trip_id = $1
            `,
            [tripId, memberId]
          );

          const deleteResult = await client.query(
            `
            DELETE FROM flights
            WHERE trip_id = $1
              AND (
                COALESCE(passenger_ids::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')
                OR (
                  passenger_ids::text LIKE '%' || $2 || '%'
                  AND passenger_ids::text NOT LIKE '%,%'
                )
              )
            `,
            [tripId, memberId]
          );

          await updatePaidByForTable('flights', tripId);
          await updatePaidByForTable('lodgings', tripId);
          await updatePaidByForTable('tours', tripId);
          await updateTravelerIdsForLodgings(tripId);
        }
      } else {
        await client.query(
          `
          UPDATE flights
          SET passenger_ids = COALESCE(
            (
              SELECT jsonb_agg(elem.value)
              FROM jsonb_array_elements_text(COALESCE(passenger_ids, '[]'::jsonb)) elem
              WHERE elem.value <> $2::text
            ),
            '[]'::jsonb
          )
          WHERE trip_id = ANY($1::uuid[])
          `,
          [tripIds, memberId]
        );

        const deleteResult = await client.query(
          `
          DELETE FROM flights
          WHERE trip_id = ANY($1::uuid[])
            AND jsonb_array_length(COALESCE(passenger_ids, '[]'::jsonb)) = 0
          `,
          [tripIds]
        );

        const updatePaidByForTable = async (table: 'flights' | 'lodgings' | 'tours') => {
          await client.query(
            `
            UPDATE ${table}
            SET paid_by = COALESCE(
              (
                SELECT jsonb_agg(elem.value) FROM (
                  SELECT value
                  FROM jsonb_array_elements_text(COALESCE(paid_by, '[]'::jsonb)) value
                  WHERE value <> $2::text
                ) elem
              ),
              '[]'::jsonb
            )
            WHERE trip_id = ANY($1::uuid[])
            `,
            [tripIds, memberId]
          );
          if (fallbackPayerId) {
            await client.query(
              `
              UPDATE ${table}
              SET paid_by = $2::jsonb
              WHERE trip_id = ANY($1::uuid[])
                AND jsonb_array_length(COALESCE(paid_by, '[]'::jsonb)) = 0
              `,
              [tripIds, JSON.stringify([fallbackPayerId])]
            );
          }
        };
        await updatePaidByForTable('flights');
        await updatePaidByForTable('lodgings');
        await updatePaidByForTable('tours');
        await client.query(
          `
          UPDATE lodgings
          SET traveler_ids = COALESCE(
            (
              SELECT jsonb_agg(elem.value)
              FROM (
                SELECT value
                FROM jsonb_array_elements_text(COALESCE(traveler_ids, '[]'::jsonb)) value
                WHERE value <> $2::text
              ) elem
            ),
            '[]'::jsonb
          )
          WHERE trip_id = ANY($1::uuid[])
          `,
          [tripIds, memberId]
        );
        await client.query(
          `
          DELETE FROM lodgings
          WHERE trip_id = ANY($1::uuid[])
            AND jsonb_array_length(COALESCE(traveler_ids, '[]'::jsonb)) = 0
          `,
          [tripIds]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const removeGroupInvite = async (ownerId: string, inviteId: string): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT gi.group_id as "groupId", g.owner_id as "ownerId"
       FROM group_invites gi
       JOIN groups g ON gi.group_id = g.id
       WHERE gi.id = $1
       FOR UPDATE`,
      [inviteId]
    );
    if (!rows.length || rows[0].ownerId !== ownerId) {
      throw new Error('Invite not found or not authorized');
    }
    await client.query(`DELETE FROM group_invites WHERE id = $1`, [inviteId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const deleteGroup = async (ownerId: string, groupId: string): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query(`SELECT owner_id as "ownerId" FROM groups WHERE id = $1`, [groupId]);
  if (!rows.length || rows[0].ownerId !== ownerId) throw new Error('Group not found or not authorized');
  await p.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
};

export const listTrips = async (userId: string): Promise<Array<Trip & { groupName: string }>> => {
  const p = getPool();
  if (process.env.USE_IN_MEMORY_DB === '1') {
    const { rows } = await p.query(
       `SELECT t.id,
              t.group_id as "groupId",
              t.name,
              t.description,
              t.destination,
              COALESCE(t.location_ids, '[]'::jsonb) as "locationIds",
              t.start_date as "startDate",
              t.end_date as "endDate",
              t.start_month as "startMonth",
              t.start_year as "startYear",
              t.duration_days as "durationDays",
              t.currency as "currency",
              t.covered_by as "coveredBy",
              t.created_at as "createdAt",
              g.name as "groupName"
       FROM trips t
       JOIN groups g ON t.group_id = g.id
       LEFT JOIN trip_removals tr ON tr.trip_id = t.id AND tr.user_id = $1
       WHERE t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1 AND removed_at IS NULL)
         AND tr.trip_id IS NULL
       ORDER BY t.created_at DESC`,
      [userId]
    );
    return rows;
  }
  const { rows } = await p.query(
    `SELECT t.id,
            t.group_id as "groupId",
            t.name,
            t.description,
            t.destination,
            COALESCE(t.location_ids, '[]'::jsonb) as "locationIds",
            t.start_date as "startDate",
            t.end_date as "endDate",
            t.start_month as "startMonth",
            t.start_year as "startYear",
            t.duration_days as "durationDays",
            t.currency as "currency",
            t.covered_by as "coveredBy",
            t.created_at as "createdAt",
            g.name as "groupName"
     FROM trips t
     JOIN groups g ON t.group_id = g.id
     LEFT JOIN trip_removals tr ON tr.trip_id = t.id AND tr.user_id = $1
     WHERE EXISTS (
       SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $1 AND gm.removed_at IS NULL
     )
       AND tr.trip_id IS NULL
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows;
};

export const createTrip = async (
  userId: string,
  groupId: string,
  name: string,
  details?: {
    description?: string | null;
    destination?: string | null;
    locationIds?: string[];
    startDate?: string | null;
    endDate?: string | null;
    startMonth?: number | null;
    startYear?: number | null;
    durationDays?: number | null;
    currency?: string | null;
  }
): Promise<Trip> => {
  const p = getPool();
  const existing = await p.query(
    `SELECT id, removed_at FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [groupId, userId]
  );
  if (existing.rowCount) {
    const removedAt = (existing.rows[0] as any).removed_at;
    if (removedAt) {
      await p.query(
        `UPDATE group_members
           SET removed_at = NULL, invite_email = NULL, claimed_at = NOW()
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId]
      );
    }
  } else {
    await p.query(
      `INSERT INTO group_members (id, group_id, user_id, added_by)
       VALUES ($1, $2, $3, $3)`,
      [randomUUID(), groupId, userId]
    );
  }

  const id = randomUUID();
  const { rows } = await p.query<Trip>(
    `INSERT INTO trips (id, group_id, name, description, destination, location_ids, start_date, end_date, start_month, start_year, duration_days, currency, covered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id,
               group_id as "groupId",
               name,
               description,
               destination,
               COALESCE(location_ids, '[]'::jsonb) as "locationIds",
               start_date as "startDate",
               end_date as "endDate",
               start_month as "startMonth",
               start_year as "startYear",
               duration_days as "durationDays",
               currency,
               covered_by as "coveredBy",
               created_at as "createdAt"`,
    [
      id,
      groupId,
      name,
      details?.description ?? null,
      details?.destination ?? null,
      JSON.stringify(Array.isArray(details?.locationIds) ? details?.locationIds : []),
      details?.startDate ?? null,
      details?.endDate ?? null,
      details?.startMonth ?? null,
      details?.startYear ?? null,
      details?.durationDays ?? null,
      details?.currency ?? 'USD',
      {},
    ]
  );
  await ensureTripPackingListWithRunner(p, id);
  return rows[0];
};

export const deleteTrip = async (userId: string, tripId: string): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ groupId: string }>(
      `SELECT group_id as "groupId" FROM trips WHERE id = $1 FOR UPDATE`,
      [tripId]
    );
    if (!rows.length) throw new Error('Trip not found');
    const groupId = rows[0].groupId;

    const membership = await client.query(
      `SELECT gm.id
       FROM group_members gm
       WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.removed_at IS NULL`,
      [groupId, userId]
    );
    if (!membership.rowCount) throw new Error('Not authorized to delete this trip');
    const memberId = membership.rows[0].id;

    await client.query(
      `INSERT INTO trip_removals (trip_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (trip_id, user_id) DO NOTHING`,
      [tripId, userId]
    );

    await removeMemberFromTripData(client, tripId, memberId);

    const { rows: remainingMembers } = await client.query<{ user_id: string | null }>(
      `SELECT user_id FROM group_members WHERE group_id = $1 AND removed_at IS NULL`,
      [groupId]
    );
    const { rows: removalRows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM trip_removals WHERE trip_id = $1`,
      [tripId]
    );
    const removedSet = new Set(removalRows.map((r) => r.user_id));
    const activeCount = remainingMembers.filter((m) => m.user_id && !removedSet.has(m.user_id)).length;
    if (activeCount === 0) {
      await client.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const updateTripGroup = async (userId: string, tripId: string, newGroupId: string): Promise<Trip & { groupName: string }> => {
  const p = getPool();
  const tripRow = await p.query<{ groupId: string }>(
    `SELECT group_id as "groupId" FROM trips WHERE id = $1`,
    [tripId]
  );
  if (!tripRow.rowCount) throw new Error('Trip not found');

  // Must belong to current group
  const currentMembership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [tripRow.rows[0].groupId, userId]
  );
  if (!currentMembership.rowCount) throw new Error('Not authorized to update this trip');

  // Must belong to target group
  const targetMembership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [newGroupId, userId]
  );
  if (!targetMembership.rowCount) throw new Error('Not a member of the target group');

  const { rows } = await p.query<Trip & { groupName: string }>(
    `UPDATE trips
     SET group_id = $1
     WHERE id = $2
     RETURNING id,
       group_id as "groupId",
       name,
       description,
       destination,
       COALESCE(location_ids, '[]'::jsonb) as "locationIds",
       start_date as "startDate",
       end_date as "endDate",
       start_month as "startMonth",
       start_year as "startYear",
       duration_days as "durationDays",
       currency,
       covered_by as "coveredBy",
       created_at as "createdAt",
       (SELECT name FROM groups WHERE id = $1) as "groupName"`,
    [newGroupId, tripId]
  );

  return rows[0];
};

export const createGroupWithMembers = async (
  ownerId: string,
  name: string,
  members: Array<{ email?: string; guestName?: string }>
): Promise<{ groupId: string; invites: { id: string; email: string }[] }> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await ensureOwnerUserRow(client, ownerId);
    const groupId = randomUUID();

    await client.query(
      `INSERT INTO groups (id, owner_id, name) VALUES ($1, $2, $3)`,
      [groupId, ownerId, name]
    );

    // Owner is always a member
    await client.query(
      `INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), groupId, ownerId, ownerId]
    );

    const invites: { id: string; email: string }[] = [];

    for (const member of members) {
      const guestName = member.guestName?.trim();
      if (guestName) {
        await client.query(
          `INSERT INTO group_members (id, group_id, guest_name, added_by) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), groupId, guestName, ownerId]
        );
        continue;
      }

      if (member.email && member.email.trim().length) {
        const normalizedEmail = member.email.trim().toLowerCase();
        const user = await findUserByEmail(normalizedEmail);
        const inviteId = randomUUID();
        await client.query(
          `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT DO NOTHING`,
          [inviteId, groupId, ownerId, user?.id ?? null, normalizedEmail]
        );
        await client.query(
          `INSERT INTO group_members (id, group_id, invite_email, guest_name, added_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [randomUUID(), groupId, normalizedEmail, guestName ?? null, ownerId]
        );
        invites.push({ id: inviteId, email: normalizedEmail });
      }
    }

    await client.query('COMMIT');
    return { groupId, invites };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const createTripWithGroupAndMembers = async (payload: {
  ownerId: string;
  tripName: string;
  description?: string | null;
  destination?: string | null;
  locationIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  currency?: string | null;
  members: Array<{ email?: string; guestName?: string }>;
}): Promise<{ trip: Trip; groupId: string; invites: { id: string; email: string }[] }> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await ensureOwnerUserRow(client, payload.ownerId);
    const groupId = randomUUID();
    const groupName = `Trip: ${payload.tripName} Group`;

    await client.query(`INSERT INTO groups (id, owner_id, name) VALUES ($1, $2, $3)`, [
      groupId,
      payload.ownerId,
      groupName,
    ]);
    await client.query(
      `INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), groupId, payload.ownerId, payload.ownerId]
    );

    const invites: { id: string; email: string }[] = [];
    for (const member of payload.members) {
      const hasEmail = member.email && member.email.trim().length > 0;
      if (hasEmail) {
        const email = member.email!.trim().toLowerCase();
        const user = await findUserByEmail(email);
        const inviteId = randomUUID();
        await client.query(
          `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT DO NOTHING`,
          [inviteId, groupId, payload.ownerId, user?.id ?? null, email]
        );
        await client.query(
          `INSERT INTO group_members (id, group_id, invite_email, added_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [randomUUID(), groupId, email, payload.ownerId]
        );
        invites.push({ id: inviteId, email });
        continue;
      }

      if (member.guestName && member.guestName.trim().length) {
        await client.query(
          `INSERT INTO group_members (id, group_id, guest_name, added_by) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), groupId, member.guestName.trim(), payload.ownerId]
        );
      }
    }

    const tripId = randomUUID();
    const { rows } = await client.query<Trip>(
      `INSERT INTO trips (id, group_id, name, description, destination, location_ids, start_date, end_date, start_month, start_year, duration_days, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id,
                 group_id as "groupId",
                 name,
                 description,
                 destination,
                 COALESCE(location_ids, '[]'::jsonb) as "locationIds",
                 start_date as "startDate",
                 end_date as "endDate",
                 start_month as "startMonth",
                 start_year as "startYear",
                 duration_days as "durationDays",
                 currency,
                 created_at as "createdAt"`,
      [
        tripId,
        groupId,
        payload.tripName,
        payload.description ?? null,
        payload.destination ?? null,
        JSON.stringify(Array.isArray(payload.locationIds) ? payload.locationIds : []),
        payload.startDate ?? null,
        payload.endDate ?? null,
        payload.startMonth ?? null,
        payload.startYear ?? null,
        payload.durationDays ?? null,
        payload.currency ?? 'USD',
      ]
    );

    if (invites.length) {
      const inviteIds = invites.map((inv) => inv.id);
      await client.query(`UPDATE group_invites SET trip_id = $2 WHERE id = ANY($1::uuid[])`, [inviteIds, tripId]);
    }
    await ensureTripPackingListWithRunner(client, tripId);

    await client.query('COMMIT');
    return { trip: rows[0], groupId, invites };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const listGroupInvitesForUser = async (userId: string, email: string) => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    const { rows } = await p.query(
      `SELECT gi.id,
              gi.group_id as "groupId",
              gi.trip_id as "tripId",
              gi.inviter_id as "inviterId",
              gi.invitee_user_id as "inviteeUserId",
              gi.invitee_email as "inviteeEmail",
              gi.status,
              gi.created_at as "createdAt",
              g.name as "groupName",
              u.email as "inviterEmail",
              wu.first_name as "inviterFirstName",
              wu.last_name as "inviterLastName",
              t_explicit.id as "explicitTripId",
              t_explicit.name as "explicitTripName"
       FROM group_invites gi
       JOIN groups g ON gi.group_id = g.id
       JOIN users u ON gi.inviter_id = u.id
       LEFT JOIN web_users wu ON wu.id = u.id
       LEFT JOIN trips t_explicit ON t_explicit.id = gi.trip_id
       WHERE (gi.invitee_user_id = $1 OR LOWER(gi.invitee_email) = LOWER($2)) AND gi.status = 'pending'
       ORDER BY gi.created_at DESC`,
      [userId, email]
    );

    const missingTripGroups = Array.from(
      new Set(rows.filter((row: any) => !row.tripId).map((row: any) => row.groupId))
    );
    let fallbackByGroup = new Map<string, { id: string; name: string; createdAt?: string | null }>();
    if (missingTripGroups.length) {
      const { rows: tripRows } = await p.query(
        `SELECT id, name, group_id as "groupId", created_at as "createdAt"
         FROM trips
         WHERE group_id = ANY($1::uuid[])`,
        [missingTripGroups]
      );
      for (const trip of tripRows) {
        const existing = fallbackByGroup.get(trip.groupId as string);
        if (!existing) {
          fallbackByGroup.set(trip.groupId as string, { id: trip.id, name: trip.name, createdAt: trip.createdAt });
          continue;
        }
        const existingDate = new Date(existing.createdAt ?? 0).getTime();
        const candidateDate = new Date(trip.createdAt ?? 0).getTime();
        if (candidateDate >= existingDate) {
          fallbackByGroup.set(trip.groupId as string, { id: trip.id, name: trip.name, createdAt: trip.createdAt });
        }
      }
    }

    return rows.map((row: any) => {
      const fallback = row.tripId ? null : fallbackByGroup.get(row.groupId);
      return {
        id: row.id,
        groupId: row.groupId,
        tripId: row.tripId ?? null,
        inviterId: row.inviterId,
        inviteeUserId: row.inviteeUserId ?? null,
        inviteeEmail: row.inviteeEmail,
        status: row.status,
        createdAt: row.createdAt,
        groupName: row.groupName,
        inviterEmail: row.inviterEmail,
        inviterFirstName: row.inviterFirstName,
        inviterLastName: row.inviterLastName,
        resolvedTripId: row.tripId ?? fallback?.id ?? null,
        resolvedTripName: row.tripId ? row.explicitTripName : fallback?.name ?? null,
      };
    });
  }

  const { rows } = await p.query(
    `SELECT gi.id,
            gi.group_id as "groupId",
            gi.trip_id as "tripId",
            gi.inviter_id as "inviterId",
            gi.invitee_user_id as "inviteeUserId",
            gi.invitee_email as "inviteeEmail",
            gi.status,
            gi.created_at as "createdAt",
            g.name as "groupName",
            u.email as "inviterEmail",
            wu.first_name as "inviterFirstName",
            wu.last_name as "inviterLastName",
            COALESCE(t_explicit.id, t_fallback.id) as "resolvedTripId",
            COALESCE(t_explicit.name, t_fallback.name) as "resolvedTripName"
     FROM group_invites gi
     JOIN groups g ON gi.group_id = g.id
     JOIN users u ON gi.inviter_id = u.id
     LEFT JOIN web_users wu ON wu.id = u.id
     LEFT JOIN trips t_explicit ON t_explicit.id = gi.trip_id
     LEFT JOIN LATERAL (
        SELECT id, name FROM trips WHERE group_id = gi.group_id ORDER BY created_at DESC LIMIT 1
     ) t_fallback ON t_explicit.id IS NULL
     WHERE (gi.invitee_user_id = $1 OR LOWER(gi.invitee_email) = LOWER($2)) AND gi.status = 'pending'
     ORDER BY gi.created_at DESC`,
    [userId, email]
  );
  return rows;
};

export const attachInviteToTrip = async (inviteId: string, tripId: string): Promise<void> => {
  const p = getPool();
  await p.query(`UPDATE group_invites SET trip_id = $2 WHERE id = $1`, [inviteId, tripId]);
};

const removeMemberFromTripData = async (client: any, tripId: string, memberId: string) => {
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';
  if (useInMemory) {
    const jsonbRemoveMemberExpr = (column: string) => `
      COALESCE(
        (
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(COALESCE(${column}::text, '[]'), ',"' || $2 || '"', ''),
                    ', \"' || $2 || '\"',
                    ''
                  ),
                  '"' || $2 || '", ',
                  ''
                ),
                '"' || $2 || '",',
                ''
              ),
              '"' || $2 || '"',
              ''
            ),
            '"' || $2 || '" ',
            ''
          )
        ),
        '[]'
      )::jsonb
    `;

    const updateJsonArray = async (table: string, column: string) => {
      await client.query(
        `
        UPDATE ${table}
        SET ${column} = ${jsonbRemoveMemberExpr(column)}
        WHERE trip_id = $1
        `,
        [tripId, memberId]
      );
    };

    await updateJsonArray('flights', 'passenger_ids');
    await updateJsonArray('flights', 'paid_by');
    await updateJsonArray('lodgings', 'traveler_ids');
    await updateJsonArray('lodgings', 'paid_by');
    await updateJsonArray('tours', 'paid_by');
    await updateJsonArray('expenses', 'payer_ids');
    await updateJsonArray('expenses', 'for_ids');

    await client.query(
      `DELETE FROM flights WHERE trip_id = $1 AND COALESCE(passenger_ids::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')`,
      [tripId]
    );
    await client.query(
      `DELETE FROM lodgings WHERE trip_id = $1 AND COALESCE(traveler_ids::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')`,
      [tripId]
    );
    await client.query(
      `DELETE FROM tours WHERE trip_id = $1 AND COALESCE(paid_by::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')`,
      [tripId]
    );
    await client.query(
      `DELETE FROM expenses
       WHERE trip_id = $1
         AND (
           COALESCE(payer_ids::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')
           OR COALESCE(for_ids::text, '[]') IN ('[]', '[ ]', '[  ]', 'null')
         )`,
      [tripId]
    );
    return;
  }

  await client.query(
    `
    UPDATE flights
    SET passenger_ids = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(passenger_ids, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    )
    WHERE trip_id = $1
    `,
    [tripId, memberId]
  );
  await client.query(
    `
    UPDATE flights
    SET paid_by = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(paid_by, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    )
    WHERE trip_id = $1
    `,
    [tripId, memberId]
  );
  await client.query(
    `
    UPDATE lodgings
    SET traveler_ids = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(traveler_ids, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    )
    WHERE trip_id = $1
    `,
    [tripId, memberId]
  );
  await client.query(
    `
    UPDATE lodgings
    SET paid_by = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(paid_by, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    )
    WHERE trip_id = $1
    `,
    [tripId, memberId]
  );
  await client.query(
    `
    UPDATE tours
    SET paid_by = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(paid_by, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    )
    WHERE trip_id = $1
    `,
    [tripId, memberId]
  );
  await client.query(
    `
    UPDATE expenses
    SET payer_ids = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(payer_ids, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    ),
    for_ids = COALESCE(
      (
        SELECT jsonb_agg(elem.value)
        FROM jsonb_array_elements_text(COALESCE(for_ids, '[]'::jsonb)) elem
        WHERE elem.value <> $2::text
      ),
      '[]'::jsonb
    )
    WHERE trip_id = $1
    `,
    [tripId, memberId]
  );

  await client.query(
    `DELETE FROM flights WHERE trip_id = $1 AND jsonb_array_length(COALESCE(passenger_ids, '[]'::jsonb)) = 0`,
    [tripId]
  );
  await client.query(
    `DELETE FROM lodgings WHERE trip_id = $1 AND jsonb_array_length(COALESCE(traveler_ids, '[]'::jsonb)) = 0`,
    [tripId]
  );
  await client.query(
    `DELETE FROM tours WHERE trip_id = $1 AND jsonb_array_length(COALESCE(paid_by, '[]'::jsonb)) = 0`,
    [tripId]
  );
  await client.query(
    `DELETE FROM expenses
     WHERE trip_id = $1
       AND (
         jsonb_array_length(COALESCE(payer_ids, '[]'::jsonb)) = 0
         OR jsonb_array_length(COALESCE(for_ids, '[]'::jsonb)) = 0
       )`,
    [tripId]
  );
};

export const rejectGroupInvite = async (inviteId: string, userId: string, email?: string): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      groupId: string;
      tripId: string | null;
      inviteeEmail: string;
    }>(
      `SELECT group_id as "groupId",
              trip_id as "tripId",
              invitee_email as "inviteeEmail"
       FROM group_invites
       WHERE id = $1 AND (invitee_user_id = $2 OR ($3 IS NOT NULL AND LOWER(invitee_email) = LOWER($3)))
       FOR UPDATE`,
      [inviteId, userId, email ?? null]
    );
    if (!rows.length) throw new Error('Invite not found');
    const invite = rows[0];

    const { rows: memberRows } = await client.query<{ id: string }>(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND removed_at IS NULL
         AND (
           user_id = $2
           OR (invite_email IS NOT NULL AND LOWER(invite_email) = LOWER($3))
         )
       LIMIT 1`,
      [invite.groupId, userId, invite.inviteeEmail]
    );
    const memberId = memberRows[0]?.id ?? null;

    const tripId = invite.tripId
      ? invite.tripId
      : (await client.query<{ id: string }>(
          `SELECT id FROM trips WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [invite.groupId]
        )).rows[0]?.id ?? null;

    if (memberId && tripId) {
      await removeMemberFromTripData(client, tripId, memberId);
      await client.query(`UPDATE group_members SET removed_at = NOW() WHERE id = $1`, [memberId]);
    } else if (memberId) {
      await client.query(`UPDATE group_members SET removed_at = NOW() WHERE id = $1`, [memberId]);
    }

    await client.query(`DELETE FROM group_invites WHERE id = $1`, [inviteId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const acceptGroupInvite = async (inviteId: string, userId: string, email?: string): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id,
              group_id as "groupId",
              inviter_id as "inviterId",
              invitee_email as "inviteeEmail",
              status
       FROM group_invites
       WHERE id = $1 AND (invitee_user_id = $2 OR ($3 IS NOT NULL AND LOWER(invitee_email) = LOWER($3)))
       FOR UPDATE`,
      [inviteId, userId, email ?? null]
    );

    if (!rows.length) {
      throw new Error('Invite not found');
    }
    const invite = rows[0] as { groupId: string; inviterId: string; status: string; inviteeEmail: string };
    if (invite.status !== 'pending') {
      throw new Error('Invite already processed');
    }

    const updated = await client.query(
      `UPDATE group_members
         SET user_id = $1, invite_email = NULL, claimed_at = NOW(), removed_at = NULL
       WHERE group_id = $2 AND invite_email = (
         SELECT invitee_email FROM group_invites WHERE id = $3
       ) AND user_id IS NULL`,
      [userId, invite.groupId, inviteId]
    );
    if (!updated.rowCount) {
      await client.query(
        `INSERT INTO group_members (id, group_id, user_id, added_by, claimed_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [randomUUID(), invite.groupId, userId, invite.inviterId]
      );
    }

    await client.query(
      `UPDATE group_invites
       SET status = 'accepted', invitee_user_id = $2
       WHERE id = $1`,
      [inviteId, userId]
    );
    await mergeUserPackingListIntoGroupTripsWithRunner(client, invite.groupId, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const claimInvitesForUser = async (email: string, userId: string): Promise<void> => {
  const p = getPool();
  const normalizedEmail = normalizeEmail(email);
  await p.query(
    `UPDATE group_invites
     SET invitee_user_id = $1
     WHERE invitee_user_id IS NULL AND LOWER(invitee_email) = LOWER($2)`,
    [userId, normalizedEmail]
  );
  await p.query(
    `UPDATE trip_share_invites
     SET invitee_user_id = $1,
         updated_at = NOW()
     WHERE invitee_user_id IS NULL
       AND status = 'pending'
       AND LOWER(invitee_email) = LOWER($2)
       AND (expires_at IS NULL OR expires_at > NOW()::timestamp)`,
    [userId, normalizedEmail]
  );
};

export const getAirportByIataCode = async (iataCode: string): Promise<{ iataCode: string; name: string; city: string; country: string; lat: number | null; lng: number | null } | null> => {
  const p = getPool();
  const { rows } = await p.query<any>(
    `SELECT iata_code, name, city, country, lat, lng FROM airports WHERE iata_code = $1 LIMIT 1`,
    [iataCode.toUpperCase()]
  );
  if (!rows.length) return null;
  return { iataCode: rows[0].iata_code, name: rows[0].name, city: rows[0].city ?? '', country: rows[0].country ?? '', lat: rows[0].lat, lng: rows[0].lng };
};

export const searchFlightLocations = async (userId: string, query: string): Promise<string[]> => {
  const p = getPool();
  const like = `%${query.toLowerCase()}%`;
  const { rows } = await p.query<{ label: string }>(
    `SELECT DISTINCT
        CASE
          WHEN a.iata_code IS NOT NULL THEN
            COALESCE(NULLIF(a.city, ''), a.name, a.iata_code) || ' (' || a.iata_code || ')'
          ELSE a.name
        END as label
     FROM airports a
     WHERE LOWER(a.iata_code) LIKE $1
        OR LOWER(a.city) LIKE $1
        OR LOWER(a.name) LIKE $1
     ORDER BY label
     LIMIT 15`,
    [like]
  );
  const dbResults = rows.map((r) => r.label).filter(Boolean);
  if (dbResults.length >= 15) return dbResults;
  const fallbackResults = searchBundledAirportDataset(query, 15);
  return Array.from(new Set([...dbResults, ...fallbackResults])).slice(0, 15);
};

const toLocationRecord = (row: any): LocationRecord => {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    id: row.id,
    sourceType: row.sourceType,
    category: row.category ?? payload.category ?? null,
    name: row.name,
    address: row.address ?? payload.address ?? null,
    visitorCount: payload.visitorCount ?? null,
    climate: payload.climate ?? null,
    priceLevel: payload.priceLevel ?? null,
    bestMonth: payload.bestMonth ?? null,
    editorialSummary: payload.editorialSummary ?? null,
    popularityTier: payload.popularityTier ?? null,
    unesco: payload.unesco ?? null,
    rating: payload.rating ?? null,
    userRatingCount: payload.userRatingCount ?? null,
    websiteUri: payload.websiteUri ?? null,
    googleMapsUri: payload.googleMapsUri ?? null,
    keywords: Array.isArray(payload.keywords) ? payload.keywords : [],
    sourceFile: row.sourceFile ?? null,
    sourceRowHash: row.sourceRowHash ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
  };
};

const toAttractionCatalogEntry = (row: any): AttractionCatalogEntry => {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const rawTags = Array.isArray(payload.interestTags) ? payload.interestTags : [];
  const tags = rawTags.map((tag: unknown) => String(tag).trim()).filter(Boolean) as AttractionCatalogEntry['interestTags'];
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  return {
    id: row.id,
    destinationKey: String(payload.destinationKey ?? '').trim(),
    destinationDisplayName: String(payload.destinationDisplayName ?? '').trim(),
    country: typeof payload.country === 'string' ? payload.country : null,
    stateProvince: typeof payload.stateProvince === 'string' ? payload.stateProvince : null,
    name: row.name,
    rank: Number(payload.rank) || 999,
    activityType: String(payload.activityType ?? 'Tour') as AttractionCatalogEntry['activityType'],
    interestTags: tags,
    sourceUrl: typeof payload.sourceUrl === 'string' ? payload.sourceUrl : null,
    sourceLabel: typeof payload.sourceLabel === 'string' ? payload.sourceLabel : null,
    snippet: typeof payload.snippet === 'string' ? payload.snippet : null,
    sourceCount: Number(payload.sourceCount) || undefined,
    budgetTier:
      typeof payload.budgetTier === 'string' ? (payload.budgetTier as AttractionCatalogEntry['budgetTier']) : undefined,
    sitelinks: Number(payload.sitelinks) || null,
    qid: typeof payload.qid === 'string' ? payload.qid : null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  };
};

const toAttractionShortlistBlob = (row: any): AttractionShortlistBlob | null => {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const destinationKey = String(payload.destinationKey ?? '').trim();
  const dateKey = String(payload.dateKey ?? '').trim();
  const promptBlock = String(payload.promptBlock ?? '').trim();
  if (!destinationKey || !dateKey || !promptBlock) return null;
  return {
    id: row.id,
    destinationKey,
    destinationDisplayName: String(payload.destinationDisplayName ?? '').trim(),
    dateKey,
    promptBlock,
    compact: String(payload.compact ?? ''),
    itemCount: Number(payload.itemCount) || 0,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  };
};

const toShortlistBlobId = (destinationKey: string, dateKey: string): string => {
  const clean = (value: string) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `attr-blob:${clean(destinationKey)}:${clean(dateKey)}`.slice(0, 180);
};

export const searchLocations = async (
  _userId: string,
  query: string,
  sourceTypes?: Array<'country_region' | 'city'>,
  limit = 15
): Promise<LocationRecord[]> => {
  const trimmed = String(query ?? '').trim().toLowerCase();
  if (!trimmed) return [];
  const p = getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const types = Array.isArray(sourceTypes) ? sourceTypes.filter(Boolean) : [];
  const pattern = `%${trimmed}%`;
  const { rows } = await p.query(
    `SELECT id,
            source_type as "sourceType",
            category,
            name,
            address,
            payload,
            source_file as "sourceFile",
            source_row_hash as "sourceRowHash",
            updated_at as "updatedAt"
       FROM locations
      WHERE ($1::text[] IS NULL OR source_type = ANY($1::text[]))
        AND (LOWER(search_name) LIKE $2 OR LOWER(name) LIKE $2 OR LOWER(COALESCE(address, '')) LIKE $2)
      ORDER BY
        CASE WHEN LOWER(name) = $3 THEN 0 ELSE 1 END,
        name ASC
      LIMIT $4`,
    [types.length ? types : null, pattern, trimmed, safeLimit]
  );
  return rows.map(toLocationRecord);
};

export const getLocationsByIds = async (_userId: string, ids: string[]): Promise<LocationRecord[]> => {
  const normalized = Array.from(new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (!normalized.length) return [];
  const p = getPool();
  const { rows } = await p.query(
    `SELECT id,
            source_type as "sourceType",
            category,
            name,
            address,
            payload,
            source_file as "sourceFile",
            source_row_hash as "sourceRowHash",
            updated_at as "updatedAt"
       FROM locations
      WHERE id = ANY($1::text[])`,
    [normalized]
  );
  const byId = new Map(rows.map((row: any) => [row.id, toLocationRecord(row)]));
  return normalized.map((id) => byId.get(id)).filter(Boolean) as LocationRecord[];
};

export const upsertLocation = async (data: {
  place_id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  types?: string[];
  image_url?: string | null;
}): Promise<LocationRecord> => {
  const p = getPool();
  const id = data.place_id;
  const name = data.name;
  const address = data.address ?? null;
  const searchName = name.toLowerCase();

  let sourceType = 'city';
  if (data.types?.includes('country')) sourceType = 'country_region';
  else if (data.types?.includes('administrative_area_level_1')) sourceType = 'country_region';

  const payload: any = {
    lat: data.lat,
    lng: data.lng,
    types: data.types,
    googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${id}`,
  };
  if (data.image_url) {
    payload.image_url = data.image_url;
  }

  // pg-mem doesn't support jsonb concatenation (||), so we handle it manually in memory mode.
  if (process.env.USE_IN_MEMORY_DB === '1') {
    const existing = await p.query('SELECT payload FROM locations WHERE id = $1', [id]);
    if (existing.rows.length > 0) {
      const oldPayload = existing.rows[0].payload || {};
      const newPayload = { ...oldPayload, ...payload };
      await p.query(
        `UPDATE locations SET name = $2, address = $3, search_name = $4, payload = $5, updated_at = NOW() WHERE id = $1`,
        [id, name, address, searchName, JSON.stringify(newPayload)]
      );
      const { rows } = await p.query('SELECT * FROM locations WHERE id = $1', [id]);
      return toLocationRecord(rows[0]);
    }
  }

  const query = `INSERT INTO locations (id, source_type, name, address, search_name, payload, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, search_name = EXCLUDED.search_name, payload = locations.payload || EXCLUDED.payload, updated_at = NOW() RETURNING *`;
  const { rows } = await p.query(query, [id, sourceType, name, address, searchName, JSON.stringify(payload)]);
  return toLocationRecord(rows[0]);
};

export const listAttractionCatalogEntries = async (
  _userId: string,
  destinationKey: string,
  limit = 20
): Promise<AttractionCatalogEntry[]> => {
  const key = String(destinationKey ?? '').trim().toLowerCase();
  if (!key) return [];
  const p = getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const { rows } = await p.query(
    `SELECT id, name, payload, updated_at as "updatedAt"
       FROM locations
      WHERE source_type = 'attraction'
        AND LOWER(COALESCE(payload->>'destinationKey', '')) = $1
      ORDER BY
        COALESCE((payload->>'rank')::int, 999) ASC,
        name ASC
      LIMIT $2`,
    [key, safeLimit]
  );
  return rows.map(toAttractionCatalogEntry);
};

export const upsertAttractionCatalogEntry = async (entry: AttractionCatalogEntry): Promise<AttractionCatalogEntry> => {
  const p = getPool();
  const payload = {
    destinationKey: entry.destinationKey,
    destinationDisplayName: entry.destinationDisplayName,
    country: entry.country ?? null,
    stateProvince: entry.stateProvince ?? null,
    rank: Number(entry.rank) || 999,
    activityType: entry.activityType,
    interestTags: Array.isArray(entry.interestTags) ? entry.interestTags : [],
    sourceUrl: entry.sourceUrl ?? null,
    sourceLabel: entry.sourceLabel ?? null,
    snippet: entry.snippet ?? null,
    sourceCount: Number(entry.sourceCount) || 1,
    budgetTier: entry.budgetTier ?? 'paid',
    sitelinks: Number(entry.sitelinks) || null,
    qid: entry.qid ?? null,
    lat: Number.isFinite(Number(entry.lat)) ? Number(entry.lat) : null,
    lon: Number.isFinite(Number(entry.lon)) ? Number(entry.lon) : null,
    updatedAt: entry.updatedAt,
  };
  const searchName = `${entry.name} ${entry.destinationDisplayName} ${entry.country ?? ''} ${entry.stateProvince ?? ''}`.toLowerCase();
  const { rows } = await p.query(
    `INSERT INTO locations (id, source_type, category, name, address, search_name, payload, updated_at)
     VALUES ($1, 'attraction', 'attraction', $2, NULL, $3, $4::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       source_type = 'attraction',
       category = 'attraction',
       name = EXCLUDED.name,
       search_name = EXCLUDED.search_name,
       payload = locations.payload || EXCLUDED.payload,
       updated_at = NOW()
     RETURNING id, name, payload, updated_at as "updatedAt"`,
    [entry.id, entry.name, searchName, JSON.stringify(payload)]
  );
  return toAttractionCatalogEntry(rows[0]);
};

export const getAttractionShortlistBlob = async (
  _userId: string,
  destinationKey: string,
  dateKey: string
): Promise<AttractionShortlistBlob | null> => {
  const key = String(destinationKey ?? '').trim().toLowerCase();
  const date = String(dateKey ?? '').trim();
  if (!key || !date) return null;
  const id = toShortlistBlobId(key, date);
  const p = getPool();
  const { rows } = await p.query(
    `SELECT id, payload, updated_at as "updatedAt"
       FROM locations
      WHERE id = $1
        AND source_type = 'attraction_shortlist_blob'
      LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  return toAttractionShortlistBlob(rows[0]);
};

export const upsertAttractionShortlistBlob = async (entry: AttractionShortlistBlob): Promise<AttractionShortlistBlob> => {
  const p = getPool();
  const payload = {
    destinationKey: entry.destinationKey,
    destinationDisplayName: entry.destinationDisplayName,
    dateKey: entry.dateKey,
    promptBlock: entry.promptBlock,
    compact: entry.compact,
    itemCount: Number(entry.itemCount) || 0,
    updatedAt: entry.updatedAt,
  };
  const searchName = `${entry.destinationDisplayName} ${entry.dateKey} attraction shortlist`.toLowerCase();
  const { rows } = await p.query(
    `INSERT INTO locations (id, source_type, category, name, address, search_name, payload, updated_at)
     VALUES ($1, 'attraction_shortlist_blob', 'attraction_shortlist_blob', $2, NULL, $3, $4::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       source_type = 'attraction_shortlist_blob',
       category = 'attraction_shortlist_blob',
       name = EXCLUDED.name,
       search_name = EXCLUDED.search_name,
       payload = locations.payload || EXCLUDED.payload,
       updated_at = NOW()
     RETURNING id, payload, updated_at as "updatedAt"`,
    [entry.id, entry.destinationDisplayName, searchName, JSON.stringify(payload)]
  );
  const parsed = toAttractionShortlistBlob(rows[0]);
  if (!parsed) {
    throw new Error('Failed to parse attraction shortlist blob after upsert.');
  }
  return parsed;
};

const clampTraitLevel = (level?: number | null): number => {
  const parsed = Number(level);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.round(parsed), 1), 5);
};

export const listTraits = async (userId: string): Promise<Trait[]> => {
  const p = getPool();
  const { rows } = await p.query<Trait>(
    `SELECT id,
            user_id as "userId",
            name,
            level,
            notes,
            created_at as "createdAt"
     FROM traits
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

export const createTrait = async (userId: string, name: string, level?: number, notes?: string): Promise<Trait> => {
  const p = getPool();
  const safeLevel = clampTraitLevel(level ?? null);
  try {
    const { rows } = await p.query<Trait>(
      `INSERT INTO traits (id, user_id, name, level, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id as "userId", name, level, notes, created_at as "createdAt"`,
      [randomUUID(), userId, name.trim(), safeLevel, notes ?? null]
    );
    return rows[0];
  } catch (err: any) {
    if (err?.code === '23505') {
      const dup = new Error('Trait already exists for this user');
      (dup as any).code = 'TRAIT_EXISTS';
      throw dup;
    }
    throw err;
  }
};

export const updateTrait = async (
  userId: string,
  traitId: string,
  updates: { name?: string; level?: number; notes?: string | null }
): Promise<Trait> => {
  const p = getPool();
  const nextLevel = updates.level !== undefined ? clampTraitLevel(updates.level) : undefined;
  const { rows } = await p.query<Trait>(
    `UPDATE traits
     SET name = COALESCE($1, name),
         level = COALESCE($2, level),
         notes = COALESCE($3, notes)
     WHERE id = $4 AND user_id = $5
     RETURNING id, user_id as "userId", name, level, notes, created_at as "createdAt"`,
    [
      updates.name?.trim() ?? null,
      nextLevel ?? null,
      updates.notes ?? null,
      traitId,
      userId,
    ]
  );
  if (!rows.length) throw new Error('Trait not found');
  return rows[0];
};

export const deleteTrait = async (userId: string, traitId: string): Promise<void> => {
  const p = getPool();
  const result = await p.query(`DELETE FROM traits WHERE id = $1 AND user_id = $2`, [traitId, userId]);
  if (!result.rowCount) throw new Error('Trait not found');
};

export const refreshAirportsDaily = async (): Promise<void> => {
  const p = getPool();
  let data: any[] = [];
  try {
    data = await downloadAirportDatasetForDailyRefresh();
  } catch (err) {
    logError('Failed to download airports dataset, falling back to local file', err);
    try {
      const localPath = path.resolve(__dirname, '../../data/airport_codes.json');
      if (fs.existsSync(localPath)) {
        data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        logInfo(`[airports] Loaded ${Array.isArray(data) ? data.length : 0} airports from local fallback`);
      }
    } catch (localErr) {
      logError('Failed to load local airports fallback', localErr);
      return;
    }
  }

  const filtered = normalizeAirportDataset(data).map((airport) => ({
    iata_code: airport.iata_code,
    name: airport.name,
    city: airport.city,
    country: airport.country,
    lat: airport.lat,
    lng: airport.lng,
  }));

  if (!filtered.length) {
    console.warn('[airports] no records to process');
    return;
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const chunkSize = 500;
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const chunk = filtered.slice(i, i + chunkSize);
      const values: any[] = [];
      const placeholders = chunk
        .map((row, idx) => {
          const base = idx * 6;
          values.push(row.iata_code, row.name, row.city, row.country, row.lat, row.lng);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW())`;
        })
        .join(',');
      await client.query(
        `INSERT INTO airports (iata_code, name, city, country, lat, lng, updated_at)
         VALUES ${placeholders}
         ON CONFLICT (iata_code) DO UPDATE SET iata_code = EXCLUDED.iata_code, name = EXCLUDED.name, city = EXCLUDED.city, country = EXCLUDED.country, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = NOW()`,
        values
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logError('Failed to refresh airports', err);
  } finally {
    client.release();
  }
};

export const searchUsersByEmail = async (query: string): Promise<User[]> => {
  const p = getPool();
  const like = `%${query.toLowerCase()}%`;
  const { rows } = await p.query<User>(
    `SELECT DISTINCT ON (u.id) u.id, u.email, u.provider
     FROM users u
     LEFT JOIN web_users wu ON wu.id = u.id
     LEFT JOIN user_emails ue ON ue.user_id = u.id
     WHERE LOWER(u.email) LIKE $1
        OR LOWER(COALESCE(wu.first_name, u.first_name, '')) LIKE $1
        OR LOWER(COALESCE(wu.last_name, u.last_name, '')) LIKE $1
        OR LOWER(COALESCE(wu.first_name, u.first_name, '') || ' ' || COALESCE(wu.last_name, u.last_name, '')) LIKE $1
        OR LOWER(COALESCE(ue.email, '')) LIKE $1
     ORDER BY u.id, u.email
     LIMIT 10`,
    [like]
  );
  return rows;
};

export const listTraitsForGroupTrip = async (
  userId: string,
  tripId: string
): Promise<Array<{ userId: string; name: string; traits: string[] }>> => {
  const p = getPool();
  const tripRows = await p.query<{ groupId: string }>(`SELECT group_id as "groupId" FROM trips WHERE id = $1`, [tripId]);
  if (!tripRows.rowCount) throw new Error('Trip not found');
  const membership = await p.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [
    tripRows.rows[0].groupId,
    userId,
  ]);
  if (!membership.rowCount) throw new Error('Not authorized for this trip');

  const { rows } = await p.query<
    { userId: string; email: string | null; firstName: string | null; lastName: string | null; trait: string | null }
  >(
    `SELECT gm.user_id as "userId",
            u.email,
            wu.first_name as "firstName",
            wu.last_name as "lastName",
            t.name as trait
     FROM group_members gm
     JOIN trips t2 ON t2.group_id = gm.group_id AND t2.id = $1
     LEFT JOIN users u ON u.id = gm.user_id
     LEFT JOIN web_users wu ON wu.id = gm.user_id
     LEFT JOIN traits t ON t.user_id = gm.user_id
     ORDER BY gm.created_at ASC`,
    [tripId]
  );

  const map = new Map<string, { userId: string; name: string; traits: string[] }>();
  for (const row of rows) {
    const displayName = row.firstName?.trim() || row.email || 'Traveler';
    if (!map.has(row.userId)) {
      map.set(row.userId, { userId: row.userId, name: displayName, traits: [] });
    }
    if (row.trait) {
      map.get(row.userId)!.traits.push(row.trait);
    }
  }
  return Array.from(map.values());
};

export const getUserDemographics = async (
  userId: string
): Promise<{ age: number | null; gender: string | null }> => {
  const p = getPool();
  const { rows } = await p.query<{ age: number | null; gender: string | null }>(
    `SELECT age, gender FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? { age: null, gender: null };
};

export const saveUserDemographics = async (
  userId: string,
  data: { age?: number | null; gender?: string | null } = {}
): Promise<void> => {
  const p = getPool();
  const { age = null, gender = null } = data;
  await p.query(
    `UPDATE web_users SET age = $1, gender = $2 WHERE id = $3`,
    [age ?? null, gender ?? null, userId]
  );
};

export const listItineraries = async (userId: string): Promise<Array<Itinerary & { tripName: string }>> => {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT i.id,
            i.trip_id as "tripId",
            i.destination,
            i.days,
            i.budget,
            i.created_at as "createdAt",
            t.name as "tripName"
     FROM itineraries i
     JOIN trips t ON t.id = i.trip_id
     JOIN groups g ON g.id = t.group_id
     WHERE (
       EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.group_id = g.id
           AND gm.user_id = $1
           AND gm.removed_at IS NULL
       )
       OR EXISTS (
         SELECT 1 FROM trip_followers tf
         WHERE tf.trip_id = t.id
           AND tf.follower_user_id = $1
       )
     )
     ORDER BY i.created_at DESC`,
    [userId]
  );
  return rows;
};

export const createItineraryRecord = async (
  userId: string,
  tripId: string,
  destination: string,
  days: number,
  budget?: number | null
): Promise<Itinerary & { tripName: string }> => {
  const p = getPool();
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('You must belong to the trip group to save an itinerary');
  const dupe = await p.query(
    `SELECT 1 FROM itineraries
     WHERE trip_id = $1 AND LOWER(destination) = LOWER($2) AND days = $3 AND COALESCE(budget,0) = COALESCE($4,0)
     LIMIT 1`,
    [tripId, destination.trim(), Math.max(1, Math.round(days)), budget ?? null]
  );
  if (dupe.rowCount) {
    const err = new Error('Itinerary already exists for this trip');
    (err as any).code = 'ITINERARY_EXISTS';
    throw err;
  }
  const { rows } = await p.query(
    `INSERT INTO itineraries (id, trip_id, destination, days, budget)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, trip_id as "tripId", destination, days, budget, created_at as "createdAt",
               (SELECT name FROM trips WHERE id = $2) as "tripName"`,
    [randomUUID(), tripId, destination.trim(), Math.max(1, Math.round(days)), budget ?? null]
  );
  return rows[0];
};

export const deleteItineraryRecord = async (userId: string, itineraryId: string): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string }>(
    `SELECT trip_id as "tripId" FROM itineraries WHERE id = $1`,
    [itineraryId]
  );
  if (!rows.length) throw new Error('Itinerary not found');
  const membership = await ensureUserInTrip(rows[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to delete this itinerary');
  await p.query(`DELETE FROM itineraries WHERE id = $1`, [itineraryId]);
};

export const updateItineraryRecord = async (
  userId: string,
  itineraryId: string,
  destination: string,
  days: number,
  budget?: number | null
): Promise<Itinerary & { tripName: string }> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string }>(
    `SELECT trip_id as "tripId" FROM itineraries WHERE id = $1`,
    [itineraryId]
  );
  if (!rows.length) throw new Error('Itinerary not found');
  const tripId = rows[0].tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');

  const dupe = await p.query(
    `SELECT 1 FROM itineraries
     WHERE trip_id = $1 AND LOWER(destination) = LOWER($2) AND days = $3 AND COALESCE(budget,0) = COALESCE($4,0)
       AND id <> $5
     LIMIT 1`,
    [tripId, destination.trim(), Math.max(1, Math.round(days)), budget ?? null, itineraryId]
  );
  if (dupe.rowCount) {
    const err = new Error('Itinerary already exists for this trip');
    (err as any).code = 'ITINERARY_EXISTS';
    throw err;
  }

  const { rows: updated } = await p.query(
    `UPDATE itineraries
     SET destination = $1, days = $2, budget = $3
     WHERE id = $4
     RETURNING id, trip_id as "tripId", destination, days, budget, created_at as "createdAt",
               (SELECT name FROM trips WHERE id = trip_id) as "tripName"`,
    [destination.trim(), Math.max(1, Math.round(days)), budget ?? null, itineraryId]
  );
  return updated[0];
};

export const listItineraryDetails = async (userId: string, itineraryId: string): Promise<ItineraryDetail[]> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string }>(
    `SELECT trip_id as "tripId" FROM itineraries WHERE id = $1`,
    [itineraryId]
  );
  if (!rows.length) throw new Error('Itinerary not found');
  const membership = await ensureUserCanReadTrip(rows[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to view this itinerary');
  const details = await p.query<ItineraryDetail & { kind: string; placeId: string | null; noteBody: string | null; position: number }>(
    `SELECT id,
            itinerary_id as "itineraryId",
            day,
            time,
            activity,
            cost,
            kind,
            place_id as "placeId",
            note_body as "noteBody",
            position
     FROM itinerary_details
     WHERE itinerary_id = $1
     ORDER BY day ASC,
              CASE WHEN time IS NULL THEN 1 ELSE 0 END ASC,
              time ASC,
              position ASC,
              created_at ASC`,
    [itineraryId]
  );
  if (!details.rows.length) return [];
  const detailIds = details.rows.map((d) => d.id);
  const childRes = await p.query<ItineraryChecklistItem>(
    `SELECT id,
            detail_id as "detailId",
            position,
            label,
            checked_by as "checkedBy",
            checked_at as "checkedAt",
            created_at as "createdAt"
     FROM itinerary_checklist_items
     WHERE detail_id = ANY($1::uuid[])
     ORDER BY position ASC, created_at ASC`,
    [detailIds]
  );
  const childrenByDetail = new Map<string, ItineraryChecklistItem[]>();
  for (const child of childRes.rows) {
    const list = childrenByDetail.get(child.detailId) ?? [];
    list.push(child);
    childrenByDetail.set(child.detailId, list);
  }
  return details.rows.map((row) => ({
    ...row,
    kind: (row.kind as ItineraryDetailKind) ?? 'activity',
    checklistItems: childrenByDetail.get(row.id) ?? [],
  }));
};

export const addItineraryDetail = async (
  userId: string,
  itineraryId: string,
  detail: {
    day: number;
    time?: string | null;
    activity: string;
    cost?: number | null;
    kind?: ItineraryDetailKind;
    placeId?: string | null;
    noteBody?: string | null;
    position?: number;
    checklistItems?: Array<{ label: string; position?: number }>;
  }
): Promise<ItineraryDetail> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string }>(
    `SELECT trip_id as "tripId" FROM itineraries WHERE id = $1`,
    [itineraryId]
  );
  if (!rows.length) throw new Error('Itinerary not found');
  const membership = await ensureUserInTrip(rows[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  const detailId = randomUUID();
  const kind: ItineraryDetailKind = detail.kind ?? 'activity';
  const { rows: inserted } = await p.query<ItineraryDetail & { kind: string; placeId: string | null; noteBody: string | null; position: number }>(
    `INSERT INTO itinerary_details (id, itinerary_id, day, time, activity, cost, kind, place_id, note_body, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id,
               itinerary_id as "itineraryId",
               day,
               time,
               activity,
               cost,
               kind,
               place_id as "placeId",
               note_body as "noteBody",
               position`,
    [
      detailId,
      itineraryId,
      Math.max(1, Math.round(detail.day)),
      detail.time ?? null,
      detail.activity.trim(),
      detail.cost ?? null,
      kind,
      detail.placeId ?? null,
      detail.noteBody ?? null,
      detail.position != null ? Math.round(detail.position) : 0,
    ]
  );

  let createdChildren: ItineraryChecklistItem[] = [];
  if (kind === 'checklist' && Array.isArray(detail.checklistItems) && detail.checklistItems.length) {
    for (let idx = 0; idx < detail.checklistItems.length; idx += 1) {
      const child = detail.checklistItems[idx];
      const label = String(child.label ?? '').trim();
      if (!label) continue;
      const position = child.position != null ? Math.round(child.position) : idx;
      const { rows: inserted } = await p.query<ItineraryChecklistItem>(
        `INSERT INTO itinerary_checklist_items (id, detail_id, position, label)
         VALUES ($1, $2, $3, $4)
         RETURNING id, detail_id as "detailId", position, label, checked_by as "checkedBy", checked_at as "checkedAt", created_at as "createdAt"`,
        [randomUUID(), detailId, position, label]
      );
      createdChildren.push(inserted[0]);
    }
  }

  await writeActivity(
    rows[0].tripId,
    userId,
    'ITINERARY_ITEM_ADDED',
    'Itinerary item added',
    inserted[0].activity,
    {
      itineraryId,
      detailId: inserted[0].id,
      day: inserted[0].day,
      time: inserted[0].time ?? null,
      cost: inserted[0].cost ?? null,
      kind,
    }
  );
  return {
    ...inserted[0],
    kind: (inserted[0].kind as ItineraryDetailKind) ?? 'activity',
    checklistItems: createdChildren,
  };
};

export const deleteItineraryDetail = async (userId: string, detailId: string): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query<{ itineraryId: string; tripId: string; activity: string; day: number; time: string | null; cost: number | null }>(
    `SELECT d.itinerary_id as "itineraryId", i.trip_id as "tripId"
            ,d.activity, d.day, d.time, d.cost
     FROM itinerary_details d
     JOIN itineraries i ON i.id = d.itinerary_id
     WHERE d.id = $1`,
    [detailId]
  );
  if (!rows.length) throw new Error('Itinerary detail not found');
  const membership = await ensureUserInTrip(rows[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  await p.query(`DELETE FROM itinerary_details WHERE id = $1`, [detailId]);
  await writeActivity(
    rows[0].tripId,
    userId,
    'ITINERARY_ITEM_DELETED',
    'Itinerary item removed',
    rows[0].activity,
    {
      itineraryId: rows[0].itineraryId,
      detailId,
      day: rows[0].day,
      time: rows[0].time ?? null,
      cost: rows[0].cost ?? null,
    }
  );
};

export const updateItineraryDetail = async (
  userId: string,
  detailId: string,
  detail: Partial<ItineraryDetail>
): Promise<ItineraryDetail> => {
  const p = getPool();
  const { rows } = await p.query<{ itineraryId: string; tripId: string }>(
    `SELECT d.itinerary_id as "itineraryId", i.trip_id as "tripId"
     FROM itinerary_details d
     JOIN itineraries i ON i.id = d.itinerary_id
     WHERE d.id = $1`,
    [detailId]
  );
  if (!rows.length) throw new Error('Itinerary detail not found');
  const membership = await ensureUserInTrip(rows[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');

  const day = detail.day != null ? Math.max(1, Math.round(detail.day)) : undefined;
  const time = detail.time ?? null;
  const activity = detail.activity?.trim();
  const cost = detail.cost != null ? Number(detail.cost) : null;
  const placeId = detail.placeId !== undefined ? detail.placeId : undefined;
  const noteBody = detail.noteBody !== undefined ? detail.noteBody : undefined;
  const position = detail.position !== undefined ? detail.position : undefined;

  if (!activity) throw new Error('Activity is required');

  const { rows: updated } = await p.query(
    `UPDATE itinerary_details
     SET day = COALESCE($1, day),
         time = $2,
         activity = $3,
         cost = $4,
         place_id = COALESCE($5, place_id),
         note_body = COALESCE($6, note_body),
         position = COALESCE($7, position)
     WHERE id = $8
     RETURNING id,
               itinerary_id as "itineraryId",
               day,
               time,
               activity,
               cost,
               kind,
               place_id as "placeId",
               note_body as "noteBody",
               position`,
    [
      day ?? null,
      time,
      activity,
      cost,
      placeId !== undefined ? placeId : null,
      noteBody !== undefined ? noteBody : null,
      position !== undefined ? Math.round(position) : null,
      detailId,
    ]
  );
  await writeActivity(
    rows[0].tripId,
    userId,
    'ITINERARY_ITEM_UPDATED',
    'Itinerary item updated',
    updated[0].activity,
    {
      itineraryId: rows[0].itineraryId,
      detailId: updated[0].id,
      day: updated[0].day,
      time: updated[0].time ?? null,
      cost: updated[0].cost ?? null,
    }
  );
  return {
    ...updated[0],
    kind: (updated[0].kind as ItineraryDetailKind) ?? 'activity',
  };
};

// ---------------------------------------------------------------------------
// Checklist children for kind='checklist' itinerary details.
// ---------------------------------------------------------------------------

const loadChecklistItemContext = async (
  itemId: string
): Promise<{ tripId: string; detailId: string; itineraryId: string } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string; detailId: string; itineraryId: string }>(
    `SELECT i.trip_id as "tripId", d.id as "detailId", d.itinerary_id as "itineraryId"
     FROM itinerary_checklist_items c
     JOIN itinerary_details d ON d.id = c.detail_id
     JOIN itineraries i ON i.id = d.itinerary_id
     WHERE c.id = $1`,
    [itemId]
  );
  return rows[0] ?? null;
};

export const addItineraryChecklistItem = async (
  userId: string,
  detailId: string,
  input: { label: string; position?: number }
): Promise<ItineraryChecklistItem> => {
  const p = getPool();
  const { rows: ctx } = await p.query<{ tripId: string; kind: string }>(
    `SELECT i.trip_id as "tripId", d.kind
     FROM itinerary_details d
     JOIN itineraries i ON i.id = d.itinerary_id
     WHERE d.id = $1`,
    [detailId]
  );
  if (!ctx.length) throw new Error('Itinerary detail not found');
  if (ctx[0].kind !== 'checklist') throw new Error('Detail is not a checklist');
  const membership = await ensureUserInTrip(ctx[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  const label = String(input.label ?? '').trim();
  if (!label) throw new Error('Label is required');

  let position = input.position;
  if (position == null) {
    const { rows } = await p.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 as next FROM itinerary_checklist_items WHERE detail_id = $1`,
      [detailId]
    );
    position = rows[0]?.next ?? 0;
  }

  const { rows: inserted } = await p.query<ItineraryChecklistItem>(
    `INSERT INTO itinerary_checklist_items (id, detail_id, position, label)
     VALUES ($1, $2, $3, $4)
     RETURNING id, detail_id as "detailId", position, label, checked_by as "checkedBy", checked_at as "checkedAt", created_at as "createdAt"`,
    [randomUUID(), detailId, Math.round(position), label]
  );
  return inserted[0];
};

export const updateItineraryChecklistItem = async (
  userId: string,
  itemId: string,
  patch: { label?: string; checked?: boolean; position?: number }
): Promise<ItineraryChecklistItem> => {
  const p = getPool();
  const ctx = await loadChecklistItemContext(itemId);
  if (!ctx) throw new Error('Checklist item not found');
  const membership = await ensureUserInTrip(ctx.tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');

  const sets: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (patch.label !== undefined) {
    const label = String(patch.label ?? '').trim();
    if (!label) throw new Error('Label cannot be empty');
    sets.push(`label = $${paramIdx++}`);
    params.push(label);
  }
  if (patch.position !== undefined) {
    sets.push(`position = $${paramIdx++}`);
    params.push(Math.round(patch.position));
  }
  if (patch.checked !== undefined) {
    if (patch.checked) {
      sets.push(`checked_by = $${paramIdx++}`);
      params.push(userId);
      sets.push(`checked_at = NOW()`);
    } else {
      sets.push(`checked_by = NULL`);
      sets.push(`checked_at = NULL`);
    }
  }
  if (!sets.length) {
    const { rows } = await p.query<ItineraryChecklistItem>(
      `SELECT id, detail_id as "detailId", position, label, checked_by as "checkedBy", checked_at as "checkedAt", created_at as "createdAt"
       FROM itinerary_checklist_items WHERE id = $1`,
      [itemId]
    );
    return rows[0];
  }
  params.push(itemId);
  const { rows: updated } = await p.query<ItineraryChecklistItem>(
    `UPDATE itinerary_checklist_items
     SET ${sets.join(', ')}
     WHERE id = $${paramIdx}
     RETURNING id, detail_id as "detailId", position, label, checked_by as "checkedBy", checked_at as "checkedAt", created_at as "createdAt"`,
    params
  );
  return updated[0];
};

export const deleteItineraryChecklistItem = async (
  userId: string,
  itemId: string
): Promise<void> => {
  const p = getPool();
  const ctx = await loadChecklistItemContext(itemId);
  if (!ctx) throw new Error('Checklist item not found');
  const membership = await ensureUserInTrip(ctx.tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  await p.query(`DELETE FROM itinerary_checklist_items WHERE id = $1`, [itemId]);
};


// Family relationship helpers

type FamilyProfile = {
  id: string;
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  provider: string;
};

const mapFamilyView = (row: any, userId: string) => {
  const direction = row.requester_id === userId ? 'outbound' : 'inbound';
  const profile: FamilyProfile = {
    id: row.other_id,
    email: row.other_email,
    firstName: row.other_first_name,
    middleName: row.other_middle_name,
    lastName: row.other_last_name,
    provider: row.other_provider,
  };
  return {
    id: row.id,
    relationship: row.relationship,
    status: row.status as 'pending' | 'accepted' | 'rejected',
    direction,
    relative: profile,
    editableProfile: profile.provider === 'family',
  };
};

export const listFamilyRelationships = async (userId: string) => {
  const p = getPool();
  const { rows } = await p.query(
    `
      SELECT fr.id,
             fr.requester_id,
             fr.relative_id,
             fr.relationship,
             fr.status,
             fr.created_at,
             u.id as other_id,
             u.email as other_email,
             u.provider as other_provider,
             wu.first_name as other_first_name,
             wu.middle_name as other_middle_name,
             wu.last_name as other_last_name
      FROM family_relationships fr
      JOIN users u ON (CASE WHEN fr.requester_id = $1 THEN fr.relative_id ELSE fr.requester_id END) = u.id
      LEFT JOIN web_users wu ON wu.id = u.id
      WHERE fr.requester_id = $1 OR (fr.relative_id = $1 AND fr.status = 'pending')
    `,
    [userId]
  );
  return rows.map((row) => mapFamilyView(row, userId));
};

export const listFellowTravelers = async (ownerId: string) => {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT id, first_name as "firstName", last_name as "lastName", email, created_at as "createdAt"
     FROM fellow_travelers
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [ownerId]
  );
  return rows;
};

export const createFellowTraveler = async (ownerId: string, firstName: string, lastName: string, email?: string | null) => {
  const p = getPool();
  const given = firstName.trim();
  const family = lastName.trim();
  const normalizedEmail = String(email ?? '').trim().toLowerCase() || null;
  if (!given || !family) throw new Error('firstName and lastName are required');
  const id = randomUUID();
  await p.query(
    `INSERT INTO fellow_travelers (id, owner_id, first_name, last_name, email)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (owner_id, LOWER(first_name), LOWER(last_name)) DO NOTHING`,
    [id, ownerId, given, family, normalizedEmail]
  );
  return id;
};

export const updateFellowTraveler = async (
  ownerId: string,
  travelerId: string,
  firstName: string,
  lastName: string,
  email?: string | null
) => {
  const p = getPool();
  const given = firstName.trim();
  const family = lastName.trim();
  const normalizedEmail = String(email ?? '').trim().toLowerCase() || null;
  if (!given || !family) throw new Error('firstName and lastName are required');
  const { rowCount } = await p.query(
    `UPDATE fellow_travelers
     SET first_name = $1, last_name = $2, email = $3
     WHERE id = $4 AND owner_id = $5`,
    [given, family, normalizedEmail, travelerId, ownerId]
  );
  if (!rowCount) throw new Error('Fellow traveler not found');
};

export const removeFellowTraveler = async (ownerId: string, travelerId: string) => {
  const p = getPool();
  const { rowCount } = await p.query(`DELETE FROM fellow_travelers WHERE id = $1 AND owner_id = $2`, [
    travelerId,
    ownerId,
  ]);
  if (!rowCount) throw new Error('Fellow traveler not found');
};

export const searchTripContacts = async (ownerId: string, query: string) => {
  const p = getPool();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const like = `%${q}%`;

  const fellowResult = await p.query(
    `SELECT id,
            first_name as "firstName",
            last_name as "lastName",
            NULL::text as "email",
            'fellow' as "source"
     FROM fellow_travelers
     WHERE owner_id = $1
       AND (LOWER(first_name) LIKE $2 OR LOWER(last_name) LIKE $2 OR LOWER(first_name || ' ' || last_name) LIKE $2)
     ORDER BY created_at DESC`,
    [ownerId, like]
  );

  const memberResult = await p.query(
    `SELECT DISTINCT u.id as "id",
            wu.first_name as "firstName",
            wu.last_name as "lastName",
            u.email as "email",
            'user' as "source"
     FROM group_members gm
     JOIN group_members gm_self ON gm_self.group_id = gm.group_id AND gm_self.user_id = $1
     JOIN users u ON gm.user_id = u.id
     LEFT JOIN web_users wu ON wu.id = u.id
     WHERE gm.user_id <> $1
       AND (LOWER(wu.first_name) LIKE $2 OR LOWER(wu.last_name) LIKE $2 OR LOWER(wu.first_name || ' ' || wu.last_name) LIKE $2 OR LOWER(u.email) LIKE $2)`,
    [ownerId, like]
  );

  const combined = [...fellowResult.rows, ...memberResult.rows];
  const seen = new Set<string>();
  return combined.filter((row) => {
    const key = `${row.source}:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const createFamilyRelationship = async (
  ownerId: string,
  payload: { givenName: string; middleName?: string | null; familyName: string; email: string; relationship: string }
) => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const given = (payload.givenName || '').trim();
    const family = (payload.familyName || '').trim();
    const rawEmail = (payload.email || '').trim().toLowerCase();
    const relationship = (payload.relationship || '').trim() || 'Not Applicable';
    if (!given || !family) {
      throw new Error('givenName and familyName are required');
    }

    let relativeId: string | null = null;
    let status: 'pending' | 'accepted' = 'accepted';

    if (rawEmail) {
      const existing = await client.query<{ id: string; provider: string }>('SELECT id, provider FROM users WHERE email = $1', [rawEmail]);
      relativeId = existing.rows[0]?.id ?? null;
      status = existing.rows.length ? 'pending' : 'accepted';
    }
    if (relativeId === ownerId) {
      throw new Error('Cannot add yourself as a family member');
    }

    if (!relativeId) {
      relativeId = randomUUID();
      const salt = randomBytes(16).toString('hex');
      const passwordHash = hashPassword(randomBytes(12).toString('hex'), salt);
      const emailToUse = rawEmail || `family-${relativeId}@placeholder.local`;
      await client.query(`INSERT INTO users (id, email, provider) VALUES ($1, $2, 'family')`, [relativeId, emailToUse]);
      await client.query(
        `INSERT INTO web_users (id, email, first_name, middle_name, last_name, password_hash, salt)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [relativeId, emailToUse, given, payload.middleName ?? null, family, passwordHash, salt]
      );
    }

    const relationshipId = randomUUID();
    const { rows: relRows } = await client.query(
      `INSERT INTO family_relationships (id, requester_id, relative_id, relationship, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (requester_id, relative_id)
       DO UPDATE SET relationship = EXCLUDED.relationship, status = EXCLUDED.status
       RETURNING id, status`,
      [relationshipId, ownerId, relativeId, relationship, status]
    );

    if (status === 'accepted') {
      await client.query(
        `INSERT INTO family_relationships (id, requester_id, relative_id, relationship, status)
         VALUES ($1, $2, $3, $4, 'accepted')
         ON CONFLICT (requester_id, relative_id)
         DO UPDATE SET relationship = EXCLUDED.relationship, status = 'accepted'`,
        [randomUUID(), relativeId, ownerId, relationship]
      );
    }

    await client.query('COMMIT');
    return { id: relRows[0].id as string, status, relativeId, needsAcceptance: status === 'pending' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const acceptFamilyRelationship = async (userId: string, relationshipId: string) => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT requester_id, relative_id, relationship, status FROM family_relationships WHERE id = $1 FOR UPDATE`,
      [relationshipId]
    );
    if (!rows.length) throw new Error('Relationship not found');
    const rel = rows[0];
    if (rel.relative_id !== userId) throw new Error('Not authorized to accept this relationship');
    if (rel.status !== 'pending') throw new Error('Relationship already handled');

    await client.query(`UPDATE family_relationships SET status = 'accepted' WHERE id = $1`, [relationshipId]);
    await client.query(
      `INSERT INTO family_relationships (id, requester_id, relative_id, relationship, status)
       VALUES ($1, $2, $3, $4, 'accepted')
       ON CONFLICT (requester_id, relative_id)
       DO UPDATE SET relationship = EXCLUDED.relationship, status = 'accepted'`,
      [randomUUID(), userId, rel.requester_id, rel.relationship]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const rejectFamilyRelationship = async (userId: string, relationshipId: string) => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT requester_id, relative_id FROM family_relationships WHERE id = $1 FOR UPDATE`,
      [relationshipId]
    );
    if (!rows.length) throw new Error('Relationship not found');
    const rel = rows[0];
    if (rel.relative_id !== userId) throw new Error('Not authorized to reject this relationship');
    await client.query(`DELETE FROM family_relationships WHERE requester_id = $1 AND relative_id = $2`, [
      rel.requester_id,
      rel.relative_id,
    ]);
    await client.query(`DELETE FROM family_relationships WHERE requester_id = $1 AND relative_id = $2`, [
      rel.relative_id,
      rel.requester_id,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const removeFamilyRelationship = async (userId: string, relationshipId: string): Promise<void> => {
  const p = getPool();
  await p.query('DELETE FROM family_relationships WHERE id = $1 AND (requester_id = $2 OR relative_id = $2)', [relationshipId, userId]);
};

export const removeTravelerFromTrip = async (userId: string, tripId: string, travelerId: string): Promise<void> => {
  // TODO: implement for postgres
  throw new Error('removeTravelerFromTrip not implemented for postgres');
};




export const updateFamilyProfile = async (
  userId: string,
  relationshipId: string,
  updates: { givenName?: string; middleName?: string | null; familyName?: string; email?: string; relationship?: string }
) => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT requester_id, relative_id, relationship FROM family_relationships WHERE id = $1 FOR UPDATE`,
      [relationshipId]
    );
    if (!rows.length) throw new Error('Relationship not found');
    const rel = rows[0];
    if (rel.requester_id !== userId) throw new Error('Not authorized to edit this relationship');

    const { rows: userRows } = await client.query<{ provider: string }>(
      `SELECT provider FROM users WHERE id = $1`,
      [rel.relative_id]
    );
    if (!userRows.length || userRows[0].provider !== 'family') {
      throw new Error('Only non-user family profiles can be edited');
    }

    if (updates.email) {
      const emailExists = await client.query(
        `SELECT 1 FROM web_users WHERE email = $1 AND id <> $2`,
        [updates.email.toLowerCase(), rel.relative_id]
      );
      if (emailExists.rowCount) {
        const err = new Error('Email already in use');
        (err as any).code = 'EMAIL_TAKEN';
        throw err;
      }
    }

    await client.query(
      `UPDATE web_users
       SET first_name = COALESCE($2, first_name),
           middle_name = COALESCE($3, middle_name),
           last_name = COALESCE($4, last_name),
           email = COALESCE($5, email)
       WHERE id = $1`,
      [
        rel.relative_id,
        updates.givenName ?? null,
        updates.middleName ?? null,
        updates.familyName ?? null,
        updates.email ? updates.email.toLowerCase() : null,
      ]
    );
    if (updates.email) {
      await client.query(`UPDATE users SET email = $2 WHERE id = $1`, [rel.relative_id, updates.email.toLowerCase()]);
    }
    if (updates.relationship) {
      await client.query(`UPDATE family_relationships SET relationship = $2 WHERE requester_id = $1 AND relative_id = $3`, [
        userId,
        updates.relationship,
        rel.relative_id,
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


export const getPlaceDetailsCache = async (placeId: string): Promise<PlaceDetailsCache | null> => {
  const p = getPool();
  const { rows } = await p.query<PlaceDetailsCache>(
    `SELECT place_id as "placeId", name, details, fetched_at as "fetchedAt"
     FROM place_details_cache
     WHERE place_id = $1
     LIMIT 1`,
    [placeId]
  );
  return rows[0] ?? null;
};

export const getTripGroupId = async (tripId: string): Promise<string | null> => {
  const p = getPool();
  const { rows } = await p.query<{ groupId: string }>(
    `SELECT group_id as "groupId" FROM trips WHERE id = $1 LIMIT 1`,
    [tripId]
  );
  return rows[0]?.groupId ?? null;
};

export const getTripById = async (tripId: string): Promise<Trip | null> => {
  const p = getPool();
  const { rows } = await p.query<Trip>(
    `SELECT id,
            group_id as "groupId",
            name,
            description,
            destination,
            COALESCE(location_ids, '[]'::jsonb) as "locationIds",
            start_date as "startDate",
            end_date as "endDate",
            start_month as "startMonth",
            start_year as "startYear",
            duration_days as "durationDays",
            currency,
            covered_by as "coveredBy",
            created_at as "createdAt"
     FROM trips WHERE id = $1 LIMIT 1`,
    [tripId]
  );
  return rows[0] ?? null;
};

export const getPlaceLookupCache = async (queryKey: string): Promise<{ queryKey: string; placeId: string; name: string; likelihood: number; fetchedAt: string } | null> => {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT query_key as "queryKey",
            place_id as "placeId",
            name,
            likelihood,
            fetched_at as "fetchedAt"
     FROM place_lookup_cache
     WHERE query_key = $1
     LIMIT 1`,
    [queryKey]
  );
  return rows[0] ?? null;
};

export const upsertPlaceDetailsCache = async (entry: {
  placeId: string;
  name: string;
  details: Record<string, any>;
  fetchedAt?: string | Date;
}): Promise<void> => {
  const p = getPool();
  const fetchedAt = entry.fetchedAt ? new Date(entry.fetchedAt) : new Date();
  await p.query(
    `INSERT INTO place_details_cache (place_id, name, details, fetched_at)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (place_id) DO UPDATE
     SET name = EXCLUDED.name,
         details = EXCLUDED.details,
         fetched_at = EXCLUDED.fetched_at`,
    [entry.placeId, entry.name, JSON.stringify(entry.details ?? {}), fetchedAt]
  );
};

export const upsertPlaceLookupCache = async (entry: {
  queryKey: string;
  placeId: string;
  name: string;
  likelihood: number;
  fetchedAt?: string | Date;
}): Promise<void> => {
  const p = getPool();
  const fetchedAt = entry.fetchedAt ? new Date(entry.fetchedAt) : new Date();
  await p.query(
    `INSERT INTO place_lookup_cache (query_key, place_id, name, likelihood, fetched_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (query_key) DO UPDATE
     SET place_id = EXCLUDED.place_id,
         name = EXCLUDED.name,
         likelihood = EXCLUDED.likelihood,
         fetched_at = EXCLUDED.fetched_at`,
    [entry.queryKey, entry.placeId, entry.name, entry.likelihood, fetchedAt]
  );
};


export const getUniversalPackingList = async (): Promise<PackingListItem[]> => {
  const p = getPool();
  const { rows } = await p.query<PackingListItem>(
    `SELECT id, category, label, position, created_at as "createdAt", updated_at as "updatedAt"
     FROM universal_packing_list_items
     ORDER BY position, category, label`
  );
  return rows;
};

export const replaceUniversalPackingList = async (itemsInput: Array<{ id?: string; category?: unknown; label?: unknown }>): Promise<PackingListItem[]> => {
  const p = getPool();
  const items = sanitizePackingItems(itemsInput);
  if (!items.length) throw new Error('At least one packing item is required');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM universal_packing_list_items`);
    for (const item of items) {
      await client.query(
        `INSERT INTO universal_packing_list_items (id, category, label, position)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), item.category, item.label, item.position]
      );
    }
    await backfillUserPackingLists(client);
    await client.query('COMMIT');
    return getUniversalPackingList();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const getUserPackingList = async (userId: string): Promise<PackingListItem[]> => {
  const p = getPool();
  await ensurePackingListForUserWithRunner(p, userId);
  const { rows } = await p.query<PackingListItem>(
    `SELECT id, category, label, position, created_at as "createdAt", updated_at as "updatedAt"
     FROM user_packing_list_items
     WHERE user_id = $1
     ORDER BY position, category, label`,
    [userId]
  );
  return rows;
};

export const replaceUserPackingList = async (userId: string, itemsInput: Array<{ id?: string; category?: unknown; label?: unknown }>): Promise<PackingListItem[]> => {
  const p = getPool();
  const items = sanitizePackingItems(itemsInput);
  if (!items.length) throw new Error('At least one packing item is required');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM user_packing_list_items WHERE user_id = $1`, [userId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO user_packing_list_items (id, user_id, category, label, position)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), userId, item.category, item.label, item.position]
      );
    }
    await client.query('COMMIT');
    return getUserPackingList(userId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const getTripPackingList = async (userId: string, tripId: string): Promise<{ items: TripPackingList[]; travelers: PackingListTraveler[] }> => {
  const p = getPool();
  await ensureUserCanReadTrip(tripId, userId);
  await ensureTripPackingListWithRunner(p, tripId);
  const travelersResult = await p.query<PackingListTraveler>(
    `SELECT gm.id,
            gm.user_id as "userId",
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(wu.first_name, gm.first_name, ''), ' ', COALESCE(wu.last_name, gm.last_name, ''))), ''),
              gm.guest_name,
              u.email,
              gm.invite_email,
              'Traveler'
            ) as name,
            COALESCE(u.email, gm.invite_email) as email
     FROM trips t
     JOIN group_members gm ON gm.group_id = t.group_id
     LEFT JOIN users u ON u.id = gm.user_id
     LEFT JOIN web_users wu ON wu.id = gm.user_id
     WHERE t.id = $1 AND gm.removed_at IS NULL
     ORDER BY gm.created_at, name`,
    [tripId]
  );
  const itemsResult = await p.query<PackingListItem>(
    `SELECT id, category, label, position, created_at as "createdAt", updated_at as "updatedAt"
     FROM trip_packing_list_items
     WHERE trip_id = $1
     ORDER BY position, category, label`,
    [tripId]
  );
  const checks = await p.query<{ itemId: string; travelerId: string }>(
    `SELECT item_id as "itemId", traveler_id as "travelerId"
     FROM trip_packing_item_checks
     WHERE packed = TRUE AND item_id = ANY($1::uuid[])`,
    [itemsResult.rows.map((item) => item.id)]
  );
  const checkedByItem = new Map<string, string[]>();
  for (const check of checks.rows) {
    checkedByItem.set(check.itemId, [...(checkedByItem.get(check.itemId) ?? []), check.travelerId]);
  }
  return {
    travelers: travelersResult.rows,
    items: itemsResult.rows.map((item) => ({ ...item, packedBy: checkedByItem.get(item.id) ?? [] })),
  };
};

export const replaceTripPackingList = async (
  userId: string,
  tripId: string,
  itemsInput: Array<{ id?: string; category?: unknown; label?: unknown }>
): Promise<{ items: TripPackingList[]; travelers: PackingListTraveler[] }> => {
  const p = getPool();
  await ensureUserCanReadTrip(tripId, userId);
  const items = sanitizePackingItems(itemsInput);
  if (!items.length) throw new Error('At least one packing item is required');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM trip_packing_list_items WHERE trip_id = $1`, [tripId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO trip_packing_list_items (id, trip_id, category, label, position)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), tripId, item.category, item.label, item.position]
      );
    }
    await client.query('COMMIT');
    return getTripPackingList(userId, tripId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const setTripPackingItemPacked = async (
  userId: string,
  tripId: string,
  itemId: string,
  travelerId: string,
  packed: boolean
): Promise<void> => {
  const p = getPool();
  await ensureUserCanReadTrip(tripId, userId);
  const valid = await p.query(
    `SELECT 1
     FROM trip_packing_list_items item
     JOIN trips t ON t.id = item.trip_id
     JOIN group_members gm ON gm.group_id = t.group_id
     WHERE item.id = $1 AND item.trip_id = $2 AND gm.id = $3 AND gm.removed_at IS NULL
     LIMIT 1`,
    [itemId, tripId, travelerId]
  );
  if (!valid.rowCount) throw new Error('Packing item or traveler not found');
  if (packed) {
    await p.query(
      `INSERT INTO trip_packing_item_checks (item_id, traveler_id, packed, updated_at)
       VALUES ($1, $2, TRUE, NOW())
       ON CONFLICT (item_id, traveler_id) DO UPDATE SET packed = TRUE, updated_at = NOW()`,
      [itemId, travelerId]
    );
  } else {
    await p.query(`DELETE FROM trip_packing_item_checks WHERE item_id = $1 AND traveler_id = $2`, [itemId, travelerId]);
  }
};

// Backwards-compatible export; call poolClient() when you need the Pool instance.
export const poolClient = (): Pool => getPool();

export const findOrCreateGoogleUser = async (profile: any): Promise<User> => {
    const p = getPool();
    const { id, displayName, emails, photos, name } = profile;

    const email = normalizeEmail(String(emails?.[0]?.value ?? ''));
    if (!email) {
        throw new Error('Google profile did not return an email');
    }

    const existing = await p.query<User>(`SELECT * FROM users WHERE google_id = $1`, [id]);
    if (existing.rows.length) {
        const user = existing.rows[0];
        await p.query(
            `UPDATE users SET email = $1, picture = $2, first_name = $3, last_name = $4, email_verified = true, email_verified_at = NOW() WHERE id = $5`,
            [email, photos?.[0]?.value, name?.givenName, name?.familyName, user.id]
        );
        await upsertUserEmail(p, user.id, email, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
        await ensurePackingListForUserWithRunner(p, user.id);
        return user;
    }

    const existingByEmail = await p.query<User>(
      `SELECT u.*
       FROM users u
       JOIN user_emails ue ON ue.user_id = u.id
       WHERE ue.email_normalized = $1
       LIMIT 1`,
      [email]
    );
    if (existingByEmail.rows.length) {
        const user = existingByEmail.rows[0];
        await p.query(
            `UPDATE users SET google_id = $1, picture = $2, first_name = $3, last_name = $4, email_verified = true, email_verified_at = NOW() WHERE id = $5`,
            [id, photos?.[0]?.value, name?.givenName, name?.familyName, user.id]
        );
        await upsertUserEmail(p, user.id, email, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
        await ensurePackingListForUserWithRunner(p, user.id);
        return user;
    }

    const newUserId = randomUUID();
    const username = await generateUniqueUsername(p, name?.givenName ?? '', name?.familyName ?? '', email);
    await p.query(
        `INSERT INTO users (id, email, username, username_normalized, provider, google_id, picture, first_name, last_name, email_verified, email_verified_at)
         VALUES ($1, $2, $3, $4, 'google', $5, $6, $7, $8, true, NOW())`,
        [newUserId, email, username, username, id, photos?.[0]?.value, name?.givenName, name?.familyName]
    );
    await upsertUserEmail(p, newUserId, email, { isPrimary: true, isVerified: true, verifiedAt: new Date() });
    await ensurePackingListForUserWithRunner(p, newUserId);

    return { id: newUserId, email, provider: 'google', emailVerified: true, role: 'user' };
};

export const deleteAllUsers = async (userIds: string[]): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
};

// ---- Entitlement system functions ----

export const getUserRole = async (userId: string): Promise<UserRole> => {
  const p = getPool();
  const { rows } = await p.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [userId]);
  return (rows[0]?.role ?? 'user') as UserRole;
};

export const setUserRole = async (userId: string, role: UserRole): Promise<void> => {
  const p = getPool();
  await p.query(`UPDATE users SET role = $1 WHERE id = $2`, [role, userId]);
};

export const listTiers = async (): Promise<Tier[]> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; key: string; display_name: string; rank: number; is_active: boolean; created_at: string;
  }>(`SELECT id, key, display_name, rank, is_active, created_at FROM tiers ORDER BY rank`);
  return rows.map(r => ({
    id: r.id,
    key: r.key,
    displayName: r.display_name,
    rank: r.rank,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
};

export const getTierByKey = async (key: string): Promise<Tier | null> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; key: string; display_name: string; rank: number; is_active: boolean; created_at: string;
  }>(`SELECT id, key, display_name, rank, is_active, created_at FROM tiers WHERE key = $1`, [key]);
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, key: r.key, displayName: r.display_name, rank: r.rank, isActive: r.is_active, createdAt: r.created_at };
};

export const listFeatures = async (): Promise<Feature[]> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; key: string; description: string; default_enabled: boolean; created_at: string;
  }>(`SELECT id, key, description, default_enabled, created_at FROM features ORDER BY key`);
  return rows.map(r => ({
    id: r.id,
    key: r.key,
    description: r.description,
    defaultEnabled: r.default_enabled,
    createdAt: r.created_at,
  }));
};

export const listTierLimits = async (tierId: string): Promise<TierLimit[]> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; tier_id: string; limit_key: string; limit_value: number; created_at: string;
  }>(`SELECT id, tier_id, limit_key, limit_value, created_at FROM tier_limits WHERE tier_id = $1`, [tierId]);
  return rows.map(r => ({
    id: r.id,
    tierId: r.tier_id,
    limitKey: r.limit_key,
    limitValue: r.limit_value,
    createdAt: r.created_at,
  }));
};

export const upsertTierLimit = async (tierId: string, limitKey: string, limitValue: number): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO tier_limits (id, tier_id, limit_key, limit_value)
     VALUES (uuid_generate_v4(), $1, $2, $3)
     ON CONFLICT (tier_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value`,
    [tierId, limitKey, limitValue]
  );
};

export const getTierLimitValue = async (tierId: string, limitKey: string): Promise<number | null> => {
  const p = getPool();
  const { rows } = await p.query<{ limit_value: number }>(
    `SELECT limit_value FROM tier_limits WHERE tier_id = $1 AND limit_key = $2`,
    [tierId, limitKey]
  );
  return rows[0]?.limit_value ?? null;
};

export const listTierEntitlements = async (tierId: string): Promise<TierEntitlement[]> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; tier_id: string; feature_id: string; is_allowed: boolean; created_at: string;
  }>(`SELECT id, tier_id, feature_id, is_allowed, created_at FROM tier_entitlements WHERE tier_id = $1`, [tierId]);
  return rows.map(r => ({
    id: r.id,
    tierId: r.tier_id,
    featureId: r.feature_id,
    isAllowed: r.is_allowed,
    createdAt: r.created_at,
  }));
};

export const upsertTierEntitlement = async (tierId: string, featureId: string, isAllowed: boolean): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO tier_entitlements (id, tier_id, feature_id, is_allowed)
     VALUES (uuid_generate_v4(), $1, $2, $3)
     ON CONFLICT (tier_id, feature_id) DO UPDATE SET is_allowed = EXCLUDED.is_allowed`,
    [tierId, featureId, isAllowed]
  );
};

export const getCurrentUserTier = async (userId: string): Promise<(UserTier & { tierKey: string }) | null> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; user_id: string; tier_id: string; source: string; reason: string | null;
    assigned_by: string | null; effective_from: string; effective_to: string | null; created_at: string;
    tier_key: string;
  }>(
    `SELECT ut.id, ut.user_id, ut.tier_id, ut.source, ut.reason, ut.assigned_by,
            ut.effective_from, ut.effective_to, ut.created_at, t.key AS tier_key
     FROM user_tiers ut
     JOIN tiers t ON t.id = ut.tier_id
     WHERE ut.user_id = $1 AND ut.effective_to IS NULL
     ORDER BY ut.effective_from DESC
     LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    tierId: r.tier_id,
    source: r.source as 'system' | 'admin',
    reason: r.reason,
    assignedBy: r.assigned_by,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    createdAt: r.created_at,
    tierKey: r.tier_key,
  };
};

export const setUserTier = async (
  userId: string,
  tierKey: string,
  source: 'system' | 'billing' | 'admin_override' | 'admin',
  assignedBy: string | null,
  reason?: string
): Promise<void> => {
  const p = getPool();
  const tier = await getTierByKey(tierKey);
  if (!tier) throw new Error(`Tier not found: ${tierKey}`);
  await p.query(
    `UPDATE user_tiers SET effective_to = NOW() WHERE user_id = $1 AND effective_to IS NULL`,
    [userId]
  );
  await p.query(
    `INSERT INTO user_tiers (id, user_id, tier_id, source, reason, assigned_by)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5)`,
    [userId, tier.id, source, reason ?? null, assignedBy]
  );
};

export const ensureCurrentUserTier = async (userId: string, tierKey = 'free'): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query<{ id: string }>(
    `SELECT id
     FROM user_tiers
     WHERE user_id = $1 AND effective_to IS NULL
     LIMIT 1`,
    [userId]
  );
  if (rows.length) return;
  await setUserTier(userId, tierKey, 'system', null, 'Automatic default tier assignment');
};

export const upsertTier = async (key: string, displayName: string, rank: number): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO tiers (id, key, display_name, rank)
     VALUES (uuid_generate_v4(), $1, $2, $3)
     ON CONFLICT (key) DO NOTHING`,
    [key, displayName, rank],
  );
};

export const upsertFeature = async (key: string, description: string, defaultEnabled: boolean): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO features (id, key, description, default_enabled)
     VALUES (uuid_generate_v4(), $1, $2, $3)
     ON CONFLICT (key) DO NOTHING`,
    [key, description, defaultEnabled],
  );
};

export const getFeatureFlag = async (key: string): Promise<FeatureFlag | null> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; key: string; enabled: boolean; scope: string;
    updated_by: string | null; updated_at: string; created_at: string;
  }>(`SELECT id, key, enabled, scope, updated_by, updated_at, created_at FROM feature_flags WHERE key = $1`, [key]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    key: r.key,
    enabled: r.enabled,
    scope: r.scope as 'global',
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
};

export const listFeatureFlags = async (): Promise<FeatureFlag[]> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; key: string; enabled: boolean; scope: string;
    updated_by: string | null; updated_at: string; created_at: string;
  }>(`SELECT id, key, enabled, scope, updated_by, updated_at, created_at FROM feature_flags ORDER BY key`);
  return rows.map(r => ({
    id: r.id,
    key: r.key,
    enabled: r.enabled,
    scope: r.scope as 'global',
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  }));
};

export const setFeatureFlag = async (key: string, enabled: boolean, updatedBy: string | null): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO feature_flags (id, key, enabled, updated_by, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, enabled, updatedBy]
  );
};

export const getUsageCounter = async (userId: string, metricKey: string, windowKey: string): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ count: string }>(
    `SELECT count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 AND window_key = $3`,
    [userId, metricKey, windowKey]
  );
  return rows.length ? parseInt(rows[0].count, 10) : 0;
};

export const incrementUsageCounter = async (
  userId: string,
  metricKey: string,
  windowKey: string,
  amount = 1
): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ count: string }>(
    `INSERT INTO usage_counters (id, user_id, metric_key, window_key, count, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, metric_key, window_key)
     DO UPDATE SET count = usage_counters.count + $4, updated_at = NOW()
     RETURNING count`,
    [userId, metricKey, windowKey, amount]
  );
  return parseInt(rows[0].count, 10);
};

export const setUsageCounter = async (
  userId: string,
  metricKey: string,
  windowKey: string,
  count: number
): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO usage_counters (id, user_id, metric_key, window_key, count, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, metric_key, window_key)
     DO UPDATE SET count = $4, updated_at = NOW()`,
    [userId, metricKey, windowKey, count]
  );
};

export const appendUsageEvent = async (
  userId: string,
  metricKey: string,
  amount = 1,
  metadata?: Record<string, unknown> | null
): Promise<void> => {
  const p = getPool();
  await p.query(
    `INSERT INTO usage_events (id, user_id, metric_key, amount, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), userId, metricKey, amount, metadata ? JSON.stringify(metadata) : null]
  );
};

export const getApiCostCounter = async (provider: string, windowKey: string): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ amount_micros: string }>(
    `SELECT amount_micros
     FROM api_cost_counters
     WHERE provider = $1 AND window_key = $2`,
    [provider, windowKey]
  );
  return rows.length ? parseInt(rows[0].amount_micros, 10) : 0;
};

export const incrementApiCostCounter = async (
  provider: string,
  windowKey: string,
  amountMicros: number
): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ amount_micros: string }>(
    `INSERT INTO api_cost_counters (id, provider, window_key, amount_micros, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, NOW())
     ON CONFLICT (provider, window_key)
     DO UPDATE SET amount_micros = api_cost_counters.amount_micros + $3, updated_at = NOW()
     RETURNING amount_micros`,
    [provider, windowKey, amountMicros]
  );
  return parseInt(rows[0].amount_micros, 10);
};

export const getApiUsageCount = async (
  provider: string,
  caller: string,
  scope: 'overall' | 'caller',
  windowKey: string
): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ count: string }>(
    `SELECT count
     FROM api_usage_counters
     WHERE provider = $1 AND caller = $2 AND scope = $3 AND window_key = $4`,
    [provider, caller, scope, windowKey]
  );
  return rows.length ? parseInt(rows[0].count, 10) : 0;
};

export const atomicIncrementApiUsageIfUnderLimit = async (params: {
  provider: string;
  caller: string;
  scope: 'overall' | 'caller';
  windowKey: string;
  limit: number;
}): Promise<{ allowed: boolean; newCount: number }> => {
  const p = getPool();
  await p.query(
    `INSERT INTO api_usage_counters (id, provider, caller, scope, window_key, count, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, 0, NOW())
     ON CONFLICT (scope, provider, caller, window_key) DO NOTHING`,
    [params.provider, params.caller, params.scope, params.windowKey]
  );
  const { rows } = await p.query<{ count: string }>(
    `UPDATE api_usage_counters
     SET count = count + 1, updated_at = NOW()
     WHERE provider = $1 AND caller = $2 AND scope = $3 AND window_key = $4 AND count < $5
     RETURNING count`,
    [params.provider, params.caller, params.scope, params.windowKey, params.limit]
  );
  if (rows.length) {
    return { allowed: true, newCount: parseInt(rows[0].count, 10) };
  }
  const current = await getApiUsageCount(params.provider, params.caller, params.scope, params.windowKey);
  return { allowed: false, newCount: current };
};

export const listApiUsageCounters = async (): Promise<
  Array<{
    provider: string;
    caller: string;
    scope: 'overall' | 'caller';
    windowKey: string;
    count: number;
  }>
> => {
  const p = getPool();
  const { rows } = await p.query<{
    provider: string;
    caller: string;
    scope: 'overall' | 'caller';
    window_key: string;
    count: string;
  }>(
    `SELECT provider, caller, scope, window_key, count
     FROM api_usage_counters`
  );
  return rows.map((row) => ({
    provider: row.provider,
    caller: row.caller,
    scope: row.scope,
    windowKey: row.window_key,
    count: parseInt(row.count, 10),
  }));
};

export const resetApiUsageCounters = async (): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM api_usage_counters`);
};

export const listApiCostCounters = async (): Promise<
  Array<{
    provider: string;
    windowKey: string;
    amountMicros: number;
  }>
> => {
  const p = getPool();
  const { rows } = await p.query<{
    provider: string;
    window_key: string;
    amount_micros: string;
  }>(
    `SELECT provider, window_key, amount_micros
     FROM api_cost_counters`
  );
  return rows.map((row) => ({
    provider: row.provider,
    windowKey: row.window_key,
    amountMicros: parseInt(row.amount_micros, 10),
  }));
};

export const resetApiCostCounters = async (): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM api_cost_counters`);
};

export const atomicIncrementIfUnderLimit = async (
  userId: string,
  metricKey: string,
  windowKey: string,
  limit: number
): Promise<{ allowed: boolean; newCount: number }> => {
  const p = getPool();
  // Ensure the row exists first (upsert with 0 if missing)
  await p.query(
    `INSERT INTO usage_counters (id, user_id, metric_key, window_key, count, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, 0, NOW())
     ON CONFLICT (user_id, metric_key, window_key) DO NOTHING`,
    [userId, metricKey, windowKey]
  );
  const { rows } = await p.query<{ count: string }>(
    `UPDATE usage_counters
     SET count = count + 1, updated_at = NOW()
     WHERE user_id = $1 AND metric_key = $2 AND window_key = $3 AND count < $4
     RETURNING count`,
    [userId, metricKey, windowKey, limit]
  );
  if (rows.length) {
    return { allowed: true, newCount: parseInt(rows[0].count, 10) };
  }
  const current = await getUsageCounter(userId, metricKey, windowKey);
  return { allowed: false, newCount: current };
};

export const getGenerationIdempotency = async (key: string) => {
  const p = getPool();
  const { rows } = await p.query<{
    key: string;
    user_id: string;
    trip_id: string;
    usage_key: string | null;
    window_key: string | null;
    status: 'pending' | 'completed' | 'failed';
    result_ref: string | null;
    response_body: Record<string, unknown> | null;
    error_message: string | null;
    created_at: string;
    expires_at: string;
  }>(
    `SELECT key, user_id, trip_id, usage_key, window_key, status, result_ref, response_body, error_message, created_at, expires_at
     FROM generation_idempotency
     WHERE key = $1`,
    [key]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    key: row.key,
    userId: row.user_id,
    tripId: row.trip_id,
    usageKey: row.usage_key,
    windowKey: row.window_key,
    status: row.status,
    resultRef: row.result_ref,
    responseBody: row.response_body,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
};

export const reserveGenerationIdempotency = async (params: {
  key: string;
  userId: string;
  tripId: string;
  usageKey: string;
  windowKey: string;
  ttlSeconds?: number;
}): Promise<{ created: boolean; record: Awaited<ReturnType<typeof getGenerationIdempotency>> }> => {
  const p = getPool();
  const ttlSeconds = Math.max(60, params.ttlSeconds ?? 3600);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await p.query(
    `INSERT INTO generation_idempotency
       (key, user_id, trip_id, usage_key, window_key, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (key) DO NOTHING`,
    [params.key, params.userId, params.tripId, params.usageKey, params.windowKey, expiresAt]
  );
  const record = await getGenerationIdempotency(params.key);
  return { created: Boolean(record && record.userId === params.userId && record.status === 'pending' && record.tripId === params.tripId), record };
};

export const completeGenerationIdempotency = async (key: string, responseBody: Record<string, unknown>, resultRef?: string | null): Promise<void> => {
  const p = getPool();
  await p.query(
    `UPDATE generation_idempotency
     SET status = 'completed',
         result_ref = $2,
         response_body = $3::jsonb,
         error_message = NULL
     WHERE key = $1`,
    [key, resultRef ?? null, JSON.stringify(responseBody)]
  );
};

export const failGenerationIdempotency = async (key: string, errorMessage: string): Promise<void> => {
  const p = getPool();
  await p.query(
    `UPDATE generation_idempotency
     SET status = 'failed',
         error_message = $2
     WHERE key = $1`,
    [key, errorMessage]
  );
};

export const countReservedOrCompletedUsage = async (userId: string, usageKey: string, windowKey: string): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM generation_idempotency
     WHERE user_id = $1
       AND usage_key = $2
       AND window_key = $3
       AND status IN ('pending', 'completed')
       AND expires_at > LOCALTIMESTAMP`,
    [userId, usageKey, windowKey]
  );
  return parseInt(rows[0]?.count ?? '0', 10);
};

export const writeAuditLog = async (entry: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: AuditAction;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AuditLogEntry> => {
  const p = getPool();
  const id = randomUUID();
  await p.query(
    `INSERT INTO audit_log
       (id, actor_user_id, target_user_id, action, before_state, after_state, reason, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      entry.actorUserId ?? null,
      entry.targetUserId ?? null,
      entry.action,
      entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      entry.afterState ? JSON.stringify(entry.afterState) : null,
      entry.reason ?? null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ]
  );
  return {
    id,
    actorUserId: entry.actorUserId ?? null,
    targetUserId: entry.targetUserId ?? null,
    action: entry.action,
    beforeState: entry.beforeState ?? null,
    afterState: entry.afterState ?? null,
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt: new Date().toISOString(),
  };
};

export const listAuditLog = async (opts: {
  actorUserId?: string;
  targetUserId?: string;
  action?: string;
  page?: number;
  limit?: number;
}): Promise<{ entries: AuditLogEntry[]; total: number }> => {
  const p = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (opts.actorUserId) { conditions.push(`actor_user_id = $${idx++}`); params.push(opts.actorUserId); }
  if (opts.targetUserId) { conditions.push(`target_user_id = $${idx++}`); params.push(opts.targetUserId); }
  if (opts.action) { conditions.push(`action = $${idx++}`); params.push(opts.action); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await p.query<{ count: string }>(`SELECT COUNT(*) as count FROM audit_log ${where}`, params);
  const total = parseInt(countResult.rows[0].count, 10);
  params.push(limit, offset);
  const { rows } = await p.query<{
    id: string; actor_user_id: string | null; target_user_id: string | null; action: string;
    before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null;
    reason: string | null; ip_address: string | null; user_agent: string | null; created_at: string;
  }>(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`, params);
  return {
    total,
    entries: rows.map(r => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      targetUserId: r.target_user_id,
      action: r.action as AuditAction,
      beforeState: r.before_state,
      afterState: r.after_state,
      reason: r.reason,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })),
  };
};

export const deleteAuditLog = async (opts: {
  targetUserId?: string;
  action?: string;
}): Promise<void> => {
  const p = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (opts.targetUserId) { conditions.push(`target_user_id = $${idx++}`); params.push(opts.targetUserId); }
  if (opts.action) { conditions.push(`action = $${idx++}`); params.push(opts.action); }
  if (!conditions.length) return;
  await p.query(`DELETE FROM audit_log WHERE ${conditions.join(' AND ')}`, params);
};

export const setPasswordSetupRequired = async (userId: string, required: boolean): Promise<void> => {
  const p = getPool();
  await p.query(`UPDATE web_users SET password_setup_required = $1 WHERE id = $2`, [required, userId]);
};

export const countActiveTripsForUser = async (userId: string): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ count: string }>(
    `SELECT COUNT(DISTINCT t.id) AS count
     FROM trips t
     JOIN groups g ON g.id = t.group_id
     LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1 AND gm.removed_at IS NULL
     WHERE (g.owner_id = $1 OR gm.user_id IS NOT NULL)
       AND (t.end_date IS NULL OR t.end_date >= CURRENT_DATE)`,
    [userId]
  );
  return parseInt(rows[0].count, 10);
};

export const countGroupMembers = async (groupId: string): Promise<number> => {
  const p = getPool();
  const { rows } = await p.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1 AND removed_at IS NULL`,
    [groupId]
  );
  return parseInt(rows[0].count, 10);
};

export type AdminUserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  tierKey: string | null;
  tierDisplayName: string | null;
  tierSince: string | null;
  createdAt: string;
};

export const adminSearchUsers = async (opts: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ users: AdminUserRow[]; total: number }> => {
  const p = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = (page - 1) * limit;
  const search = opts.search?.trim() || null;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (search) {
    conditions.push(
      `(
        u.email ILIKE $${idx}
        OR COALESCE(wu.first_name, u.first_name, '') ILIKE $${idx}
        OR COALESCE(wu.last_name, u.last_name, '') ILIKE $${idx}
        OR (COALESCE(wu.first_name, u.first_name, '') || ' ' || COALESCE(wu.last_name, u.last_name, '')) ILIKE $${idx}
        OR COALESCE(ue.email, '') ILIKE $${idx}
        OR u.id::text ILIKE $${idx}
      )`
    );
    params.push(`%${search}%`);
    idx++;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await p.query<{ count: string }>(
    `SELECT COUNT(DISTINCT u.id) as count
     FROM users u
     LEFT JOIN web_users wu ON wu.id = u.id
     LEFT JOIN user_emails ue ON ue.user_id = u.id
     ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const { rows } = await p.query<{
    id: string; email: string; first_name: string | null; last_name: string | null;
    role: string | null; tier_key: string | null; tier_display_name: string | null;
    tier_since: string | null; created_at: string;
  }>(
    `SELECT DISTINCT ON (u.id) u.id, u.email,
            COALESCE(wu.first_name, u.first_name) as first_name,
            COALESCE(wu.last_name, u.last_name) as last_name,
            COALESCE(u.role, 'user') as role,
            t.key as tier_key, t.display_name as tier_display_name,
            ut.effective_from as tier_since, u.created_at
     FROM users u
     LEFT JOIN web_users wu ON wu.id = u.id
     LEFT JOIN user_emails ue ON ue.user_id = u.id
     LEFT JOIN user_tiers ut ON ut.user_id = u.id AND ut.effective_to IS NULL
     LEFT JOIN tiers t ON t.id = ut.tier_id
     ${where}
     ORDER BY u.id, u.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    dataParams
  );

  const users = await Promise.all(rows.map(async (r) => {
    let tierKey = r.tier_key;
    let tierDisplayName = r.tier_display_name;
    const role = r.role ?? 'user';

    if (role === 'admin' && tierKey !== 'pro') {
      await setUserTier(r.id, 'pro', 'system', null, 'Admin users are automatically assigned Pro tier');
      tierKey = 'pro';
      tierDisplayName = 'Pro';
    }

    return {
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      role,
      tierKey,
      tierDisplayName,
      tierSince: r.tier_since,
      createdAt: r.created_at,
    };
  }));

  return {
    total,
    users,
  };
};

export const adminGetUser = async (userId: string): Promise<{
  id: string; email: string; firstName: string | null; lastName: string | null;
  role: string; tierKey: string | null; tierDisplayName: string | null;
  tierSince: string | null; tierSource: string | null; createdAt: string;
  usage: { metricKey: string; windowKey: string; count: number }[];
} | null> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string; email: string; first_name: string | null; last_name: string | null;
    role: string | null; tier_key: string | null; tier_display_name: string | null;
    tier_since: string | null; tier_source: string | null; created_at: string;
  }>(
    `SELECT u.id, u.email,
            COALESCE(wu.first_name, u.first_name) as first_name,
            COALESCE(wu.last_name, u.last_name) as last_name,
            COALESCE(u.role, 'user') as role,
            t.key as tier_key, t.display_name as tier_display_name,
            ut.effective_from as tier_since, ut.source as tier_source, u.created_at
     FROM users u
     LEFT JOIN web_users wu ON wu.id = u.id
     LEFT JOIN user_tiers ut ON ut.user_id = u.id AND ut.effective_to IS NULL
     LEFT JOIN tiers t ON t.id = ut.tier_id
     WHERE u.id = $1`,
    [userId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  let tierKey = r.tier_key;
  let tierDisplayName = r.tier_display_name;
  const role = r.role ?? 'user';

  if (role === 'admin' && tierKey !== 'pro') {
    await setUserTier(userId, 'pro', 'system', null, 'Admin users are automatically assigned Pro tier');
    tierKey = 'pro';
    tierDisplayName = 'Pro';
  }

  const { rows: usageRows } = await p.query<{
    metric_key: string; window_key: string; count: string;
  }>(
    `SELECT metric_key, window_key, count
     FROM usage_counters
     WHERE user_id = $1
     ORDER BY window_key DESC, metric_key ASC`,
    [userId]
  );

  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    role,
    tierKey,
    tierDisplayName,
    tierSince: r.tier_since,
    tierSource: r.tier_source,
    createdAt: r.created_at,
    usage: usageRows.map(u => ({
      metricKey: u.metric_key,
      windowKey: u.window_key,
      count: parseInt(u.count, 10),
    })),
  };
};

export const adminGetUserData = async (opts: {
  window?: '7d' | '30d' | 'all-time';
  page?: number;
  limit?: number;
}): Promise<{
  summary: { totalUsers: number; byTier: Record<string, number> };
  users: Array<{
    id: string; email: string; role: string; tierKey: string | null;
    tripCount: number; tripCreations: number; aiGenerations: number; tokens: number; apiCalls: Record<string, number>; createdAt: string;
  }>;
  total: number;
}> => {
  const p = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = (page - 1) * limit;
  const providerKeys = Object.keys(getApiLimitsConfig().providers ?? {});
  const windowDays = opts.window === '7d' ? 7 : opts.window === '30d' ? 30 : null;
  const windowStart = windowDays
    ? new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Summary
  const { rows: summaryRows } = await p.query<{ tier_key: string | null; count: string }>(
    `SELECT t.key as tier_key, COUNT(u.id) as count
     FROM users u
     LEFT JOIN user_tiers ut ON ut.user_id = u.id AND ut.effective_to IS NULL
     LEFT JOIN tiers t ON t.id = ut.tier_id
     GROUP BY t.key`
  );
  const totalUsers = summaryRows.reduce((acc, r) => acc + parseInt(r.count, 10), 0);
  const byTier: Record<string, number> = {};
  for (const r of summaryRows) {
    byTier[r.tier_key ?? 'none'] = parseInt(r.count, 10);
  }

  // Total count
  const countResult = await p.query<{ count: string }>(`SELECT COUNT(*) as count FROM users`);
  const total = parseInt(countResult.rows[0].count, 10);

  const { rows } = await p.query<{
    id: string; email: string; role: string | null; tier_key: string | null; created_at: string;
  }>(
    `SELECT u.id, u.email, COALESCE(u.role, 'user') as role, t.key as tier_key,
            u.created_at
     FROM users u
     LEFT JOIN user_tiers ut ON ut.user_id = u.id AND ut.effective_to IS NULL
     LEFT JOIN tiers t ON t.id = ut.tier_id
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const userIds = rows.map((row) => row.id);
  const metricsByUser = new Map<string, Record<string, number>>();
  const tripCountsByUser = new Map<string, number>();
  const apiCallsByUser = new Map<string, Record<string, number>>();
  if (userIds.length) {
    const { rows: metricRows } = await p.query<{ user_id: string; metric_key: string; total: string }>(
      `SELECT ue.user_id, ue.metric_key, SUM(ue.amount) AS total
       FROM usage_events ue
       WHERE ue.user_id = ANY($1::uuid[])
         AND ($2::timestamp IS NULL OR ue.created_at >= $2::timestamp)
       GROUP BY ue.user_id, ue.metric_key`,
      [userIds, windowStart]
    );
    for (const row of metricRows) {
      const bucket = metricsByUser.get(row.user_id) ?? {};
      bucket[row.metric_key] = parseInt(row.total, 10);
      metricsByUser.set(row.user_id, bucket);
    }
    const { rows: tripRows } = await p.query<{ user_id: string; total: string }>(
      `SELECT u.id AS user_id, COUNT(DISTINCT t.id) AS total
       FROM users u
       LEFT JOIN groups g ON g.owner_id = u.id
       LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.removed_at IS NULL
       LEFT JOIN trips t ON t.group_id = g.id OR t.group_id = gm.group_id
       WHERE u.id = ANY($1::uuid[])
       GROUP BY u.id`,
      [userIds]
    );
    for (const row of tripRows) {
      tripCountsByUser.set(row.user_id, parseInt(row.total, 10));
    }
    const { rows: apiRows } = await p.query<{ user_id: string; metric_key: string; total: string }>(
      `SELECT ue.user_id, ue.metric_key, SUM(ue.amount) AS total
       FROM usage_events ue
       WHERE ue.user_id = ANY($1::uuid[])
         AND ue.metric_key LIKE 'api_calls_%'
         AND ($2::timestamp IS NULL OR ue.created_at >= $2::timestamp)
       GROUP BY ue.user_id, ue.metric_key`,
      [userIds, windowStart]
    );
    for (const row of apiRows) {
      const bucket = apiCallsByUser.get(row.user_id) ?? {};
      bucket[row.metric_key] = parseInt(row.total, 10);
      apiCallsByUser.set(row.user_id, bucket);
    }
  }

  return {
    summary: { totalUsers, byTier },
    total,
    users: rows.map(r => ({
      id: r.id,
      email: r.email,
      role: r.role ?? 'user',
      tierKey: r.tier_key,
      tripCount: tripCountsByUser.get(r.id) ?? 0,
      tripCreations: metricsByUser.get(r.id)?.trip_creations ?? 0,
      aiGenerations: metricsByUser.get(r.id)?.ai_itinerary_generations ?? 0,
      tokens: metricsByUser.get(r.id)?.openai_tokens ?? 0,
      apiCalls: providerKeys.reduce<Record<string, number>>((acc, providerKey) => {
        const metricKey = `api_calls_${providerKey.toLowerCase()}`;
        acc[providerKey] =
          apiCallsByUser.get(r.id)?.[metricKey] ??
          (providerKey === 'OPENAI' ? metricsByUser.get(r.id)?.ai_itinerary_generations ?? 0 : 0);
        return acc;
      }, {}),
      createdAt: r.created_at,
    })),
  };
};


// ---------------------------------------------------------------------------
// Chat / Messaging
// ---------------------------------------------------------------------------

type TripMessageRow = {
  id: string;
  appId: string;
  tripId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  body: string;
  createdAt: string;
};

const attachReadByForTrip = async (
  tripId: string,
  messageIds: string[],
): Promise<Map<string, string[]>> => {
  const readMap = new Map<string, string[]>();
  if (messageIds.length === 0) return readMap;
  const p = getPool();
  // Scope by trip via subquery; intersect with the page ids in-memory.
  const { rows: reads } = await p.query<{ messageId: string; userId: string }>(
    `SELECT message_id AS "messageId", user_id AS "userId"
     FROM message_reads
     WHERE message_id IN (
       SELECT id FROM trip_messages WHERE trip_id = $1
     )`,
    [tripId],
  );
  const pageIds = new Set(messageIds);
  for (const read of reads) {
    if (!pageIds.has(read.messageId)) continue;
    if (!readMap.has(read.messageId)) readMap.set(read.messageId, []);
    readMap.get(read.messageId)!.push(read.userId);
  }
  return readMap;
};

/**
 * Fetch a page of messages for a trip, newest-first via cursor.
 *
 * - `beforeId` (optional): returns messages strictly older than the referenced
 *   message. When omitted, returns the most recent `limit` messages.
 * - Returned `messages` are in ascending chronological order for rendering.
 * - `hasMore` indicates whether more messages exist before the oldest returned.
 */
export const listTripMessagesPage = async (
  tripId: string,
  options: { limit?: number; beforeId?: string } = {},
): Promise<{ messages: TripChatMessage[]; hasMore: boolean }> => {
  const p = getPool();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (options.beforeId) {
    const { rows: cursorRows } = await p.query<{ createdAt: string; id: string }>(
      `SELECT created_at AS "createdAt", id FROM trip_messages WHERE id = $1 LIMIT 1`,
      [options.beforeId],
    );
    if (cursorRows.length) {
      cursorCreatedAt = cursorRows[0].createdAt;
      cursorId = cursorRows[0].id;
    } else {
      return { messages: [], hasMore: false };
    }
  }

  const params: unknown[] = [tripId];
  let cursorClause = '';
  if (cursorCreatedAt && cursorId) {
    params.push(cursorCreatedAt, cursorId);
    cursorClause = ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`;
  }
  params.push(limit + 1);
  const limitIdx = params.length;

  const { rows } = await p.query<TripMessageRow>(
    `SELECT id,
            app_id          AS "appId",
            trip_id         AS "tripId",
            sender_id       AS "senderId",
            sender_name     AS "senderName",
            sender_initials AS "senderInitials",
            body,
            created_at      AS "createdAt"
     FROM trip_messages
     WHERE trip_id = $1${cursorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${limitIdx}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ascending = page.slice().reverse();

  const readMap = await attachReadByForTrip(tripId, ascending.map((r) => r.id));
  const messages = ascending.map((r) => ({ ...r, readBy: readMap.get(r.id) ?? [] }));
  return { messages, hasMore };
};

/** Fetch messages for a trip, oldest-first, with their read-by lists. */
export const listTripMessages = async (
  tripId: string,
  limit = 200,
): Promise<TripChatMessage[]> => {
  const p = getPool();
  const { rows } = await p.query<TripMessageRow>(
    `SELECT id,
            app_id          AS "appId",
            trip_id         AS "tripId",
            sender_id       AS "senderId",
            sender_name     AS "senderName",
            sender_initials AS "senderInitials",
            body,
            created_at      AS "createdAt"
     FROM trip_messages
     WHERE trip_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [tripId, limit],
  );

  if (rows.length === 0) return [];
  const readMap = await attachReadByForTrip(tripId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, readBy: readMap.get(r.id) ?? [] }));
};

/** Persist a new chat message and return it. */
export const addTripMessage = async (msg: {
  appId: string;
  tripId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  body: string;
}): Promise<TripChatMessage> => {
  const p = getPool();
  const text = String(msg.body ?? '').trim();
  if (!text) throw new Error('Message body is required');
  const id = randomUUID();
  const { rows } = await p.query<{ createdAt: string }>(
    `INSERT INTO trip_messages (id, app_id, trip_id, sender_id, sender_name, sender_initials, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING created_at AS "createdAt"`,
    [id, msg.appId, msg.tripId, msg.senderId, msg.senderName, msg.senderInitials, text],
  );
  const createdAt = rows[0]?.createdAt ?? new Date().toISOString();
  return {
    id,
    appId: msg.appId,
    tripId: msg.tripId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    senderInitials: msg.senderInitials,
    body: text,
    createdAt,
    readBy: [],
  };
};

/** Mark messages in a trip as read by a user up to and including upToMessageId. */
export const markMessagesRead = async (
  tripId: string,
  userId: string,
  upToMessageId: string,
): Promise<void> => {
  const p = getPool();
  // Fetch the cutoff timestamp first
  const { rows: cutoffRows } = await p.query<{ createdAt: string }>(
    `SELECT created_at AS "createdAt" FROM trip_messages WHERE id = $1 LIMIT 1`,
    [upToMessageId],
  );
  if (!cutoffRows.length) return;
  const cutoff = cutoffRows[0].createdAt;

  // Legacy per-message reads are behind a soak-window env flag. Default ON
  // so current deployments keep writing both. Flip to "false" to drop the
  // legacy path and run watermark-only; once confident, the fallback read in
  // `countUnreadMessages` and the `message_reads` table itself can be
  // retired together in a follow-up slice.
  const legacyReadsEnabled = getEnvFlag('CHAT_LEGACY_READS_ENABLED', { defaultValue: true });
  if (legacyReadsEnabled) {
    // Fetch messages to mark (read separately to avoid INSERT ... SELECT +
    // ON CONFLICT in pg-mem)
    const { rows: toMark } = await p.query<{ id: string }>(
      `SELECT id FROM trip_messages WHERE trip_id = $1 AND created_at <= $2`,
      [tripId, cutoff],
    );

    for (const row of toMark) {
      try {
        await p.query(
          `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2)`,
          [row.id, userId],
        );
      } catch {
        // Already exists (duplicate primary key) — skip
      }
    }
  }

  // Dual-write: upsert the per-user watermark. Only advance forward — if the
  // stored cutoff is already newer, leave it alone (prevents a stale
  // MARK_READ from a re-opened panel from walking the read-state backwards).
  await p.query(
    `INSERT INTO chat_read_watermarks (user_id, trip_id, last_read_message_id, last_read_created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, trip_id) DO UPDATE
     SET last_read_message_id = CASE
           WHEN EXCLUDED.last_read_created_at > chat_read_watermarks.last_read_created_at
             THEN EXCLUDED.last_read_message_id
           ELSE chat_read_watermarks.last_read_message_id
         END,
         last_read_created_at = CASE
           WHEN EXCLUDED.last_read_created_at > chat_read_watermarks.last_read_created_at
             THEN EXCLUDED.last_read_created_at
           ELSE chat_read_watermarks.last_read_created_at
         END,
         updated_at = NOW()`,
    [userId, tripId, upToMessageId, cutoff],
  );
};

/**
 * Count unread messages for a user in a trip. Prefers the per-user watermark
 * when one exists (single indexed lookup); falls back to the legacy
 * `message_reads` LEFT JOIN for users who have never emitted a MARK_READ
 * since the watermark table was introduced.
 */
export const countUnreadMessages = async (
  tripId: string,
  userId: string,
): Promise<number> => {
  const p = getPool();

  const { rows: watermarkRows } = await p.query<{ cutoff: string }>(
    `SELECT last_read_created_at AS "cutoff"
     FROM chat_read_watermarks
     WHERE user_id = $1 AND trip_id = $2`,
    [userId, tripId],
  );
  if (watermarkRows.length) {
    const cutoff = watermarkRows[0].cutoff;
    const { rows } = await p.query<{ count: string }>(
      `SELECT COUNT(id)::text AS count
       FROM trip_messages
       WHERE trip_id = $1 AND created_at > $2`,
      [tripId, cutoff],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  // Fall back to per-message reads (legacy path).
  const { rows } = await p.query<{ count: string }>(
    `SELECT COUNT(m.id)::text AS count
     FROM trip_messages m
     LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = $2
     WHERE m.trip_id = $1 AND mr.message_id IS NULL`,
    [tripId, userId],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
};

// ---------------------------------------------------------------------------
// User-authored item aggregation (for account data export)
// ---------------------------------------------------------------------------

/**
 * Return every row whose `user_id` column equals the exporting user. This is
 * the read-side companion to the user-deletion cascade: if deletion removes
 * a row based on user_id, export surfaces it. Trip membership-scoped reads
 * (visible-to-user) live in their own list functions elsewhere — this one
 * answers "what did *this user* author".
 */
export const listUserAuthoredItems = async (
  userId: string,
): Promise<{
  flights: any[];
  lodgings: any[];
  tours: any[];
  carRentals: any[];
  expenses: any[];
  tripMessages: any[];
}> => {
  const p = getPool();
  const [flights, lodgings, tours, carRentals, expenses, tripMessages] = await Promise.all([
    p.query(
      `SELECT id, user_id as "userId", trip_id as "tripId", status, transfer_type as "transferType",
              passenger_name as "passengerName", departure_date as "departureDate",
              arrival_date as "arrivalDate", departure_time as "departureTime",
              arrival_time as "arrivalTime", carrier, flight_number as "flightNumber",
              booking_reference as "bookingReference", cost
       FROM flights
       WHERE user_id = $1
       ORDER BY departure_date ASC NULLS LAST`,
      [userId],
    ),
    p.query(
      `SELECT id, user_id as "userId", trip_id as "tripId", status, name,
              check_in_date as "checkInDate", check_out_date as "checkOutDate",
              rooms, total_cost as "totalCost", address, created_at as "createdAt"
       FROM lodgings
       WHERE user_id = $1
       ORDER BY check_in_date ASC NULLS LAST`,
      [userId],
    ),
    p.query(
      `SELECT id, user_id as "userId", trip_id as "tripId", status, name, cost,
              date as "date", start_time as "startTime", duration,
              created_at as "createdAt"
       FROM tours
       WHERE user_id = $1
       ORDER BY date ASC NULLS LAST`,
      [userId],
    ),
    p.query(
      `SELECT id, user_id as "userId", trip_id as "tripId", status, vendor, model, cost,
              pickup_date as "pickupDate", dropoff_date as "dropoffDate",
              pickup_location as "pickupLocation", dropoff_location as "dropoffLocation",
              created_at as "createdAt"
       FROM car_rentals
       WHERE user_id = $1
       ORDER BY pickup_date ASC NULLS LAST`,
      [userId],
    ),
    p.query(
      `SELECT id, user_id as "userId", trip_id as "tripId", group_id as "groupId",
              category, amount, currency, vendor, notes,
              expense_date as "expenseDate", created_at as "createdAt"
       FROM expenses
       WHERE user_id = $1
       ORDER BY expense_date ASC NULLS LAST`,
      [userId],
    ),
    p.query(
      `SELECT id, trip_id as "tripId", body, created_at as "createdAt"
       FROM trip_messages
       WHERE sender_id = $1
       ORDER BY created_at ASC`,
      [userId],
    ),
  ]);
  return {
    flights: flights.rows,
    lodgings: lodgings.rows,
    tours: tours.rows,
    carRentals: carRentals.rows,
    expenses: expenses.rows,
    tripMessages: tripMessages.rows,
  };
};
