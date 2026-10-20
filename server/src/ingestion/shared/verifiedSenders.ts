import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { getCurrentDbProvider } from '../../db';
import { getFirebaseDb, getPg } from './repository';

// Additional addresses a user may forward from. Verification proves the user can
// read mail at the address; it does not by itself grant automatic-add trust
// (that also needs trusted receiver authentication results, see gap-closing §3.1).
export const VERIFIED_SENDER_CODE_TTL_MS = 30 * 60 * 1000;
export const VERIFIED_SENDER_RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFIED_SENDER_MAX_ATTEMPTS = 5;
export const VERIFIED_SENDER_MAX_PER_USER = 5;

export class SenderVerificationError extends Error {
  constructor(public readonly code: 'invalid_email' | 'verification_too_soon' | 'too_many_addresses' | 'verification_invalid',
    public readonly httpStatus: number, message: string) {
    super(message);
    this.name = 'SenderVerificationError';
  }
}

export type VerifiedSender = {
  id: string; userId: string; email: string; status: 'PENDING' | 'VERIFIED';
  codeHash: string | null; expiresAt: number; attempts: number; createdAt: number;
  lastSentAt: number; verifiedAt: number | null;
};
export type PublicVerifiedSender = Pick<VerifiedSender, 'id' | 'email' | 'status' | 'verifiedAt'>;

const firebase = (): boolean => getCurrentDbProvider() === 'firebase';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const COLLECTION = 'ingestion_verified_senders';

export const normalizeSenderEmail = (value: unknown): string | null => {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) return null;
  return email;
};
const senderId = (userId: string, email: string): string => hash(`${userId}:${email}`);
const newCode = (): string => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(8), byte => alphabet[byte % alphabet.length]).join('');
};
const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const ensureVerifiedSendersSchema = async (): Promise<void> => {
  if (firebase()) return;
  await getPg().query(`CREATE TABLE IF NOT EXISTS ingestion_verified_senders (
    id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL
  )`);
};

/** Read-modify-write one user's records in one transaction (user row lock / Firestore tx). */
const withUserRecords = async <T>(
  userId: string,
  work: (records: VerifiedSender[], write: (record: VerifiedSender) => void) => T
): Promise<T> => {
  await ensureVerifiedSendersSchema();
  if (firebase()) {
    const db = getFirebaseDb();
    return db.runTransaction(async tx => {
      const snap = await tx.get(db.collection(COLLECTION).where('userId', '==', userId).limit(50));
      const writes: VerifiedSender[] = [];
      const result = work(snap.docs.map(d => d.data() as VerifiedSender), r => writes.push(r));
      for (const record of writes) tx.set(db.collection(COLLECTION).doc(record.id), record);
      return result;
    });
  }
  const client = await getPg().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const { rows } = await client.query<{ data: VerifiedSender }>('SELECT data FROM ingestion_verified_senders WHERE user_id=$1', [userId]);
    const writes: VerifiedSender[] = [];
    const result = work(rows.map(r => r.data), r => writes.push(r));
    for (const record of writes) {
      await client.query(
        `INSERT INTO ingestion_verified_senders (id,user_id,data) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`, [record.id, userId, JSON.stringify(record)]);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};

export const toPublicSender = (r: VerifiedSender): PublicVerifiedSender =>
  ({ id: r.id, email: r.email, status: r.status, verifiedAt: r.verifiedAt });

/** Creates or refreshes a pending verification. The caller emails `code` to `email` only. */
export const startSenderVerification = async (userId: string, rawEmail: unknown):
  Promise<{ alreadyVerified: true } | { alreadyVerified: false; email: string; code: string }> => {
  const email = normalizeSenderEmail(rawEmail);
  if (!email) throw new SenderVerificationError('invalid_email', 400, 'Enter a valid email address.');
  const id = senderId(userId, email);
  const now = Date.now();
  const code = newCode();
  return withUserRecords(userId, (records, write) => {
    const existing = records.find(r => r.id === id);
    if (existing?.status === 'VERIFIED') return { alreadyVerified: true as const };
    if (existing && now - existing.lastSentAt < VERIFIED_SENDER_RESEND_COOLDOWN_MS) {
      throw new SenderVerificationError('verification_too_soon', 429, 'Please wait a minute before requesting another code.');
    }
    if (!existing && records.length >= VERIFIED_SENDER_MAX_PER_USER) {
      throw new SenderVerificationError('too_many_addresses', 409, 'Remove an address before adding another.');
    }
    write({
      id, userId, email, status: 'PENDING', codeHash: hash(`${id}:${code}`),
      expiresAt: now + VERIFIED_SENDER_CODE_TTL_MS, attempts: 0, createdAt: existing?.createdAt ?? now,
      lastSentAt: now, verifiedAt: null,
    });
    return { alreadyVerified: false as const, email, code };
  });
};

/** Single-use: the code is consumed on success, and invalidated after too many wrong guesses. */
export const confirmSenderVerification = async (userId: string, rawEmail: unknown, rawCode: unknown): Promise<PublicVerifiedSender> => {
  const email = normalizeSenderEmail(rawEmail);
  const code = String(rawCode ?? '').trim().toLowerCase();
  const invalid = () => new SenderVerificationError('verification_invalid', 400, 'That code is not valid. Request a new one.');
  if (!email || !/^[a-z0-9]{8}$/.test(code)) throw invalid();
  const id = senderId(userId, email);
  const now = Date.now();
  // A wrong guess must persist its attempt count, so the failure is returned, not thrown inside the tx.
  const outcome = await withUserRecords(userId, (records, write) => {
    const record = records.find(r => r.id === id);
    if (!record || record.status !== 'PENDING' || !record.codeHash || record.expiresAt <= now || record.attempts >= VERIFIED_SENDER_MAX_ATTEMPTS) {
      return { ok: false as const };
    }
    if (!sameHash(record.codeHash, hash(`${id}:${code}`))) {
      const attempts = record.attempts + 1;
      write({ ...record, attempts, codeHash: attempts >= VERIFIED_SENDER_MAX_ATTEMPTS ? null : record.codeHash });
      return { ok: false as const };
    }
    const verified: VerifiedSender = { ...record, status: 'VERIFIED', codeHash: null, attempts: 0, expiresAt: 0, verifiedAt: now };
    write(verified);
    return { ok: true as const, verified };
  });
  if (!outcome.ok) throw invalid();
  return toPublicSender(outcome.verified);
};

export const listSenders = async (userId: string): Promise<PublicVerifiedSender[]> => {
  const now = Date.now();
  return withUserRecords(userId, records => records
    .filter(r => r.status === 'VERIFIED' || r.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toPublicSender));
};

export const isVerifiedSender = async (userId: string, rawEmail: unknown): Promise<boolean> => {
  const email = normalizeSenderEmail(rawEmail);
  if (!email) return false;
  const id = senderId(userId, email);
  await ensureVerifiedSendersSchema();
  const record = firebase()
    ? (await getFirebaseDb().collection(COLLECTION).doc(id).get()).data() as VerifiedSender | undefined
    : (await getPg().query<{ data: VerifiedSender }>('SELECT data FROM ingestion_verified_senders WHERE id=$1 AND user_id=$2', [id, userId])).rows[0]?.data;
  return record?.status === 'VERIFIED' && record.userId === userId;
};

export const removeSender = async (userId: string, id: string): Promise<boolean> => {
  await ensureVerifiedSendersSchema();
  if (firebase()) {
    const ref = getFirebaseDb().collection(COLLECTION).doc(id);
    return getFirebaseDb().runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() as VerifiedSender).userId !== userId) return false;
      tx.delete(ref); return true;
    });
  }
  const result = await getPg().query('DELETE FROM ingestion_verified_senders WHERE id=$1 AND user_id=$2', [id, userId]);
  return (result.rowCount ?? 0) > 0;
};

export const deleteUserVerifiedSenders = async (userId: string): Promise<void> => {
  await ensureVerifiedSendersSchema();
  if (firebase()) {
    const db = getFirebaseDb();
    for (;;) {
      const docs = await db.collection(COLLECTION).where('userId', '==', userId).limit(100).get();
      if (docs.empty) break;
      const batch = db.batch(); docs.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit();
    }
    return;
  }
  await getPg().query('DELETE FROM ingestion_verified_senders WHERE user_id=$1', [userId]);
};
