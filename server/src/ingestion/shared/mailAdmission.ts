import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { getCurrentDbProvider } from '../../db';
import { getEnvValue } from '../../env';
import { getFirebaseDb, getPg } from './repository';
import { IngestionError } from './userFailures';
import { INGESTION_USAGE_KEYS } from '../config';

// Bounded first release: larger confirmations continue through manual upload.
// Encrypted raw mail stays below Firestore's single-document limit even after
// base64 encoding. It is private quarantine, never rendered or parsed at intake.
export const MAIL_MAX_BYTES = 256 * 1024;
export const MAIL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 20;
const QUEUE_LIMIT = 20;
export type RawMail = {
  body: Record<string, string>;
  files: Array<{ originalname: string; mimetype: string; bytes: string }>;
};
export type MailReceipt = {
  id: string; userId: string; quotaReserved: boolean; state: 'PENDING' | 'HELD' | 'COMPLETE';
  encrypted: string | null; attempts: number; nextAttemptAt: number;
  lease: string | null; leaseUntil: number; expiresAt: number;
  allowLargeLlm: boolean; allowSmallLlm: boolean;
};
type Alias = { userId: string; tokenHash: string; encrypted: string; createdAt: number; keyVersion: 1 };
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const firebase = (): boolean => getCurrentDbProvider() === 'firebase';

const key = (): Buffer => {
  const secret = getEnvValue('INGESTION_ENCRYPTION_SECRET');
  if (!secret && getEnvValue('NODE_ENV') !== 'test') throw new Error('INGESTION_ENCRYPTION_SECRET is required for mail admission');
  return createHash('sha256').update(secret || 'mail-admission-tests-only').digest();
};
const seal = (value: string, aad: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`mail:v1:${aad}`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
};
const open = (value: string, aad: string): string => {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(`mail:v1:${aad}`));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
};
export const mailAliasDomain = (): string => {
  const domain = (getEnvValue('INGESTION_ALIAS_DOMAIN') || 'in.wander-bunnies.com').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('Invalid INGESTION_ALIAS_DOMAIN');
  return domain;
};
const newToken = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0; let value = 0; let token = '';
  for (const byte of randomBytes(16)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; token += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) token += alphabet[(value << (5 - bits)) & 31];
  return token;
};

// Runtime expansion matches the SQL migration; pg-mem uses this same path.
export const ensureMailAdmissionSchema = async (): Promise<void> => {
  if (firebase()) return;
  await getPg().query(`CREATE TABLE IF NOT EXISTS ingestion_aliases (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, data JSONB NOT NULL
  )`);
  await getPg().query(`CREATE TABLE IF NOT EXISTS ingestion_mail_receipts (
    id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL
  )`);
};

/** Rotation immediately revokes the old capability. No grace for leaked aliases. */
export const getMailAlias = async (userId: string, rotate = false): Promise<string> => {
  await ensureMailAdmissionSchema();
  // Generate the actual capability separately from database identifiers.
  const token = newToken();
  const actualHash = hash(token);
  const address = `u-${token}@${mailAliasDomain()}`;
  const alias: Alias = { userId, tokenHash: actualHash, encrypted: seal(address, `alias:${userId}:${actualHash}`), createdAt: Date.now(), keyVersion: 1 };
  let result: Alias;
  if (firebase()) {
    const db = getFirebaseDb();
    const owner = db.collection('ingestion_alias_owners').doc(userId);
    result = await db.runTransaction(async tx => {
      const previous = await tx.get(owner);
      if (previous.exists && !rotate) return previous.data() as Alias;
      const ref = db.collection('ingestion_aliases').doc(actualHash);
      const existing = await tx.get(ref);
      if (existing.exists) throw new Error('Alias collision');
      if (previous.exists) tx.delete(db.collection('ingestion_aliases').doc(String(previous.data()!.tokenHash)));
      tx.create(ref, alias); tx.set(owner, alias);
      return alias;
    });
  } else {
    const { rows } = await getPg().query<{ data: Alias }>(
      `INSERT INTO ingestion_aliases (user_id, token_hash, data) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET
       token_hash = CASE WHEN $4 THEN EXCLUDED.token_hash ELSE ingestion_aliases.token_hash END,
       data = CASE WHEN $4 THEN EXCLUDED.data ELSE ingestion_aliases.data END RETURNING data`,
      [userId, actualHash, JSON.stringify(alias), rotate]);
    result = rows[0].data;
  }
  return open(result.encrypted, `alias:${userId}:${result.tokenHash}`);
};

export const resolveMailAlias = async (recipient: unknown): Promise<{ userId: string; aliasHash: string } | null> => {
  if (typeof recipient !== 'string') return null;
  const match = /^u-([a-z2-7]{26})@([^@]+)$/.exec(recipient.trim().toLowerCase());
  if (!match || match[2] !== mailAliasDomain()) return null;
  await ensureMailAdmissionSchema();
  const aliasHash = hash(match[1]);
  const record = firebase()
    ? (await getFirebaseDb().collection('ingestion_aliases').doc(aliasHash).get()).data() as Alias | undefined
    : (await getPg().query<{ data: Alias }>('SELECT data FROM ingestion_aliases WHERE token_hash=$1', [aliasHash])).rows[0]?.data;
  return record ? { userId: record.userId, aliasHash } : null;
};

export const mailReceiptId = (userId: string, body: Record<string, unknown>): string =>
  hash(`${userId}:${String(body.token)}`);

/** Receipt + transport dedupe + quota are one transaction. Holds consume no quota.
 * User row locks serialize PostgreSQL admission across alias rotations/instances.
 * Firestore contention on the owner doc supplies the equivalent serialization. */
export const admitMail = async (params: {
  id: string; userId: string; aliasHash: string; raw: RawMail; monthlyLimit: number;
  allowLargeLlm: boolean; allowSmallLlm: boolean;
}): Promise<MailReceipt | null> => {
  await ensureMailAdmissionSchema();
  const now = Date.now(); const month = new Date(now).toISOString().slice(0, 7);
  const day = new Date(now).toISOString().slice(0, 10);
  const metric = INGESTION_USAGE_KEYS.forwardedMailboxDeliveries;
  const makeReceipt = (held: boolean): MailReceipt => ({
    id: params.id, userId: params.userId, quotaReserved: !held, state: held ? 'HELD' : 'PENDING',
    encrypted: seal(JSON.stringify(params.raw), `receipt:${params.userId}:${params.id}`),
    attempts: 0, nextAttemptAt: now, lease: null, leaseUntil: 0, expiresAt: now + MAIL_RETENTION_MS,
    allowLargeLlm: params.allowLargeLlm, allowSmallLlm: params.allowSmallLlm,
  });
  if (firebase()) {
    const db = getFirebaseDb();
    return db.runTransaction(async tx => {
      const ref = db.collection('ingestion_mail_receipts').doc(params.id);
      const owner = db.collection('ingestion_alias_owners').doc(params.userId);
      const quota = db.collection('usage_counters').doc(`${params.userId}_${metric}_${month}`);
      const [old, alias, usage, queued] = await Promise.all([
        tx.get(ref), tx.get(owner), tx.get(quota),
        tx.get(db.collection('ingestion_mail_receipts').where('userId', '==', params.userId).where('state', 'in', ['PENDING', 'HELD']).limit(20)),
      ]);
      if (old.exists) return old.data() as MailReceipt;
      if (alias.data()?.tokenHash !== params.aliasHash) return null;
      const pending = queued.docs.map(d => d.data() as MailReceipt).filter(r => r.state !== 'COMPLETE');
      if (pending.length >= QUEUE_LIMIT) return null;
      const count = Number(usage.data()?.count ?? 0);
      const daily = alias.data()?.day === day ? Number(alias.data()?.accepted ?? 0) : 0;
      const held = count >= params.monthlyLimit || daily >= DAILY_LIMIT;
      const receipt = makeReceipt(held);
      tx.create(ref, receipt);
      if (!held) {
        tx.set(quota, { userId: params.userId, metricKey: metric, windowKey: month, count: count + 1, updatedAt: new Date(now).toISOString() });
        tx.update(owner, { day, accepted: daily + 1 });
      }
      return receipt;
    });
  }
  const client = await getPg().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [params.userId]);
    const old = await client.query<{ data: MailReceipt }>('SELECT data FROM ingestion_mail_receipts WHERE id=$1', [params.id]);
    if (old.rows[0]) { await client.query('COMMIT'); return old.rows[0].data; }
    const alias = await client.query<{ data: Alias & { day?: string; accepted?: number } }>('SELECT data FROM ingestion_aliases WHERE user_id=$1 AND token_hash=$2', [params.userId, params.aliasHash]);
    if (!alias.rows[0]) { await client.query('ROLLBACK'); return null; }
    const queued = await client.query<{ data: MailReceipt }>("SELECT data FROM ingestion_mail_receipts WHERE user_id=$1 AND data->>'state' IN ('PENDING','HELD') LIMIT 20", [params.userId]);
    if (queued.rows.length >= QUEUE_LIMIT) {
      await client.query('ROLLBACK'); return null;
    }
    const usage = await client.query<{ count: string }>('SELECT count FROM usage_counters WHERE user_id=$1 AND metric_key=$2 AND window_key=$3', [params.userId, metric, month]);
    const count = Number(usage.rows[0]?.count ?? 0);
    const daily = alias.rows[0].data.day === day ? Number(alias.rows[0].data.accepted ?? 0) : 0;
    const held = count >= params.monthlyLimit || daily >= DAILY_LIMIT;
    const receipt = makeReceipt(held);
    await client.query('INSERT INTO ingestion_mail_receipts (id,user_id,data) VALUES ($1,$2,$3)', [receipt.id, receipt.userId, JSON.stringify(receipt)]);
    if (!held) {
      await client.query(`INSERT INTO usage_counters (id,user_id,metric_key,window_key,count) VALUES ($1,$2,$3,$4,1)
        ON CONFLICT (user_id,metric_key,window_key) DO UPDATE SET count=usage_counters.count+1`, [randomUUID(), params.userId, metric, month]);
      await client.query('UPDATE ingestion_aliases SET data=$2 WHERE user_id=$1', [params.userId, JSON.stringify({ ...alias.rows[0].data, day, accepted: daily + 1 })]);
    }
    await client.query('COMMIT'); return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};

export const listMailReceipts = async (userId?: string): Promise<MailReceipt[]> => {
  await ensureMailAdmissionSchema();
  if (firebase()) {
    const collection = getFirebaseDb().collection('ingestion_mail_receipts');
    const query = userId ? collection.where('userId', '==', userId) : collection.where('state', '==', 'PENDING').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt');
    return (await query.limit(100).get()).docs.map(d => d.data() as MailReceipt);
  }
  const result = await getPg().query<{ data: MailReceipt }>(userId
    ? 'SELECT data FROM ingestion_mail_receipts WHERE user_id=$1 LIMIT 100'
    : "SELECT data FROM ingestion_mail_receipts WHERE data->>'state'='PENDING' LIMIT 100", userId ? [userId] : []);
  return result.rows.map(r => r.data);
};

export const updateMailReceipt = async (id: string, change: (current: MailReceipt) => MailReceipt | null): Promise<MailReceipt | null> => {
  await ensureMailAdmissionSchema();
  if (firebase()) {
    const ref = getFirebaseDb().collection('ingestion_mail_receipts').doc(id);
    return getFirebaseDb().runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const next = change(snap.data() as MailReceipt);
      if (next) tx.set(ref, next);
      return next;
    });
  }
  const client = await getPg().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ data: MailReceipt }>('SELECT data FROM ingestion_mail_receipts WHERE id=$1 FOR UPDATE', [id]);
    const next = rows[0] ? change(rows[0].data) : null;
    if (next) await client.query('UPDATE ingestion_mail_receipts SET data=$2 WHERE id=$1', [id, JSON.stringify(next)]);
    await client.query('COMMIT'); return next;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};
export const readRawMail = (receipt: MailReceipt): RawMail => {
  if (!receipt.encrypted || receipt.expiresAt <= Date.now()) throw new IngestionError('mailbox_webhook_temporary_failure', 503);
  return JSON.parse(open(receipt.encrypted, `receipt:${receipt.userId}:${receipt.id}`)) as RawMail;
};

/** Authenticated Import once, with exactly-once reservation for quota holds. */
export const releaseHeldMail = async (id: string, userId: string, limit: number): Promise<boolean> => {
  await ensureMailAdmissionSchema();
  const month = new Date().toISOString().slice(0, 7);
  const metric = INGESTION_USAGE_KEYS.forwardedMailboxDeliveries;
  const canRelease = (r: MailReceipt | undefined): r is MailReceipt =>
    Boolean(r && r.userId === userId && r.state === 'HELD' && r.expiresAt > Date.now());
  const released = (r: MailReceipt): MailReceipt => ({ ...r, quotaReserved: true, state: 'PENDING', attempts: 0, nextAttemptAt: Date.now() });
  if (firebase()) {
    const db = getFirebaseDb();
    return db.runTransaction(async tx => {
      const ref = db.collection('ingestion_mail_receipts').doc(id);
      const quota = db.collection('usage_counters').doc(`${userId}_${metric}_${month}`);
      const [snap, usage] = await Promise.all([tx.get(ref), tx.get(quota)]);
      const r = snap.data() as MailReceipt | undefined;
      if (!canRelease(r)) return false;
      const count = Number(usage.data()?.count ?? 0);
      if (!r.quotaReserved && count >= limit) throw new IngestionError('quota_exceeded', 429);
      if (!r.quotaReserved) tx.set(quota, { userId, metricKey: metric, windowKey: month, count: count + 1, updatedAt: new Date().toISOString() });
      tx.set(ref, released(r)); return true;
    });
  }
  const client = await getPg().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const { rows } = await client.query<{ data: MailReceipt }>('SELECT data FROM ingestion_mail_receipts WHERE id=$1 FOR UPDATE', [id]);
    const r = rows[0]?.data;
    if (!canRelease(r)) { await client.query('ROLLBACK'); return false; }
    if (!r.quotaReserved) {
      const usage = await client.query<{ count: string }>('SELECT count FROM usage_counters WHERE user_id=$1 AND metric_key=$2 AND window_key=$3', [userId, metric, month]);
      if (Number(usage.rows[0]?.count ?? 0) >= limit) throw new IngestionError('quota_exceeded', 429);
      await client.query(`INSERT INTO usage_counters (id,user_id,metric_key,window_key,count) VALUES ($1,$2,$3,$4,1)
        ON CONFLICT (user_id,metric_key,window_key) DO UPDATE SET count=usage_counters.count+1`, [randomUUID(), userId, metric, month]);
    }
    await client.query('UPDATE ingestion_mail_receipts SET data=$2 WHERE id=$1', [id, JSON.stringify(released(r))]);
    await client.query('COMMIT'); return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};

/** Bounded cleanup; run through the authenticated scheduled worker. */
export const cleanupMailReceipts = async (): Promise<number> => {
  await ensureMailAdmissionSchema();
  const now = Date.now();
  if (firebase()) {
    const db = getFirebaseDb();
    const expired = await db.collection('ingestion_mail_receipts').where('expiresAt', '<=', now).limit(100).get();
    const batch = db.batch(); expired.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit();
    return expired.size;
  }
  const result = await getPg().query('DELETE FROM ingestion_mail_receipts WHERE (data->>\'expiresAt\')::bigint <= $1', [now]);
  return result.rowCount ?? 0;
};

export const deleteUserMailAdmissionData = async (userId: string): Promise<void> => {
  await ensureMailAdmissionSchema();
  if (firebase()) {
    const db = getFirebaseDb();
    // Revoke first so no new delivery can be attributed during cleanup.
    const owner = db.collection('ingestion_alias_owners').doc(userId);
    const previous = await owner.get();
    await owner.delete();
    if (previous.exists) await db.collection('ingestion_aliases').doc(String(previous.data()!.tokenHash)).delete();
    for (;;) {
      const docs = await db.collection('ingestion_mail_receipts').where('userId', '==', userId).limit(100).get();
      if (docs.empty) break;
      const batch = db.batch(); docs.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit();
    }
    await (await import('./verifiedSenders')).deleteUserVerifiedSenders(userId);
    return;
  }
  await getPg().query('DELETE FROM ingestion_aliases WHERE user_id=$1', [userId]);
  await getPg().query('DELETE FROM ingestion_mail_receipts WHERE user_id=$1', [userId]);
  await (await import('./verifiedSenders')).deleteUserVerifiedSenders(userId);
};

export const recordSyntheticReceipt = async (userId: string, address: string): Promise<void> => {
  const id = `setup-test:${userId}`;
  const data = { id, userId, state: 'COMPLETE', encrypted: null, synthetic: true, quotaReserved: false, attempts: 0,
    nextAttemptAt: Date.now(), lease: null, leaseUntil: 0, expiresAt: Date.now() + MAIL_RETENTION_MS, allowLargeLlm: false, allowSmallLlm: false };
  // Reuse the private receipt store and coalesce repeated tests. The address is
  // deliberately not persisted/logged; resolving it above checks alias storage.
  if (!address) throw new Error('Alias unavailable');
  await ensureMailAdmissionSchema();
  if (firebase()) await getFirebaseDb().collection('ingestion_mail_receipts').doc(id).set(data);
  else await getPg().query('INSERT INTO ingestion_mail_receipts(id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data', [id,userId,JSON.stringify(data)]);
};
