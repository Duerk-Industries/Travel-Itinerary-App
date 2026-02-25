// server/src/db.ts
import { Pool } from 'pg';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import {
  Flight,
  Group,
  GroupMember,
  Trait,
  Trip,
  User,
  WebUser,
  Lodging,
  Activity,
  CarRental,
  Itinerary,
  ItineraryDetail,
  PlaceDetailsCache,
  LocationRecord,
  AttractionCatalogEntry,
  AttractionShortlistBlob,
  TripActivity,
  TripActivityType,
  TripComment,
} from './types';
import { logError } from './logger';
import { getEnvValue } from './env';
import { downloadAirportDatasetForDailyRefresh } from './apis/airportDatasetCallers';


type PoolCtor = typeof Pool;
let PoolFactory: PoolCtor = Pool;
let pool: Pool | null = null;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const FOLLOW_CODE_LENGTH = 6;
const FOLLOW_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generateFollowCode = (): string => {
  const bytes = randomBytes(FOLLOW_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < FOLLOW_CODE_LENGTH; i += 1) {
    out += FOLLOW_CODE_CHARS[bytes[i] % FOLLOW_CODE_CHARS.length];
  }
  return out;
};

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
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;`);


  await p.query(`
    CREATE TABLE IF NOT EXISTS web_users (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      home_address TEXT,
      preferred_airport TEXT,
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
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS salt TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMP;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS age INTEGER;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS gender TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT FALSE;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP
    );
  `);

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

  await p.query(`
    CREATE TABLE IF NOT EXISTS fellow_travelers (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fellow_travelers_owner_name ON fellow_travelers(owner_id, LOWER(first_name), LOWER(last_name));`);

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

  await p.query(`
    CREATE TABLE IF NOT EXISTS place_details_cache (
      place_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
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
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (source_type, source_id)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_expenses_trip_date ON expenses(trip_id, expense_date);`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_in_trip_currency NUMERIC;`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS exchange_rate_to_trip_currency NUMERIC;`);
  await p.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS exchange_rate_date DATE;`);

  if (process.env.USE_IN_MEMORY_DB === '1') {
    // Clear data between test runs while keeping schema intact.
    await p.query(`DELETE FROM trip_comments`);
    await p.query(`DELETE FROM trip_activity`);
    await p.query(`DELETE FROM itinerary_details`);
    await p.query(`DELETE FROM itineraries`);
    await p.query(`DELETE FROM tours`);
    await p.query(`DELETE FROM car_rentals`);
    await p.query(`DELETE FROM item_votes`);
    await p.query(`DELETE FROM lodgings`);
    await p.query(`DELETE FROM flight_shares`);
    await p.query(`DELETE FROM flights`);
    await p.query(`DELETE FROM expenses`);
    await p.query(`DELETE FROM trips`);
    await p.query(`DELETE FROM place_details_cache`);
    await p.query(`DELETE FROM place_lookup_cache`);
    await p.query(`DELETE FROM group_invites`);
    await p.query(`DELETE FROM group_members`);
    await p.query(`DELETE FROM groups`);
    await p.query(`DELETE FROM traits`);
    await p.query(`DELETE FROM family_relationships`);
    await p.query(`DELETE FROM fellow_travelers`);
    await p.query(`DELETE FROM web_users`);
    await p.query(`DELETE FROM users`);
  }
};


export const findOrCreateUser = async (
  email: string,
  provider: User['provider']
): Promise<User> => {
  const p = getPool();


  const existing = await p.query<User>(`SELECT * FROM users WHERE email = $1`, [email]);
  if (existing.rows.length) return existing.rows[0];


  const id = randomUUID();
  await p.query(`INSERT INTO users (id, email, provider, email_verified) VALUES ($1, $2, $3, true)`, [id, email, provider]);
  return { id, email, provider };
};

type Queryable = Pick<Pool, 'query'>;

const ensureOwnerUserRow = async (db: Queryable, ownerId: string): Promise<void> => {
  const existing = await db.query(`SELECT id FROM users WHERE id = $1`, [ownerId]);
  if (existing.rowCount) return;
  const webUser = await db.query<{ email: string }>(`SELECT email FROM web_users WHERE id = $1`, [ownerId]);
  const email = webUser.rows[0]?.email;
  if (!email) {
    throw new Error('User not found. Please log in again.');
  }
  await db.query(`INSERT INTO users (id, email, provider, email_verified) VALUES ($1, $2, $3, true)`, [ownerId, email, 'email']);
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
  const { rows } = await p.query<User>(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
  const row = rows[0] as any;
  if (!row) return null;
  return { ...row, passengerIds: Array.isArray(row.passenger_ids) ? row.passenger_ids : [] };
};


const hashPassword = (password: string, salt: string): string => {
  return scryptSync(password, salt, 64).toString('hex');
};


export const createWebUser = async (
  firstName: string,
  lastName: string,
  email: string,
  password: string
): Promise<WebUser> => {
  const p = getPool();

  const existingUser = await p.query<{ id: string; emailVerified: boolean }>(
    `SELECT id, COALESCE(email_verified, TRUE) as "emailVerified" FROM users WHERE email = $1 LIMIT 1`,
    [email]
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
      [user.id, email, firstName, lastName, passwordHash, salt]
    );
    await p.query(
      `UPDATE users
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           email_verified = COALESCE(email_verified, TRUE),
           email_verified_at = CASE WHEN COALESCE(email_verified, TRUE) THEN COALESCE(email_verified_at, NOW()) ELSE email_verified_at END
       WHERE id = $3`,
      [firstName, lastName, user.id]
    );
    return { id: user.id, email, firstName, lastName, emailVerified: user.emailVerified };
  }

  const id = randomUUID();
  await p.query(`INSERT INTO users (id, email, provider, email_verified) VALUES ($1, $2, 'email', false)`, [id, email]);

  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  await p.query(
    `INSERT INTO web_users (id, email, first_name, last_name, password_hash, salt, password_setup_required)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
    [id, email, firstName, lastName, passwordHash, salt]
  );

  return { id, email, firstName, lastName, emailVerified: false };
};

export const ensureWebPasswordAccountForOAuth = async (
  userId: string,
  email: string,
  firstName?: string,
  lastName?: string
): Promise<{ requiresPasswordSetup: boolean }> => {
  const p = getPool();
  const existing = await p.query<{ passwordSetupRequired: boolean }>(
    `SELECT password_setup_required as "passwordSetupRequired" FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (existing.rows.length) {
    return { requiresPasswordSetup: Boolean(existing.rows[0].passwordSetupRequired) };
  }

  const salt = randomBytes(16).toString('hex');
  const randomSecret = randomBytes(32).toString('hex');
  const passwordHash = hashPassword(randomSecret, salt);
  await p.query(
    `INSERT INTO web_users (id, email, first_name, last_name, password_hash, salt, password_setup_required)
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), $5, $6, TRUE)`,
    [userId, email, firstName ?? '', lastName ?? '', passwordHash, salt]
  );
  return { requiresPasswordSetup: true };
};


export const verifyWebUserCredentials = async (
  email: string,
  password: string
): Promise<WebUser | null> => {
  const p = getPool();


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
     WHERE wu.email = $1`,
    [email]
  );


  if (!rows.length) return null;


  const [{ id, first_name, last_name, passwordHash, salt, emailVerified }] = rows;
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
} | null> => {
  const p = getPool();
  const { rows } = await p.query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    home_address: string | null;
    preferred_airport: string | null;
  }>(
    `SELECT id, email, first_name, last_name, home_address, preferred_airport FROM web_users WHERE id = $1 LIMIT 1`,
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
  updates: { firstName?: string; lastName?: string; email?: string; homeAddress?: string; preferredAirport?: string }
): Promise<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  homeAddress?: string | null;
  preferredAirport?: string | null;
}> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    if (updates.email) {
      const emailInUse = await client.query(`SELECT 1 FROM web_users WHERE email = $1 AND id <> $2`, [
        updates.email,
        userId,
      ]);
      if (emailInUse.rowCount) {
        const err = new Error('Email already in use');
        (err as any).code = 'EMAIL_TAKEN';
        throw err;
      }
    }

    const { rows } = await client.query(
      `
      UPDATE web_users
      SET
        first_name = COALESCE($2, first_name),
        last_name = COALESCE($3, last_name),
        email = COALESCE($4, email),
        home_address = CASE WHEN $5::text IS NULL THEN home_address ELSE NULLIF($5::text, '') END,
        preferred_airport = CASE WHEN $6::text IS NULL THEN preferred_airport ELSE NULLIF($6::text, '') END
      WHERE id = $1
      RETURNING
        id,
        email,
        first_name as "firstName",
        last_name as "lastName",
        home_address as "homeAddress",
        preferred_airport as "preferredAirport"
    `,
      [
        userId,
        updates.firstName ?? null,
        updates.lastName ?? null,
        updates.email ?? null,
        typeof updates.homeAddress === 'string' ? updates.homeAddress.trim() : null,
        typeof updates.preferredAirport === 'string' ? updates.preferredAirport.trim() : null,
      ]
    );

    if (!rows.length) {
      throw new Error('User not found');
    }

    if (updates.email) {
      await client.query(`UPDATE users SET email = $2 WHERE id = $1`, [userId, updates.email]);
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
    const { rows: ownedGroups } = await client.query<{ id: string; newOwner: string | null }>(
      `
      SELECT g.id,
        (
          SELECT gm.user_id
          FROM group_members gm
          WHERE gm.group_id = g.id AND gm.user_id IS NOT NULL AND gm.user_id <> $1
          ORDER BY gm.created_at ASC
          LIMIT 1
        ) as "newOwner"
      FROM groups g
      WHERE g.owner_id = $1
    `,
      [userId]
    );
    for (const g of ownedGroups) {
      if (g.newOwner) {
        await client.query(`UPDATE groups SET owner_id = $2 WHERE id = $1`, [g.id, g.newOwner]);
      }
    }

    // Ensure memberships added by this user are retained by reassigning added_by to the new owner (or the member themself).
    await client.query(
      `
      UPDATE group_members gm
      SET added_by = COALESCE(
        (SELECT owner_id FROM groups g WHERE g.id = gm.group_id),
        gm.user_id,
        gm.added_by
      )
      WHERE gm.added_by = $1
    `,
      [userId]
    );

    // Trips where this user is the only non-guest member should be removed entirely.
    const { rows: soloTrips } = await client.query<{ id: string }>(
      `
      SELECT t.id
      FROM trips t
      WHERE t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = t.group_id
            AND gm.user_id IS NOT NULL
            AND gm.user_id <> $1
        )
    `,
      [userId]
    );
    const tripIds = soloTrips.map((t) => t.id);
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
      id, user_id, trip_id, status, activity_type, date, name, start_location, start_time, duration, cost, free_cancel_by, booked_on, reference, paid_by, traveler_ids
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
      paid_by = COALESCE($14::jsonb, paid_by),
      traveler_ids = COALESCE($15::jsonb, traveler_ids)
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
  rows.forEach((row: any) => {
    result[row.itemId] = {
      netVotes: Number(row.netVotes) || 0,
      userVote: row.userVote === 1 || row.userVote === -1 ? row.userVote : null,
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
        payer_ids, for_ids, source_type, source_id, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::jsonb, $13::jsonb, $14, $15, $16
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
        payer_ids, for_ids, source_type, source_id, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::jsonb, $13::jsonb, $14, $15, $16
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
            gm.added_by as "addedBy",
            gm.created_at as "createdAt",
            u.email as "userEmail"
     FROM group_members gm
     LEFT JOIN users u ON gm.user_id = u.id
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
      `SELECT 1 FROM groups WHERE id = $1 AND owner_id = $2`,
      [groupId, ownerId]
    );
    if (!groupRows.length) throw new Error('Group not found or not owner');

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
        const userRes = await client.query<User>('SELECT id, email FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0] ?? null;
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
  await p.query(
    `UPDATE group_invites
     SET invitee_user_id = $1
     WHERE invitee_user_id IS NULL AND LOWER(invitee_email) = LOWER($2)`,
    [userId, email]
  );
  await p.query(
    `UPDATE group_members
     SET user_id = $1, invite_email = NULL, claimed_at = NOW(), removed_at = NULL
     WHERE invite_email IS NOT NULL AND LOWER(invite_email) = LOWER($2) AND user_id IS NULL`,
    [userId, email]
  );
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
  return rows.map((r) => r.label).filter(Boolean);
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
  return {
    id: row.id,
    destinationKey: String(payload.destinationKey ?? '').trim(),
    destinationDisplayName: String(payload.destinationDisplayName ?? '').trim(),
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
    rank: Number(entry.rank) || 999,
    activityType: entry.activityType,
    interestTags: Array.isArray(entry.interestTags) ? entry.interestTags : [],
    sourceUrl: entry.sourceUrl ?? null,
    sourceLabel: entry.sourceLabel ?? null,
    snippet: entry.snippet ?? null,
    sourceCount: Number(entry.sourceCount) || 1,
    budgetTier: entry.budgetTier ?? 'paid',
    updatedAt: entry.updatedAt,
  };
  const searchName = `${entry.name} ${entry.destinationDisplayName}`.toLowerCase();
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
    logError('Failed to download airports dataset', err);
    return;
  }

  const filtered = data
    .filter((a) => typeof a.iata_code === 'string' && a.iata_code.length === 3)
    .map((a) => ({
      iata_code: a.iata_code,
      name: a.name ?? '',
      city: a.city ?? '',
      country: a.country ?? '',
      lat: typeof a._geoloc?.lat === 'number' ? a._geoloc.lat : null,
      lng: typeof a._geoloc?.lng === 'number' ? a._geoloc.lng : null,
    }))
    .filter((a) => a.name && a.iata_code);

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
    `SELECT id, email, provider FROM users WHERE LOWER(email) LIKE $1 ORDER BY email LIMIT 10`,
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
  age?: number | null,
  gender?: string | null
): Promise<void> => {
  const p = getPool();
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
  const details = await p.query<ItineraryDetail>(
    `SELECT id,
            itinerary_id as "itineraryId",
            day,
            time,
            activity,
            cost
     FROM itinerary_details
     WHERE itinerary_id = $1
     ORDER BY day ASC, time ASC NULLS LAST, created_at ASC`,
    [itineraryId]
  );
  return details.rows;
};

export const addItineraryDetail = async (
  userId: string,
  itineraryId: string,
  detail: { day: number; time?: string | null; activity: string; cost?: number | null }
): Promise<ItineraryDetail> => {
  const p = getPool();
  const { rows } = await p.query<{ tripId: string }>(
    `SELECT trip_id as "tripId" FROM itineraries WHERE id = $1`,
    [itineraryId]
  );
  if (!rows.length) throw new Error('Itinerary not found');
  const membership = await ensureUserInTrip(rows[0].tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  const { rows: inserted } = await p.query<ItineraryDetail>(
    `INSERT INTO itinerary_details (id, itinerary_id, day, time, activity, cost)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, itinerary_id as "itineraryId", day, time, activity, cost`,
    [randomUUID(), itineraryId, Math.max(1, Math.round(detail.day)), detail.time ?? null, detail.activity.trim(), detail.cost ?? null]
  );
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
    }
  );
  return inserted[0];
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

  if (!activity) throw new Error('Activity is required');

  const { rows: updated } = await p.query(
    `UPDATE itinerary_details
     SET day = COALESCE($1, day),
         time = $2,
         activity = $3,
         cost = $4
     WHERE id = $5
     RETURNING id, itinerary_id as "itineraryId", day, time, activity, cost`,
    [day ?? null, time, activity, cost, detailId]
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
  return updated[0];
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
    `SELECT id, first_name as "firstName", last_name as "lastName", created_at as "createdAt"
     FROM fellow_travelers
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [ownerId]
  );
  return rows;
};

export const createFellowTraveler = async (ownerId: string, firstName: string, lastName: string) => {
  const p = getPool();
  const given = firstName.trim();
  const family = lastName.trim();
  if (!given || !family) throw new Error('firstName and lastName are required');
  const id = randomUUID();
  await p.query(
    `INSERT INTO fellow_travelers (id, owner_id, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_id, LOWER(first_name), LOWER(last_name)) DO NOTHING`,
    [id, ownerId, given, family]
  );
  return id;
};

export const updateFellowTraveler = async (
  ownerId: string,
  travelerId: string,
  firstName: string,
  lastName: string
) => {
  const p = getPool();
  const given = firstName.trim();
  const family = lastName.trim();
  if (!given || !family) throw new Error('firstName and lastName are required');
  const { rowCount } = await p.query(
    `UPDATE fellow_travelers
     SET first_name = $1, last_name = $2
     WHERE id = $3 AND owner_id = $4`,
    [given, family, travelerId, ownerId]
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


// Backwards-compatible export; call poolClient() when you need the Pool instance.
export const poolClient = (): Pool => getPool();

export const findOrCreateGoogleUser = async (profile: any): Promise<User> => {
    const p = getPool();
    const { id, displayName, emails, photos, name } = profile;

    const email = String(emails?.[0]?.value ?? '').trim().toLowerCase();
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
        return user;
    }

    const existingByEmail = await p.query<User>(`SELECT * FROM users WHERE email = $1`, [email]);
    if (existingByEmail.rows.length) {
        const user = existingByEmail.rows[0];
        await p.query(
            `UPDATE users SET google_id = $1, picture = $2, first_name = $3, last_name = $4, email_verified = true, email_verified_at = NOW() WHERE id = $5`,
            [id, photos?.[0]?.value, name?.givenName, name?.familyName, user.id]
        );
        return user;
    }

    const newUserId = randomUUID();
    await p.query(
        `INSERT INTO users (id, email, provider, google_id, picture, first_name, last_name, email_verified, email_verified_at)
         VALUES ($1, $2, 'google', $3, $4, $5, $6, true, NOW())`,
        [newUserId, email, id, photos?.[0]?.value, name?.givenName, name?.familyName]
    );

    return { id: newUserId, email, provider: 'google' };
};

export const deleteAllUsers = async (userIds: string[]): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
};

