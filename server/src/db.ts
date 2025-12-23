// server/src/db.ts
import { Pool } from 'pg';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { Flight, Group, GroupMember, Trait, Trip, User, WebUser, Lodging, Itinerary, ItineraryDetail } from './types';
import fetch from 'node-fetch';


let pool: Pool | null = null;


function getPool(): Pool {
  if (!pool) {
    const cs = process.env.DATABASE_URL;


    // Fail fast with a clear error instead of the SCRAM message
    if (typeof cs !== 'string' || cs.trim().length === 0) {
      throw new Error(
        `DATABASE_URL is missing or not a string. Got type=${typeof cs}, value=${String(cs)}`
      );
    }


    pool = new Pool({ connectionString: cs });
  }
  return pool;
}


export const initDb = async (): Promise<void> => {
  const p = getPool();


  await p.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');


  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);


  await p.query(`
    CREATE TABLE IF NOT EXISTS web_users (
      id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Backward compatibility if the table already exists
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;`);
  await p.query(`ALTER TABLE web_users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
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
      guest_name TEXT,
      added_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (group_id, user_id)
    );
  `);

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
    CREATE TABLE IF NOT EXISTS trips (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS flights (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      passenger_name TEXT NOT NULL,
      departure_date DATE NOT NULL,
      departure_location TEXT,
      departure_airport_code TEXT,
      departure_time TEXT NOT NULL,
      arrival_location TEXT,
      arrival_airport_code TEXT,
      layover_location TEXT,
      layover_location_code TEXT,
      layover_duration TEXT,
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
  await p.query(`ALTER TABLE flights ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(id) ON DELETE SET NULL;`);

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
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS rooms INTEGER NOT NULL DEFAULT 1;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS refund_by DATE;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS cost_per_night NUMERIC NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS address TEXT;`);

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

export const ensureDefaultGroupForUser = async (userId: string, email: string): Promise<void> => {
  const p = getPool();
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
  return rows[0] ?? null;
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
    id, user_id, trip_id, passenger_name, departure_date, departure_location, departure_airport_code, departure_time,
    arrival_location, arrival_airport_code, layover_location, layover_location_code, layover_duration,
    arrival_time, cost, carrier, flight_number, booking_reference
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`;


  const values = [
    id,
    flight.userId,
    flight.tripId,
    flight.passengerName,
    flight.departureDate,
    departureCode,
    departureCode,
    flight.departureTime,
    arrivalCode,
    arrivalCode,
    layoverCode,
    layoverCode,
    flight.layoverDuration ?? null,
    flight.arrivalTime,
    flight.cost,
    flight.carrier,
    flight.flightNumber,
    flight.bookingReference,
  ];

  const { rows } = await p.query<Flight>(query, values);
  return rows[0];
};


export const deleteFlight = async (flightId: string, userId: string): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM flights WHERE id = $1 AND user_id = $2`, [flightId, userId]);
};

export const updateFlight = async (
  flightId: string,
  userId: string,
  updates: Omit<Flight, 'id' | 'userId' | 'sharedWith' | 'tripId' | 'groupId' | 'passengerInGroup'>
): Promise<Flight> => {
  const p = getPool();
  const normalizeCode = (code?: string | null) => (code ? code.toUpperCase() : null);
  const departureCode = normalizeCode(updates.departureLocation ?? updates.departureAirportCode);
  const arrivalCode = normalizeCode(updates.arrivalLocation ?? updates.arrivalAirportCode);
  const layoverCode = normalizeCode(updates.layoverLocation ?? updates.layoverLocationCode);

  const { rows } = await p.query<Flight>(
    `UPDATE flights
     SET passenger_name = $1,
         departure_date = $2,
         departure_location = $3,
         departure_airport_code = $4,
         departure_time = $5,
         arrival_location = $6,
         arrival_airport_code = $7,
         layover_location = $8,
         layover_location_code = $9,
         layover_duration = $10,
         arrival_time = $11,
         cost = $12,
         carrier = $13,
         flight_number = $14,
         booking_reference = $15
     WHERE id = $16 AND user_id = $17
     RETURNING *`,
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
      updates.arrivalTime,
      updates.cost,
      updates.carrier,
      updates.flightNumber,
      updates.bookingReference,
      flightId,
      userId,
    ]
  );
  if (!rows.length) throw new Error('Flight not found');
  return rows[0];
};

export const ensureUserInTrip = async (tripId: string, userId: string): Promise<{ groupId: string } | null> => {
  const p = getPool();
  const { rows } = await p.query<{ groupId: string }>(
    `SELECT t.group_id as "groupId"
     FROM trips t
     JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = $2
     WHERE t.id = $1`,
    [tripId, userId]
  );
  return rows[0] ?? null;
};

export const getFlightForUser = async (flightId: string, userId: string): Promise<Flight | null> => {
  const p = getPool();

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
       f.arrival_time as "arrivalTime",
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

  return rows[0] ?? null;
};


export const listFlights = async (userId: string, tripId?: string): Promise<Flight[]> => {
  const p = getPool();


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
            LOWER(gm.guest_name) = LOWER(f.passenger_name)
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
      END as layover_airport_label
     FROM flights f
     JOIN trips t ON f.trip_id = t.id
     LEFT JOIN airports apd ON apd.iata_code = f.departure_location
     LEFT JOIN airports apa ON apa.iata_code = f.arrival_location
     LEFT JOIN airports apl ON apl.iata_code = f.layover_location
     WHERE f.user_id = $1
       AND ($2::uuid IS NULL OR f.trip_id = $2)
     ORDER BY f.departure_date DESC`,
    [userId, tripId ?? null]
  );


  return rows;
};

export const listLodgings = async (userId: string, tripId?: string | null): Promise<Lodging[]> => {
  const p = getPool();
  const params: any[] = [userId];
  let where = 'user_id = $1';
  if (tripId) {
    params.push(tripId);
    where += ` AND trip_id = $${params.length}`;
  }
  const { rows } = await p.query(
    `
      SELECT id,
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
             created_at as "createdAt"
      FROM lodgings
      WHERE ${where}
      ORDER BY check_in_date ASC
    `,
    params
  );
  return rows;
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
}): Promise<Lodging> => {
  const p = getPool();
  const id = randomUUID();
  const { rows } = await p.query(
    `
      INSERT INTO lodgings (
        id, user_id, trip_id, name, check_in_date, check_out_date, rooms, refund_by, total_cost, cost_per_night, address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    ]
  );
  return rows[0];
};

export const deleteLodging = async (lodgingId: string, userId: string): Promise<void> => {
  const p = getPool();
  await p.query(`DELETE FROM lodgings WHERE id = $1 AND user_id = $2`, [lodgingId, userId]);
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
): Promise<Array<{ id: string; guestName?: string; email?: string; firstName?: string; lastName?: string }>> => {
  const p = getPool();
  const membership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (!membership.rowCount) throw new Error('Not authorized to view members');

  const { rows } = await p.query(
    `SELECT gm.id,
            gm.guest_name as "guestName",
            u.email as "email",
            wu.first_name as "firstName",
            wu.last_name as "lastName"
     FROM group_members gm
     LEFT JOIN users u ON gm.user_id = u.id
     LEFT JOIN web_users wu ON gm.user_id = wu.id
     WHERE gm.group_id = $1
     ORDER BY gm.created_at DESC`,
    [groupId]
  );
  return rows;
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
     WHERE EXISTS (
       SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1
     )
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

  return groupsResult.rows.map((g) => ({
    ...g,
    members: membersResult.rows.filter((m) => m.groupId === g.id),
    invites: invitesResult.rows.filter((i) => i.groupId === g.id),
  }));
};

export const addGroupMember = async (
  ownerId: string,
  groupId: string,
  member: { email?: string; guestName?: string }
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

    if (member.guestName && member.guestName.trim()) {
      await client.query(
        `INSERT INTO group_members (id, group_id, guest_name, added_by) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), groupId, member.guestName.trim(), ownerId]
      );
      await client.query('COMMIT');
      return {};
    }

    if (member.email && member.email.trim()) {
      const user = await findUserByEmail(member.email.trim());
      if (user) {
        await client.query(
          `INSERT INTO group_members (id, group_id, user_id, added_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          [randomUUID(), groupId, user.id, ownerId]
        );
        await client.query(`DELETE FROM group_invites WHERE group_id = $1 AND invitee_email = $2`, [groupId, user.email]);
        await client.query('COMMIT');
        return {};
      }

      const inviteId = randomUUID();
      await client.query(
        `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT DO NOTHING`,
        [inviteId, groupId, ownerId, null, member.email.trim()]
      );
      await client.query('COMMIT');
      return { inviteId, email: member.email.trim() };
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
  ownerId: string,
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
    if (!groupRows.length || groupRows[0].ownerId !== ownerId) throw new Error('Group not found or not owner');

    const { rows: memberRows } = await client.query(
      `SELECT user_id as "userId" FROM group_members WHERE id = $1 AND group_id = $2`,
      [memberId, groupId]
    );
    if (!memberRows.length) throw new Error('Member not found');
    if (memberRows[0].userId === ownerId) throw new Error('Owner cannot be removed');

    await client.query(`DELETE FROM group_members WHERE id = $1 AND group_id = $2`, [memberId, groupId]);
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
  const { rows } = await p.query(
    `SELECT t.id, t.group_id as "groupId", t.name, t.created_at as "createdAt", g.name as "groupName"
     FROM trips t
     JOIN groups g ON t.group_id = g.id
     WHERE EXISTS (
       SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = $1
     )
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows;
};

export const createTrip = async (userId: string, groupId: string, name: string): Promise<Trip> => {
  const p = getPool();
  const membership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (!membership.rowCount) throw new Error('Not a member of this group');

  const id = randomUUID();
  const { rows } = await p.query<Trip>(
    `INSERT INTO trips (id, group_id, name) VALUES ($1, $2, $3) RETURNING id, group_id as "groupId", name, created_at as "createdAt"`,
    [id, groupId, name]
  );
  return rows[0];
};

export const deleteTrip = async (userId: string, tripId: string): Promise<void> => {
  const p = getPool();
  const { rows } = await p.query<{ groupId: string }>(
    `SELECT group_id as "groupId" FROM trips WHERE id = $1`,
    [tripId]
  );
  if (!rows.length) throw new Error('Trip not found');
  const membership = await p.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [rows[0].groupId, userId]
  );
  if (!membership.rowCount) throw new Error('Not authorized to delete this trip');
  await p.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
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
     RETURNING id, group_id as "groupId", name, created_at as "createdAt",
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
      if (member.guestName && member.guestName.trim().length) {
        await client.query(
          `INSERT INTO group_members (id, group_id, guest_name, added_by) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), groupId, member.guestName.trim(), ownerId]
        );
        continue;
      }

      if (member.email && member.email.trim().length) {
        const user = await findUserByEmail(member.email.trim());
        if (user) {
          await client.query(
            `INSERT INTO group_members (id, group_id, user_id, added_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (group_id, user_id) DO NOTHING`,
            [randomUUID(), groupId, user.id, ownerId]
          );
          await client.query(`DELETE FROM group_invites WHERE group_id = $1 AND invitee_email = $2`, [groupId, user.email]);
        } else {
          const inviteId = randomUUID();
          await client.query(
            `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT DO NOTHING`,
            [inviteId, groupId, ownerId, null, member.email.trim()]
          );
          invites.push({ id: inviteId, email: member.email.trim() });
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

    await client.query(
      `INSERT INTO group_members (id, group_id, user_id, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [randomUUID(), invite.groupId, userId, invite.inviterId]
    );

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
  console.log('[airports] refresh starting');
  const url = 'https://raw.githubusercontent.com/algolia/datasets/master/airports/airports.json';
  let data: any[] = [];
  try {
    const res = await fetch(url);
    data = (await res.json()) as any[];
  } catch (err) {
    console.error('Failed to download airports dataset', err);
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
    console.log(`[airports] refreshed ${filtered.length} airports`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to refresh airports', err);
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


// Backwards-compatible export; call poolClient() when you need the Pool instance.
export const poolClient = (): Pool => getPool();
