// server/src/db.ts
import { Pool } from 'pg';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import {
  Flight,
  Group,
  GroupMember,
  Trait,
  Trip,
  User,
  WebUser,
  Lodging,
  Tour,
  Itinerary,
  ItineraryDetail,
  PlaceDetailsCache,
} from './types';
import { logError } from './logger';
import { getEnvValue } from './env';


type PoolCtor = typeof Pool;
let PoolFactory: PoolCtor = Pool;
let pool: Pool | null = null;

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
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);


  await p.query(`
    CREATE TABLE IF NOT EXISTS web_users (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Backward compatibility if the table already exists
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS middle_name TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS salt TEXT;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS age INTEGER;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS gender TEXT;`);

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
      inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      invitee_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`ALTER TABLE group_invites ALTER COLUMN invitee_user_id DROP NOT NULL;`);

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
      start_date DATE,
      end_date DATE,
      start_month INTEGER,
      start_year INTEGER,
      duration_days INTEGER,
      currency TEXT DEFAULT 'USD',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS description TEXT;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination TEXT;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date DATE;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date DATE;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_month INTEGER;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_year INTEGER;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS duration_days INTEGER;`);
  await p.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';`);
  await p.query(`UPDATE trips SET currency = 'USD' WHERE currency IS NULL;`);

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
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS passenger_ids JSONB DEFAULT '[]'::jsonb;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS lodgings (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
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
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS traveler_ids JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS image_url TEXT;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS tours (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
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
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS paid_by JSONB DEFAULT '[]'::jsonb;`);
  await p.query(`ALTER TABLE tours ADD COLUMN IF NOT EXISTS booked_on TEXT;`);

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
    await p.query(`DELETE FROM itinerary_details`);
    await p.query(`DELETE FROM itineraries`);
    await p.query(`DELETE FROM tours`);
    await p.query(`DELETE FROM lodgings`);
    await p.query(`DELETE FROM flight_shares`);
    await p.query(`DELETE FROM flights`);
    await p.query(`DELETE FROM expenses`);
    await p.query(`DELETE FROM trips`);
    await p.query(`DELETE FROM place_details_cache`);
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
  await p.query(`INSERT INTO users (id, email, provider) VALUES ($1, $2, $3)`, [id, email, provider]);
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
  await db.query(`INSERT INTO users (id, email, provider) VALUES ($1, $2, $3)`, [ownerId, email, 'email']);
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


  const existing = await p.query(`SELECT 1 FROM web_users WHERE email = $1`, [email]);
  if (existing.rowCount) {
    const err = new Error('User already exists');
    (err as any).code = 'USER_EXISTS';
    throw err;
  }


  const id = randomUUID();
  try {
    // create auth user row for flights ownership
    await p.query(`INSERT INTO users (id, email, provider) VALUES ($1, $2, 'email')`, [id, email]);
  } catch (err: any) {
    if (err?.code === '23505') {
      const dup = new Error('User already exists');
      (dup as any).code = 'USER_EXISTS';
      throw dup;
    }
    throw err;
  }

  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  await p.query(
    `INSERT INTO web_users (id, email, first_name, last_name, password_hash, salt) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, email, firstName, lastName, passwordHash, salt]
  );


  return { id, email, firstName, lastName };
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
  }>(`SELECT id, email, first_name, last_name, password_hash as "passwordHash", salt FROM web_users WHERE email = $1`, [email]);


  if (!rows.length) return null;


  const [{ id, first_name, last_name, passwordHash, salt }] = rows;
  const providedHash = hashPassword(password, salt);


  const storedBuffer = Buffer.from(passwordHash, 'hex');
  const providedBuffer = Buffer.from(providedHash, 'hex');


  if (
    storedBuffer.length === providedBuffer.length &&
    timingSafeEqual(storedBuffer, providedBuffer)
  ) {
    return { id, email, firstName: first_name, lastName: last_name };
  }


  return null;
};

export const getWebUserProfile = async (
  userId: string
): Promise<{ id: string; email: string; firstName: string; lastName: string } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ id: string; email: string; first_name: string; last_name: string }>(
    `SELECT id, email, first_name, last_name FROM web_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (rows.length) {
    const row = rows[0];
    return { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name };
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
  updates: { firstName?: string; lastName?: string; email?: string }
): Promise<{ id: string; email: string; firstName: string; lastName: string }> => {
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
        email = COALESCE($4, email)
      WHERE id = $1
      RETURNING id, email, first_name as "firstName", last_name as "lastName"
    `,
      [userId, updates.firstName ?? null, updates.lastName ?? null, updates.email ?? null]
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
  await p.query(`UPDATE web_users SET password_hash = $1, salt = $2 WHERE id = $3`, [newHash, newSalt, userId]);
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
    id, user_id, trip_id, passenger_name, passenger_ids, departure_date, departure_location, departure_airport_code, departure_time,
    arrival_location, arrival_airport_code, layover_location, layover_location_code, layover_duration,
    arrival_date, arrival_time, cost, carrier, flight_number, booking_reference, paid_by
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
  RETURNING
    id,
    user_id as "userId",
    trip_id as "tripId",
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
           departure_date = COALESCE($2, departure_date),
           departure_location = COALESCE($3, departure_location),
           departure_airport_code = COALESCE($4, departure_airport_code),
           departure_time = COALESCE($5, departure_time),
           arrival_location = COALESCE($6, arrival_location),
           arrival_airport_code = COALESCE($7, arrival_airport_code),
           layover_location = COALESCE($8, layover_location),
           layover_location_code = COALESCE($9, layover_location_code),
           layover_duration = COALESCE($10, layover_duration),
           arrival_date = COALESCE($11, arrival_date),
           arrival_time = COALESCE($12, arrival_time),
           cost = COALESCE($13, cost),
           carrier = COALESCE($14, carrier),
           flight_number = COALESCE($15, flight_number),
           booking_reference = COALESCE($16, booking_reference),
           paid_by = COALESCE($17::jsonb, paid_by),
           passenger_ids = COALESCE($18::jsonb, passenger_ids)
      WHERE id = $19 AND user_id = $20
      RETURNING *`,
      [
        updates.passengerName ?? null,
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
         departure_date = COALESCE($2, f.departure_date),
         departure_location = COALESCE($3, f.departure_location),
         departure_airport_code = COALESCE($4, f.departure_airport_code),
         departure_time = COALESCE($5, f.departure_time),
         arrival_location = COALESCE($6, f.arrival_location),
         arrival_airport_code = COALESCE($7, f.arrival_airport_code),
         layover_location = COALESCE($8, f.layover_location),
         layover_location_code = COALESCE($9, f.layover_location_code),
         layover_duration = COALESCE($10, f.layover_duration),
         arrival_date = COALESCE($11, f.arrival_date),
         arrival_time = COALESCE($12, f.arrival_time),
         cost = COALESCE($13, f.cost),
         carrier = COALESCE($14, f.carrier),
         flight_number = COALESCE($15, f.flight_number),
         booking_reference = COALESCE($16, f.booking_reference),
         paid_by = COALESCE($17::jsonb, f.paid_by),
         passenger_ids = COALESCE($18::jsonb, f.passenger_ids)
    FROM trips t
    WHERE f.id = $19
      AND t.id = f.trip_id
      -- allow edits by any member of the trip's group
      AND t.group_id IN (SELECT group_id FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $20)
    RETURNING f.*`,
    [
      updates.passengerName,
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

export const updateTripDetails = async (
  userId: string,
  tripId: string,
  updates: {
    description?: string | null;
    destination?: string | null;
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
         start_date = CASE WHEN $6 = 'range' THEN $3::date WHEN $6 = 'month' THEN NULL ELSE start_date END,
         end_date = CASE WHEN $6 = 'range' THEN $4::date WHEN $6 = 'month' THEN NULL ELSE end_date END,
         start_month = CASE WHEN $6 = 'month' THEN $7::int WHEN $6 = 'range' THEN NULL ELSE start_month END,
         start_year = CASE WHEN $6 = 'month' THEN $8::int WHEN $6 = 'range' THEN NULL ELSE start_year END,
         duration_days = CASE WHEN $6 = 'month' THEN $9::int WHEN $6 = 'range' THEN NULL ELSE duration_days END,
         currency = COALESCE($10, currency)
     WHERE id = $5
     RETURNING id,
       group_id as "groupId",
       name,
       description,
       destination,
       start_date as "startDate",
       end_date as "endDate",
       start_month as "startMonth",
       start_year as "startYear",
       duration_days as "durationDays",
       currency,
       created_at as "createdAt"`,
    [
      updates.description ?? null,
      updates.destination ?? null,
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

export const getFlightForUser = async (flightId: string, userId: string): Promise<Flight | null> => {
  const p = getPool();
  const useInMemory = process.env.USE_IN_MEMORY_DB === '1';

  if (useInMemory) {
    const { rows } = await p.query<Flight>(
      `SELECT id,
              user_id as "userId",
              trip_id as "tripId",
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


export const listFlights = async (userId: string, tripId?: string): Promise<Flight[]> => {
  // Return flights for the given trip that the requesting user can see (anyone in the trip's group).
  const p = getPool();

  if (process.env.USE_IN_MEMORY_DB === '1') {
    const { rows } = await p.query(
      `
      SELECT id,
             user_id as "userId",
             trip_id as "tripId",
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
          SELECT t.id FROM trips t JOIN group_members gm ON gm.group_id = t.group_id WHERE gm.user_id = $1
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
       -- authorize by shared trip membership, not owner
       AND t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
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
      WHERE ($2::uuid IS NULL OR l.trip_id = $2)
        -- authorize by shared trip membership, not owner
        AND t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
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

export const insertLodging = async (lodging: {
  userId: string;
  tripId: string;
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
        id, user_id, trip_id, name, check_in_date, check_out_date, rooms, refund_by, total_cost, cost_per_night, address, place_id, paid_by, traveler_ids, image_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id,
                user_id as "userId",
                trip_id as "tripId",
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
          check_in_date = COALESCE($4, check_in_date),
          check_out_date = COALESCE($5, check_out_date),
          rooms = COALESCE($6, rooms),
          refund_by = COALESCE($7, refund_by),
          total_cost = COALESCE($8, total_cost),
          cost_per_night = COALESCE($9, cost_per_night),
          address = COALESCE($10, address),
          place_id = COALESCE($11, place_id),
          image_url = COALESCE($12, image_url),
          paid_by = COALESCE($13::jsonb, paid_by),
          traveler_ids = COALESCE($14::jsonb, traveler_ids),
          trip_id = COALESCE($15, trip_id)
        WHERE id = $1
        RETURNING
          id,
          user_id as "userId",
          trip_id as "tripId",
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
          check_in_date = COALESCE($4, l.check_in_date),
          check_out_date = COALESCE($5, l.check_out_date),
          rooms = COALESCE($6, l.rooms),
          refund_by = COALESCE($7, l.refund_by),
          total_cost = COALESCE($8, l.total_cost),
          cost_per_night = COALESCE($9, l.cost_per_night),
          address = COALESCE($10, l.address),
          place_id = COALESCE($11, l.place_id),
          image_url = COALESCE($12, l.image_url),
          paid_by = COALESCE($13::jsonb, l.paid_by),
          traveler_ids = COALESCE($14::jsonb, l.traveler_ids),
          trip_id = COALESCE($15, l.trip_id)
        FROM trips t
        WHERE l.id = $1
          AND t.id = COALESCE($15, l.trip_id)
          -- allow edits by any member of the trip's group
          AND t.group_id IN (SELECT group_id FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $2)
        RETURNING
          l.id,
          l.user_id as "userId",
          l.trip_id as "tripId",
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
export const listTours = async (userId: string, tripId?: string): Promise<Tour[]> => {
  // Return tours for the given trip that the requesting user can see (anyone in the trip's group).
  const p = getPool();
  const { rows } = await p.query<Tour>(
    `
    SELECT
      tu.id,
      tu.user_id as "userId",
      tu.trip_id as "tripId",
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
      tu.created_at as "createdAt"
    FROM tours tu
    JOIN trips t ON tu.trip_id = t.id
    WHERE ($2::uuid IS NULL OR tu.trip_id = $2)
      -- authorize by shared trip membership, not owner
      AND t.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
    ORDER BY tu.date ASC, tu.created_at DESC
    `,
    [userId, tripId ?? null]
  );
  return rows.map((r) => ({ ...r, paidBy: Array.isArray((r as any).paidBy) ? (r as any).paidBy : [] }));
};

export const insertTour = async (tour: Omit<Tour, 'id' | 'createdAt'>): Promise<Tour> => {
  const p = getPool();
  const id = randomUUID();
  const paidBy = JSON.stringify(tour.paidBy ?? []);
  const { rows } = await p.query<Tour>(
    `
    INSERT INTO tours (
      id, user_id, trip_id, date, name, start_location, start_time, duration, cost, free_cancel_by, booked_on, reference, paid_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    )
    RETURNING
      id,
      user_id as "userId",
      trip_id as "tripId",
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
      created_at as "createdAt"
    `,
    [
      id,
      tour.userId,
      tour.tripId,
      tour.date,
      tour.name,
      tour.startLocation,
      tour.startTime,
      tour.duration,
      tour.cost,
      tour.freeCancelBy ?? null,
      tour.bookedOn,
      tour.reference,
      paidBy,
    ]
  );
  const row = rows[0];
  return { ...row, paidBy: Array.isArray((row as any).paidBy) ? (row as any).paidBy : [] };
};

export const updateTour = async (id: string, userId: string, tour: Partial<Tour>): Promise<Tour | null> => {
  const p = getPool();
  const paidBy = typeof tour.paidBy !== 'undefined' ? JSON.stringify(tour.paidBy ?? []) : undefined;
  const { rows } = await p.query<Tour>(
    `
    UPDATE tours
    SET
      date = COALESCE($3, date),
      name = COALESCE($4, name),
      start_location = COALESCE($5, start_location),
      start_time = COALESCE($6, start_time),
      duration = COALESCE($7, duration),
      cost = COALESCE($8, cost),
      free_cancel_by = COALESCE($9, free_cancel_by),
      booked_on = COALESCE($10, booked_on),
      reference = COALESCE($11, reference),
      paid_by = COALESCE($12::jsonb, paid_by)
    WHERE id = $1 AND user_id = $2
    RETURNING
      id,
      user_id as "userId",
      trip_id as "tripId",
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
      created_at as "createdAt"
    `,
    [
      id,
      userId,
      tour.date ?? null,
      tour.name ?? null,
      tour.startLocation ?? null,
      tour.startTime ?? null,
      tour.duration ?? null,
      tour.cost ?? null,
      tour.freeCancelBy ?? null,
      tour.bookedOn ?? null,
      tour.reference ?? null,
      paidBy ?? null,
    ]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return { ...row, paidBy: Array.isArray((row as any).paidBy) ? (row as any).paidBy : [] };
};

export const deleteTour = async (tourId: string, userId: string): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM tours WHERE id = $1 AND user_id = $2`, [tourId, userId]);
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
): Promise<Array<{ id: string; guestName?: string; email?: string; firstName?: string; lastName?: string; status?: string; removedAt?: string | null }>> => {
  const p = getPool();
  const membership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
    [groupId, userId]
  );
  if (!membership.rowCount) throw new Error('Not authorized to view members');

  const { rows } = await p.query(
    `SELECT gm.id,
            gm.guest_name as "guestName",
            COALESCE(u.email, gm.invite_email) as "email",
            COALESCE(gm.first_name, wu.first_name, wu_pending.first_name) as "firstName",
            COALESCE(gm.last_name, wu.last_name, wu_pending.last_name) as "lastName",
            gm.removed_at as "removedAt",
            CASE
              WHEN gm.removed_at IS NOT NULL THEN 'removed'
              WHEN gm.user_id IS NULL THEN 'pending'
              WHEN gm.invite_email IS NOT NULL AND gm.claimed_at IS NULL THEN 'pending'
              ELSE 'active'
            END as status
     FROM group_members gm
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
            gi.invitee_email as "guestName",
            gi.invitee_email as "email",
            wu.first_name as "firstName",
            wu.last_name as "lastName",
            gi.status
     FROM group_invites gi
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
        await client.query(
          `INSERT INTO group_members (id, group_id, user_id, added_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          [randomUUID(), groupId, user.id, ownerId]
        );
        await client.query(
          `UPDATE group_members SET removed_at = NULL, invite_email = NULL, claimed_at = NOW()
           WHERE group_id = $1 AND user_id = $2`,
          [groupId, user.id]
        );
        await client.query(`DELETE FROM group_invites WHERE group_id = $1 AND invitee_email = $2`, [groupId, user.email]);
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
              t.start_date as "startDate",
              t.end_date as "endDate",
              t.start_month as "startMonth",
              t.start_year as "startYear",
              t.duration_days as "durationDays",
              t.currency as "currency",
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
            t.start_date as "startDate",
            t.end_date as "endDate",
            t.start_month as "startMonth",
            t.start_year as "startYear",
            t.duration_days as "durationDays",
            t.currency as "currency",
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
    `INSERT INTO trips (id, group_id, name, description, destination, start_date, end_date, start_month, start_year, duration_days, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id,
               group_id as "groupId",
               name,
               description,
               destination,
               start_date as "startDate",
               end_date as "endDate",
               start_month as "startMonth",
               start_year as "startYear",
               duration_days as "durationDays",
               currency,
               created_at as "createdAt"`,
    [
      id,
      groupId,
      name,
      details?.description ?? null,
      details?.destination ?? null,
      details?.startDate ?? null,
      details?.endDate ?? null,
      details?.startMonth ?? null,
      details?.startYear ?? null,
      details?.durationDays ?? null,
      details?.currency ?? 'USD',
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
      `SELECT gm.id, u.email
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.removed_at IS NULL`,
      [groupId, userId]
    );
    if (!membership.rowCount) throw new Error('Not authorized to delete this trip');
    const memberId = membership.rows[0].id;
    const memberEmail = membership.rows[0].email;

    await client.query(
      `INSERT INTO trip_removals (trip_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (trip_id, user_id) DO NOTHING`,
      [tripId, userId]
    );

    // Convert the member to a pending invite for the trip while keeping their passenger links intact.
    await client.query(
      `UPDATE group_members
         SET user_id = NULL,
             invite_email = COALESCE(invite_email, $1),
             claimed_at = NULL,
             removed_at = NULL
       WHERE id = $2`,
      [memberEmail, memberId]
    );

    // Ensure they are no longer a payer on any flights for this trip.
    const { rows: flights } = await client.query<{ id: string; paid_by: string[] | null }>(
      `SELECT id, COALESCE(paid_by, '[]'::jsonb) as paid_by FROM flights WHERE trip_id = $1`,
      [tripId]
    );
    for (const flight of flights) {
      const filtered = Array.isArray(flight.paid_by) ? flight.paid_by.filter((p) => p !== memberId) : [];
      await client.query(`UPDATE flights SET paid_by = $2 WHERE id = $1`, [flight.id, JSON.stringify(filtered)]);
    }

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
       start_date as "startDate",
       end_date as "endDate",
       start_month as "startMonth",
       start_year as "startYear",
       duration_days as "durationDays",
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
        if (user) {
          await client.query(
            `INSERT INTO group_members (id, group_id, user_id, guest_name, added_by, invite_email, claimed_at)
             VALUES ($1, $2, $3, $4, $5, NULL, NOW())
             ON CONFLICT (group_id, user_id) DO NOTHING`,
            [randomUUID(), groupId, user.id, guestName ?? null, ownerId]
          );
          await client.query(`DELETE FROM group_invites WHERE group_id = $1 AND invitee_email = $2`, [groupId, user.email]);
        } else {
          const inviteId = randomUUID();
          await client.query(
            `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT DO NOTHING`,
            [inviteId, groupId, ownerId, null, normalizedEmail]
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
        if (user) {
          await client.query(
            `INSERT INTO group_members (id, group_id, user_id, added_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (group_id, user_id) DO NOTHING`,
            [randomUUID(), groupId, user.id, payload.ownerId]
          );
          await client.query(`DELETE FROM group_invites WHERE group_id = $1 AND invitee_email = $2`, [groupId, user.email]);
        } else {
          const inviteId = randomUUID();
         await client.query(
            `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT DO NOTHING`,
            [inviteId, groupId, payload.ownerId, null, email]
          );
          invites.push({ id: inviteId, email });
        }
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
      `INSERT INTO trips (id, group_id, name, description, destination, start_date, end_date, start_month, start_year, duration_days, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id,
                 group_id as "groupId",
                 name,
                 description,
                 destination,
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
        payload.startDate ?? null,
        payload.endDate ?? null,
        payload.startMonth ?? null,
        payload.startYear ?? null,
        payload.durationDays ?? null,
        payload.currency ?? 'USD',
      ]
    );

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
  const { rows } = await p.query(
    `SELECT gi.id,
            gi.group_id as "groupId",
            gi.inviter_id as "inviterId",
            gi.invitee_user_id as "inviteeUserId",
            gi.invitee_email as "inviteeEmail",
            gi.status,
            gi.created_at as "createdAt",
            g.name as "groupName",
            u.email as "inviterEmail"
     FROM group_invites gi
     JOIN groups g ON gi.group_id = g.id
     JOIN users u ON gi.inviter_id = u.id
     WHERE (gi.invitee_user_id = $1 OR LOWER(gi.invitee_email) = LOWER($2)) AND gi.status = 'pending'
     ORDER BY gi.created_at DESC`,
    [userId, email]
  );
  return rows;
};

export const acceptGroupInvite = async (inviteId: string, userId: string): Promise<void> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, group_id as "groupId", inviter_id as "inviterId", status
       FROM group_invites WHERE id = $1 AND invitee_user_id = $2 FOR UPDATE`,
      [inviteId, userId]
    );

    if (!rows.length) {
      throw new Error('Invite not found');
    }
    const invite = rows[0];
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

    await client.query(`UPDATE group_invites SET status = 'accepted' WHERE id = $1`, [inviteId]);
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
  const url = 'https://raw.githubusercontent.com/algolia/datasets/master/airports/airports.json';
  let data: any[] = [];
  try {
    const res = await fetch(url);
    data = (await res.json()) as any[];
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
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
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
  const membership = await ensureUserInTrip(rows[0].tripId, userId);
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
  return inserted[0];
};

export const deleteItineraryDetail = async (userId: string, detailId: string): Promise<void> => {
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
  await p.query(`DELETE FROM itinerary_details WHERE id = $1`, [detailId]);
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


// Backwards-compatible export; call poolClient() when you need the Pool instance.
export const poolClient = (): Pool => getPool();

export const findOrCreateGoogleUser = async (profile: any): Promise<User> => {
    const p = getPool();
    const { id, displayName, emails, photos, name } = profile;

    const email = emails?.[0]?.value;
    if (!email) {
        throw new Error('Google profile did not return an email');
    }

    const existing = await p.query<User>(`SELECT * FROM users WHERE google_id = $1`, [id]);
    if (existing.rows.length) {
        const user = existing.rows[0];
        await p.query(
            `UPDATE users SET email = $1, picture = $2, first_name = $3, last_name = $4 WHERE id = $5`,
            [email, photos?.[0]?.value, name?.givenName, name?.familyName, user.id]
        );
        return user;
    }

    const existingByEmail = await p.query<User>(`SELECT * FROM users WHERE email = $1`, [email]);
    if (existingByEmail.rows.length) {
        const user = existingByEmail.rows[0];
        await p.query(
            `UPDATE users SET google_id = $1, picture = $2, first_name = $3, last_name = $4 WHERE id = $5`,
            [id, photos?.[0]?.value, name?.givenName, name?.familyName, user.id]
        );
        return user;
    }

    const newUserId = randomUUID();
    await p.query(
        `INSERT INTO users (id, email, provider, google_id, picture, first_name, last_name) VALUES ($1, $2, 'google', $3, $4, $5, $6)`,
        [newUserId, email, id, photos?.[0]?.value, name?.givenName, name?.familyName]
    );

    return { id: newUserId, email, provider: 'google' };
};

export const deleteAllUsers = async (userIds: string[]): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
};
