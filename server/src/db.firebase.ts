// Firebase adapter (Firestore-backed)
import { initializeApp, cert, deleteApp, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldPath } from 'firebase-admin/firestore';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import {
  Flight,
  Lodging,
  Activity,
  CarRental,
  Trait,
  Trip,
  User,
  WebUser,
  Itinerary,
  ItineraryDetail,
  Group,
  GroupMember,
  PlaceDetailsCache,
  LocationRecord,
  AttractionCatalogEntry,
  AttractionShortlistBlob,
  TripActivity,
  TripActivityType,
  TripComment,
} from './types';
import { logError, logInfo } from './logger';
import { getEnvValue, isLocalEnv } from './env';
import { normalizeItineraryStatus } from './utils/itineraryStatus';

let app: App | null = null;
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const nowIso = () => new Date().toISOString();
const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 64).toString('hex');
const stripUndefined = <T extends Record<string, any>>(updates: T): Partial<T> =>
  Object.fromEntries(Object.entries(updates).filter(([, value]) => typeof value !== 'undefined')) as Partial<T>;
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

export const getDb = (): Firestore => {
  if (!app) {
    logInfo('Firebase app not initialized, initializing...');
    const firebaseConfigRaw = process.env.FIREBASE_CONFIG;
    let firebaseConfigProjectId: string | undefined;
    if (firebaseConfigRaw) {
      try {
        const parsed = JSON.parse(firebaseConfigRaw) as { projectId?: string };
        firebaseConfigProjectId = parsed.projectId;
        logInfo('Parsed FIREBASE_CONFIG for projectId.');
      } catch (e) {
        // Ignore malformed FIREBASE_CONFIG; fall back to explicit envs.
        logError('Malformed FIREBASE_CONFIG, ignoring', e);
      }
    }
    const projectId =
      process.env.GCLOUD_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      firebaseConfigProjectId;
    logInfo(`Using projectId: ${projectId}`);
    const clientEmail = getEnvValue('FIREBASE_CLIENT_EMAIL');
    const rawPrivateKey = getEnvValue('FIREBASE_PRIVATE_KEY');
    const privateKey = rawPrivateKey ? rawPrivateKey.replace(/\\n/g, '\n') : undefined;
    if (process.env.K_SERVICE && process.env.FIRESTORE_EMULATOR_HOST) {
      // Never use emulator on Cloud Run even if the env var is present.
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
    const useEmulator = isLocalEnv() && !!process.env.FIRESTORE_EMULATOR_HOST;
    if (useEmulator) {
      const emulatorHost = getEnvValue('FIRESTORE_EMULATOR_HOST', { defaultValue: 'localhost:8080' });
      logInfo(`Using Firestore emulator at ${emulatorHost}`);
      process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
      app = initializeApp({ projectId });
    } else {
      if (!projectId) {
        logError('GCLOUD_PROJECT_ID (or FIREBASE_PROJECT_ID) is required for Firebase DB provider');
        throw new Error('GCLOUD_PROJECT_ID (or FIREBASE_PROJECT_ID) is required for Firebase DB provider');
      }
      if (clientEmail && privateKey) {
        logInfo('Initializing Firebase with service account credentials.');
        app = initializeApp({
          credential: cert({ projectId, clientEmail, privateKey }),
          projectId,
        });
      } else {
        logInfo('Initializing Firebase with default Application Default Credentials (ADC).');
        // Default to ADC on Cloud Run / local gcloud auth
        app = initializeApp({ projectId });
      }
    }
    logInfo('Firebase app initialized.');
  }
  const databaseId = getEnvValue('FIRESTORE_DATABASE_ID');
  if (databaseId) {
  }
  return databaseId ? getFirestore(app!, databaseId) : getFirestore(app!);
};

export const initDb = async (): Promise<void> => {
  logInfo('Initializing DB connection...');
  const db = getDb();
  try {
    logInfo('Attempting to list collections to test database connection...');
    await db.collection('users').limit(1).get();
    logInfo('Database connection test successful.');
  } catch (error) {
    logError('Database connection test failed.', error);
    if (process.env.K_SERVICE) {
      // On Cloud Run, provide more diagnostics.
      logInfo('This service is running on Cloud Run. Checking for common issues...');
      try {
        const saResponse = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
            headers: { 'Metadata-Flavor': 'Google' }
        });
        if(saResponse.ok) {
            const serviceAccount = await saResponse.text();
            const projectIdForLog =
              getEnvValue('GCLOUD_PROJECT_ID') ||
              getEnvValue('GOOGLE_CLOUD_PROJECT') ||
              getEnvValue('FIREBASE_PROJECT_ID') ||
              'unknown';
            logInfo(`Cloud Run service is using service account: ${serviceAccount}. Ensure this service account has the 'Cloud Datastore User' role on project ${projectIdForLog}.`);
        } else {
            logError('Could not retrieve service account from metadata server.', await saResponse.text());
        }
      } catch (metaError) {
          logError('Failed to query metadata server for service account diagnostics.', metaError);
      }
    }
    throw error;
  }
};

export const closePool = async (): Promise<void> => {
  if (app) {
    await deleteApp(app);
    app = null;
  }
};

// Placeholder exports; implementations appended below.
export const poolClient = (): any => {
  throw new Error('Direct SQL Pool is not available for Firebase provider');
};

// Users
export const findOrCreateUser = async (email: string, provider: User['provider']): Promise<User> => {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const existing = await db.collection('users').where('email', '==', normalized).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    const data = doc.data() as User;
    return { id: doc.id, email: data.email, provider: data.provider };
  }
  const id = randomUUID();
  await db.collection('users').doc(id).set({ email: normalized, provider, createdAt: nowIso(), emailVerified: true });
  return { id, email: normalized, provider };
};

export const ensureDefaultGroupForUser = async (userId: string, email: string): Promise<void> => {
  const db = getDb();
  const groups = await db.collection('groups').where('ownerId', '==', userId).where('name', '==', 'My Trips').limit(1).get();
  if (!groups.empty) return;
  const groupId = randomUUID();
  await db.collection('groups').doc(groupId).set({ ownerId: userId, name: 'My Trips', createdAt: nowIso() });
  await db.collection('group_members').doc(randomUUID()).set({
    groupId,
    userId,
    addedBy: userId,
    createdAt: nowIso(),
    removedAt: null,
  });
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const snapshot = await db.collection('users').where('email', '==', normalized).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as User;
  return { id: doc.id, email: data.email, provider: data.provider };
};

export const findUserByIdentifier = async (identifier: string): Promise<User | null> => {
  const normalized = normalizeEmail(identifier);
  if (!normalized.includes('@')) {
    const usersByUsername = await getDb().collection('users').where('username', '==', normalized).limit(1).get();
    if (usersByUsername.empty) return null;
    const doc = usersByUsername.docs[0];
    const data = doc.data() as User;
    return { id: doc.id, email: data.email, provider: data.provider };
  }
  return findUserByEmail(normalized);
};

export const createWebUser = async (
  firstName: string,
  lastName: string,
  email: string,
  password: string
): Promise<WebUser> => {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) {
    const webUserDoc = await db.collection('web_users').doc(existingUser.id).get();
    if (webUserDoc.exists) {
      const err: any = new Error('User already exists');
      err.code = 'USER_EXISTS';
      throw err;
    }
    // User from another provider, upgrade to email/password
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    await db.collection('web_users').doc(existingUser.id).set({
      email: normalizedEmail,
      firstName,
      lastName,
      passwordHash,
      salt,
      passwordSetupRequired: false,
      createdAt: nowIso(),
    });
    await db.collection('users').doc(existingUser.id).update({ firstName, lastName });
    const userDoc = await db.collection('users').doc(existingUser.id).get();
    const userData = userDoc.exists ? (userDoc.data() as any) : {};
    return {
      id: existingUser.id,
      email: normalizedEmail,
      firstName,
      lastName,
      emailVerified: Boolean(userData.emailVerified),
    };
  }
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  await db.collection('users').doc(id).set({
    email: normalizedEmail,
    provider: 'email',
    createdAt: nowIso(),
    firstName,
    lastName,
    emailVerified: false,
  });
  await db.collection('web_users').doc(id).set({
    email: normalizedEmail,
    firstName,
    lastName,
    passwordHash,
    salt,
    passwordSetupRequired: false,
    createdAt: nowIso(),
  });
  return { id, email: normalizedEmail, firstName, lastName, emailVerified: false };
};

export const ensureWebPasswordAccountForOAuth = async (
  userId: string,
  email: string,
  firstName?: string,
  lastName?: string
): Promise<{ requiresPasswordSetup: boolean }> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (doc.exists) {
    const data = doc.data() as any;
    return { requiresPasswordSetup: Boolean(data.passwordSetupRequired) };
  }

  const salt = randomBytes(16).toString('hex');
  const randomSecret = randomBytes(32).toString('hex');
  const passwordHash = hashPassword(randomSecret, salt);
  await db.collection('web_users').doc(userId).set({
    email: normalizeEmail(email),
    firstName: firstName ?? '',
    lastName: lastName ?? '',
    passwordHash,
    salt,
    passwordSetupRequired: true,
    createdAt: nowIso(),
  });
  return { requiresPasswordSetup: true };
};

export const verifyWebUserCredentials = async (
  identifier: string,
  password: string
): Promise<{ id: string; email: string; firstName: string; lastName: string; emailVerified?: boolean } | null> => {
  const db = getDb();
  const normalized = normalizeEmail(identifier);
  let snapshot = await db.collection('web_users').where('email', '==', normalized).limit(1).get();
  if (!normalized.includes('@')) {
    const userSnap = await db.collection('users').where('username', '==', normalized).limit(1).get();
    if (!userSnap.empty) {
      snapshot = await db.collection('web_users').where(FieldPath.documentId(), '==', userSnap.docs[0].id).limit(1).get();
    }
  }
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as any;
  const hash = hashPassword(password, data.salt);
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(data.passwordHash, 'hex'))) {
    return null;
  }
  const userDoc = await db.collection('users').doc(doc.id).get();
  const userData = userDoc.exists ? (userDoc.data() as any) : {};
  return { id: doc.id, email: data.email, firstName: data.firstName, lastName: data.lastName, emailVerified: userData.emailVerified };
};

export const getUserById = async (userId: string): Promise<User | null> => {
  const doc = await getDb().collection('users').doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as User;
  return { ...data, id: doc.id };
};

export const recordWebUserLogin = async (userId: string): Promise<{ firstLogin: boolean }> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (!doc.exists) return { firstLogin: false };
  const data = doc.data() as any;
  const firstLogin = !data.firstLoginAt;
  const updates: any = { lastLoginAt: nowIso() };
  if (firstLogin) {
    updates.firstLoginAt = nowIso();
  }
  await db.collection('web_users').doc(userId).update(updates);
  return { firstLogin };
};

export const createEmailVerification = async (
  userId: string,
  ttlHours = 24
): Promise<{ token: string; expiresAt: string }> => {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await db.collection('email_verifications').doc(randomUUID()).set({
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: nowIso(),
    usedAt: null,
  });
  return { token, expiresAt: expiresAt.toISOString() };
};

export const getPendingEmailVerification = async (
  userId: string
): Promise<{ id: string; expiresAt: string } | null> => {
  const db = getDb();
  const snapshot = await db
    .collection('email_verifications')
    .where('userId', '==', userId)
    .where('usedAt', '==', null)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as any;
  return { id: doc.id, expiresAt: data.expiresAt };
};

export const consumeEmailVerificationToken = async (
  token: string
): Promise<{ id: string; userId: string; email: string; expiresAt: string } | null> => {
  const db = getDb();
  const tokenHash = hashToken(token);
  const snapshot = await db
    .collection('email_verifications')
    .where('tokenHash', '==', tokenHash)
    .where('usedAt', '==', null)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as any;
  const userDoc = await db.collection('users').doc(data.userId).get();
  if (!userDoc.exists) return null;
  const userData = userDoc.data() as any;
  return { id: doc.id, userId: data.userId, email: userData.email, expiresAt: data.expiresAt };
};

export const markEmailVerificationUsed = async (verificationId: string): Promise<void> => {
  const db = getDb();
  await db.collection('email_verifications').doc(verificationId).update({ usedAt: nowIso() });
};

export const markUserEmailVerified = async (userId: string): Promise<void> => {
  const db = getDb();
  await db.collection('users').doc(userId).update({ emailVerified: true, emailVerifiedAt: nowIso() });
};

export const listUserEmails = async (userId: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>> => {
  const db = getDb();
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return [];
  const email = String((userDoc.data() as any).email ?? '').trim().toLowerCase();
  if (!email) return [];
  return [{ email, isPrimary: true, isVerified: Boolean((userDoc.data() as any).emailVerified ?? true) }];
};

export const addUserEmail = async (_userId: string, _email: string): Promise<{ email: string; isPrimary: boolean; isVerified: boolean }> => {
  const err: any = new Error('Multi-email account management is not implemented for Firebase provider');
  err.code = 'NOT_IMPLEMENTED';
  throw err;
};

export const createUserEmailVerification = async (
  userId: string,
  email: string,
  ttlHours = 24
): Promise<{ token: string; expiresAt: string }> => {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await db.collection('user_email_verifications').doc(randomUUID()).set({
    userId,
    email: normalizeEmail(email),
    tokenHash,
    expiresAt,
    createdAt: nowIso(),
    usedAt: null,
  });
  return { token, expiresAt };
};

export const consumeUserEmailVerificationToken = async (
  token: string
): Promise<{ id: string; userId: string; email: string; expiresAt: string } | null> => {
  const db = getDb();
  const tokenHash = hashToken(token);
  const snapshot = await db
    .collection('user_email_verifications')
    .where('tokenHash', '==', tokenHash)
    .where('usedAt', '==', null)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as any;
  return {
    id: doc.id,
    userId: String(data.userId ?? ''),
    email: String(data.email ?? ''),
    expiresAt: String(data.expiresAt ?? ''),
  };
};

export const markUserEmailVerificationUsed = async (verificationId: string): Promise<void> => {
  await getDb().collection('user_email_verifications').doc(verificationId).update({ usedAt: nowIso() });
};

export const markAccountEmailVerified = async (userId: string, _email: string): Promise<void> => {
  await markUserEmailVerified(userId);
};

export const setPrimaryUserEmail = async (_userId: string, _email: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>> => {
  const err: any = new Error('Multi-email account management is not implemented for Firebase provider');
  err.code = 'NOT_IMPLEMENTED';
  throw err;
};

export const removeUserEmail = async (_userId: string, _email: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>> => {
  const err: any = new Error('Multi-email account management is not implemented for Firebase provider');
  err.code = 'NOT_IMPLEMENTED';
  throw err;
};

export const deleteUserRecord = async (userId: string): Promise<void> => {
  const db = getDb();
  await db.collection('web_users').doc(userId).delete();
  await db.collection('users').doc(userId).delete();
};

export const getWebUserProfile = async (userId: string): Promise<WebUser | null> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (doc.exists) {
    const data = doc.data() as any;
    return {
      id: userId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      homeAddress: data.homeAddress ?? null,
      preferredAirport: data.preferredAirport ?? null,
      mapPreference: data.mapPreference ?? null,
      appearancePreference: data.appearancePreference ?? null,
    };
  }

  const userDoc = await db.collection('users').doc(userId).get();
  if (userDoc.exists) {
    const data = userDoc.data() as any;
    return {
      id: userId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      homeAddress: data.homeAddress ?? null,
      preferredAirport: data.preferredAirport ?? null,
      mapPreference: data.mapPreference ?? null,
      appearancePreference: data.appearancePreference ?? null,
    };
  }

  return null;
};

export const updateWebUserProfile = async (
  userId: string,
  payload: Partial<WebUser & { age?: number; gender?: string }>
): Promise<WebUser> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (!doc.exists) throw new Error('User not found');
  const updates = stripUndefined({
    ...payload,
    homeAddress: typeof (payload as any).homeAddress === 'string' && !(payload as any).homeAddress.trim() ? null : (payload as any).homeAddress,
    preferredAirport:
      typeof (payload as any).preferredAirport === 'string' && !(payload as any).preferredAirport.trim()
        ? null
        : (payload as any).preferredAirport,
    mapPreference:
      (payload as any).mapPreference === 'google' || (payload as any).mapPreference === 'apple' || (payload as any).mapPreference === 'waze'
        ? (payload as any).mapPreference
        : typeof (payload as any).mapPreference === 'undefined'
          ? undefined
          : null,
    appearancePreference:
      (payload as any).appearancePreference === 'light' ||
      (payload as any).appearancePreference === 'dark' ||
      (payload as any).appearancePreference === 'auto'
        ? (payload as any).appearancePreference
        : typeof (payload as any).appearancePreference === 'undefined'
          ? undefined
          : null,
  });
  await db.collection('web_users').doc(userId).update(updates);
  const updated = await db.collection('web_users').doc(userId).get();
  const data = updated.data() as any;
  return {
    id: userId,
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    homeAddress: data.homeAddress ?? null,
    preferredAirport: data.preferredAirport ?? null,
    mapPreference: data.mapPreference ?? null,
    appearancePreference: data.appearancePreference ?? null,
  };
};

export const updateWebUserPassword = async (userId: string, oldPassword: string, newPassword: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (!doc.exists) throw new Error('User not found');
  const data = doc.data() as any;
  const oldHash = hashPassword(oldPassword, data.salt);
  if (!timingSafeEqual(Buffer.from(oldHash, 'hex'), Buffer.from(data.passwordHash, 'hex'))) {
    throw new Error('Invalid password');
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  await db.collection('web_users').doc(userId).update({ salt, passwordHash, passwordSetupRequired: false });
};

export const setInitialWebUserPassword = async (userId: string, newPassword: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (!doc.exists) throw new Error('User not found');
  const data = doc.data() as any;
  if (!data.passwordSetupRequired) {
    const err: any = new Error('Initial password setup is not required');
    err.code = 'PASSWORD_SETUP_NOT_REQUIRED';
    throw err;
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  await db.collection('web_users').doc(userId).update({ salt, passwordHash, passwordSetupRequired: false });
};

export const isPasswordSetupRequired = async (userId: string): Promise<boolean> => {
  const db = getDb();
  const doc = await db.collection('web_users').doc(userId).get();
  if (!doc.exists) return false;
  const data = doc.data() as any;
  return Boolean(data.passwordSetupRequired);
};

export const deleteWebUserAndCleanup = async (userId: string): Promise<void> => {
  const db = getDb();
  const batch = db.batch();
  batch.delete(db.collection('users').doc(userId));
  batch.delete(db.collection('web_users').doc(userId));
  const memberships = await db.collection('group_members').where('userId', '==', userId).get();
  memberships.forEach((m) => batch.delete(m.ref));
  const invites = await db.collection('group_invites').where('inviteeUserId', '==', userId).get();
  invites.forEach((i) => batch.delete(i.ref));
  await batch.commit();
};

// Helpers
const ensureMembership = async (groupId: string, userId: string): Promise<boolean> => {
  const db = getDb();
  const member = await db
    .collection('group_members')
    .where('groupId', '==', groupId)
    .where('userId', '==', userId)
    .where('removedAt', '==', null)
    .limit(1)
    .get();
  return !member.empty;
};

// Groups
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
  const db = getDb();
  const allowed = await ensureMembership(groupId, userId);
  if (!allowed) throw new Error('Not authorized to view members');
  const groupDoc = await db.collection('groups').doc(groupId).get();
  const groupOwnerId = (groupDoc.data()?.ownerId as string | undefined) ?? '';
  const membersSnap = await db.collection('group_members').where('groupId', '==', groupId).where('removedAt', '==', null).get();
  const invitesSnap = await db.collection('group_invites').where('groupId', '==', groupId).where('status', '==', 'pending').get();
  const memberDocs = membersSnap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
  const userIds = Array.from(
    new Set(memberDocs.map((m) => m.data.userId).filter((id) => typeof id === 'string' && id.trim().length))
  );
  const userProfiles = new Map<string, any>();
  if (userIds.length) {
    const refs = userIds.map((id) => db.collection('web_users').doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((doc) => {
      if (doc.exists) {
        userProfiles.set(doc.id, doc.data() as any);
      }
    });
  }
  const inviteEmails = Array.from(new Set([
    ...memberDocs
      .map((m) => m.data.inviteEmail)
      .filter((email) => typeof email === 'string' && email.trim().length)
      .map((email) => normalizeEmail(email)),
    ...invitesSnap.docs
      .map((d) => (d.data() as any)?.inviteeEmail)
      .filter((email) => typeof email === 'string' && email.trim().length)
      .map((email) => normalizeEmail(email)),
  ]));
  const emailToUserId = new Map<string, string>();
  if (inviteEmails.length) {
    await Promise.all(
      inviteEmails.map(async (email) => {
        const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!userSnap.empty) {
          emailToUserId.set(email, userSnap.docs[0].id);
        }
      })
    );
  }
  const inviteUserIds = Array.from(new Set(Array.from(emailToUserId.values())));
  const allProfileIds = Array.from(new Set([...userIds, ...inviteUserIds]));
  const emailProfiles = new Map<string, any>();
  if (inviteEmails.length) {
    const profileRefs = inviteEmails.map((email) => db.collection('web_users').where('email', '==', email).limit(1));
    const profileSnaps = await Promise.all(profileRefs.map((q) => q.get()));
    profileSnaps.forEach((snap) => {
      snap.docs.forEach((doc) => emailProfiles.set(doc.data().email, doc.data()));
    });
  }
  if (allProfileIds.length) {
    const profileRefs = allProfileIds.map((id) => db.collection('web_users').doc(id));
    const profileSnaps = await db.getAll(...profileRefs);
    profileSnaps.forEach((doc) => {
      if (doc.exists) {
        userProfiles.set(doc.id, doc.data() as any);
      }
    });
  }
  const members = memberDocs.map((doc) => {
    const data = doc.data;
    const inviteEmail = data.inviteEmail ? normalizeEmail(data.inviteEmail) : '';
    const resolvedUserId = data.userId || (inviteEmail ? emailToUserId.get(inviteEmail) : null);
    const profile = resolvedUserId ? userProfiles.get(resolvedUserId) : null;
    const normalizedInvite = data.inviteEmail ? normalizeEmail(data.inviteEmail) : '';
    const inviteProfile = normalizedInvite ? emailProfiles.get(normalizedInvite) : null;
    const email = data.inviteEmail ?? profile?.email ?? inviteProfile?.email ?? data.email;
    const result = {
      id: doc.id,
      userId: resolvedUserId,
      guestName: data.guestName ?? null,
      email,
      firstName: data.firstName ?? profile?.firstName ?? inviteProfile?.firstName ?? null,
      lastName: data.lastName ?? profile?.lastName ?? inviteProfile?.lastName ?? null,
      preferredAirport: profile?.preferredAirport ?? inviteProfile?.preferredAirport ?? null,
      isGroupOwner: Boolean(resolvedUserId && groupOwnerId && resolvedUserId === groupOwnerId),
      status: resolvedUserId ? 'active' : data.inviteEmail ? 'pending' : 'active',
      removedAt: data.removedAt ?? null,
    };
    return result;
  });
  const memberEmails = new Set(
    members
      .map((m) => (m.email ?? '').trim().toLowerCase())
      .filter((email) => email.length)
  );
  const invites = invitesSnap.docs
    .map((d) => {
      const data = d.data() as any;
      const email = normalizeEmail(data.inviteeEmail ?? '');
      const resolvedUserId = emailToUserId.get(email);
      const profile = resolvedUserId
        ? userProfiles.get(resolvedUserId)
        : (email ? emailProfiles.get(email) : null);
      return {
        id: d.id,
        guestName: data.inviteeEmail,
        email: data.inviteeEmail,
        userId: resolvedUserId ?? null,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        preferredAirport: profile?.preferredAirport ?? null,
        isGroupOwner: Boolean(resolvedUserId && groupOwnerId && resolvedUserId === groupOwnerId),
        status: data.status,
      };
    })
    .filter((invite) => {
      const email = (invite.email ?? '').trim().toLowerCase();
      return !email || !memberEmails.has(email);
    });
  return [...members, ...invites];
};

export const listGroupsForUser = async (userId: string): Promise<Group[]> => {
  const db = getDb();
  const memberships = await db
    .collection('group_members')
    .where('userId', '==', userId)
    .where('removedAt', '==', null)
    .get();
  const groupIds = memberships.docs.map((d) => d.data().groupId as string);
  if (!groupIds.length) return [];
  const groupsSnap = await db.collection('groups').where(FieldPath.documentId(), 'in', groupIds).get();
  return groupsSnap.docs.map((g) => {
    const data = g.data() as any;
    return { id: g.id, ownerId: data.ownerId, name: data.name, createdAt: data.createdAt };
  });
};

export const addGroupMember = async (
  ownerId: string,
  groupId: string,
  member: { email?: string; guestName?: string; firstName?: string; lastName?: string }
): Promise<{ inviteId?: string; email?: string }> => {
  const db = getDb();
  const groupDoc = await db.collection('groups').doc(groupId).get();
  if (!groupDoc.exists || groupDoc.data()?.ownerId !== ownerId) throw new Error('Group not found or not owner');

  if (member.email && member.email.trim()) {
    const email = normalizeEmail(member.email);
    const user = await findUserByEmail(email);
    if (user) {
      const existingMember = await db
        .collection('group_members')
        .where('groupId', '==', groupId)
        .where('userId', '==', user.id)
        .where('removedAt', '==', null)
        .limit(1)
        .get();
      if (!existingMember.empty) {
        return {};
      }
    }

    const pendingMember = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('inviteEmail', '==', email)
      .limit(1)
      .get();
    if (pendingMember.empty) {
      await db.collection('group_members').doc(randomUUID()).set({
        groupId,
        inviteEmail: email,
        guestName: member.guestName ?? null,
        firstName: member.firstName?.trim() || null,
        lastName: member.lastName?.trim() || null,
        addedBy: ownerId,
        createdAt: nowIso(),
        removedAt: null,
      });
    } else {
      await pendingMember.docs[0].ref.update({
        removedAt: null,
        guestName: member.guestName ?? null,
        firstName: member.firstName?.trim() || null,
        lastName: member.lastName?.trim() || null,
      });
    }

    const existingInvite = await db
      .collection('group_invites')
      .where('groupId', '==', groupId)
      .where('inviteeEmail', '==', email)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!existingInvite.empty) {
      return { inviteId: existingInvite.docs[0].id, email };
    }

    const inviteId = randomUUID();
    await db.collection('group_invites').doc(inviteId).set({
      groupId,
      inviterId: ownerId,
      inviteeUserId: user?.id ?? null,
      inviteeEmail: email,
      status: 'pending',
      createdAt: nowIso(),
    });
    return { inviteId, email };
  }

  if (member.guestName && member.guestName.trim()) {
    await db.collection('group_members').doc(randomUUID()).set({
      groupId,
      guestName: member.guestName.trim(),
      firstName: member.firstName?.trim() || null,
      lastName: member.lastName?.trim() || null,
      addedBy: ownerId,
      createdAt: nowIso(),
      removedAt: null,
    });
    return {};
  }

  throw new Error('Provide an email or guest name');
};

export const removeGroupMember = async (requesterId: string, groupId: string, memberId: string): Promise<void> => {
  const db = getDb();
  const group = await db.collection('groups').doc(groupId).get();
  if (!group.exists) throw new Error('Group not found');
  const authorized = await ensureMembership(groupId, requesterId);
  if (!authorized) throw new Error('Not authorized to remove members');
  const memberDoc = await db.collection('group_members').doc(memberId).get();
  if (!memberDoc.exists) throw new Error('Member not found');
  await db.collection('group_members').doc(memberId).set({ removedAt: nowIso() }, { merge: true });
  const requesterSnap = await db
    .collection('group_members')
    .where('groupId', '==', groupId)
    .where('userId', '==', requesterId)
    .where('removedAt', '==', null)
    .limit(1)
    .get();
  const requesterMemberId = requesterSnap.empty ? null : requesterSnap.docs[0].id;
  const tripsSnap = await db.collection('trips').where('groupId', '==', groupId).get();
  const tripIds = tripsSnap.docs.map((d) => d.id);
  if (!tripIds.length) return;
  const fallbackPayerId = requesterMemberId;
  for (const tripId of tripIds) {
    const flightsSnap = await db.collection('flights').where('tripId', '==', tripId).get();
    for (const doc of flightsSnap.docs) {
      const data = doc.data() as any;
      const passengerIds = Array.isArray(data.passengerIds) ? data.passengerIds.filter((id: string) => id !== memberId) : [];
      if (!passengerIds.length) {
        await doc.ref.delete();
        continue;
      }
      let paidBy = Array.isArray(data.paidBy) ? data.paidBy.filter((id: string) => id !== memberId) : [];
      if (!paidBy.length && fallbackPayerId) {
        paidBy = [fallbackPayerId];
      }
      await doc.ref.update({ passengerIds, paidBy });
    }

    const lodgingsSnap = await db.collection('lodgings').where('trip_id', '==', tripId).get();
    for (const doc of lodgingsSnap.docs) {
      const data = doc.data() as any;
      let paidBy = Array.isArray(data.paid_by) ? data.paid_by.filter((id: string) => id !== memberId) : [];
      if (!paidBy.length && fallbackPayerId) {
        paidBy = [fallbackPayerId];
      }
      const travelerIds = Array.isArray(data.traveler_ids)
        ? data.traveler_ids.filter((id: string) => id !== memberId)
        : Array.isArray(data.travelerIds)
          ? data.travelerIds.filter((id: string) => id !== memberId)
          : [];
      if (!travelerIds.length) {
        await doc.ref.delete();
        continue;
      }
      await doc.ref.update({ paid_by: paidBy, traveler_ids: travelerIds });
    }

    const toursSnap = await db.collection('tours').where('tripId', '==', tripId).get();
    for (const doc of toursSnap.docs) {
      const data = doc.data() as any;
      let paidBy = Array.isArray(data.paidBy) ? data.paidBy.filter((id: string) => id !== memberId) : [];
      if (!paidBy.length && fallbackPayerId) {
        paidBy = [fallbackPayerId];
      }
      await doc.ref.update({ paidBy });
    }
  }
};

export const removeGroupInvite = async (ownerId: string, inviteId: string): Promise<void> => {
  const db = getDb();
  const invite = await db.collection('group_invites').doc(inviteId).get();
  if (!invite.exists) return;
  const data = invite.data() as any;
  const group = await db.collection('groups').doc(data.groupId).get();
  if (!group.exists || group.data()?.ownerId !== ownerId) throw new Error('Not authorized');
  await db.collection('group_invites').doc(inviteId).delete();
};

export const deleteGroup = async (ownerId: string, groupId: string): Promise<void> => {
  const db = getDb();
  const group = await db.collection('groups').doc(groupId).get();
  if (!group.exists || group.data()?.ownerId !== ownerId) throw new Error('Group not found or not owner');
  const batch = db.batch();
  batch.delete(group.ref);
  const members = await db.collection('group_members').where('groupId', '==', groupId).get();
  members.forEach((m) => batch.delete(m.ref));
  const invites = await db.collection('group_invites').where('groupId', '==', groupId).get();
  invites.forEach((i) => batch.delete(i.ref));
  const trips = await db.collection('trips').where('groupId', '==', groupId).get();
  trips.forEach((t) => batch.delete(t.ref));
  await batch.commit();
};

export const listTrips = async (userId: string): Promise<Array<Trip & { groupName: string }>> => {
  const db = getDb();
  const removalsSnap = await db.collection('trip_removals').where('userId', '==', userId).get();
  const removedTripIds = new Set(
    removalsSnap.docs.map((doc) => (doc.data() as any)?.tripId).filter((id) => typeof id === 'string' && id.length)
  );
  const memberships = await db
    .collection('group_members')
    .where('userId', '==', userId)
    .where('removedAt', '==', null)
    .get();
  const groupIds = memberships.docs.map((d) => d.data().groupId as string);
  if (!groupIds.length) return [];
  const trips = await db.collection('trips').where('groupId', 'in', groupIds).get();
  const groups = await db.collection('groups').where(FieldPath.documentId(), 'in', groupIds).get();
  const groupNames = Object.fromEntries(groups.docs.map((g) => [g.id, g.data().name]));
  return trips.docs
    .filter((t) => !removedTripIds.has(t.id))
    .map((t) => {
      const data = t.data() as any;
      return {
        id: t.id,
        groupId: data.groupId,
        name: data.name,
        description: data.description ?? null,
        destination: data.destination ?? null,
        locationIds: Array.isArray(data.locationIds) ? data.locationIds : [],
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        startMonth: data.startMonth ?? null,
        startYear: data.startYear ?? null,
        durationDays: data.durationDays ?? null,
        currency: data.currency ?? 'USD',
        coveredBy: data.coveredBy ?? {},
        createdAt: data.createdAt,
        groupName: groupNames[data.groupId] ?? '',
      } as any;
    });
};

export const createTrip = async (
  userId: string,
  groupId: string,
  name: string,
  details: Partial<Trip>
): Promise<Trip> => {
  const db = getDb();
  const allowed = await ensureMembership(groupId, userId);
  if (!allowed) {
    await db.collection('group_members').doc(randomUUID()).set({
      groupId,
      userId,
      addedBy: userId,
      createdAt: nowIso(),
      removedAt: null,
    });
  }
  const id = randomUUID();
  const payload = {
    groupId,
    name,
    description: details.description ?? null,
    destination: details.destination ?? null,
    locationIds: Array.isArray(details.locationIds) ? details.locationIds : [],
    startDate: details.startDate ?? null,
    endDate: details.endDate ?? null,
    startMonth: details.startMonth ?? null,
    startYear: details.startYear ?? null,
    durationDays: details.durationDays ?? null,
    currency: details.currency ?? 'USD',
    coveredBy: details.coveredBy ?? {},
    createdAt: nowIso(),
  };
  await db.collection('trips').doc(id).set(payload);
  return { id, ...payload } as any;
};

export const updateTripDetails = async (
  userId: string,
  tripId: string,
  updates: Partial<Trip>
): Promise<Trip | null> => {
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) return null;
  const data = tripDoc.data() as any;
  const allowed = await ensureMembership(data.groupId, userId);
  if (!allowed) throw new Error('Not authorized to update trip');
  await db
    .collection('trips')
    .doc(tripId)
    .update({
      description: updates.description ?? data.description ?? null,
      destination: updates.destination ?? data.destination ?? null,
      locationIds: Array.isArray(updates.locationIds) ? updates.locationIds : (Array.isArray(data.locationIds) ? data.locationIds : []),
      startDate: updates.startDate ?? data.startDate ?? null,
      endDate: updates.endDate ?? data.endDate ?? null,
      startMonth: updates.startMonth ?? data.startMonth ?? null,
      startYear: updates.startYear ?? data.startYear ?? null,
      durationDays: updates.durationDays ?? data.durationDays ?? null,
      currency: updates.currency ?? data.currency ?? 'USD',
      name: updates.name ?? data.name,
    });
  const updated = await db.collection('trips').doc(tripId).get();
  return { id: tripId, ...(updated.data() as any) };
};

export const getTripCovering = async (userId: string, tripId: string): Promise<Record<string, string>> => {
  const db = getDb();
  const membership = await ensureUserCanReadTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to view this trip');
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) throw new Error('Trip not found');
  const data = tripDoc.data() as any;
  return data?.coveredBy ?? {};
};

export const updateTripCovering = async (
  userId: string,
  tripId: string,
  coveredBy: Record<string, string>
): Promise<Record<string, string>> => {
  const db = getDb();
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to update this trip');
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) throw new Error('Trip not found');
  await db.collection('trips').doc(tripId).update({ coveredBy: coveredBy ?? {} });
  return coveredBy ?? {};
};

export const deleteTrip = async (userId: string, tripId: string): Promise<void> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) return;
  const data = trip.data() as any;
  const allowed = await ensureMembership(data.groupId, userId);
  if (!allowed) throw new Error('Not authorized');
  const memberSnap = await db
    .collection('group_members')
    .where('groupId', '==', data.groupId)
    .where('userId', '==', userId)
    .where('removedAt', '==', null)
    .limit(1)
    .get();
  const memberDoc = memberSnap.empty ? null : memberSnap.docs[0];
  if (!memberDoc) throw new Error('Not authorized');

  const membersSnap = await db.collection('group_members').where('groupId', '==', data.groupId).where('removedAt', '==', null).get();
  const removalsSnap = await db.collection('trip_removals').where('tripId', '==', tripId).get();
  const removedUserIds = new Set(
    removalsSnap.docs.map((doc) => (doc.data() as any)?.userId).filter((id) => typeof id === 'string' && id.length)
  );
  const alreadyRemoved = removedUserIds.has(userId);
  removedUserIds.add(userId);
  const activeUserCount = membersSnap.docs
    .map((doc) => (doc.data() as any)?.userId)
    .filter((id) => typeof id === 'string' && id.length && !removedUserIds.has(id)).length;

  if (activeUserCount === 0) {
    const expenses = await db.collection('expenses').where('tripId', '==', tripId).get();
    const batch = db.batch();
    expenses.forEach((doc) => batch.delete(doc.ref));
    batch.delete(trip.ref);
    await batch.commit();
    return;
  }

  if (!alreadyRemoved) {
    await db.collection('trip_removals').doc(randomUUID()).set({
      tripId,
      userId,
      memberId: memberDoc.id,
      createdAt: nowIso(),
    });
  }

  await removeMemberFromTripData(tripId, memberDoc.id);
};

export const updateTripGroup = async (
  userId: string,
  tripId: string,
  newGroupId: string
): Promise<Trip & { groupName: string }> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) throw new Error('Trip not found');
  const data = trip.data() as any;
  const allowed = await ensureMembership(data.groupId, userId);
  if (!allowed) throw new Error('Not authorized to move trip');
  const newMembership = await ensureMembership(newGroupId, userId);
  if (!newMembership) throw new Error('Not authorized for destination group');
  await db.collection('trips').doc(tripId).update({ groupId: newGroupId });
  const newGroup = await db.collection('groups').doc(newGroupId).get();
  return { ...(data as any), id: tripId, groupId: newGroupId, groupName: (newGroup.data() as any)?.name ?? '' };
};

export const createGroupWithMembers = async (
  ownerId: string,
  groupName: string,
  memberEmails: string[]
): Promise<{ groupId: string; invites: { id: string; email: string }[] }> => {
  const db = getDb();
  const groupId = randomUUID();
  await db.collection('groups').doc(groupId).set({ ownerId, name: groupName, createdAt: nowIso() });
  await db
    .collection('group_members')
    .doc(randomUUID())
    .set({ groupId, userId: ownerId, addedBy: ownerId, createdAt: nowIso(), removedAt: null });
  const invites: { id: string; email: string }[] = [];
  for (const email of memberEmails) {
    const normalized = normalizeEmail(email);
    if (!normalized) continue;
    const user = await findUserByEmail(normalized);
    const inviteId = randomUUID();
    invites.push({ id: inviteId, email: normalized });
    await db.collection('group_invites').doc(inviteId).set({
      groupId,
      inviterId: ownerId,
      inviteeUserId: user?.id ?? null,
      inviteeEmail: normalized,
      status: 'pending',
      createdAt: nowIso(),
    });
    await db.collection('group_members').doc(randomUUID()).set({
      groupId,
      inviteEmail: normalized,
      addedBy: ownerId,
      createdAt: nowIso(),
      removedAt: null,
    });
  }
  return { groupId, invites };
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
  const group = await createGroupWithMembers(
    payload.ownerId,
    `Trip: ${payload.tripName} Group`,
    payload.members.map((m) => m.email || '').filter(Boolean)
  );
  const trip = await createTrip(payload.ownerId, group.groupId, payload.tripName, {
    description: payload.description ?? null,
    destination: payload.destination ?? null,
    locationIds: Array.isArray(payload.locationIds) ? payload.locationIds : [],
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    startMonth: payload.startMonth ?? null,
    startYear: payload.startYear ?? null,
    durationDays: payload.durationDays ?? null,
    currency: payload.currency ?? 'USD',
  });
  if (group.invites.length) {
    await Promise.all(
      group.invites.map((invite) =>
        getDb().collection('group_invites').doc(invite.id).update({ tripId: trip.id }).catch(() => undefined)
      )
    );
  }
  for (const m of payload.members) {
    if (!m.email && m.guestName) {
      await addGroupMember(payload.ownerId, group.groupId, { guestName: m.guestName });
    }
  }
  return { trip, groupId: group.groupId, invites: group.invites };
};

export const listGroupInvitesForUser = async (userId: string, email: string) => {
  const db = getDb();
  const normalized = normalizeEmail(email);
  // Keep these as single-field queries and filter status in memory to avoid
  // requiring composite indexes in production Firestore.
  const [byEmailSnap, byUserSnap] = await Promise.all([
    db.collection('group_invites').where('inviteeEmail', '==', normalized).get(),
    db.collection('group_invites').where('inviteeUserId', '==', userId).get(),
  ]);
  const inviteDocsMap = new Map<string, any>();
  byEmailSnap.docs.forEach((d) => {
    const data = d.data() as any;
    if (data.status === 'pending') inviteDocsMap.set(d.id, { id: d.id, ...data });
  });
  byUserSnap.docs.forEach((d) => {
    const data = d.data() as any;
    if (data.status === 'pending') inviteDocsMap.set(d.id, { id: d.id, ...data });
  });
  const inviteDocs = Array.from(inviteDocsMap.values());
  if (!inviteDocs.length) return [];
  const groupIds = Array.from(new Set(inviteDocs.map((d) => d.groupId).filter(Boolean)));
  const inviterIds = Array.from(new Set(inviteDocs.map((d) => d.inviterId).filter(Boolean)));
  const groupMap = new Map<string, any>();
  if (groupIds.length) {
    const groupRefs = groupIds.map((id) => db.collection('groups').doc(id));
    const groupDocs = await db.getAll(...groupRefs);
    groupDocs.forEach((doc) => {
      if (doc.exists) groupMap.set(doc.id, doc.data());
    });
  }
  const inviterMap = new Map<string, any>();
  if (inviterIds.length) {
    const inviterRefs = inviterIds.map((id) => db.collection('web_users').doc(id));
    const inviterDocs = await db.getAll(...inviterRefs);
    inviterDocs.forEach((doc) => {
      if (doc.exists) inviterMap.set(doc.id, doc.data());
    });
  }
  const fallbackTripMap = new Map<string, { id: string; name: string } | null>();
  await Promise.all(
    groupIds.map(async (groupId) => {
      // Avoid requiring a composite Firestore index on (groupId, createdAt).
      const snap = await db.collection('trips').where('groupId', '==', groupId).get();
      if (snap.empty) {
        fallbackTripMap.set(groupId, null);
        return;
      }
      const latestTrip = snap.docs
        .map((doc) => {
          const data = doc.data() as any;
          const createdAt = data?.createdAt;
          const createdAtMs =
            createdAt && typeof createdAt.toMillis === 'function'
              ? createdAt.toMillis()
              : new Date(createdAt ?? 0).getTime();
          return { id: doc.id, name: data?.name ?? '', createdAtMs };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
      fallbackTripMap.set(groupId, latestTrip ? { id: latestTrip.id, name: latestTrip.name } : null);
    })
  );
  return inviteDocs.map((invite) => {
    const group = groupMap.get(invite.groupId) ?? {};
    const inviter = inviterMap.get(invite.inviterId) ?? {};
    const fallbackTrip = fallbackTripMap.get(invite.groupId);
    return {
      ...invite,
      groupName: group.name ?? null,
      inviterEmail: inviter.email ?? null,
      inviterFirstName: inviter.firstName ?? null,
      inviterLastName: inviter.lastName ?? null,
      resolvedTripId: invite.tripId ?? fallbackTrip?.id ?? null,
      resolvedTripName: invite.tripName ?? fallbackTrip?.name ?? null,
    };
  });
};

export const attachInviteToTrip = async (inviteId: string, tripId: string): Promise<void> => {
  const db = getDb();
  await db.collection('group_invites').doc(inviteId).update({ tripId });
};

const removeMemberFromTripData = async (tripId: string, memberId: string) => {
  const db = getDb();
  const batch = db.batch();

  const flightsSnap = await db.collection('flights').where('tripId', '==', tripId).get();
  flightsSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    const passengerIds: string[] = Array.isArray(data.passengerIds) ? data.passengerIds : [];
    const paidBy: string[] = Array.isArray(data.paidBy) ? data.paidBy : [];
    const nextPassengers = passengerIds.filter((id) => id !== memberId);
    const nextPaidBy = paidBy.filter((id) => id !== memberId);
    if (!nextPassengers.length) {
      batch.delete(doc.ref);
      return;
    }
    batch.update(doc.ref, { passengerIds: nextPassengers, paidBy: nextPaidBy });
  });

  const lodgingsSnap = await db.collection('lodgings').where('trip_id', '==', tripId).get();
  lodgingsSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    const travelerIds: string[] = Array.isArray(data.traveler_ids) ? data.traveler_ids : [];
    const paidBy: string[] = Array.isArray(data.paid_by) ? data.paid_by : [];
    const nextTravelers = travelerIds.filter((id) => id !== memberId);
    const nextPaidBy = paidBy.filter((id) => id !== memberId);
    if (!nextTravelers.length) {
      batch.delete(doc.ref);
      return;
    }
    batch.update(doc.ref, { traveler_ids: nextTravelers, paid_by: nextPaidBy });
  });

  const toursSnap = await db.collection('tours').where('tripId', '==', tripId).get();
  toursSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    const paidBy: string[] = Array.isArray(data.paidBy) ? data.paidBy : [];
    const nextPaidBy = paidBy.filter((id) => id !== memberId);
    if (!nextPaidBy.length) {
      batch.delete(doc.ref);
      return;
    }
    batch.update(doc.ref, { paidBy: nextPaidBy });
  });

  const expensesSnap = await db.collection('expenses').where('tripId', '==', tripId).get();
  expensesSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    const payerIds: string[] = Array.isArray(data.payerIds) ? data.payerIds : [];
    const forIds: string[] = Array.isArray(data.forIds) ? data.forIds : [];
    const nextPayers = payerIds.filter((id) => id !== memberId);
    const nextFor = forIds.filter((id) => id !== memberId);
    if (!nextPayers.length || !nextFor.length) {
      batch.delete(doc.ref);
      return;
    }
    batch.update(doc.ref, { payerIds: nextPayers, forIds: nextFor });
  });

  await batch.commit();
};

export const acceptGroupInvite = async (inviteId: string, userId: string, email?: string): Promise<void> => {
  const db = getDb();
  const invite = await db.collection('group_invites').doc(inviteId).get();
  if (!invite.exists) throw new Error('Invite not found');
  const data = invite.data() as any;
  const inviteEmailMatches = Boolean(data.inviteeEmail && email && normalizeEmail(data.inviteeEmail) === normalizeEmail(email));
  const inviteUserMatches = Boolean(data.inviteeUserId && data.inviteeUserId === userId);
  if (!inviteEmailMatches && !inviteUserMatches) {
    throw new Error('Invite not found');
  }
  const memberSnap = await db
    .collection('group_members')
    .where('groupId', '==', data.groupId)
    .where('inviteEmail', '==', data.inviteeEmail)
    .limit(1)
    .get();
  if (!memberSnap.empty) {
    const docRef = memberSnap.docs[0].ref;
    await docRef.update({
      userId,
      inviteEmail: null,
      claimedAt: nowIso(),
      removedAt: null,
    });
  } else {
    await db.collection('group_members').doc(randomUUID()).set({
      groupId: data.groupId,
      userId,
      addedBy: data.inviterId,
      claimedAt: nowIso(),
      createdAt: nowIso(),
    });
  }
  await db.collection('group_invites').doc(inviteId).update({ status: 'accepted', inviteeUserId: userId });
};

export const rejectGroupInvite = async (inviteId: string, userId: string, email?: string): Promise<void> => {
  const db = getDb();
  const inviteDoc = await db.collection('group_invites').doc(inviteId).get();
  if (!inviteDoc.exists) throw new Error('Invite not found');
  const invite = inviteDoc.data() as any;
  const inviteEmailMatches = Boolean(invite.inviteeEmail && email && normalizeEmail(invite.inviteeEmail) === normalizeEmail(email));
  const inviteUserMatches = Boolean(invite.inviteeUserId && invite.inviteeUserId === userId);
  if (!inviteEmailMatches && !inviteUserMatches) {
    throw new Error('Invite not found');
  }
  const groupId = invite.groupId;
  const inviteEmail = invite.inviteeEmail ? normalizeEmail(invite.inviteeEmail) : '';

  const memberSnap = await db
    .collection('group_members')
    .where('groupId', '==', groupId)
    .where('removedAt', '==', null)
    .get();
  const memberDoc = memberSnap.docs.find((doc) => {
    const data = doc.data() as any;
    if (data.userId && data.userId === userId) return true;
    if (inviteEmail && data.inviteEmail && normalizeEmail(data.inviteEmail) === inviteEmail) return true;
    return false;
  });
  const memberId = memberDoc?.id ?? null;

  let tripId = invite.tripId ?? null;
  if (!tripId) {
    const tripsSnap = await db.collection('trips').where('groupId', '==', groupId).get();
    if (!tripsSnap.empty) {
      const latestTrip = tripsSnap.docs
        .map((doc) => {
          const data = doc.data() as any;
          const createdAt = data?.createdAt;
          const createdAtMs =
            createdAt && typeof createdAt.toMillis === 'function'
              ? createdAt.toMillis()
              : new Date(createdAt ?? 0).getTime();
          return { id: doc.id, createdAtMs };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
      tripId = latestTrip?.id ?? null;
    }
  }

  if (memberId && tripId) {
    await removeMemberFromTripData(tripId, memberId);
    await db.collection('group_members').doc(memberId).update({ removedAt: nowIso() });
  } else if (memberId) {
    await db.collection('group_members').doc(memberId).update({ removedAt: nowIso() });
  }

  await db.collection('group_invites').doc(inviteId).delete();
};

export const claimInvitesForUser = async (email: string, userId: string): Promise<void> => {
  const normalized = normalizeEmail(email);
  const db = getDb();
  const invites = await db.collection('group_invites').where('inviteeEmail', '==', normalized).where('status', '==', 'pending').get();
  for (const invite of invites.docs) {
    const data = invite.data() as any;
    if (!data.inviteeUserId) {
      await invite.ref.update({ inviteeUserId: userId });
    }
  }
};

// Trip membership helper
export const ensureUserInTrip = async (tripId: string, userId: string): Promise<{ groupId: string } | null> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) return null;
  const data = trip.data() as any;
  const member = await ensureMembership(data.groupId, userId);
  if (!member) return null;
  const removals = await db.collection('trip_removals').where('userId', '==', userId).get();
  const removed = removals.docs.some((doc) => (doc.data() as any)?.tripId === tripId);
  if (removed) return null;
  return { groupId: data.groupId };
};

export const ensureUserCanReadTrip = async (
  tripId: string,
  userId: string
): Promise<{ groupId: string; access: 'member' | 'follower' } | null> => {
  const membership = await ensureUserInTrip(tripId, userId);
  if (membership) return { groupId: membership.groupId, access: 'member' };
  const db = getDb();
  const follower = await db
    .collection('trip_followers')
    .where('tripId', '==', tripId)
    .where('followerUserId', '==', userId)
    .limit(1)
    .get();
  if (follower.empty) return null;
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) return null;
  const data = trip.data() as any;
  return { groupId: data.groupId, access: 'follower' };
};

export const getTripFollowCode = async (
  userId: string,
  tripId: string
): Promise<{ id: string; tripId: string; code: string; status: string; createdAt: string }> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) throw new Error('Trip not found');
  const tripData = trip.data() as any;
  const group = await db.collection('groups').doc(tripData.groupId).get();
  if (!group.exists || (group.data() as any).ownerId !== userId) {
    throw new Error('Not authorized to manage follow codes');
  }

  const existing = await db
    .collection('follow_codes')
    .where('tripId', '==', tripId)
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    const data = doc.data() as any;
    return {
      id: doc.id,
      tripId: data.tripId,
      code: data.code,
      status: data.status,
      createdAt: data.createdAt,
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateFollowCode();
    const codeDoc = await db.collection('follow_codes').doc(code).get();
    if (codeDoc.exists) continue;
    const payload = {
      tripId,
      code,
      status: 'active',
      expiresAt: null,
      maxUses: null,
      usesCount: 0,
      createdBy: userId,
      createdAt: nowIso(),
      revokedAt: null,
    };
    await db.collection('follow_codes').doc(code).set(payload);
    return { id: code, tripId, code, status: 'active', createdAt: payload.createdAt };
  }

  throw new Error('Unable to create follow code. Try again.');
};

export const followTripByCode = async (
  userId: string,
  inviteCode: string
): Promise<{ trip: { id: string; name: string; destination?: string | null }; inviterName: string | null; alreadyFollowing: boolean }> => {
  const db = getDb();
  const code = String(inviteCode ?? '').trim().toUpperCase();
  if (!code) throw new Error('inviteCode is required');
  const codeDoc = await db.collection('follow_codes').doc(code).get();
  if (!codeDoc.exists) throw new Error('Invalid or expired follow code');
  const codeData = codeDoc.data() as any;
  if (codeData.status !== 'active' || codeData.revokedAt) throw new Error('Invalid or expired follow code');
  if (codeData.expiresAt && new Date(codeData.expiresAt).getTime() <= Date.now()) {
    throw new Error('Invalid or expired follow code');
  }
  const tripId = String(codeData.tripId ?? '').trim();
  if (!tripId) throw new Error('Invalid or expired follow code');

  const existing = await db
    .collection('trip_followers')
    .where('tripId', '==', tripId)
    .where('followerUserId', '==', userId)
    .limit(1)
    .get();
  const alreadyFollowing = !existing.empty;
  if (!alreadyFollowing) {
    await db.collection('trip_followers').doc(randomUUID()).set({
      tripId,
      followerUserId: userId,
      role: 'follower',
      followCode: code,
      createdAt: nowIso(),
      lastViewedAt: null,
    });
    await db.collection('follow_codes').doc(code).set(
      {
        usesCount: Number(codeData.usesCount ?? 0) + 1,
      },
      { merge: true }
    );
    await writeActivity(tripId, userId, 'FOLLOW_ADDED', 'New follower', 'A user started following this trip.', {
      inviteCode: code,
      followerUserId: userId,
    });
  }

  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) throw new Error('Trip not found');
  const tripData = tripDoc.data() as any;
  const groupDoc = await db.collection('groups').doc(tripData.groupId).get();
  const ownerId = groupDoc.exists ? (groupDoc.data() as any).ownerId : null;
  let inviterName: string | null = null;
  if (ownerId) {
    const profile = await db.collection('web_users').doc(ownerId).get();
    const profileData = profile.exists ? (profile.data() as any) : {};
    const full = `${profileData.firstName ?? ''} ${profileData.lastName ?? ''}`.trim();
    if (full) {
      inviterName = full;
    } else {
      const userDoc = await db.collection('users').doc(ownerId).get();
      inviterName = userDoc.exists ? ((userDoc.data() as any).email ?? null) : null;
    }
  }

  return {
    trip: {
      id: tripId,
      name: tripData.name ?? 'Trip',
      destination: tripData.destination ?? null,
    },
    inviterName,
    alreadyFollowing,
  };
};

export const listFollowedTrips = async (
  userId: string
): Promise<Array<{ tripId: string; tripName: string; destination?: string | null; inviterName?: string | null }>> => {
  const db = getDb();
  const followers = await db.collection('trip_followers').where('followerUserId', '==', userId).get();
  const results: Array<{ tripId: string; tripName: string; destination?: string | null; inviterName?: string | null }> = [];
  for (const doc of followers.docs) {
    const data = doc.data() as any;
    const tripId = String(data.tripId ?? '').trim();
    if (!tripId) continue;
    const tripDoc = await db.collection('trips').doc(tripId).get();
    if (!tripDoc.exists) continue;
    const trip = tripDoc.data() as any;
    const groupDoc = await db.collection('groups').doc(trip.groupId).get();
    const ownerId = groupDoc.exists ? (groupDoc.data() as any).ownerId : null;
    let inviterName: string | null = null;
    if (ownerId) {
      const profileDoc = await db.collection('web_users').doc(ownerId).get();
      if (profileDoc.exists) {
        const profile = profileDoc.data() as any;
        const full = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
        inviterName = full || null;
      }
    }
    results.push({
      tripId,
      tripName: trip.name ?? 'Trip',
      destination: trip.destination ?? null,
      inviterName,
    });
  }
  return results;
};

export const unfollowTrip = async (userId: string, tripId: string): Promise<void> => {
  const db = getDb();
  const followers = await db
    .collection('trip_followers')
    .where('tripId', '==', tripId)
    .where('followerUserId', '==', userId)
    .get();
  for (const doc of followers.docs) {
    await doc.ref.delete();
  }
  if (!followers.empty) {
    await writeActivity(tripId, userId, 'FOLLOW_REMOVED', 'Follower left', 'A user unfollowed this trip.', {
      followerUserId: userId,
    });
  }
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
  const db = getDb();
  const id = randomUUID();
  const createdAt = nowIso();
  const payload: TripActivity = {
    id,
    tripId,
    actorUserId: actorUserId ?? null,
    type,
    title: String(title ?? '').trim(),
    summary: String(summary ?? '').trim(),
    metadata: metadata ?? {},
    createdAt,
  };
  await db.collection('trip_activity').doc(id).set(payload);
  return payload;
};

export const listTripActivity = async (
  tripId: string,
  options?: { limit?: number; cursor?: { createdAt: string; id: string } | null }
): Promise<{ events: TripActivity[]; nextCursor: string | null }> => {
  const db = getDb();
  const limit = Math.min(Math.max(Number(options?.limit ?? 20), 1), 100);
  const rows = await db
    .collection('trip_activity')
    .where('tripId', '==', tripId)
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(limit + 1)
    .get();
  let events = rows.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      tripId: data.tripId,
      actorUserId: data.actorUserId ?? null,
      type: data.type,
      title: data.title ?? '',
      summary: data.summary ?? '',
      metadata: data.metadata ?? {},
      createdAt: data.createdAt ?? nowIso(),
    } as TripActivity;
  });

  const cursor = options?.cursor;
  if (cursor?.createdAt && cursor?.id) {
    events = events.filter((event) => {
      if (event.createdAt < cursor.createdAt) return true;
      if (event.createdAt > cursor.createdAt) return false;
      return event.id < cursor.id;
    });
  }

  const hasNext = events.length > limit;
  const page = hasNext ? events.slice(0, limit) : events;
  const last = page[page.length - 1];
  const nextCursor = hasNext && last ? `${last.createdAt}::${last.id}` : null;
  return { events: page, nextCursor };
};

export const listTripComments = async (tripId: string): Promise<TripComment[]> => {
  const db = getDb();
  const rows = await db
    .collection('trip_comments')
    .where('tripId', '==', tripId)
    .orderBy('createdAt', 'asc')
    .orderBy(FieldPath.documentId(), 'asc')
    .get();
  return rows.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      tripId: data.tripId,
      actorUserId: data.actorUserId ?? null,
      body: data.body ?? '',
      createdAt: data.createdAt ?? nowIso(),
      authorName: data.authorName ?? null,
      authorEmail: data.authorEmail ?? null,
    } as TripComment;
  });
};

export const addTripComment = async (
  tripId: string,
  actorUserId: string,
  body: string
): Promise<TripComment> => {
  const db = getDb();
  const text = String(body ?? '').trim();
  if (!text) throw new Error('Comment body is required');
  const userDoc = await db.collection('users').doc(actorUserId).get();
  const webUserDoc = await db.collection('web_users').doc(actorUserId).get();
  const web = webUserDoc.exists ? (webUserDoc.data() as any) : {};
  const fullName = `${web.firstName ?? ''} ${web.lastName ?? ''}`.trim();
  const authorEmail = userDoc.exists ? ((userDoc.data() as any).email ?? null) : null;
  const authorName = fullName || authorEmail || null;
  const id = randomUUID();
  const createdAt = nowIso();
  const payload: TripComment = {
    id,
    tripId,
    actorUserId,
    body: text,
    createdAt,
    authorName,
    authorEmail,
  };
  await db.collection('trip_comments').doc(id).set(payload);
  return payload;
};

export const getTripGroupId = async (tripId: string): Promise<string | null> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) return null;
  const data = trip.data() as any;
  return data?.groupId ?? data?.group_id ?? null;
};

export const getTripById = async (tripId: string): Promise<Trip | null> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) return null;
  return { id: tripId, ...(trip.data() as any) };
};

// Flights
export const insertFlight = async (flight: Omit<Flight, 'id'>): Promise<Flight> => {
  const db = getDb();
  const id = randomUUID();
  const payload = { ...flight, status: normalizeItineraryStatus((flight as any).status), id, createdAt: nowIso() };
  await db.collection('flights').doc(id).set(payload);
  const saved = await db.collection('flights').doc(id).get();
  return { ...flight, status: normalizeItineraryStatus((flight as any).status), id };
};

export const deleteFlight = async (flightId: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('flights').doc(flightId).get();
  if (!doc.exists) return;
  const data = doc.data() as any;
  if (data.userId !== userId) throw new Error('Not authorized to delete');
  await db.collection('flights').doc(flightId).delete();
};

export const updateFlight = async (flightId: string, userId: string, updates: Partial<Flight>): Promise<Flight | null> => {
  const db = getDb();
  const doc = await db.collection('flights').doc(flightId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  if (data.userId !== userId) throw new Error('Not authorized to update');
  const updatePayload = stripUndefined(updates);
  await db.collection('flights').doc(flightId).update(updatePayload);
  const updated = await db.collection('flights').doc(flightId).get();
  return { ...(updated.data() as Flight), status: normalizeItineraryStatus((updated.data() as any)?.status) };
};

export const getFlightForUser = async (flightId: string, userId: string): Promise<Flight | null> => {
  const doc = await getDb().collection('flights').doc(flightId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  if (data.userId !== userId) return null;
  return data as Flight;
};

export const getFlightById = async (flightId: string): Promise<Flight | null> => {
  const doc = await getDb().collection('flights').doc(flightId).get();
  if (!doc.exists) return null;
  return doc.data() as Flight;
};

export const listFlights = async (userId: string, tripId?: string): Promise<Flight[]> => {
  const db = getDb();
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  };
  if (tripId) {
    const access = await ensureUserCanReadTrip(tripId, userId);
    if (!access) return [];
  }
  let allowedTripIds: string[] = [];
  if (tripId) {
    allowedTripIds = [tripId];
  } else {
    const memberSnap = await db.collection('group_members').where('userId', '==', userId).where('removedAt', '==', null).get();
    const memberGroupIds = memberSnap.docs.map((d) => (d.data() as any).groupId).filter(Boolean);
    if (memberGroupIds.length) {
      const tripSnaps = await Promise.all(
        Array.from(new Set(memberGroupIds)).map((groupId) => db.collection('trips').where('groupId', '==', groupId).get())
      );
      tripSnaps.forEach((snap) => snap.docs.forEach((doc) => allowedTripIds.push(doc.id)));
    }
    const followSnap = await db.collection('trip_followers').where('followerUserId', '==', userId).get();
    followSnap.docs.forEach((doc) => {
      const data = doc.data() as any;
      if (data.tripId) allowedTripIds.push(String(data.tripId));
    });
    allowedTripIds = Array.from(new Set(allowedTripIds));
  }
  if (!allowedTripIds.length) return [];
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const ids of chunk(allowedTripIds)) {
    const snap = await db.collection('flights').where('tripId', 'in', ids).get();
    docs.push(...snap.docs);
  }
  let validPassengerIds: Set<string> | null = null;
  if (tripId) {
    const tripDoc = await db.collection('trips').doc(tripId).get();
    const tripData = tripDoc.exists ? (tripDoc.data() as any) : null;
    const groupId = tripData?.groupId ?? tripData?.group_id ?? null;
    if (groupId) {
      const members = await listGroupMembers(groupId, userId).catch(() => []);
      validPassengerIds = new Set(members.map((m) => String(m.id)));
    }
  }
  return docs.map((d) => {
    const data = d.data() as Flight;
    const ids: string[] = Array.isArray((data as any).passengerIds)
      ? (data as any).passengerIds
      : Array.isArray((data as any).passenger_ids)
        ? (data as any).passenger_ids
        : [];
    const passengerInGroup = validPassengerIds ? ids.every((id: string) => validPassengerIds!.has(String(id))) : true;
    return { ...data, status: normalizeItineraryStatus((data as any).status), passengerInGroup };
  });
};

export const shareFlight = async (flightId: string, sharedEmail: string): Promise<void> => {
  const db = getDb();
  const email = normalizeEmail(sharedEmail);
  const user = await findOrCreateUser(email, 'email');
  await db.collection('flight_shares').doc(randomUUID()).set({ flightId, userId: user.id, createdAt: nowIso() });
};

export const searchFlightLocations = async (_userId: string, query: string): Promise<string[]> => {
  const db = getDb();
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const airports = await db
    .collection('airports')
    .where('search', 'array-contains', normalized)
    .limit(10)
    .get()
    .catch(() => null);
  if (!airports || airports.empty) return [];
  return airports.docs.map((d) => d.data().label as string);
};

const toLocationRecord = (id: string, data: any): LocationRecord => ({
  id,
  sourceType: data.sourceType,
  category: data.category ?? null,
  name: data.name,
  address: data.address ?? null,
  visitorCount: data.visitorCount ?? null,
  climate: data.climate ?? null,
  priceLevel: data.priceLevel ?? null,
  bestMonth: data.bestMonth ?? null,
  editorialSummary: data.editorialSummary ?? null,
  popularityTier: data.popularityTier ?? null,
  unesco: data.unesco ?? null,
  rating: data.rating ?? null,
  userRatingCount: data.userRatingCount ?? null,
  websiteUri: data.websiteUri ?? null,
  googleMapsUri: data.googleMapsUri ?? null,
  keywords: Array.isArray(data.keywords) ? data.keywords : [],
  sourceFile: data.sourceFile ?? null,
  sourceRowHash: data.sourceRowHash ?? null,
  updatedAt: data.updatedAt ?? undefined,
});

const toAttractionCatalogEntry = (id: string, data: any): AttractionCatalogEntry => {
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
  const rawTags = Array.isArray(payload.interestTags) ? payload.interestTags : [];
  const interestTags = rawTags.map((tag: unknown) => String(tag).trim()).filter(Boolean) as AttractionCatalogEntry['interestTags'];
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  return {
    id,
    destinationKey: String(payload.destinationKey ?? '').trim(),
    destinationDisplayName: String(payload.destinationDisplayName ?? '').trim(),
    country: typeof payload.country === 'string' ? payload.country : null,
    stateProvince: typeof payload.stateProvince === 'string' ? payload.stateProvince : null,
    name: String(data.name ?? ''),
    rank: Number(payload.rank) || 999,
    activityType: String(payload.activityType ?? 'Tour') as AttractionCatalogEntry['activityType'],
    interestTags,
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
    updatedAt: String(data.updatedAt ?? nowIso()),
  };
};

const toAttractionShortlistBlob = (id: string, data: any): AttractionShortlistBlob | null => {
  const payload = data?.payload && typeof data.payload === 'object' ? data.payload : {};
  const destinationKey = String(payload.destinationKey ?? '').trim();
  const dateKey = String(payload.dateKey ?? '').trim();
  const promptBlock = String(payload.promptBlock ?? '').trim();
  if (!destinationKey || !dateKey || !promptBlock) return null;
  return {
    id,
    destinationKey,
    destinationDisplayName: String(payload.destinationDisplayName ?? '').trim(),
    dateKey,
    promptBlock,
    compact: String(payload.compact ?? ''),
    itemCount: Number(payload.itemCount) || 0,
    updatedAt: String(data.updatedAt ?? nowIso()),
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
  const db = getDb();
  const normalized = String(query ?? '').trim().toLowerCase();
  if (!normalized) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const snapshot = await db.collection('locations').limit(200).get();
  let docs = snapshot.docs;
  if (Array.isArray(sourceTypes) && sourceTypes.length) {
    const allowed = new Set(sourceTypes);
    docs = docs.filter((doc) => allowed.has((doc.data() as any).sourceType as 'country_region' | 'city'));
  }
  const filtered = docs
    .filter((doc) => {
      const data = doc.data() as any;
      const name = String(data.name ?? '').toLowerCase();
      const searchName = String(data.searchName ?? '').toLowerCase();
      const address = String(data.address ?? '').toLowerCase();
      return name.includes(normalized) || searchName.includes(normalized) || address.includes(normalized);
    })
    .sort((a, b) => String((a.data() as any).name ?? '').localeCompare(String((b.data() as any).name ?? '')))
    .slice(0, safeLimit)
    .map((doc) => toLocationRecord(doc.id, doc.data()));
  return filtered;
};

export const getLocationsByIds = async (_userId: string, ids: string[]): Promise<LocationRecord[]> => {
  const db = getDb();
  const normalized = Array.from(new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (!normalized.length) return [];
  const docs = await Promise.all(normalized.map((id) => db.collection('locations').doc(id).get()));
  const byId = new Map<string, LocationRecord>();
  for (const doc of docs) {
    if (!doc.exists) continue;
    byId.set(doc.id, toLocationRecord(doc.id, doc.data() as any));
  }
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
  const db = getDb();
  const id = data.place_id;

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

  const docRef = db.collection('locations').doc(id);
  const now = nowIso();

  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const existing = doc.exists ? (doc.data() as any) : {};
    const mergedPayload = { ...(existing.payload || {}), ...payload };
    const updateData = { id, sourceType, name: data.name, address: data.address ?? null, searchName: data.name.toLowerCase(), payload: mergedPayload, updatedAt: now };
    t.set(docRef, updateData, { merge: true });
  });

  const saved = await docRef.get();
  return toLocationRecord(id, saved.data());
};

export const listAttractionCatalogEntries = async (
  _userId: string,
  destinationKey: string,
  limit = 20
): Promise<AttractionCatalogEntry[]> => {
  const key = String(destinationKey ?? '').trim().toLowerCase();
  if (!key) return [];
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const snapshot = await db.collection('locations').where('sourceType', '==', 'attraction').limit(500).get();
  const filtered = snapshot.docs
    .filter((doc) => {
      const payload = ((doc.data() as any).payload ?? {}) as Record<string, unknown>;
      return String(payload.destinationKey ?? '').trim().toLowerCase() === key;
    })
    .map((doc) => toAttractionCatalogEntry(doc.id, doc.data()))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.name.localeCompare(b.name)))
    .slice(0, safeLimit);
  return filtered;
};

export const upsertAttractionCatalogEntry = async (entry: AttractionCatalogEntry): Promise<AttractionCatalogEntry> => {
  const db = getDb();
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
  const docRef = db.collection('locations').doc(entry.id);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    const existing = doc.exists ? (doc.data() as any) : {};
    const mergedPayload = { ...(existing.payload || {}), ...payload };
    tx.set(
      docRef,
      {
        id: entry.id,
        sourceType: 'attraction',
        category: 'attraction',
        name: entry.name,
        address: null,
        searchName: `${entry.name} ${entry.destinationDisplayName} ${entry.country ?? ''} ${entry.stateProvince ?? ''}`.toLowerCase(),
        payload: mergedPayload,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
  });
  const saved = await docRef.get();
  return toAttractionCatalogEntry(saved.id, saved.data() as any);
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
  const db = getDb();
  const doc = await db.collection('locations').doc(id).get();
  if (!doc.exists) return null;
  return toAttractionShortlistBlob(doc.id, doc.data() as any);
};

export const upsertAttractionShortlistBlob = async (entry: AttractionShortlistBlob): Promise<AttractionShortlistBlob> => {
  const db = getDb();
  const payload = {
    destinationKey: entry.destinationKey,
    destinationDisplayName: entry.destinationDisplayName,
    dateKey: entry.dateKey,
    promptBlock: entry.promptBlock,
    compact: entry.compact,
    itemCount: Number(entry.itemCount) || 0,
    updatedAt: entry.updatedAt,
  };
  const docRef = db.collection('locations').doc(entry.id);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    const existing = doc.exists ? (doc.data() as any) : {};
    const mergedPayload = { ...(existing.payload || {}), ...payload };
    tx.set(
      docRef,
      {
        id: entry.id,
        sourceType: 'attraction_shortlist_blob',
        category: 'attraction_shortlist_blob',
        name: entry.destinationDisplayName,
        address: null,
        searchName: `${entry.destinationDisplayName} ${entry.dateKey} attraction shortlist`.toLowerCase(),
        payload: mergedPayload,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
  });
  const saved = await docRef.get();
  const parsed = toAttractionShortlistBlob(saved.id, saved.data() as any);
  if (!parsed) {
    throw new Error('Failed to parse attraction shortlist blob after upsert.');
  }
  return parsed;
};

// Lodgings
export const listLodgings = async (userId: string, tripId?: string | null): Promise<Lodging[]> => {
  const db = getDb();
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  };

  if (tripId) {
    const membership = await ensureUserCanReadTrip(tripId, userId);
    if (!membership) return [];
    const snapshot = await db.collection('lodgings').where('trip_id', '==', tripId).get();
    return snapshot.docs.map((d) => ({ ...(d.data() as Lodging), status: normalizeItineraryStatus((d.data() as any).status) }));
  }

  const memberSnap = await db
    .collection('group_members')
    .where('userId', '==', userId)
    .where('removedAt', '==', null)
    .get();
  const groupIds = memberSnap.docs.map((doc) => (doc.data() as any).groupId).filter(Boolean);

  const tripIds: string[] = [];
  for (const groupChunk of chunk(groupIds)) {
    const tripsSnap = await db.collection('trips').where('groupId', 'in', groupChunk).get();
    tripsSnap.docs.forEach((doc) => {
      tripIds.push(doc.id);
    });
  }

  const followedSnap = await db.collection('trip_followers').where('followerUserId', '==', userId).get();
  followedSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    if (data.tripId) tripIds.push(String(data.tripId));
  });
  const uniqueTripIds = Array.from(new Set(tripIds));
  if (!uniqueTripIds.length) return [];

  const lodgings: Lodging[] = [];
  for (const tripChunk of chunk(uniqueTripIds)) {
    const lodgingsSnap = await db.collection('lodgings').where('trip_id', 'in', tripChunk).get();
    lodgingsSnap.docs.forEach((doc) =>
      lodgings.push({ ...(doc.data() as Lodging), status: normalizeItineraryStatus((doc.data() as any).status) })
    );
  }
  return lodgings;
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
  placeId?: string;
  paid_by?: string[];
  traveler_ids?: string[];
  imageUrl?: string;
  image_url?: string;
}): Promise<Lodging> => {
  const db = getDb();
  const id = randomUUID();
  const payload: Lodging = {
    id,
    user_id: lodging.userId,
    trip_id: lodging.tripId,
    status: normalizeItineraryStatus((lodging as any).status),
    name: lodging.name,
    check_in_date: lodging.checkInDate,
    check_out_date: lodging.checkOutDate,
    rooms: lodging.rooms,
    refund_by: lodging.refundBy ?? '',
    total_cost: lodging.totalCost,
    cost_per_night: lodging.costPerNight,
    address: lodging.address ?? '',
    place_id: lodging.place_id ?? lodging.placeId ?? '',
    paid_by: lodging.paid_by ?? [],
    traveler_ids: lodging.traveler_ids ?? lodging.paid_by ?? [],
    imageUrl: lodging.imageUrl ?? lodging.image_url ?? '',
  };
  await db.collection('lodgings').doc(id).set(payload);
  return payload;
};

export const deleteLodging = async (lodgingId: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('lodgings').doc(lodgingId).get();
  if (!doc.exists) return;
  const data = doc.data() as any;
  const tripId = data.trip_id ?? data.tripId;
  if (!tripId) return;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return;
  await db.collection('lodgings').doc(lodgingId).delete();
};

export const updateLodging = async (lodgingId: string, userId: string, updates: Partial<Lodging>): Promise<Lodging | null> => {
  const db = getDb();
  const doc = await db.collection('lodgings').doc(lodgingId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  const tripId = (updates as any).trip_id ?? data.trip_id ?? data.tripId;
  if (!tripId) return null;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return null;
  const updatePayload = stripUndefined(updates);
  await db.collection('lodgings').doc(lodgingId).update(updatePayload);
  const updated = await db.collection('lodgings').doc(lodgingId).get();
  return { ...(updated.data() as Lodging), status: normalizeItineraryStatus((updated.data() as any)?.status) };
};

export const getLodgingById = async (lodgingId: string): Promise<Lodging | null> => {
  const doc = await getDb().collection('lodgings').doc(lodgingId).get();
  if (!doc.exists) return null;
  return { ...(doc.data() as Lodging), status: normalizeItineraryStatus((doc.data() as any)?.status) };
};

// Tours
export const listActivities = async (userId: string, tripId?: string): Promise<Activity[]> => {
  const db = getDb();
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  };
  if (tripId) {
    const access = await ensureUserCanReadTrip(tripId, userId);
    if (!access) return [];
    const snapshot = await db.collection('tours').where('tripId', '==', tripId).get();
    return snapshot.docs.map((d) => ({
      ...(d.data() as Activity),
      activityType: ((d.data() as any).activityType ?? 'Tour') as Activity['activityType'],
      status: normalizeItineraryStatus((d.data() as any).status),
    }));
  }
  const memberSnap = await db.collection('group_members').where('userId', '==', userId).where('removedAt', '==', null).get();
  const groupIds = memberSnap.docs.map((d) => (d.data() as any).groupId).filter(Boolean);
  const tripIds: string[] = [];
  for (const groupId of Array.from(new Set(groupIds))) {
    const trips = await db.collection('trips').where('groupId', '==', groupId).get();
    trips.docs.forEach((doc) => tripIds.push(doc.id));
  }
  const followed = await db.collection('trip_followers').where('followerUserId', '==', userId).get();
  followed.docs.forEach((doc) => {
    const data = doc.data() as any;
    if (data.tripId) tripIds.push(String(data.tripId));
  });
  const uniqueTripIds = Array.from(new Set(tripIds));
  if (!uniqueTripIds.length) return [];
  const activities: Activity[] = [];
  for (const ids of chunk(uniqueTripIds)) {
    const snapshot = await db.collection('tours').where('tripId', 'in', ids).get();
    snapshot.docs.forEach((d) =>
      activities.push({
        ...(d.data() as Activity),
        activityType: ((d.data() as any).activityType ?? 'Tour') as Activity['activityType'],
        status: normalizeItineraryStatus((d.data() as any).status),
      })
    );
  }
  return activities;
};

export const insertActivity = async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<Activity> => {
  const db = getDb();
  const id = randomUUID();
  const payload = {
    ...activity,
    activityType: (activity as any).activityType ?? 'Tour',
    status: normalizeItineraryStatus((activity as any).status),
    id,
    createdAt: nowIso(),
  };
  await db.collection('tours').doc(id).set(payload);
  return payload;
};

export const updateActivity = async (id: string, userId: string, activity: Partial<Activity>): Promise<Activity | null> => {
  const db = getDb();
  const doc = await db.collection('tours').doc(id).get();
  if (!doc.exists) return null;
  if ((doc.data() as any).userId !== userId) throw new Error('Not authorized');
  const updatePayload = stripUndefined({
    ...activity,
    activityType: typeof (activity as any).activityType === 'undefined' ? undefined : (activity as any).activityType,
  });
  await db.collection('tours').doc(id).update(updatePayload);
  const updated = await db.collection('tours').doc(id).get();
  return {
    ...(updated.data() as Activity),
    activityType: ((updated.data() as any)?.activityType ?? 'Tour') as Activity['activityType'],
    status: normalizeItineraryStatus((updated.data() as any)?.status),
  };
};

export const deleteActivity = async (tourId: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('tours').doc(tourId).get();
  if (!doc.exists) return;
  if ((doc.data() as any).userId !== userId) throw new Error('Not authorized');
  await db.collection('tours').doc(tourId).delete();
};

export const getActivityById = async (id: string): Promise<Activity | null> => {
  const doc = await getDb().collection('tours').doc(id).get();
  if (!doc.exists) return null;
  return {
    ...(doc.data() as Activity),
    activityType: ((doc.data() as any)?.activityType ?? 'Tour') as Activity['activityType'],
    status: normalizeItineraryStatus((doc.data() as any)?.status),
  };
};

// Car rentals
export const listCarRentals = async (userId: string, tripId?: string): Promise<CarRental[]> => {
  const db = getDb();
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };

  if (tripId) {
    const access = await ensureUserCanReadTrip(tripId, userId);
    if (!access) return [];
    const snapshot = await db.collection('car_rentals').where('tripId', '==', tripId).get();
    return snapshot.docs.map((d) => ({ ...(d.data() as CarRental), status: normalizeItineraryStatus((d.data() as any).status) }));
  }

  const memberSnap = await db.collection('group_members').where('userId', '==', userId).where('removedAt', '==', null).get();
  const groupIds = memberSnap.docs.map((d) => (d.data() as any).groupId).filter(Boolean);
  const tripIds: string[] = [];
  for (const groupId of Array.from(new Set(groupIds))) {
    const trips = await db.collection('trips').where('groupId', '==', groupId).get();
    trips.docs.forEach((doc) => tripIds.push(doc.id));
  }
  const followed = await db.collection('trip_followers').where('followerUserId', '==', userId).get();
  followed.docs.forEach((doc) => {
    const data = doc.data() as any;
    if (data.tripId) tripIds.push(String(data.tripId));
  });
  const uniqueTripIds = Array.from(new Set(tripIds));
  if (!uniqueTripIds.length) return [];
  const rentals: CarRental[] = [];
  for (const ids of chunk(uniqueTripIds)) {
    const snapshot = await db.collection('car_rentals').where('tripId', 'in', ids).get();
    snapshot.docs.forEach((d) =>
      rentals.push({ ...(d.data() as CarRental), status: normalizeItineraryStatus((d.data() as any).status) })
    );
  }
  return rentals;
};

export const getCarRentalById = async (id: string): Promise<CarRental | null> => {
  const doc = await getDb().collection('car_rentals').doc(id).get();
  if (!doc.exists) return null;
  return { ...(doc.data() as CarRental), status: normalizeItineraryStatus((doc.data() as any)?.status) };
};

export const insertCarRental = async (rental: Omit<CarRental, 'id' | 'createdAt'>): Promise<CarRental> => {
  const db = getDb();
  const id = randomUUID();
  const payload: CarRental = {
    ...rental,
    id,
    status: normalizeItineraryStatus((rental as any).status),
    cost: Number((rental as any).cost) || 0,
    createdAt: nowIso(),
  };
  await db.collection('car_rentals').doc(id).set(payload);
  return payload;
};

export const updateCarRental = async (id: string, userId: string, updates: Partial<CarRental>): Promise<CarRental | null> => {
  const db = getDb();
  const doc = await db.collection('car_rentals').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  const tripId = data.tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return null;
  const payload = stripUndefined({
    ...updates,
    status: typeof updates.status === 'undefined' ? undefined : normalizeItineraryStatus((updates as any).status),
    cost: typeof updates.cost === 'undefined' ? undefined : Number(updates.cost) || 0,
  });
  await db.collection('car_rentals').doc(id).update(payload);
  const updated = await db.collection('car_rentals').doc(id).get();
  return { ...(updated.data() as CarRental), status: normalizeItineraryStatus((updated.data() as any)?.status) };
};

export const deleteCarRental = async (id: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('car_rentals').doc(id).get();
  if (!doc.exists) return;
  const data = doc.data() as any;
  const tripId = data.tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return;
  await db.collection('car_rentals').doc(id).delete();
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
  const db = getDb();
  const itemTypeKey = reactionItemTypeKey(itemType, kind);
  const existing = await db
    .collection('item_votes')
    .where('itemType', '==', itemTypeKey)
    .where('itemId', '==', itemId)
    .where('userId', '==', userId)
    .limit(1)
    .get();
  const payload = { tripId, itemType: itemTypeKey, itemId, userId, value, updatedAt: nowIso() };
  if (!existing.empty) {
    await existing.docs[0].ref.update(payload);
    return;
  }
  await db.collection('item_votes').doc(randomUUID()).set({ ...payload, createdAt: nowIso() });
};

export const getItemVoteSummaries = async (
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  itemIds: string[],
  kind: ReactionKind = 'vote'
): Promise<Record<string, { netVotes: number; userVote: -1 | 1 | null }>> => {
  const normalized = Array.from(new Set((itemIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (!normalized.length) return {};
  const db = getDb();
  const itemTypeKey = reactionItemTypeKey(itemType, kind);
  const result: Record<string, { netVotes: number; userVote: -1 | 1 | null }> = {};
  normalized.forEach((id) => {
    result[id] = { netVotes: 0, userVote: null };
  });
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };
  for (const ids of chunk(normalized)) {
    const snap = await db
      .collection('item_votes')
      .where('tripId', '==', tripId)
      .where('itemType', '==', itemTypeKey)
      .where('itemId', 'in', ids)
      .get();
    snap.docs.forEach((doc) => {
      const vote = doc.data() as any;
      const itemId = String(vote.itemId ?? '');
      if (!result[itemId]) return;
      const value = vote.value === -1 ? -1 : 1;
      result[itemId].netVotes += value;
      if (String(vote.userId) === String(userId)) {
        result[itemId].userVote = value;
      }
    });
  }
  return result;
};

// Expenses
export const listExpenses = async (userId: string, tripId?: string | null): Promise<any[]> => {
  if (!tripId) return [];
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return [];
  const db = getDb();
  const snapshot = await db.collection('expenses').where('tripId', '==', tripId).get();
  return snapshot.docs.map((d) => d.data() as any);
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
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(expense.tripId).get();
  const tripCurrency = (tripDoc.data() as any)?.currency ?? 'USD';
  const currency = expense.currency ?? tripCurrency ?? 'USD';
  const amountInTripCurrency =
    expense.amountInTripCurrency ??
    (currency === tripCurrency ? expense.amount ?? 0 : null);
  const exchangeRateToTripCurrency =
    expense.exchangeRateToTripCurrency ??
    (currency === tripCurrency ? 1 : null);
  const id = randomUUID();
  const payload = {
    id,
    tripId: expense.tripId,
    groupId: expense.groupId,
    userId: expense.userId,
    expenseDate: expense.expenseDate,
    category: expense.category,
    amount: expense.amount ?? 0,
    currency,
    amountInTripCurrency,
    exchangeRateToTripCurrency,
    exchangeRateDate: expense.exchangeRateDate ?? null,
    payerIds: Array.isArray(expense.payerIds) ? expense.payerIds : [],
    forIds: Array.isArray(expense.forIds) ? expense.forIds : [],
    sourceType: expense.sourceType ?? null,
    sourceId: expense.sourceId ?? null,
    notes: expense.notes ?? null,
    createdAt: nowIso(),
  };
  await db.collection('expenses').doc(id).set(payload);
  return payload;
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
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(expense.tripId).get();
  const tripCurrency = (tripDoc.data() as any)?.currency ?? 'USD';
  const currency = expense.currency ?? tripCurrency ?? 'USD';
  const amountInTripCurrency =
    expense.amountInTripCurrency ??
    (currency === tripCurrency ? expense.amount ?? 0 : null);
  const exchangeRateToTripCurrency =
    expense.exchangeRateToTripCurrency ??
    (currency === tripCurrency ? 1 : null);
  const existing = await db
    .collection('expenses')
    .where('sourceType', '==', expense.sourceType)
    .where('sourceId', '==', expense.sourceId)
    .limit(1)
    .get();
  const payload = {
    tripId: expense.tripId,
    groupId: expense.groupId,
    userId: expense.userId,
    expenseDate: expense.expenseDate,
    category: expense.category,
    amount: expense.amount ?? 0,
    currency,
    amountInTripCurrency,
    exchangeRateToTripCurrency,
    exchangeRateDate: expense.exchangeRateDate ?? null,
    payerIds: Array.isArray(expense.payerIds) ? expense.payerIds : [],
    forIds: Array.isArray(expense.forIds) ? expense.forIds : [],
    sourceType: expense.sourceType,
    sourceId: expense.sourceId,
    notes: expense.notes ?? null,
    createdAt: nowIso(),
  };
  if (existing.docs.length) {
    const doc = existing.docs[0];
    await doc.ref.update(payload);
    return { id: doc.id, ...payload };
  }
  const id = randomUUID();
  await db.collection('expenses').doc(id).set({ id, ...payload });
  return { id, ...payload };
};

export const deleteExpense = async (expenseId: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('expenses').doc(expenseId).get();
  if (!doc.exists) return;
  const data = doc.data() as any;
  const membership = await ensureUserInTrip(data.tripId, userId);
  if (!membership) throw new Error('Not authorized');
  await db.collection('expenses').doc(expenseId).delete();
};

export const deleteExpenseForSource = async (sourceType: string, sourceId: string, userId: string): Promise<void> => {
  const db = getDb();
  const snapshot = await db
    .collection('expenses')
    .where('sourceType', '==', sourceType)
    .where('sourceId', '==', sourceId)
    .get();
  for (const doc of snapshot.docs) {
    const data = doc.data() as any;
    const membership = await ensureUserInTrip(data.tripId, userId);
    if (!membership) continue;
    await doc.ref.delete();
  }
};

// Traits
export const listTraits = async (userId: string): Promise<Trait[]> => {
  const db = getDb();
  const snapshot = await db.collection('traits').where('userId', '==', userId).get();
  return snapshot.docs.map((d) => d.data() as Trait);
};

export const createTrait = async (userId: string, name: string, level?: number, notes?: string): Promise<Trait> => {
  const db = getDb();
  const id = randomUUID();
  const payload = { id, userId, name, level: level ?? 1, notes: notes ?? null, createdAt: nowIso() };
  await db.collection('traits').doc(id).set(payload);
  return payload;
};

export const updateTrait = async (userId: string, traitId: string, updates: Partial<Trait>): Promise<Trait | null> => {
  const db = getDb();
  const doc = await db.collection('traits').doc(traitId).get();
  if (!doc.exists) return null;
  if ((doc.data() as any).userId !== userId) throw new Error('Not authorized');
  await db.collection('traits').doc(traitId).update(updates);
  const updated = await db.collection('traits').doc(traitId).get();
  return updated.data() as Trait;
};

export const deleteTrait = async (userId: string, traitId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('traits').doc(traitId).get();
  if (!doc.exists) return;
  if ((doc.data() as any).userId !== userId) throw new Error('Not authorized');
  await db.collection('traits').doc(traitId).delete();
};

export const refreshAirportsDaily = async (): Promise<void> => {
  // Firestore adapter leaves airport ingestion to external scripts; noop to avoid network calls here.
  return;
};

export const searchUsersByEmail = async (query: string): Promise<User[]> => {
  const db = getDb();
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const snapshot = await db.collection('users').where('email', '>=', normalized).where('email', '<=', normalized + '\\uf8ff').limit(10).get();
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
};

export const listTraitsForGroupTrip = async (userId: string, tripId: string) => {
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized for this trip');
  return listTraits(userId);
};

export const getUserDemographics = async (userId: string) => {
  const doc = await getDb().collection('user_demographics').doc(userId).get();
  if (!doc.exists) {
    return { age: null, gender: null };
  }
  const data = doc.data() as any;
  return { age: data?.age ?? null, gender: data?.gender ?? null };
};

export const saveUserDemographics = async (userId: string, data: any) => {
  await getDb().collection('user_demographics').doc(userId).set({ ...data, updatedAt: nowIso() }, { merge: true });
};

// Itineraries
export const listItineraries = async (userId: string): Promise<Array<Itinerary & { tripName: string }>> => {
  const db = getDb();
  const itineraries = await db.collection('itineraries').get();
  const trips = await listTrips(userId);
  const tripNames = Object.fromEntries(trips.map((t) => [t.id, t.name]));
  const visible: Array<Itinerary & { tripName: string }> = [];
  for (const d of itineraries.docs) {
    const data = d.data() as any;
    const access = await ensureUserCanReadTrip(String(data.tripId ?? ''), userId);
    if (!access) continue;
    visible.push({ ...(data as any), id: d.id, tripName: tripNames[data.tripId] ?? '' });
  }
  return visible;
};

export const createItineraryRecord = async (
  userId: string,
  tripId: string,
  destination: string,
  days: number,
  budget?: number | null
): Promise<Itinerary & { tripName: string }> => {
  const db = getDb();
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('You must belong to the trip group to save an itinerary');

  const normalizedDestination = destination.trim().toLowerCase();
  const roundedDays = Math.max(1, Math.round(days));
  const budgetValue = budget ?? null;

  const dupeQuery = await db
    .collection('itineraries')
    .where('tripId', '==', tripId)
    .where('destination', '==', normalizedDestination)
    .where('days', '==', roundedDays)
    .where('budget', '==', budgetValue)
    .limit(1)
    .get();

  if (!dupeQuery.empty) {
    const err = new Error('Itinerary already exists for this trip');
    (err as any).code = 'ITINERARY_EXISTS';
    throw err;
  }

  const id = randomUUID();
  const trip = await db.collection('trips').doc(tripId).get();
  const tripName = trip.exists ? (trip.data() as Trip).name : '';

  const payload: Itinerary = {
    id,
    tripId,
    destination: destination.trim(),
    days: roundedDays,
    budget: budgetValue,
    createdAt: nowIso(),
    userId,
  };
  await db.collection('itineraries').doc(id).set(payload);

  return { ...payload, tripName };
};

export const deleteItineraryRecord = async (userId: string, itineraryId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('itineraries').doc(itineraryId).get();
  if (!doc.exists) return;
  if ((doc.data() as any).userId !== userId) throw new Error('Not authorized');
  await db.collection('itineraries').doc(itineraryId).delete();
};

export const updateItineraryRecord = async (
  userId: string,
  itineraryId: string,
  data: Partial<Itinerary>
): Promise<Itinerary | null> => {
  const db = getDb();
  const doc = await db.collection('itineraries').doc(itineraryId).get();
  if (!doc.exists) return null;
  if ((doc.data() as any).userId !== userId) throw new Error('Not authorized');
  await db.collection('itineraries').doc(itineraryId).update({ ...data, updatedAt: nowIso() });
  const updated = await db.collection('itineraries').doc(itineraryId).get();
  return updated.data() as Itinerary;
};

export const listItineraryDetails = async (userId: string, itineraryId: string): Promise<ItineraryDetail[]> => {
  const db = getDb();
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) throw new Error('Itinerary not found');
  const itineraryData = itinerary.data() as any;
  const membership = await ensureUserCanReadTrip(String(itineraryData.tripId ?? ''), userId);
  if (!membership) throw new Error('Not authorized');
  const details = await db.collection('itinerary_details').where('itineraryId', '==', itineraryId).get();
  return details.docs.map((d) => d.data() as ItineraryDetail);
};

export const addItineraryDetail = async (
  userId: string,
  itineraryId: string,
  detail: { day: number; time?: string | null; activity: string; cost?: number | null }
): Promise<ItineraryDetail> => {
  const db = getDb();
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) throw new Error('Itinerary not found');

  const tripId = (itinerary.data() as Itinerary).tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');

  const id = randomUUID();
  const payload: ItineraryDetail = {
    id,
    itineraryId,
    day: Math.max(1, Math.round(detail.day)),
    time: detail.time ?? null,
    activity: detail.activity.trim(),
    cost: detail.cost ?? null,
  };
  await db.collection('itinerary_details').doc(id).set(payload);
  await writeActivity(tripId, userId, 'ITINERARY_ITEM_ADDED', 'Itinerary item added', payload.activity, {
    itineraryId,
    detailId: id,
    day: payload.day,
    time: payload.time ?? null,
    cost: payload.cost ?? null,
  });
  return payload;
};

export const deleteItineraryDetail = async (userId: string, detailId: string): Promise<void> => {
  const db = getDb();
  const detail = await db.collection('itinerary_details').doc(detailId).get();
  if (!detail.exists) return;
  const detailData = detail.data() as any;
  const itineraryId = detailData.itineraryId;
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists || (itinerary.data() as any).userId !== userId) throw new Error('Not authorized');
  const tripId = String((itinerary.data() as any).tripId ?? '');
  await db.collection('itinerary_details').doc(detailId).delete();
  if (tripId) {
    await writeActivity(tripId, userId, 'ITINERARY_ITEM_DELETED', 'Itinerary item removed', detailData.activity ?? '', {
      itineraryId,
      detailId,
      day: detailData.day ?? null,
      time: detailData.time ?? null,
      cost: detailData.cost ?? null,
    });
  }
};

export const updateItineraryDetail = async (
  detailId: string,
  userId: string,
  updates: Partial<ItineraryDetail>
): Promise<ItineraryDetail | null> => {
  const db = getDb();
  const detail = await db.collection('itinerary_details').doc(detailId).get();
  if (!detail.exists) return null;
  const itineraryId = (detail.data() as any).itineraryId;
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists || (itinerary.data() as any).userId !== userId) throw new Error('Not authorized');
  await db.collection('itinerary_details').doc(detailId).update(updates);
  const updated = await db.collection('itinerary_details').doc(detailId).get();
  const payload = updated.data() as ItineraryDetail;
  const tripId = String((itinerary.data() as any).tripId ?? '');
  if (tripId) {
    await writeActivity(tripId, userId, 'ITINERARY_ITEM_UPDATED', 'Itinerary item updated', payload.activity ?? '', {
      itineraryId,
      detailId,
      day: payload.day ?? null,
      time: payload.time ?? null,
      cost: payload.cost ?? null,
    });
  }
  return payload;
};

export const getPlaceDetailsCache = async (placeId: string): Promise<PlaceDetailsCache | null> => {
  const db = getDb();
  const doc = await db.collection('place_details_cache').doc(placeId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  return {
    placeId: data.placeId ?? placeId,
    name: data.name ?? '',
    details: data.details ?? {},
    fetchedAt: data.fetchedAt ?? data.updatedAt ?? nowIso(),
  };
};

export const upsertPlaceDetailsCache = async (entry: {
  placeId: string;
  name: string;
  details: Record<string, any>;
  fetchedAt?: string | Date;
}): Promise<void> => {
  const db = getDb();
  const fetchedAt = entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : nowIso();
  await db.collection('place_details_cache').doc(entry.placeId).set(
    {
      placeId: entry.placeId,
      name: entry.name,
      details: entry.details ?? {},
      fetchedAt,
      updatedAt: nowIso(),
    },
    { merge: true }
  );
};

export const getPlaceLookupCache = async (
  queryKey: string
): Promise<{ queryKey: string; placeId: string; name: string; likelihood: number; fetchedAt: string } | null> => {
  const db = getDb();
  const docId = createHash('sha256').update(queryKey).digest('hex');
  const doc = await db.collection('place_lookup_cache').doc(docId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  return {
    queryKey: data.queryKey ?? queryKey,
    placeId: data.placeId ?? '',
    name: data.name ?? '',
    likelihood: Number(data.likelihood ?? 0),
    fetchedAt: data.fetchedAt ?? data.updatedAt ?? nowIso(),
  };
};

export const upsertPlaceLookupCache = async (entry: {
  queryKey: string;
  placeId: string;
  name: string;
  likelihood: number;
  fetchedAt?: string | Date;
}): Promise<void> => {
  const db = getDb();
  const docId = createHash('sha256').update(entry.queryKey).digest('hex');
  const fetchedAt = entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : nowIso();
  await db.collection('place_lookup_cache').doc(docId).set(
    {
      queryKey: entry.queryKey,
      placeId: entry.placeId,
      name: entry.name,
      likelihood: entry.likelihood,
      fetchedAt,
      updatedAt: nowIso(),
    },
    { merge: true }
  );
};

// Family & fellow travelers
export const listFamilyRelationships = async (userId: string) => {
  const rels = await getDb().collection('family_relationships').where('requesterId', '==', userId).get();
  return rels.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
};

export const listFellowTravelers = async (ownerId: string) => {
  const docs = await getDb().collection('fellow_travelers').where('ownerId', '==', ownerId).get();
  return docs.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
};

export const createFellowTraveler = async (ownerId: string, firstName: string, lastName: string) => {
  const id = randomUUID();
  const payload = { ownerId, firstName, lastName, createdAt: nowIso() };
  await getDb().collection('fellow_travelers').doc(id).set(payload);
  return payload;
};

export const updateFellowTraveler = async (
  ownerId: string,
  travelerId: string,
  updates: { firstName?: string; lastName?: string }
) => {
  const doc = await getDb().collection('fellow_travelers').doc(travelerId).get();
  if (!doc.exists) throw new Error('Traveler not found');
  if ((doc.data() as any).ownerId !== ownerId) throw new Error('Not authorized');
  await getDb().collection('fellow_travelers').doc(travelerId).update(updates);
};

export const removeFellowTraveler = async (ownerId: string, travelerId: string) => {
  const doc = await getDb().collection('fellow_travelers').doc(travelerId).get();
  if (!doc.exists) return;
  if ((doc.data() as any).ownerId !== ownerId) throw new Error('Not authorized');
  await getDb().collection('fellow_travelers').doc(travelerId).delete();
};

export const searchTripContacts = async (ownerId: string, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const travelers = await listFellowTravelers(ownerId);
  return travelers.filter((t) => `${t.firstName} ${t.lastName}`.toLowerCase().includes(normalized));
};

export const createFamilyRelationship = async (
  requesterId: string,
  relativeEmail: string,
  relationship: string
) => {
  const user = await findOrCreateUser(relativeEmail, 'email');
  const id = randomUUID();
  await getDb().collection('family_relationships').doc(id).set({
    requesterId,
    relativeId: user.id,
    relationship,
    status: 'pending',
    createdAt: nowIso(),
  });
  return { id, requesterId, relativeId: user.id, relationship, status: 'pending' };
};

export const acceptFamilyRelationship = async (userId: string, relationshipId: string) => {
  const rel = await getDb().collection('family_relationships').doc(relationshipId).get();
  if (!rel.exists) throw new Error('Relationship not found');
  const data = rel.data() as any;
  if (data.relativeId !== userId) throw new Error('Not authorized');
  await getDb().collection('family_relationships').doc(relationshipId).update({ status: 'accepted' });
};

export const rejectFamilyRelationship = async (userId: string, relationshipId: string) => {
  const rel = await getDb().collection('family_relationships').doc(relationshipId).get();
  if (!rel.exists) throw new Error('Relationship not found');
  const data = rel.data() as any;
  if (data.relativeId !== userId) throw new Error('Not authorized');
  await getDb().collection('family_relationships').doc(relationshipId).update({ status: 'rejected' });
};

export const removeFamilyRelationship = async (userId: string, relationshipId: string) => {
  const rel = await getDb().collection('family_relationships').doc(relationshipId).get();
  if (!rel.exists) return;
  const data = rel.data() as any;
  if (data.relativeId !== userId && data.requesterId !== userId) throw new Error('Not authorized');
  await getDb().collection('family_relationships').doc(relationshipId).delete();
};

export const removeTravelerFromTrip = async (userId: string, tripId: string, travelerId: string): Promise<void> => {
  const db = getDb();
  const tripRef = db.collection('trips').doc(tripId);
  const tripDoc = await tripRef.get();
  if (!tripDoc.exists) {
    throw new Error('Trip not found');
  }
  
  // 1. Authorize user
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    throw new Error('Not authorized for this trip');
  }

  // Get the user ID of the traveler being removed.
  const memberToRemoveDoc = await db.collection('group_members').doc(travelerId).get();
  if (!memberToRemoveDoc.exists) {
    // It might be an invite, not a full member.
    const inviteDoc = await db.collection('group_invites').doc(travelerId).get();
    if (inviteDoc.exists) {
      await inviteDoc.ref.delete();
    }
    return; // Nothing more to do.
  }
  const memberToRemove = memberToRemoveDoc.data() as GroupMember;
  const userIdToRemove = memberToRemove.userId;

  const batch = db.batch();

  if (userIdToRemove) {
    // 2. Process Flights
    const flightsSnap = await db.collection('flights').where('tripId', '==', tripId).get();
    for (const flightDoc of flightsSnap.docs) {
      const flight = flightDoc.data() as Flight & { passengerIds?: string[]; paidBy?: string[]; paid_by?: string[] };
      let wasModified = false;
      const updates: Partial<Flight> = {};

      if (flight.passengerIds?.includes(userIdToRemove)) {
        if (flight.passengerIds.length === 1) {
          batch.delete(flightDoc.ref);
          continue; 
        }
        updates.passengerIds = flight.passengerIds.filter((id) => id !== userIdToRemove);
        wasModified = true;
      }

      const currentPaidBy = (updates.paidBy || flight.paidBy || flight.paid_by) ?? [];
      if (currentPaidBy.includes(userIdToRemove)) {
        if (currentPaidBy.length === 1) {
          updates.paidBy = [userId];
        } else {
          updates.paidBy = currentPaidBy.filter((id: string) => id !== userIdToRemove);
        }
        wasModified = true;
      }
      
      if (wasModified) {
        batch.update(flightDoc.ref, updates);
      }
    }

    // 3. Process Lodgings
    const lodgingsSnap = await db.collection('lodgings').where('trip_id', '==', tripId).get();
    for (const lodgingDoc of lodgingsSnap.docs) {
      const lodging = lodgingDoc.data() as Lodging & { paidBy?: string[]; paid_by?: string[]; traveler_ids?: string[]; travelerIds?: string[] };
      const lodgingPaidBy = lodging.paid_by ?? lodging.paidBy ?? [];
      const lodgingTravelers = lodging.traveler_ids ?? lodging.travelerIds ?? [];
      const updates: Partial<Lodging> = {};
      let shouldDelete = false;

      if (lodgingTravelers.includes(userIdToRemove)) {
        const nextTravelers = lodgingTravelers.filter((id: string) => id !== userIdToRemove);
        if (nextTravelers.length === 0) {
          shouldDelete = true;
        } else {
          updates.traveler_ids = nextTravelers;
        }
      }

      if (lodgingPaidBy.includes(userIdToRemove)) {
        if (lodgingPaidBy.length === 1) {
          updates.paid_by = [userId];
        } else {
          updates.paid_by = lodgingPaidBy.filter((id: string) => id !== userIdToRemove);
        }
      }

      if (shouldDelete) {
        batch.delete(lodgingDoc.ref);
      } else if (Object.keys(updates).length) {
        batch.update(lodgingDoc.ref, updates);
      }
    }

    // 4. Process Tours
    const toursSnap = await db.collection('tours').where('tripId', '==', tripId).get();
    for (const tourDoc of toursSnap.docs) {
      const tour = tourDoc.data() as Activity & { paidBy?: string[] };
      if (tour.paidBy?.includes(userIdToRemove)) {
        if (tour.paidBy.length === 1) {
          batch.delete(tourDoc.ref);
        } else {
          const updates: Partial<Activity> = {
            paidBy: tour.paidBy.filter((id) => id !== userIdToRemove),
          };
          batch.update(tourDoc.ref, updates);
        }
      }
    }
  }

  // 5. Remove from group
  batch.update(memberToRemoveDoc.ref, { removedAt: nowIso() });

  await batch.commit();
};





export const updateFamilyProfile = async (
  userId: string,
  relationshipId: string,
  updates: { givenName?: string; middleName?: string | null; familyName?: string; email?: string; relationship?: string }
) => {
  const rel = await getDb().collection('family_relationships').doc(relationshipId).get();
  if (!rel.exists) throw new Error('Relationship not found');
  const data = rel.data() as any;
  if (data.requesterId !== userId) throw new Error('Not authorized to edit this relationship');
  const updateFields: any = {};
  if (updates.relationship) updateFields.relationship = updates.relationship;
  await getDb().collection('family_relationships').doc(relationshipId).update(updateFields);
  if (updates.email) {
    const normalized = normalizeEmail(updates.email);
    await getDb().collection('users').doc(data.relativeId).set({ email: normalized }, { merge: true });
    await getDb().collection('web_users').doc(data.relativeId).set({ email: normalized }, { merge: true });
  }
};

export const findOrCreateGoogleUser = async (profile: any): Promise<User> => {
    const db = getDb();
    const { id, displayName, emails, photos, name } = profile;

    const email = emails?.[0]?.value;
    if (!email) {
        throw new Error('Google profile did not return an email');
    }
    const normalizedEmail = normalizeEmail(email);

    const existing = await db.collection('users').where('googleId', '==', id).limit(1).get();
    if (!existing.empty) {
        const doc = existing.docs[0];
        const updateData = {
            email: normalizedEmail,
            picture: photos?.[0]?.value,
            firstName: name?.givenName,
            lastName: name?.familyName,
            emailVerified: true,
            emailVerifiedAt: nowIso(),
        };
        await doc.ref.update(updateData);
        const updatedDoc = await doc.ref.get();
        const data = updatedDoc.data() as User;
        return { id: doc.id, email: data.email, provider: data.provider };
    }

    const existingByEmail = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!existingByEmail.empty) {
        const doc = existingByEmail.docs[0];
        const updateData = {
            googleId: id,
            picture: photos?.[0]?.value,
            firstName: name?.givenName,
            lastName: name?.familyName,
            emailVerified: true,
            emailVerifiedAt: nowIso(),
        };
        await doc.ref.update(updateData);
        const updatedDoc = await doc.ref.get();
        const data = updatedDoc.data() as User;
        return { id: doc.id, email: data.email, provider: data.provider };
    }

    const newUserId = randomUUID();
    await db.collection('users').doc(newUserId).set({
        email: normalizedEmail,
        provider: 'google',
        googleId: id,
        picture: photos?.[0]?.value,
        firstName: name?.givenName,
        lastName: name?.familyName,
        emailVerified: true,
        emailVerifiedAt: nowIso(),
        createdAt: nowIso(),
    });

    return { id: newUserId, email: normalizedEmail, provider: 'google' };
};

