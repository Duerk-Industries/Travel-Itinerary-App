// Firebase adapter (Firestore-backed)
import { initializeApp, cert, deleteApp, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldPath, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import {
  Flight,
  Lodging,
  Activity,
  CarRental,
  Trait,
  Trip,
  User,
  UserRole,
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
} from './types';
import { logError, logInfo } from './logger';
import { getEnvValue, isLocalEnv } from './env';
import { normalizeItineraryStatus } from './utils/itineraryStatus';
import { getApiLimitsConfig } from './config/apiLimits';

let app: App | null = null;
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeLoginIdentifier = (value: string): string => value.trim().toLowerCase();
const isEmailLikeIdentifier = (value: string): boolean => value.includes('@');
const USERNAME_MAX_LEN = 30;
const USERNAME_ALLOWED_REGEX = /^[a-z0-9_-]{1,30}$/;
const nowIso = () => new Date().toISOString();
const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 64).toString('hex');
const stripUndefined = <T extends Record<string, any>>(updates: T): Partial<T> =>
  Object.fromEntries(Object.entries(updates).filter(([, value]) => typeof value !== 'undefined')) as Partial<T>;
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const TRIP_SHARE_TOKEN_BYTES = 24;
const generateTripShareToken = (): string => randomBytes(TRIP_SHARE_TOKEN_BYTES).toString('base64url');
const FOLLOW_CODE_LENGTH = 6;
const FOLLOW_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ADMIN_ANALYTICS_VERSION = 1;
type TripAccessRole = 'owner' | 'member' | 'follower';
type GroupAccessRole = 'owner' | 'member';
type GroupAccessRecord = {
  groupId: string;
  userId: string;
  role: GroupAccessRole;
  status: 'active';
  canRead: true;
  canWrite: boolean;
  canManageMembers: boolean;
  source: 'group_owner' | 'group_member';
  createdAt: string;
  updatedAt: string;
};
type TripAccessRecord = {
  tripId: string;
  groupId: string;
  userId: string;
  role: TripAccessRole;
  status: 'active';
  canRead: true;
  canWrite: boolean;
  canComment: boolean;
  canVote: boolean;
  source: 'group_membership' | 'trip_follower';
  createdAt: string;
  updatedAt: string;
};

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

const isUsernameAvailable = async (normalizedUsername: string, excludeUserId?: string): Promise<boolean> => {
  const snap = await getDb().collection('users').where('username', '==', normalizedUsername).limit(5).get();
  return snap.docs.every((doc) => doc.id === excludeUserId);
};

const generateUniqueUsername = async (
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
  while (!USERNAME_ALLOWED_REGEX.test(candidate) || !(await isUsernameAvailable(candidate, excludeUserId))) {
    candidate = appendUsernameSuffix(base, counter);
    counter += 1;
    if (counter > 100000) {
      throw new Error('Unable to generate a unique username');
    }
  }
  return candidate;
};

const getTripAccessDocId = (tripId: string, userId: string): string => `${tripId}_${userId}`;
const getGroupAccessDocId = (groupId: string, userId: string): string => `${groupId}_${userId}`;

const buildGroupAccessRecord = (
  existing: Partial<GroupAccessRecord> | null | undefined,
  params: {
    groupId: string;
    userId: string;
    role: GroupAccessRole;
    source: 'group_owner' | 'group_member';
  }
): GroupAccessRecord => {
  const manageMembers = params.role === 'owner';
  return {
    groupId: params.groupId,
    userId: params.userId,
    role: params.role,
    status: 'active',
    canRead: true,
    canWrite: true,
    canManageMembers: manageMembers,
    source: params.source,
    createdAt: String(existing?.createdAt ?? nowIso()),
    updatedAt: nowIso(),
  };
};

const buildTripAccessRecord = (
  existing: Partial<TripAccessRecord> | null | undefined,
  params: {
    tripId: string;
    groupId: string;
    userId: string;
    role: TripAccessRole;
    source: 'group_membership' | 'trip_follower';
  }
): TripAccessRecord => {
  const writeEnabled = params.role !== 'follower';
  return {
    tripId: params.tripId,
    groupId: params.groupId,
    userId: params.userId,
    role: params.role,
    status: 'active',
    canRead: true,
    canWrite: writeEnabled,
    canComment: true,
    canVote: writeEnabled,
    source: params.source,
    createdAt: String(existing?.createdAt ?? nowIso()),
    updatedAt: nowIso(),
  };
};

export const clearTripAccessForTrip = async (tripId: string): Promise<void> => {
  const db = getDb();
  const existing = await db.collection('trip_access').where('tripId', '==', tripId).get();
  await Promise.all(existing.docs.map((doc) => doc.ref.delete()));
};

export const clearGroupAccessForGroup = async (groupId: string): Promise<void> => {
  const db = getDb();
  const existing = await db.collection('group_access').where('groupId', '==', groupId).get();
  await Promise.all(existing.docs.map((doc) => doc.ref.delete()));
};

export const rebuildGroupAccessForGroup = async (groupId: string): Promise<void> => {
  const db = getDb();
  const groupDoc = await db.collection('groups').doc(groupId).get();
  if (!groupDoc.exists) {
    await clearGroupAccessForGroup(groupId);
    return;
  }

  const ownerId = String((groupDoc.data() as any)?.ownerId ?? '').trim();
  const [membersSnap, existingSnap] = await Promise.all([
    db.collection('group_members').where('groupId', '==', groupId).where('removedAt', '==', null).get(),
    db.collection('group_access').where('groupId', '==', groupId).get(),
  ]);

  const desired = new Map<string, GroupAccessRecord>();
  if (ownerId) {
    desired.set(
      ownerId,
      buildGroupAccessRecord(null, {
        groupId,
        userId: ownerId,
        role: 'owner',
        source: 'group_owner',
      })
    );
  }

  for (const doc of membersSnap.docs) {
    const data = doc.data() as any;
    const memberUserId = String(data.userId ?? '').trim();
    if (!memberUserId) continue;
    if (!desired.has(memberUserId)) {
      desired.set(
        memberUserId,
        buildGroupAccessRecord(null, {
          groupId,
          userId: memberUserId,
          role: memberUserId === ownerId ? 'owner' : 'member',
          source: memberUserId === ownerId ? 'group_owner' : 'group_member',
        })
      );
    }
  }

  const existingByUserId = new Map(
    existingSnap.docs.map((doc) => {
      const data = doc.data() as any;
      return [String(data.userId ?? '').trim(), { id: doc.id, data }];
    })
  );

  await Promise.all(
    Array.from(desired.entries()).map(async ([userId, record]) => {
      const existing = existingByUserId.get(userId);
      await db
        .collection('group_access')
        .doc(getGroupAccessDocId(groupId, userId))
        .set(buildGroupAccessRecord(existing?.data, {
          groupId,
          userId,
          role: record.role,
          source: record.source,
        }));
    })
  );

  await Promise.all(
    existingSnap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const userId = String(data.userId ?? '').trim();
        return !userId || !desired.has(userId);
      })
      .map((doc) => doc.ref.delete())
  );
};

export const rebuildGroupAccessForAllGroups = async (): Promise<{ groupCount: number }> => {
  const db = getDb();
  const groupsSnap = await db.collection('groups').get();
  for (const doc of groupsSnap.docs) {
    await rebuildGroupAccessForGroup(doc.id);
  }
  return { groupCount: groupsSnap.docs.length };
};

export const rebuildTripAccessForTrip = async (tripId: string): Promise<void> => {
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) {
    await clearTripAccessForTrip(tripId);
    return;
  }

  const tripData = tripDoc.data() as any;
  const groupId = String(tripData.groupId ?? '').trim();
  if (!groupId) {
    await clearTripAccessForTrip(tripId);
    return;
  }

  const groupDoc = await db.collection('groups').doc(groupId).get();
  const ownerId = groupDoc.exists ? String((groupDoc.data() as any)?.ownerId ?? '').trim() : '';
  const [membersSnap, removalsSnap, followersSnap, existingSnap] = await Promise.all([
    db.collection('group_members').where('groupId', '==', groupId).where('removedAt', '==', null).get(),
    db.collection('trip_removals').where('tripId', '==', tripId).get(),
    db.collection('trip_followers').where('tripId', '==', tripId).get(),
    db.collection('trip_access').where('tripId', '==', tripId).get(),
  ]);

  const removedUserIds = new Set(
    removalsSnap.docs
      .map((doc) => String((doc.data() as any)?.userId ?? '').trim())
      .filter(Boolean)
  );

  const desired = new Map<string, TripAccessRecord>();
  for (const doc of membersSnap.docs) {
    const data = doc.data() as any;
    const memberUserId = String(data.userId ?? '').trim();
    if (!memberUserId || removedUserIds.has(memberUserId)) continue;
    desired.set(
      memberUserId,
      buildTripAccessRecord(null, {
        tripId,
        groupId,
        userId: memberUserId,
        role: ownerId && memberUserId === ownerId ? 'owner' : 'member',
        source: 'group_membership',
      })
    );
  }

  for (const doc of followersSnap.docs) {
    const data = doc.data() as any;
    const followerUserId = String(data.followerUserId ?? '').trim();
    if (!followerUserId || removedUserIds.has(followerUserId) || desired.has(followerUserId)) continue;
    desired.set(
      followerUserId,
      buildTripAccessRecord(null, {
        tripId,
        groupId,
        userId: followerUserId,
        role: 'follower',
        source: 'trip_follower',
      })
    );
  }

  const existingByUserId = new Map(
    existingSnap.docs.map((doc) => {
      const data = doc.data() as any;
      return [String(data.userId ?? '').trim(), { id: doc.id, data }];
    })
  );

  await Promise.all(
    Array.from(desired.entries()).map(async ([userId, record]) => {
      const existing = existingByUserId.get(userId);
      await db
        .collection('trip_access')
        .doc(getTripAccessDocId(tripId, userId))
        .set(buildTripAccessRecord(existing?.data, {
          tripId,
          groupId,
          userId,
          role: record.role,
          source: record.source,
        }));
    })
  );

  await Promise.all(
    existingSnap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const userId = String(data.userId ?? '').trim();
        return !userId || !desired.has(userId);
      })
      .map((doc) => doc.ref.delete())
  );
};

const rebuildTripAccessForGroup = async (groupId: string): Promise<void> => {
  const db = getDb();
  const tripsSnap = await db.collection('trips').where('groupId', '==', groupId).get();
  await Promise.all(tripsSnap.docs.map((doc) => rebuildTripAccessForTrip(doc.id)));
};

export const rebuildTripAccessForAllTrips = async (): Promise<{ tripCount: number }> => {
  const db = getDb();
  const tripsSnap = await db.collection('trips').get();
  for (const doc of tripsSnap.docs) {
    await rebuildTripAccessForTrip(doc.id);
  }
  return { tripCount: tripsSnap.docs.length };
};

const getUserEmailDocRef = (email: string) => getDb().collection('user_emails').doc(normalizeEmail(email));

const upsertUserEmail = async (
  userId: string,
  email: string,
  options: { isPrimary?: boolean; isVerified?: boolean; verifiedAt?: string | null } = {}
): Promise<void> => {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  const ref = getUserEmailDocRef(normalizedEmail);
  const existing = await ref.get();
  const existingData = existing.exists ? (existing.data() as any) : null;
  const isPrimary = options.isPrimary ?? false;
  const isVerified = options.isVerified ?? false;
  const verifiedAt = options.verifiedAt ?? (isVerified ? nowIso() : existingData?.verifiedAt ?? null);
  await ref.set({
    userId,
    email: normalizedEmail,
    isPrimary,
    isVerified: isVerified || Boolean(existingData?.isVerified),
    verifiedAt,
    createdAt: existingData?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  }, { merge: true });

  if (isPrimary) {
    const userEmails = await db.collection('user_emails').where('userId', '==', userId).get();
    const batch = db.batch();
    userEmails.docs.forEach((doc) => {
      batch.update(doc.ref, { isPrimary: doc.id === normalizedEmail, updatedAt: nowIso() });
    });
    await batch.commit();
  }
};

const listStoredUserEmails = async (userId: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean; verifiedAt?: string | null; createdAt?: string | null }>> => {
  const snap = await getDb().collection('user_emails').where('userId', '==', userId).get();
  return snap.docs
    .map((doc) => {
      const data = doc.data() as any;
      return {
        email: String(data.email ?? doc.id).toLowerCase(),
        isPrimary: Boolean(data.isPrimary),
        isVerified: Boolean(data.isVerified),
        verifiedAt: data.verifiedAt ?? null,
        createdAt: data.createdAt ?? null,
      };
    })
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return `${a.createdAt ?? ''}:${a.email}`.localeCompare(`${b.createdAt ?? ''}:${b.email}`);
    });
};

const findUserByEmailDoc = async (email: string): Promise<{ id: string; data: any } | null> => {
  const normalized = normalizeEmail(email);
  const userEmailDoc = await getUserEmailDocRef(normalized).get();
  if (userEmailDoc.exists) {
    const userId = String((userEmailDoc.data() as any).userId ?? '').trim();
    if (userId) {
      const userDoc = await getDb().collection('users').doc(userId).get();
      if (userDoc.exists) {
        return { id: userDoc.id, data: userDoc.data() as any };
      }
    }
  }
  const snapshot = await getDb().collection('users').where('email', '==', normalized).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() as any };
};

const getDayKey = (iso: string): string => String(iso ?? '').slice(0, 10);
const getAdminAnalyticsDailyDocId = (userId: string, dayKey: string): string => `${userId}_${dayKey}`;

const incrementAdminUserAnalyticsMetric = async (
  userId: string,
  metricKey: string,
  amount: number,
  createdAt = nowIso()
): Promise<void> => {
  const db = getDb();
  const dayKey = getDayKey(createdAt);
  await Promise.all([
    db.collection('admin_user_analytics').doc(userId).set({
      userId,
      analyticsVersion: ADMIN_ANALYTICS_VERSION,
      metrics: { [metricKey]: FieldValue.increment(amount) },
      updatedAt: createdAt,
    }, { merge: true }),
    db.collection('admin_user_analytics_daily').doc(getAdminAnalyticsDailyDocId(userId, dayKey)).set({
      userId,
      dayKey,
      analyticsVersion: ADMIN_ANALYTICS_VERSION,
      metrics: { [metricKey]: FieldValue.increment(amount) },
      updatedAt: createdAt,
    }, { merge: true }),
  ]);
};

const incrementAdminUserTripCount = async (userId: string, amount: number, updatedAt = nowIso()): Promise<void> => {
  const db = getDb();
  await db.collection('admin_user_analytics').doc(userId).set({
    userId,
    analyticsVersion: ADMIN_ANALYTICS_VERSION,
    tripCount: FieldValue.increment(amount),
    updatedAt,
  }, { merge: true });
};

const deleteDocRefsInBatches = async (
  refs: FirebaseFirestore.DocumentReference[],
  batchSize = 400,
): Promise<void> => {
  const db = getDb();
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + batchSize)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
};

const listActiveGroupUserIds = async (groupId: string): Promise<string[]> => {
  const db = getDb();
  const accessSnap = await db.collection('group_access')
    .where('groupId', '==', groupId)
    .get();
  return Array.from(
    new Set(
      accessSnap.docs
        .map((doc) => doc.data() as any)
        .filter((data) => data.status === 'active' && data.canRead === true)
        .map((data) => String(data.userId ?? '').trim())
        .filter((userId) => userId.length > 0)
    )
  );
};

const countVisibleTripsForUserInGroup = async (userId: string, groupId: string): Promise<number> => {
  const db = getDb();
  const accessSnap = await db.collection('trip_access').where('userId', '==', userId).get();
  return accessSnap.docs
    .map((doc) => doc.data() as any)
    .filter((data) => data.groupId === groupId && data.status === 'active' && data.canRead === true)
    .length;
};

const writeAdminUserAnalyticsBackfill = async (params: {
  userId: string;
  tripCount: number;
  totalMetrics: Record<string, number>;
  dailyMetrics: Record<string, Record<string, number>>;
}): Promise<void> => {
  const db = getDb();
  const updatedAt = nowIso();
  await db.collection('admin_user_analytics').doc(params.userId).set({
    userId: params.userId,
    analyticsVersion: ADMIN_ANALYTICS_VERSION,
    backfilledAt: updatedAt,
    tripCount: params.tripCount,
    metrics: params.totalMetrics,
    updatedAt,
  }, { merge: true });

  const entries = Object.entries(params.dailyMetrics);
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    for (const [dayKey, metrics] of entries.slice(i, i + 400)) {
      batch.set(
        db.collection('admin_user_analytics_daily').doc(getAdminAnalyticsDailyDocId(params.userId, dayKey)),
        {
          userId: params.userId,
          dayKey,
          analyticsVersion: ADMIN_ANALYTICS_VERSION,
          metrics,
          updatedAt,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
};

const backfillAdminAnalyticsForUser = async (userId: string): Promise<void> => {
  const db = getDb();
  const [usageEventsSnap, groupsSnap, membershipsSnap] = await Promise.all([
    db.collection('usage_events').where('userId', '==', userId).get(),
    db.collection('groups').where('ownerId', '==', userId).get(),
    db.collection('group_members').where('userId', '==', userId).where('removedAt', '==', null).get(),
  ]);

  const totalMetrics: Record<string, number> = {};
  const dailyMetrics: Record<string, Record<string, number>> = {};
  for (const doc of usageEventsSnap.docs) {
    const data = doc.data() as any;
    const metricKey = String(data.metricKey ?? '').trim();
    if (!metricKey) continue;
    const amount = Number(data.amount ?? 0);
    const createdAt = String(data.createdAt ?? nowIso());
    const dayKey = getDayKey(createdAt);
    totalMetrics[metricKey] = (totalMetrics[metricKey] ?? 0) + amount;
    dailyMetrics[dayKey] = dailyMetrics[dayKey] ?? {};
    dailyMetrics[dayKey][metricKey] = (dailyMetrics[dayKey][metricKey] ?? 0) + amount;
  }

  const groupIds = Array.from(new Set([
    ...groupsSnap.docs.map((doc) => doc.id),
    ...membershipsSnap.docs.map((doc) => String((doc.data() as any)?.groupId ?? '').trim()).filter(Boolean),
  ]));
  const tripIds = new Set<string>();
  for (const groupId of groupIds) {
    const tripsSnap = await db.collection('trips').where('groupId', '==', groupId).get();
    tripsSnap.docs.forEach((doc) => tripIds.add(doc.id));
  }

  await writeAdminUserAnalyticsBackfill({
    userId,
    tripCount: tripIds.size,
    totalMetrics,
    dailyMetrics,
  });
};

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
      // Prevent firebase-admin from trying ADC via a local credentials file when we explicitly target the emulator.
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS_FILE;
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

  // Seed tiers (skip if already present)
  const tierSeeds: Array<{ key: string; displayName: string; rank: number }> = [
    { key: 'free',    displayName: 'Free',    rank: 1 },
    { key: 'premium', displayName: 'Premium', rank: 2 },
    { key: 'pro',     displayName: 'Pro',     rank: 3 },
  ];
  for (const tier of tierSeeds) {
    const ref = db.collection('tiers').doc(tier.key);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ key: tier.key, displayName: tier.displayName, rank: tier.rank, isActive: true, createdAt: nowIso() });
      logInfo(`[db.firebase] Seeded tier: ${tier.key}`);
    }
  }

  // Seed features (skip if already present)
  const featureSeeds: Array<{ key: string; description: string }> = [
    { key: 'ai_itinerary_generation', description: 'AI-powered itinerary generation' },
    { key: 'csv_export',              description: 'Export cost reports as CSV' },
    { key: 'car_rentals',             description: 'Car rental tracking' },
    { key: 'trip_sharing',            description: 'Share trips with other users' },
    { key: 'trip_following',          description: 'Follow trips as read-only observer' },
    { key: 'cost_tracking',           description: 'Expense and cost tracking' },
    { key: 'multiple_groups',         description: 'Create more than one group' },
    { key: 'trip_creation',           description: 'Create new trips' },
  ];
  for (const feature of featureSeeds) {
    const ref = db.collection('features').doc(feature.key);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ key: feature.key, description: feature.description, defaultEnabled: true, createdAt: nowIso() });
      logInfo(`[db.firebase] Seeded feature: ${feature.key}`);
    }
  }

  const tierEntitlementSeeds: Array<{ tierKey: string; featureKey: string; isAllowed: boolean }> = [
    { tierKey: 'free', featureKey: 'ai_itinerary_generation', isAllowed: true },
    { tierKey: 'free', featureKey: 'csv_export', isAllowed: true },
    { tierKey: 'free', featureKey: 'car_rentals', isAllowed: true },
    { tierKey: 'free', featureKey: 'trip_sharing', isAllowed: true },
    { tierKey: 'free', featureKey: 'trip_following', isAllowed: true },
    { tierKey: 'free', featureKey: 'cost_tracking', isAllowed: false },
    { tierKey: 'free', featureKey: 'multiple_groups', isAllowed: true },
    { tierKey: 'free', featureKey: 'trip_creation', isAllowed: true },
    { tierKey: 'premium', featureKey: 'cost_tracking', isAllowed: true },
    { tierKey: 'pro', featureKey: 'cost_tracking', isAllowed: true },
  ];
  for (const { tierKey, featureKey, isAllowed } of tierEntitlementSeeds) {
    const docId = `${tierKey}_${featureKey}`;
    const ref = db.collection('tier_entitlements').doc(docId);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ tierId: tierKey, featureId: featureKey, isAllowed, createdAt: nowIso() });
      logInfo(`[db.firebase] Seeded tier entitlement: ${tierKey}/${featureKey}`);
    }
  }

  // Seed tier limits (skip if already present)
  const tierLimitSeeds: Array<{ tierKey: string; limitKey: string; limitValue: number }> = [
    { tierKey: 'free',    limitKey: 'max_active_trips',                   limitValue: 3 },
    { tierKey: 'free',    limitKey: 'max_travelers_per_trip',             limitValue: 6 },
    { tierKey: 'free',    limitKey: 'ai_itinerary_generations_per_month', limitValue: 5 },
    { tierKey: 'premium', limitKey: 'max_active_trips',                   limitValue: 250 },
    { tierKey: 'premium', limitKey: 'max_travelers_per_trip',             limitValue: 200 },
    { tierKey: 'premium', limitKey: 'ai_itinerary_generations_per_month', limitValue: -1 },
    { tierKey: 'pro',     limitKey: 'max_active_trips',                   limitValue: 250 },
    { tierKey: 'pro',     limitKey: 'max_travelers_per_trip',             limitValue: 200 },
    { tierKey: 'pro',     limitKey: 'ai_itinerary_generations_per_month', limitValue: -1 },
  ];
  for (const { tierKey, limitKey, limitValue } of tierLimitSeeds) {
    const docId = `${tierKey}_${limitKey}`;
    const ref = db.collection('tier_limits').doc(docId);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ tierId: tierKey, limitKey, limitValue, createdAt: nowIso() });
      logInfo(`[db.firebase] Seeded tier limit: ${tierKey}/${limitKey}`);
    }
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
  const existing = await findUserByEmailDoc(normalized);
  if (existing) {
    const data = existing.data as User;
    return { id: existing.id, email: data.email, provider: data.provider, role: (data.role ?? 'user') as UserRole };
  }
  const id = randomUUID();
  const username = await generateUniqueUsername('', '', normalized);
  await db.collection('users').doc(id).set({
    email: normalized,
    username,
    provider,
    role: 'user',
    createdAt: nowIso(),
    emailVerified: true,
    emailVerifiedAt: nowIso(),
  });
  await upsertUserEmail(id, normalized, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
  return { id, email: normalized, provider, role: 'user' };
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
  const found = await findUserByEmailDoc(email);
  if (!found) return null;
  const data = found.data as User;
  return { id: found.id, email: data.email, username: data.username, provider: data.provider, role: (data.role ?? 'user') as UserRole };
};

export const findUserByIdentifier = async (identifier: string): Promise<User | null> => {
  const normalized = normalizeLoginIdentifier(identifier);
  if (!isEmailLikeIdentifier(normalized)) {
    const usersByUsername = await getDb().collection('users').where('username', '==', normalized).limit(1).get();
    if (usersByUsername.empty) return null;
    const doc = usersByUsername.docs[0];
    const data = doc.data() as User;
    return { id: doc.id, email: data.email, username: data.username, provider: data.provider, role: (data.role ?? 'user') as UserRole };
  }
  return findUserByEmail(normalized);
};

export const createWebUser = async (
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  usernameInput?: string
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
    const userDoc = await db.collection('users').doc(existingUser.id).get();
    const userData = userDoc.exists ? (userDoc.data() as any) : {};
    const username = userData.username ?? await generateUniqueUsername(firstName, lastName, normalizedEmail, usernameInput, existingUser.id);
    await db.collection('users').doc(existingUser.id).update({
      firstName,
      lastName,
      email: normalizedEmail,
      emailVerified: userData.emailVerified ?? false,
      username,
    });
    await upsertUserEmail(existingUser.id, normalizedEmail, {
      isPrimary: true,
      isVerified: Boolean(userData.emailVerified ?? false),
      verifiedAt: userData.emailVerifiedAt ?? null,
    });
    const updatedUserDoc = await db.collection('users').doc(existingUser.id).get();
    const updatedUserData = updatedUserDoc.exists ? (updatedUserDoc.data() as any) : {};
    return {
      id: existingUser.id,
      email: normalizedEmail,
      firstName,
      lastName,
      emailVerified: Boolean(updatedUserData.emailVerified),
    };
  }
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const username = await generateUniqueUsername(firstName, lastName, normalizedEmail, usernameInput);
  await db.collection('users').doc(id).set({
    email: normalizedEmail,
    username,
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
  await upsertUserEmail(id, normalizedEmail, { isPrimary: true, isVerified: false, verifiedAt: null });
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
  await upsertUserEmail(userId, normalizeEmail(email), { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
  return { requiresPasswordSetup: true };
};

export const verifyWebUserCredentials = async (
  identifier: string,
  password: string
): Promise<{ id: string; email: string; firstName: string; lastName: string; emailVerified?: boolean } | null> => {
  const db = getDb();
  const normalized = normalizeLoginIdentifier(identifier);
  let snapshot = db.collection('web_users').where('email', '==', normalized).limit(1);
  if (!isEmailLikeIdentifier(normalized)) {
    const userSnap = await db.collection('users').where('username', '==', normalized).limit(1).get();
    if (!userSnap.empty) {
      snapshot = db.collection('web_users').where(FieldPath.documentId(), '==', userSnap.docs[0].id).limit(1);
    }
  } else {
    const userEmailDoc = await getUserEmailDocRef(normalized).get();
    if (userEmailDoc.exists) {
      const linkedUserId = String((userEmailDoc.data() as any).userId ?? '').trim();
      if (linkedUserId) {
        snapshot = db.collection('web_users').where(FieldPath.documentId(), '==', linkedUserId).limit(1);
      }
    }
  }
  const snapshotResult = await snapshot.get();
  if (snapshotResult.empty) return null;
  const doc = snapshotResult.docs[0];
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
  const emails = await listStoredUserEmails(userId);
  const primary = emails.find((email) => email.isPrimary) ?? emails[0];
  if (primary) {
    await getUserEmailDocRef(primary.email).set({
      isVerified: true,
      verifiedAt: nowIso(),
      updatedAt: nowIso(),
    }, { merge: true });
  }
};

export const listUserEmails = async (userId: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>> => {
  const stored = await listStoredUserEmails(userId);
  if (stored.length) {
    return stored.map(({ email, isPrimary, isVerified }) => ({ email, isPrimary, isVerified }));
  }
  const db = getDb();
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return [];
  const email = String((userDoc.data() as any).email ?? '').trim().toLowerCase();
  if (!email) return [];
  const isVerified = Boolean((userDoc.data() as any).emailVerified ?? true);
  await upsertUserEmail(userId, email, { isPrimary: true, isVerified, verifiedAt: isVerified ? nowIso() : null });
  return [{ email, isPrimary: true, isVerified }];
};

export const addUserEmail = async (userId: string, email: string): Promise<{ email: string; isPrimary: boolean; isVerified: boolean }> => {
  const normalizedEmail = normalizeEmail(email);
  const existing = await getUserEmailDocRef(normalizedEmail).get();
  if (existing.exists && String((existing.data() as any).userId ?? '') !== userId) {
    const err: any = new Error('Email is already associated with another account');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  await upsertUserEmail(userId, normalizedEmail, { isPrimary: false, isVerified: false, verifiedAt: null });
  return { email: normalizedEmail, isPrimary: false, isVerified: false };
};

export const createUserEmailVerification = async (
  userId: string,
  email: string,
  ttlHours = 24
): Promise<{ token: string; expiresAt: string }> => {
  const normalizedEmail = normalizeEmail(email);
  const emailDoc = await getUserEmailDocRef(normalizedEmail).get();
  if (!emailDoc.exists || String((emailDoc.data() as any).userId ?? '') !== userId) {
    const err: any = new Error('Email is not associated with this account');
    err.code = 'EMAIL_NOT_FOUND';
    throw err;
  }
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await db.collection('user_email_verifications').doc(randomUUID()).set({
    userId,
    email: normalizedEmail,
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
  const normalizedEmail = normalizeEmail(_email);
  const emailDoc = await getUserEmailDocRef(normalizedEmail).get();
  if (!emailDoc.exists || String((emailDoc.data() as any).userId ?? '') !== userId) return;
  await emailDoc.ref.set({
    isVerified: true,
    verifiedAt: nowIso(),
    updatedAt: nowIso(),
  }, { merge: true });
};

export const setPrimaryUserEmail = async (userId: string, email: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>> => {
  const normalizedEmail = normalizeEmail(email);
  const emailDoc = await getUserEmailDocRef(normalizedEmail).get();
  const data = emailDoc.exists ? (emailDoc.data() as any) : null;
  if (!data || String(data.userId ?? '') !== userId || !data.isVerified) {
    const err: any = new Error('Email must be linked and verified before it can be set as primary');
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }
  await upsertUserEmail(userId, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: data.verifiedAt ?? nowIso() });
  await getDb().collection('users').doc(userId).set({
    email: normalizedEmail,
    emailVerified: true,
    emailVerifiedAt: data.verifiedAt ?? nowIso(),
  }, { merge: true });
  await getDb().collection('web_users').doc(userId).set({ email: normalizedEmail }, { merge: true });
  return listUserEmails(userId);
};

export const removeUserEmail = async (userId: string, email: string): Promise<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>> => {
  const normalizedEmail = normalizeEmail(email);
  const emailDoc = await getUserEmailDocRef(normalizedEmail).get();
  const data = emailDoc.exists ? (emailDoc.data() as any) : null;
  if (!data || String(data.userId ?? '') !== userId) {
    const err: any = new Error('Email not found on this account');
    err.code = 'EMAIL_NOT_FOUND';
    throw err;
  }
  if (data.isPrimary) {
    const err: any = new Error('Primary email cannot be deleted');
    err.code = 'PRIMARY_EMAIL_IMMUTABLE';
    throw err;
  }
  const emails = await listStoredUserEmails(userId);
  const verifiedRemaining = emails.filter((entry) => entry.email !== normalizedEmail && entry.isVerified).length;
  if (data.isVerified && verifiedRemaining === 0) {
    const err: any = new Error('At least one verified email must remain on this account');
    err.code = 'LAST_VERIFIED_EMAIL_REQUIRED';
    throw err;
  }
  await emailDoc.ref.delete();
  return listUserEmails(userId);
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
    const err: any = new Error('Invalid password');
    err.code = 'INVALID_PASSWORD';
    throw err;
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
  const [
    memberships,
    invites,
    groupAccess,
    tripAccess,
    tripFollowers,
    tripRemovals,
    userEmails,
  ] = await Promise.all([
    db.collection('group_members').where('userId', '==', userId).get(),
    db.collection('group_invites').where('inviteeUserId', '==', userId).get(),
    db.collection('group_access').where('userId', '==', userId).get(),
    db.collection('trip_access').where('userId', '==', userId).get(),
    db.collection('trip_followers').where('followerUserId', '==', userId).get(),
    db.collection('trip_removals').where('userId', '==', userId).get(),
    db.collection('user_emails').where('userId', '==', userId).get(),
  ]);
  const refs = [
    db.collection('users').doc(userId),
    db.collection('web_users').doc(userId),
    ...memberships.docs.map((doc) => doc.ref),
    ...invites.docs.map((doc) => doc.ref),
    ...groupAccess.docs.map((doc) => doc.ref),
    ...tripAccess.docs.map((doc) => doc.ref),
    ...tripFollowers.docs.map((doc) => doc.ref),
    ...tripRemovals.docs.map((doc) => doc.ref),
    ...userEmails.docs.map((doc) => doc.ref),
  ];
  await deleteDocRefsInBatches(refs);
};

export const deleteAllUsers = async (userIds: string[]): Promise<void> => {
  for (const userId of userIds) {
    await deleteWebUserAndCleanup(userId);
  }
};

// Helpers
const ensureMembership = async (groupId: string, userId: string): Promise<boolean> => {
  const db = getDb();
  const projected = await db.collection('group_access').doc(getGroupAccessDocId(groupId, userId)).get();
  if (!projected.exists) return false;
  const access = projected.data() as any;
  return access.status === 'active' && access.canRead === true;
};

const listReadableGroupIdsForUser = async (userId: string): Promise<string[]> => {
  const db = getDb();
  const snap = await db.collection('group_access').where('userId', '==', userId).get();
  return Array.from(
    new Set(
      snap.docs
        .map((doc) => doc.data() as any)
        .filter((data) => data.status === 'active' && data.canRead === true)
        .map((data) => String(data.groupId ?? '').trim())
        .filter(Boolean)
    )
  );
};

const listReadableTripIdsForUser = async (userId: string): Promise<string[]> => {
  const db = getDb();
  const snap = await db.collection('trip_access').where('userId', '==', userId).get();
  return Array.from(
    new Set(
      snap.docs
        .map((doc) => doc.data() as any)
        .filter((data) => data.status === 'active' && data.canRead === true)
        .map((data) => String(data.tripId ?? '').trim())
        .filter(Boolean)
    )
  );
};

const listWritableTripIdsForUser = async (userId: string): Promise<string[]> => {
  const db = getDb();
  const snap = await db.collection('trip_access').where('userId', '==', userId).get();
  return Array.from(
    new Set(
      snap.docs
        .map((doc) => doc.data() as any)
        .filter((data) => data.status === 'active' && data.canWrite === true)
        .map((data) => String(data.tripId ?? '').trim())
        .filter(Boolean)
    )
  );
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
  const userRecords = new Map<string, any>();
  const userProfiles = new Map<string, any>();
  if (userIds.length) {
    const userRefs = userIds.map((id) => db.collection('users').doc(id));
    const userSnaps = await db.getAll(...userRefs);
    userSnaps.forEach((doc) => {
      if (doc.exists) {
        userRecords.set(doc.id, doc.data() as any);
      }
    });
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
    const userRefs = allProfileIds.map((id) => db.collection('users').doc(id));
    const userSnaps = await db.getAll(...userRefs);
    userSnaps.forEach((doc) => {
      if (doc.exists) {
        userRecords.set(doc.id, doc.data() as any);
      }
    });
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
    const userRecord = resolvedUserId ? userRecords.get(resolvedUserId) : null;
    const normalizedInvite = data.inviteEmail ? normalizeEmail(data.inviteEmail) : '';
    const inviteProfile = normalizedInvite ? emailProfiles.get(normalizedInvite) : null;
    const email = data.inviteEmail ?? profile?.email ?? userRecord?.email ?? inviteProfile?.email ?? data.email;
    const result = {
      id: doc.id,
      userId: resolvedUserId,
      guestName: data.guestName ?? null,
      email,
      userEmail: userRecord?.email ?? profile?.email ?? null,
      firstName: data.firstName ?? profile?.firstName ?? userRecord?.firstName ?? inviteProfile?.firstName ?? null,
      lastName: data.lastName ?? profile?.lastName ?? userRecord?.lastName ?? inviteProfile?.lastName ?? null,
      preferredAirport: profile?.preferredAirport ?? inviteProfile?.preferredAirport ?? null,
      isGroupOwner: Boolean(resolvedUserId && groupOwnerId && resolvedUserId === groupOwnerId),
      status: data.userId ? 'active' : data.inviteEmail ? 'pending' : 'active',
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
      const userRecord = resolvedUserId ? userRecords.get(resolvedUserId) : null;
      return {
        id: d.id,
        guestName: data.inviteeEmail,
        email: data.inviteeEmail,
        userId: resolvedUserId ?? null,
        userEmail: userRecord?.email ?? profile?.email ?? null,
        firstName: profile?.firstName ?? userRecord?.firstName ?? null,
        lastName: profile?.lastName ?? userRecord?.lastName ?? null,
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
  const groupIds = await listReadableGroupIdsForUser(userId);
  if (!groupIds.length) return [];
  const groupsSnap = await db.collection('groups').where(FieldPath.documentId(), 'in', groupIds).get();
  const groups = await Promise.all(groupsSnap.docs.map(async (g) => {
    const data = g.data() as any;
    const members = await listGroupMembers(g.id, userId).catch(() => []);
    const invitesSnap = await db.collection('group_invites').where('groupId', '==', g.id).where('status', '==', 'pending').get();
    return {
      id: g.id,
      ownerId: data.ownerId,
      name: data.name,
      createdAt: data.createdAt,
      members,
      invites: invitesSnap.docs.map((doc) => {
        const invite = doc.data() as any;
        return { id: doc.id, inviteeEmail: invite.inviteeEmail, status: invite.status };
      }),
    };
  }));
  groups.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return groups;
};

export const addGroupMember = async (
  ownerId: string,
  groupId: string,
  member: { email?: string; guestName?: string; firstName?: string; lastName?: string }
): Promise<{ inviteId?: string; email?: string }> => {
  const db = getDb();
  const groupDoc = await db.collection('groups').doc(groupId).get();
  if (!groupDoc.exists) throw new Error('Group not found or not a member');
  const isOwner = groupDoc.data()?.ownerId === ownerId;
  if (!isOwner) {
    const memberSnap = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('userId', '==', ownerId)
      .where('removedAt', '==', null)
      .limit(1)
      .get();
    if (memberSnap.empty) throw new Error('Group not found or not a member');
  }

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
    await rebuildGroupAccessForGroup(groupId);
    if (user?.id) {
      await rebuildTripAccessForGroup(groupId);
    }
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
    await rebuildGroupAccessForGroup(groupId);
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
  const removedMemberUserId = String((memberDoc.data() as any)?.userId ?? '').trim();
  await db.collection('group_members').doc(memberId).set({ removedAt: nowIso() }, { merge: true });
  if (removedMemberUserId) {
    const visibleTrips = await countVisibleTripsForUserInGroup(removedMemberUserId, groupId);
    if (visibleTrips > 0) {
      await incrementAdminUserTripCount(removedMemberUserId, -visibleTrips);
    }
  }
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
  await rebuildGroupAccessForGroup(groupId);
  await rebuildTripAccessForGroup(groupId);
};

export const removeGroupInvite = async (ownerId: string, inviteId: string): Promise<void> => {
  const db = getDb();
  const invite = await db.collection('group_invites').doc(inviteId).get();
  if (!invite.exists) return;
  const data = invite.data() as any;
  const group = await db.collection('groups').doc(data.groupId).get();
  if (!group.exists || group.data()?.ownerId !== ownerId) throw new Error('Not authorized');
  await db.collection('group_invites').doc(inviteId).delete();
  await rebuildGroupAccessForGroup(String(data.groupId ?? ''));
};

export const deleteGroup = async (ownerId: string, groupId: string): Promise<void> => {
  const db = getDb();
  const group = await db.collection('groups').doc(groupId).get();
  if (!group.exists || group.data()?.ownerId !== ownerId) throw new Error('Group not found or not owner');
  const activeUserIds = await listActiveGroupUserIds(groupId);
  const visibleTripCounts = new Map<string, number>();
  await Promise.all(
    activeUserIds.map(async (userId) => {
      visibleTripCounts.set(userId, await countVisibleTripsForUserInGroup(userId, groupId));
    })
  );
  const members = await db.collection('group_members').where('groupId', '==', groupId).get();
  const invites = await db.collection('group_invites').where('groupId', '==', groupId).get();
  const trips = await db.collection('trips').where('groupId', '==', groupId).get();
  await deleteDocRefsInBatches([
    group.ref,
    ...members.docs.map((doc) => doc.ref),
    ...invites.docs.map((doc) => doc.ref),
    ...trips.docs.map((doc) => doc.ref),
  ]);
  await clearGroupAccessForGroup(groupId);
  await Promise.all(trips.docs.map((doc) => clearTripAccessForTrip(doc.id)));
  await Promise.all(
    Array.from(visibleTripCounts.entries())
      .filter(([, tripCount]) => tripCount > 0)
      .map(([userId, tripCount]) => incrementAdminUserTripCount(userId, -tripCount))
  );
};

export const listTrips = async (userId: string): Promise<Array<Trip & { groupName: string }>> => {
  const db = getDb();
  const tripIds = await listReadableTripIdsForUser(userId);
  if (!tripIds.length) return [];
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };
  const tripDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const ids of chunk(tripIds)) {
    const trips = await db.collection('trips').where(FieldPath.documentId(), 'in', ids).get();
    tripDocs.push(...trips.docs);
  }
  const groupIds = Array.from(new Set(tripDocs.map((doc) => String((doc.data() as any).groupId ?? '').trim()).filter(Boolean)));
  const groups = groupIds.length ? await db.collection('groups').where(FieldPath.documentId(), 'in', groupIds).get() : { docs: [] as any[] };
  const groupNames = Object.fromEntries(groups.docs.map((g) => [g.id, g.data().name]));
  return tripDocs
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
  await rebuildTripAccessForTrip(id);
  const activeUserIds = await listActiveGroupUserIds(groupId);
  await Promise.all(activeUserIds.map((memberUserId) => incrementAdminUserTripCount(memberUserId, 1, payload.createdAt)));
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
    await clearTripAccessForTrip(tripId);
    await incrementAdminUserTripCount(userId, -1);
    return;
  }

  if (!alreadyRemoved) {
    await db.collection('trip_removals').doc(randomUUID()).set({
      tripId,
      userId,
      memberId: memberDoc.id,
      createdAt: nowIso(),
    });
    await incrementAdminUserTripCount(userId, -1);
  }

  await removeMemberFromTripData(tripId, memberDoc.id);
  await rebuildTripAccessForTrip(tripId);
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
  const [oldActiveUserIds, newActiveUserIds] = await Promise.all([
    listActiveGroupUserIds(data.groupId),
    listActiveGroupUserIds(newGroupId),
  ]);
  await db.collection('trips').doc(tripId).update({ groupId: newGroupId });
  await rebuildGroupAccessForGroup(String(data.groupId ?? ''));
  await rebuildGroupAccessForGroup(newGroupId);
  await rebuildTripAccessForTrip(tripId);
  const oldSet = new Set(oldActiveUserIds);
  const newSet = new Set(newActiveUserIds);
  await Promise.all([
    ...oldActiveUserIds
      .filter((memberUserId) => !newSet.has(memberUserId))
      .map((memberUserId) => incrementAdminUserTripCount(memberUserId, -1)),
    ...newActiveUserIds
      .filter((memberUserId) => !oldSet.has(memberUserId))
      .map((memberUserId) => incrementAdminUserTripCount(memberUserId, 1)),
  ]);
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
  await rebuildGroupAccessForGroup(groupId);
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
  await rebuildGroupAccessForGroup(String(data.groupId ?? ''));
  await rebuildTripAccessForGroup(String(data.groupId ?? ''));
  const tripCount = await countVisibleTripsForUserInGroup(userId, data.groupId);
  if (tripCount > 0) {
    await incrementAdminUserTripCount(userId, tripCount);
  }
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

  const resolvedMemberUserId = String((memberDoc?.data() as any)?.userId ?? '').trim();
  if (resolvedMemberUserId) {
    const visibleTrips = await countVisibleTripsForUserInGroup(resolvedMemberUserId, groupId);
    if (visibleTrips > 0) {
      await incrementAdminUserTripCount(resolvedMemberUserId, -visibleTrips);
    }
  }

  await db.collection('group_invites').doc(inviteId).delete();
  await rebuildGroupAccessForGroup(String(groupId ?? ''));
  await rebuildTripAccessForGroup(String(groupId ?? ''));
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
  const projected = await db.collection('trip_access').doc(getTripAccessDocId(tripId, userId)).get();
  if (!projected.exists) return null;
  const access = projected.data() as any;
  if (access.status === 'active' && access.canWrite === true) {
    return { groupId: String(access.groupId ?? '') };
  }
  return null;
};

export const ensureUserCanReadTrip = async (
  tripId: string,
  userId: string
): Promise<{ groupId: string; access: 'member' | 'follower' } | null> => {
  const db = getDb();
  const projected = await db.collection('trip_access').doc(getTripAccessDocId(tripId, userId)).get();
  if (!projected.exists) return null;
  const access = projected.data() as any;
  if (access.status === 'active' && access.canRead === true) {
    return {
      groupId: String(access.groupId ?? ''),
      access: access.canWrite === true ? 'member' : 'follower',
    };
  }
  return null;
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
    .get();
  const activeExisting = existing.docs
    .map((doc) => ({ doc, data: doc.data() as any }))
    .filter(({ data }) => data.status === 'active' && !data.revokedAt && (!data.expiresAt || new Date(data.expiresAt).getTime() > Date.now()))
    .sort((left, right) => String(right.data.createdAt ?? '').localeCompare(String(left.data.createdAt ?? '')))[0];
  if (activeExisting) {
    const doc = activeExisting.doc;
    const data = activeExisting.data;
    const id = String(data.code ?? doc.id);
    return {
      id,
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

const getTripOwnerContextFirebase = async (
  tripId: string,
  userId: string
): Promise<{ tripId: string; groupId: string; ownerId: string } | null> => {
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) return null;
  const trip = tripDoc.data() as any;
  const groupId = String(trip.groupId ?? '').trim();
  if (!groupId) return null;
  const groupDoc = await db.collection('groups').doc(groupId).get();
  if (!groupDoc.exists) return null;
  const ownerId = String((groupDoc.data() as any).ownerId ?? '').trim();
  if (!ownerId || ownerId !== userId) return null;
  return { tripId, groupId, ownerId };
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
  const db = getDb();
  const context = await getTripOwnerContextFirebase(tripId, userId);
  if (!context) throw new Error('Not authorized to manage trip sharing');
  const rows = await db.collection('trip_share_invites').where('tripId', '==', tripId).get();
  return rows.docs
    .map((doc) => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        tripId: String(data.tripId ?? tripId),
        inviteeEmail: String(data.inviteeEmail ?? ''),
        inviteeUserId: data.inviteeUserId ? String(data.inviteeUserId) : null,
        role: (data.role === 'member' ? 'member' : 'follower') as 'member' | 'follower',
        status: (data.status ?? 'pending') as 'pending' | 'accepted' | 'revoked' | 'expired',
        expiresAt: data.expiresAt ? String(data.expiresAt) : null,
        acceptedAt: data.acceptedAt ? String(data.acceptedAt) : null,
        createdAt: String(data.createdAt ?? nowIso()),
        updatedAt: String(data.updatedAt ?? data.createdAt ?? nowIso()),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
  const db = getDb();
  const context = await getTripOwnerContextFirebase(tripId, inviterId);
  if (!context) throw new Error('Not authorized to manage trip sharing');
  const email = normalizeEmail(inviteeEmailRaw);

  const existingInvites = await db.collection('trip_share_invites').where('tripId', '==', tripId).get();
  const duplicate = existingInvites.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .find((invite) =>
      normalizeEmail(String(invite.inviteeEmail ?? '')) === email &&
      String(invite.role ?? 'follower') === role &&
      String(invite.status ?? 'pending') === 'pending' &&
      !invite.revokedAt
    );
  if (duplicate) {
    return {
      invite: {
        id: duplicate.id,
        tripId: String(duplicate.tripId ?? tripId),
        inviteeEmail: String(duplicate.inviteeEmail ?? email),
        inviteeUserId: duplicate.inviteeUserId ? String(duplicate.inviteeUserId) : null,
        role,
        status: 'pending',
        createdAt: String(duplicate.createdAt ?? nowIso()),
      },
      autoApplied: false,
    };
  }

  const matchedUser = await findUserByEmail(email);
  const userId = matchedUser?.id ?? null;
  const token = generateTripShareToken();
  const inviteId = randomUUID();
  const createdAt = nowIso();
  const payload = {
    tripId,
    groupId: context.groupId,
    inviterId,
    inviteeUserId: userId,
    inviteeEmail: email,
    role,
    status: 'pending',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + Math.max(1, expiresInDays) * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
  await db.collection('trip_share_invites').doc(inviteId).set(payload);
  return {
    invite: {
      id: inviteId,
      tripId,
      inviteeEmail: email,
      inviteeUserId: userId,
      role,
      status: 'pending',
      createdAt,
    },
    token,
    autoApplied: false,
  };
};

export const acceptTripShareInvite = async (
  userId: string,
  emailRaw: string,
  token: string
): Promise<{ tripId: string; role: 'member' | 'follower' }> => {
  const db = getDb();
  const email = normalizeEmail(emailRaw);
  const tokenHash = hashToken(token);
  const matches = await db.collection('trip_share_invites').where('tokenHash', '==', tokenHash).limit(1).get();
  if (matches.empty) throw new Error('Invite not found');
  const inviteDoc = matches.docs[0]!;
  const invite = inviteDoc.data() as any;
  if (String(invite.status ?? 'pending') !== 'pending') throw new Error('Invite is no longer pending');
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
    await inviteDoc.ref.set({ status: 'expired', updatedAt: nowIso() }, { merge: true });
    throw new Error('Invite has expired');
  }
  if (normalizeEmail(String(invite.inviteeEmail ?? '')) !== email) throw new Error('Invite email does not match this account');

  const tripId = String(invite.tripId ?? '').trim();
  const groupId = String(invite.groupId ?? '').trim();
  const role = (invite.role === 'member' ? 'member' : 'follower') as 'member' | 'follower';
  if (!tripId || !groupId) throw new Error('Invite not found');

  if (role === 'member') {
    const activeMember = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (activeMember.empty) {
      await db.collection('group_members').doc(randomUUID()).set({
        groupId,
        userId,
        addedBy: invite.inviterId ?? null,
        createdAt: nowIso(),
        removedAt: null,
      });
    } else {
      await activeMember.docs[0]!.ref.set({ removedAt: null }, { merge: true });
    }
    const followers = await db
      .collection('trip_followers')
      .where('tripId', '==', tripId)
      .where('followerUserId', '==', userId)
      .get();
    for (const doc of followers.docs) {
      await doc.ref.delete();
    }
  } else {
    const activeMember = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (activeMember.empty) {
      const follower = await db
        .collection('trip_followers')
        .where('tripId', '==', tripId)
        .where('followerUserId', '==', userId)
        .limit(1)
        .get();
      if (follower.empty) {
        await db.collection('trip_followers').doc(randomUUID()).set({
          tripId,
          followerUserId: userId,
          role: 'follower',
          followCodeId: null,
          createdAt: nowIso(),
          lastViewedAt: null,
        });
      }
    }
  }

  await inviteDoc.ref.set(
    {
      status: 'accepted',
      inviteeUserId: userId,
      acceptedAt: nowIso(),
      updatedAt: nowIso(),
    },
    { merge: true }
  );
  await rebuildTripAccessForTrip(tripId);
  return { tripId, role };
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
  const db = getDb();
  const email = normalizeEmail(emailRaw ?? '');
  const invites = await db.collection('trip_share_invites').get();
  const results: Array<{
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
  }> = [];
  for (const doc of invites.docs) {
    const data = doc.data() as any;
    const inviteeEmail = normalizeEmail(String(data.inviteeEmail ?? ''));
    if (String(data.status ?? 'pending') !== 'pending' || data.revokedAt) continue;
    if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) continue;
    if (String(data.inviteeUserId ?? '') !== userId && (!email || inviteeEmail !== email)) continue;
    const tripId = String(data.tripId ?? '').trim();
    if (!tripId) continue;
    const tripDoc = await db.collection('trips').doc(tripId).get();
    if (!tripDoc.exists) continue;
    const tripData = tripDoc.data() as any;
    const inviterId = String(data.inviterId ?? '').trim();
    let inviterEmail: string | null = null;
    let inviterFirstName: string | null = null;
    let inviterLastName: string | null = null;
    if (inviterId) {
      const inviterUserDoc = await db.collection('users').doc(inviterId).get();
      inviterEmail = inviterUserDoc.exists ? String((inviterUserDoc.data() as any)?.email ?? '') || null : null;
      const inviterProfileDoc = await db.collection('web_users').doc(inviterId).get();
      if (inviterProfileDoc.exists) {
        const inviterProfile = inviterProfileDoc.data() as any;
        inviterFirstName = inviterProfile.firstName ? String(inviterProfile.firstName) : null;
        inviterLastName = inviterProfile.lastName ? String(inviterProfile.lastName) : null;
      }
    }
    results.push({
      id: doc.id,
      tripId,
      tripName: String(tripData.name ?? 'Trip'),
      destination: tripData.destination ?? null,
      inviteeEmail: String(data.inviteeEmail ?? ''),
      role: data.role === 'member' ? 'member' : 'follower',
      status: 'pending',
      createdAt: String(data.createdAt ?? nowIso()),
      expiresAt: data.expiresAt ? String(data.expiresAt) : null,
      inviterEmail,
      inviterFirstName,
      inviterLastName,
    });
  }
  return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

export const acceptTripShareInviteById = async (
  userId: string,
  emailRaw: string,
  inviteId: string
): Promise<{ tripId: string; role: 'member' | 'follower' }> => {
  const db = getDb();
  const email = normalizeEmail(emailRaw);
  const inviteDoc = await db.collection('trip_share_invites').doc(inviteId).get();
  if (!inviteDoc.exists) throw new Error('Invite not found');
  const invite = inviteDoc.data() as any;
  if (String(invite.status ?? 'pending') !== 'pending') throw new Error('Invite is no longer pending');
  if (invite.revokedAt) throw new Error('Invite is no longer pending');
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
    await inviteDoc.ref.set({ status: 'expired', updatedAt: nowIso() }, { merge: true });
    throw new Error('Invite has expired');
  }
  if (String(invite.inviteeUserId ?? '') !== userId && normalizeEmail(String(invite.inviteeEmail ?? '')) !== email) {
    throw new Error('Invite not found');
  }
  const tripId = String(invite.tripId ?? '').trim();
  const groupId = String(invite.groupId ?? '').trim();
  const role = (invite.role === 'member' ? 'member' : 'follower') as 'member' | 'follower';
  if (!tripId || !groupId) throw new Error('Invite not found');
  if (normalizeEmail(String(invite.inviteeEmail ?? '')) !== email) throw new Error('Invite email does not match this account');

  if (role === 'member') {
    const activeMember = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (activeMember.empty) {
      await db.collection('group_members').doc(randomUUID()).set({
        groupId,
        userId,
        addedBy: invite.inviterId ?? null,
        createdAt: nowIso(),
        removedAt: null,
      });
    } else {
      await activeMember.docs[0]!.ref.set({ removedAt: null }, { merge: true });
    }
    const followers = await db
      .collection('trip_followers')
      .where('tripId', '==', tripId)
      .where('followerUserId', '==', userId)
      .get();
    for (const doc of followers.docs) {
      await doc.ref.delete();
    }
  } else {
    const activeMember = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (activeMember.empty) {
      const follower = await db
        .collection('trip_followers')
        .where('tripId', '==', tripId)
        .where('followerUserId', '==', userId)
        .limit(1)
        .get();
      if (follower.empty) {
        await db.collection('trip_followers').doc(randomUUID()).set({
          tripId,
          followerUserId: userId,
          role: 'follower',
          followCodeId: null,
          createdAt: nowIso(),
          lastViewedAt: null,
        });
      }
    }
  }

  await inviteDoc.ref.set(
    {
      status: 'accepted',
      inviteeUserId: userId,
      acceptedAt: nowIso(),
      updatedAt: nowIso(),
    },
    { merge: true }
  );
  await rebuildTripAccessForTrip(tripId);
  return { tripId, role };
};

export const rejectTripShareInvite = async (userId: string, emailRaw: string, inviteId: string): Promise<void> => {
  const db = getDb();
  const email = normalizeEmail(emailRaw);
  const inviteDoc = await db.collection('trip_share_invites').doc(inviteId).get();
  if (!inviteDoc.exists) throw new Error('Invite not found');
  const invite = inviteDoc.data() as any;
  if (String(invite.status ?? 'pending') !== 'pending' || invite.revokedAt) throw new Error('Invite not found');
  if (String(invite.inviteeUserId ?? '') !== userId && normalizeEmail(String(invite.inviteeEmail ?? '')) !== email) {
    throw new Error('Invite not found');
  }
  await inviteDoc.ref.set({ status: 'revoked', revokedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
};

export const revokeTripShareInvite = async (userId: string, tripId: string, inviteId: string): Promise<void> => {
  const db = getDb();
  const context = await getTripOwnerContextFirebase(tripId, userId);
  if (!context) throw new Error('Not authorized to manage trip sharing');
  const inviteDoc = await db.collection('trip_share_invites').doc(inviteId).get();
  if (!inviteDoc.exists) return;
  const data = inviteDoc.data() as any;
  if (String(data.tripId ?? '') !== tripId) return;
  if (String(data.status ?? '') !== 'pending') return;
  await inviteDoc.ref.set({ status: 'revoked', revokedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
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
    await rebuildTripAccessForTrip(tripId);
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
      if (!inviterName) {
        const userDoc = await db.collection('users').doc(ownerId).get();
        inviterName = userDoc.exists ? ((userDoc.data() as any).email ?? null) : null;
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
    await rebuildTripAccessForTrip(tripId);
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
  const payload = stripUndefined({ ...flight, status: normalizeItineraryStatus((flight as any).status), id, createdAt: nowIso() });
  await db.collection('flights').doc(id).set(payload);
  const saved = await db.collection('flights').doc(id).get();
  return { ...flight, status: normalizeItineraryStatus((flight as any).status), id };
};

export const deleteFlight = async (flightId: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('flights').doc(flightId).get();
  if (!doc.exists) return;
  const data = doc.data() as any;
  const tripId = data.tripId ?? data.trip_id;
  if (!tripId) return;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to delete');
  await db.collection('flights').doc(flightId).delete();
};

export const updateFlight = async (flightId: string, userId: string, updates: Partial<Flight>): Promise<Flight | null> => {
  const db = getDb();
  const doc = await db.collection('flights').doc(flightId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  const tripId = (updates as any).tripId ?? (updates as any).trip_id ?? data.tripId ?? data.trip_id;
  if (!tripId) return null;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to update');
  const updatePayload = stripUndefined(updates);
  await db.collection('flights').doc(flightId).update(updatePayload);
  const updated = await db.collection('flights').doc(flightId).get();
  return { ...(updated.data() as Flight), status: normalizeItineraryStatus((updated.data() as any)?.status) };
};

export const getFlightForUser = async (flightId: string, userId: string): Promise<Flight | null> => {
  const doc = await getDb().collection('flights').doc(flightId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  const tripId = data.tripId ?? data.trip_id;
  if (!tripId) return null;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return null;
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
    allowedTripIds = await listReadableTripIdsForUser(userId);
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

export const getAirportByIataCode = async (iataCode: string): Promise<{ iataCode: string; name: string; city: string; country: string; lat: number | null; lng: number | null } | null> => {
  const db = getDb();
  const doc = await db.collection('airports').doc(iataCode.toUpperCase()).get().catch(() => null);
  if (!doc || !doc.exists) return null;
  const data = doc.data() as any;
  return { iataCode: doc.id, name: data.name ?? '', city: data.city ?? '', country: data.country ?? '', lat: data.lat ?? null, lng: data.lng ?? null };
};

export const searchFlightLocations = async (_userId: string, query: string): Promise<string[]> => {
  const db = getDb();
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const exactMatches = await db
    .collection('airports')
    .where('search', 'array-contains', normalized)
    .limit(15)
    .get()
    .catch(() => null);
  if (exactMatches && !exactMatches.empty) {
    const exactResults = exactMatches.docs.map((d) => d.data().label as string).filter(Boolean);
    if (exactResults.length >= 15) return exactResults;
    const fallbackResults = searchBundledAirportDataset(query, 15);
    return Array.from(new Set([...exactResults, ...fallbackResults])).slice(0, 15);
  }

  // Fallback for partial airport queries when Firestore only has exact search tokens.
  const airports = await db.collection('airports').get().catch(() => null);
  if (!airports || airports.empty) return searchBundledAirportDataset(query, 15);

  const matches = airports.docs
    .map((doc) => doc.data() as any)
    .map((data) => ({
      label: String(data.label ?? '').trim(),
      code: String(data.iata_code ?? '').trim().toLowerCase(),
      city: String(data.city ?? '').trim().toLowerCase(),
      name: String(data.name ?? '').trim().toLowerCase(),
    }))
    .filter((airport) =>
      airport.label.toLowerCase().includes(normalized) ||
      airport.code.includes(normalized) ||
      airport.city.includes(normalized) ||
      airport.name.includes(normalized)
    )
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, 15)
    .map((airport) => airport.label)
    .filter(Boolean);

  const fallbackResults = searchBundledAirportDataset(query, 15);
  return Array.from(new Set([...matches, ...fallbackResults])).slice(0, 15);
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

const normalizeLodgingRecord = (data: any) => ({
  ...data,
  userId: data.userId ?? data.user_id,
  tripId: data.tripId ?? data.trip_id,
  checkInDate: data.checkInDate ?? data.check_in_date,
  checkOutDate: data.checkOutDate ?? data.check_out_date,
  refundBy: data.refundBy ?? data.refund_by,
  totalCost: data.totalCost ?? data.total_cost ?? 0,
  costPerNight: data.costPerNight ?? data.cost_per_night ?? 0,
  paidBy: Array.isArray(data.paidBy) ? data.paidBy : Array.isArray(data.paid_by) ? data.paid_by : [],
  travelerIds: Array.isArray(data.travelerIds) ? data.travelerIds : Array.isArray(data.traveler_ids) ? data.traveler_ids : [],
  placeId: data.placeId ?? data.place_id ?? '',
  status: normalizeItineraryStatus(data.status),
});

const normalizeActivityRecord = (data: any) => ({
  ...data,
  userId: data.userId ?? data.user_id,
  tripId: data.tripId ?? data.trip_id,
  startLocation: data.startLocation ?? data.start_location,
  startTime: data.startTime ?? data.start_time,
  freeCancelBy: data.freeCancelBy ?? data.free_cancel_by ?? null,
  bookedOn: data.bookedOn ?? data.booked_on ?? '',
  paidBy: Array.isArray(data.paidBy) ? data.paidBy : [],
  travelerIds: Array.isArray(data.travelerIds) ? data.travelerIds : [],
  activityType: (data.activityType ?? 'Tour') as Activity['activityType'],
  status: normalizeItineraryStatus(data.status),
});

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
  // Use top-level destinationKey field for an indexed Firestore query
  // instead of loading 500 docs and filtering in-memory.
  const snapshot = await db
    .collection('locations')
    .where('sourceType', '==', 'attraction')
    .where('destinationKey', '==', key)
    .limit(safeLimit * 2)
    .get();
  const filtered = snapshot.docs
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
        // Top-level destinationKey for indexed Firestore compound queries
        destinationKey: String(entry.destinationKey ?? '').trim().toLowerCase(),
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
    return snapshot.docs.map((d) => normalizeLodgingRecord(d.data()));
  }

  const memberSnap = await db
    .collection('trip_access')
    .where('userId', '==', userId)
    .get();
  const uniqueTripIds = Array.from(new Set(
    memberSnap.docs
      .map((doc) => doc.data() as any)
      .filter((data) => data.status === 'active' && data.canRead === true)
      .map((data) => String(data.tripId ?? '').trim())
      .filter(Boolean)
  ));
  if (!uniqueTripIds.length) return [];

  const lodgings: Lodging[] = [];
  for (const tripChunk of chunk(uniqueTripIds)) {
    const lodgingsSnap = await db.collection('lodgings').where('trip_id', 'in', tripChunk).get();
    lodgingsSnap.docs.forEach((doc) => lodgings.push(normalizeLodgingRecord(doc.data()) as Lodging));
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
  if (Object.keys(updatePayload).length > 0) {
    await db.collection('lodgings').doc(lodgingId).update(updatePayload);
  }
  const updated = await db.collection('lodgings').doc(lodgingId).get();
  return normalizeLodgingRecord(updated.data()) as Lodging;
};

export const getLodgingById = async (lodgingId: string): Promise<Lodging | null> => {
  const doc = await getDb().collection('lodgings').doc(lodgingId).get();
  if (!doc.exists) return null;
  return normalizeLodgingRecord(doc.data()) as Lodging;
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
    return snapshot.docs.map((d) => normalizeActivityRecord(d.data()) as Activity);
  }
  const uniqueTripIds = await listReadableTripIdsForUser(userId);
  if (!uniqueTripIds.length) return [];
  const activities: Activity[] = [];
  for (const ids of chunk(uniqueTripIds)) {
    const snapshot = await db.collection('tours').where('tripId', 'in', ids).get();
    snapshot.docs.forEach((d) => activities.push(normalizeActivityRecord(d.data()) as Activity));
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
  if (Object.keys(updatePayload).length > 0) {
    await db.collection('tours').doc(id).update(updatePayload);
  }
  const updated = await db.collection('tours').doc(id).get();
  return normalizeActivityRecord(updated.data()) as Activity;
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
  return normalizeActivityRecord(doc.data()) as Activity;
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

  const uniqueTripIds = await listReadableTripIdsForUser(userId);
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

export const listTripPayments = async (userId: string, tripId: string): Promise<any[]> => {
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) return [];
  const db = getDb();
  const snapshot = await db.collection('trip_payments').where('tripId', '==', tripId).get();
  const rows = snapshot.docs.map((d) => d.data() as any);
  rows.sort((a, b) => {
    if (a.paymentDate !== b.paymentDate) return String(b.paymentDate).localeCompare(String(a.paymentDate));
    return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
  });
  return rows;
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
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(payment.tripId).get();
  const tripCurrency = (tripDoc.data() as any)?.currency ?? 'USD';
  const currency = payment.currency ?? tripCurrency ?? 'USD';
  const id = randomUUID();
  const payload = {
    id,
    tripId: payment.tripId,
    groupId: payment.groupId,
    recordedBy: payment.recordedBy,
    payerId: payment.payerId,
    receiverId: payment.receiverId,
    paymentDate: payment.paymentDate,
    amountCents: payment.amountCents,
    currency,
    notes: payment.notes ?? null,
    createdAt: nowIso(),
  };
  await db.collection('trip_payments').doc(id).set(payload);
  return payload;
};

export const deleteTripPayment = async (paymentId: string, userId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('trip_payments').doc(paymentId).get();
  if (!doc.exists) throw new Error('Payment not found');
  const data = doc.data() as any;
  const membership = await ensureUserInTrip(data.tripId, userId);
  if (!membership) throw new Error('Payment not found');
  await db.collection('trip_payments').doc(paymentId).delete();
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
  const [userSnap, webUserSnap, userEmailSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('web_users').get(),
    db.collection('user_emails').get(),
  ]);
  const webUsersById = new Map(webUserSnap.docs.map((doc) => [doc.id, doc.data()] as const));
  const userEmailsByUserId = new Map<string, string[]>();

  userEmailSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    const userId = String(data.userId ?? '');
    const email = String(data.email ?? '').toLowerCase();
    if (!userId || !email) return;
    const existing = userEmailsByUserId.get(userId) ?? [];
    existing.push(email);
    userEmailsByUserId.set(userId, existing);
  });

  return userSnap.docs
    .map((d) => {
      const user = d.data() as any;
      const webUser = webUsersById.get(d.id) as any;
      const haystack = [
        String(user.email ?? ''),
        String(user.firstName ?? ''),
        String(user.lastName ?? ''),
        String(webUser?.firstName ?? ''),
        String(webUser?.lastName ?? ''),
        ...(userEmailsByUserId.get(d.id) ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return { matches: haystack.includes(normalized), user: { id: d.id, ...user } as User };
    })
    .filter((entry) => entry.matches)
    .slice(0, 10)
    .map((entry) => entry.user);
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
  const db = getDb();
  const [requested, inboundPending] = await Promise.all([
    db.collection('family_relationships').where('requesterId', '==', userId).get(),
    db.collection('family_relationships').where('relativeId', '==', userId).where('status', '==', 'pending').get(),
  ]);
  const docs = [...requested.docs, ...inboundPending.docs];
  const otherUserIds = Array.from(
    new Set(
      docs
        .map((doc) => {
          const data = doc.data() as any;
          return data.requesterId === userId ? data.relativeId : data.requesterId;
        })
        .filter(Boolean)
    )
  );
  const users = new Map<string, any>();
  const webUsers = new Map<string, any>();
  if (otherUserIds.length) {
    const userDocs = await db.getAll(...otherUserIds.map((id) => db.collection('users').doc(id)));
    userDocs.forEach((doc) => {
      if (doc.exists) users.set(doc.id, doc.data() as any);
    });
    const webUserDocs = await db.getAll(...otherUserIds.map((id) => db.collection('web_users').doc(id)));
    webUserDocs.forEach((doc) => {
      if (doc.exists) webUsers.set(doc.id, doc.data() as any);
    });
  }
  return docs.map((doc) => {
    const data = doc.data() as any;
    const direction = data.requesterId === userId ? 'outbound' : 'inbound';
    const otherUserId = direction === 'outbound' ? data.relativeId : data.requesterId;
    const user = users.get(otherUserId) ?? {};
    const webUser = webUsers.get(otherUserId) ?? {};
    const provider = String(user.provider ?? '');
    return {
      id: doc.id,
      relationship: data.relationship,
      status: data.status,
      direction,
      editableProfile: direction === 'outbound' && provider === 'family',
      relative: {
        id: otherUserId,
        email: user.email ?? webUser.email ?? null,
        firstName: webUser.firstName ?? user.firstName ?? null,
        middleName: webUser.middleName ?? user.middleName ?? null,
        lastName: webUser.lastName ?? user.lastName ?? null,
        provider: provider || null,
      },
      createdAt: data.createdAt ?? nowIso(),
    };
  });
};

export const listFellowTravelers = async (ownerId: string) => {
  const docs = await getDb().collection('fellow_travelers').where('ownerId', '==', ownerId).get();
  return docs.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
};

export const createFellowTraveler = async (ownerId: string, firstName: string, lastName: string, email?: string | null) => {
  const id = randomUUID();
  const payload = { ownerId, firstName, lastName, email: String(email ?? '').trim().toLowerCase() || null, createdAt: nowIso() };
  await getDb().collection('fellow_travelers').doc(id).set(payload);
  return payload;
};

export const updateFellowTraveler = async (
  ownerId: string,
  travelerId: string,
  firstName: string,
  lastName: string,
  email?: string | null
) => {
  const doc = await getDb().collection('fellow_travelers').doc(travelerId).get();
  if (!doc.exists) throw new Error('Traveler not found');
  if ((doc.data() as any).ownerId !== ownerId) throw new Error('Not authorized');
  await getDb().collection('fellow_travelers').doc(travelerId).update({
    firstName,
    lastName,
    email: String(email ?? '').trim().toLowerCase() || null,
  });
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
  payloadOrEmail: { givenName: string; middleName?: string | null; familyName: string; email: string; relationship: string } | string,
  maybeRelationship?: string
) => {
  const payload = typeof payloadOrEmail === 'string'
    ? {
        givenName: '',
        familyName: '',
        middleName: null,
        email: payloadOrEmail,
        relationship: maybeRelationship ?? 'Not Applicable',
      }
    : payloadOrEmail;
  const given = String(payload.givenName ?? '').trim();
  const family = String(payload.familyName ?? '').trim();
  const rawEmail = String(payload.email ?? '').trim().toLowerCase();
  const relationship = String(payload.relationship ?? '').trim() || 'Not Applicable';
  if (!given || !family) {
    throw new Error('givenName and familyName are required');
  }

  let user = rawEmail ? await findUserByEmail(rawEmail) : null;
  if (user?.id === requesterId) {
    throw new Error('Cannot add yourself as a family member');
  }

  if (!user) {
    const id = randomUUID();
    const email = rawEmail || `family-${id}@placeholder.local`;
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(randomBytes(12).toString('hex'), salt);
    await getDb().collection('users').doc(id).set({
      email,
      username: await generateUniqueUsername(given, family, email),
      provider: 'family',
      firstName: given,
      lastName: family,
      role: 'user',
      createdAt: nowIso(),
      emailVerified: !rawEmail,
      emailVerifiedAt: rawEmail ? null : nowIso(),
    });
    await getDb().collection('web_users').doc(id).set({
      email,
      firstName: given,
      middleName: payload.middleName ?? null,
      lastName: family,
      passwordHash,
      salt,
      passwordSetupRequired: false,
      createdAt: nowIso(),
    }, { merge: true });
    await upsertUserEmail(id, email, { isPrimary: true, isVerified: !rawEmail, verifiedAt: !rawEmail ? nowIso() : null });
    user = { id, email, provider: 'family', role: 'user' };
  }
  const id = randomUUID();
  const status = rawEmail && user.provider !== 'family' ? 'pending' : 'accepted';
  await getDb().collection('family_relationships').doc(id).set({
    requesterId,
    relativeId: user.id,
    relationship,
    status,
    createdAt: nowIso(),
  });
  if (status === 'accepted') {
    await getDb().collection('family_relationships').doc(randomUUID()).set({
      requesterId: user.id,
      relativeId: requesterId,
      relationship,
      status: 'accepted',
      createdAt: nowIso(),
    });
  }
  return { id, requesterId, relativeId: user.id, relationship, status };
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
    await rebuildTripAccessForTrip(tripId);
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
  await rebuildTripAccessForTrip(tripId);
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
  const profileUpdates = stripUndefined({
    firstName: typeof updates.givenName === 'string' ? updates.givenName.trim() || undefined : undefined,
    middleName: typeof updates.middleName === 'undefined' ? undefined : updates.middleName,
    lastName: typeof updates.familyName === 'string' ? updates.familyName.trim() || undefined : undefined,
  });
  if (Object.keys(profileUpdates).length > 0) {
    await getDb().collection('users').doc(data.relativeId).set(profileUpdates, { merge: true });
    await getDb().collection('web_users').doc(data.relativeId).set(profileUpdates, { merge: true });
  }
  if (updates.email) {
    const normalized = normalizeEmail(updates.email);
    await getDb().collection('users').doc(data.relativeId).set({ email: normalized }, { merge: true });
    await getDb().collection('web_users').doc(data.relativeId).set({ email: normalized }, { merge: true });
    await upsertUserEmail(data.relativeId, normalized, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
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
        const currentData = doc.data() as any;
        const updateData = {
            email: normalizedEmail,
            picture: photos?.[0]?.value,
            firstName: name?.givenName,
            lastName: name?.familyName,
            emailVerified: true,
            emailVerifiedAt: nowIso(),
            username: currentData.username ?? await generateUniqueUsername(name?.givenName ?? '', name?.familyName ?? '', normalizedEmail, undefined, doc.id),
        };
        await doc.ref.update(updateData);
        await upsertUserEmail(doc.id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
        const updatedDoc = await doc.ref.get();
        const data = updatedDoc.data() as User;
        return { id: doc.id, email: data.email, provider: data.provider, role: (data.role ?? 'user') as UserRole };
    }

    const existingByEmail = await findUserByEmailDoc(normalizedEmail);
    if (existingByEmail) {
        const doc = db.collection('users').doc(existingByEmail.id);
        const currentData = existingByEmail.data as any;
        const updateData = {
            googleId: id,
            picture: photos?.[0]?.value,
            firstName: name?.givenName,
            lastName: name?.familyName,
            emailVerified: true,
            emailVerifiedAt: nowIso(),
            username: currentData.username ?? await generateUniqueUsername(name?.givenName ?? '', name?.familyName ?? '', normalizedEmail, undefined, existingByEmail.id),
        };
        await doc.set(updateData, { merge: true });
        await upsertUserEmail(existingByEmail.id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
        const updatedDoc = await doc.get();
        const data = updatedDoc.data() as User;
        return { id: existingByEmail.id, email: data.email, provider: data.provider, role: (data.role ?? 'user') as UserRole };
    }

    const newUserId = randomUUID();
    const username = await generateUniqueUsername(name?.givenName ?? '', name?.familyName ?? '', normalizedEmail);
    await db.collection('users').doc(newUserId).set({
        email: normalizedEmail,
        username,
        provider: 'google',
        googleId: id,
        picture: photos?.[0]?.value,
        firstName: name?.givenName,
        lastName: name?.familyName,
        emailVerified: true,
        emailVerifiedAt: nowIso(),
        createdAt: nowIso(),
    });
    await upsertUserEmail(newUserId, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });

    return { id: newUserId, email: normalizedEmail, provider: 'google', role: 'user' };
};

// ---- Entitlement system functions ----

export const getUserRole = async (userId: string): Promise<UserRole> => {
  const db = getDb();
  const doc = await db.collection('users').doc(userId).get();
  return ((doc.data()?.role as string) ?? 'user') as UserRole;
};

export const setUserRole = async (userId: string, role: UserRole): Promise<void> => {
  const db = getDb();
  await db.collection('users').doc(userId).update({ role });
};

export const listTiers = async (): Promise<Tier[]> => {
  const db = getDb();
  const snap = await db.collection('tiers').orderBy('rank').get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: data.id ?? d.id,
      key: d.id,
      displayName: data.displayName,
      rank: data.rank,
      isActive: data.isActive ?? true,
      createdAt: data.createdAt ?? nowIso(),
    };
  });
};

export const getTierByKey = async (key: string): Promise<Tier | null> => {
  const db = getDb();
  const doc = await db.collection('tiers').doc(key).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { id: data.id ?? doc.id, key: doc.id, displayName: data.displayName, rank: data.rank, isActive: data.isActive ?? true, createdAt: data.createdAt ?? nowIso() };
};

export const listFeatures = async (): Promise<Feature[]> => {
  const db = getDb();
  const snap = await db.collection('features').get();
  return snap.docs
    .map(d => {
      const data = d.data();
      return {
        id: data.id ?? d.id,
        key: data.key ?? d.id,
        description: data.description ?? '',
        defaultEnabled: data.defaultEnabled ?? false,
        createdAt: data.createdAt ?? nowIso(),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
};

export const listTierLimits = async (tierId: string): Promise<TierLimit[]> => {
  const db = getDb();
  const snap = await db.collection('tier_limits').where('tierId', '==', tierId).get();
  return snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, tierId: data.tierId, limitKey: data.limitKey, limitValue: data.limitValue, createdAt: data.createdAt ?? nowIso() };
  });
};

export const upsertTierLimit = async (tierId: string, limitKey: string, limitValue: number): Promise<void> => {
  const db = getDb();
  const docId = `${tierId}_${limitKey}`;
  await db.collection('tier_limits').doc(docId).set({ tierId, limitKey, limitValue, updatedAt: nowIso() }, { merge: true });
};

export const getTierLimitValue = async (tierId: string, limitKey: string): Promise<number | null> => {
  const db = getDb();
  const docId = `${tierId}_${limitKey}`;
  const doc = await db.collection('tier_limits').doc(docId).get();
  if (!doc.exists) return null;
  return doc.data()!.limitValue ?? null;
};

export const listTierEntitlements = async (tierId: string): Promise<TierEntitlement[]> => {
  const db = getDb();
  const snap = await db.collection('tier_entitlements').where('tierId', '==', tierId).get();
  return snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, tierId: data.tierId, featureId: data.featureId, isAllowed: data.isAllowed, createdAt: data.createdAt ?? nowIso() };
  });
};

export const upsertTierEntitlement = async (tierId: string, featureId: string, isAllowed: boolean): Promise<void> => {
  const db = getDb();
  const docId = `${tierId}_${featureId}`;
  await db.collection('tier_entitlements').doc(docId).set({ tierId, featureId, isAllowed, updatedAt: nowIso() }, { merge: true });
};

const getLatestActiveUserTierDoc = <T extends { data: () => any }>(docs: T[]): T | null => docs
  .slice()
  .sort((a, b) => String(b.data().effectiveFrom ?? '').localeCompare(String(a.data().effectiveFrom ?? '')))[0] ?? null;

export const getCurrentUserTier = async (userId: string): Promise<(UserTier & { tierKey: string }) | null> => {
  const db = getDb();
  // Keep this as a two-filter query and sort in memory so login does not depend
  // on a composite Firestore index being present in production.
  const snap = await db.collection('user_tiers')
    .where('userId', '==', userId)
    .where('effectiveTo', '==', null)
    .get();
  const doc = getLatestActiveUserTierDoc(snap.docs);
  if (!doc) return null;
  const data = doc.data();
  const tier = await getTierByKey(data.tierKey);
  return {
    id: doc.id,
    userId: data.userId,
    tierId: data.tierId,
    source: data.source,
    reason: data.reason ?? null,
    assignedBy: data.assignedBy ?? null,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo ?? null,
    createdAt: data.createdAt ?? nowIso(),
    tierKey: tier?.key ?? data.tierKey ?? 'free',
  };
};

export const setUserTier = async (
  userId: string,
  tierKey: string,
  source: 'system' | 'billing' | 'admin_override' | 'admin',
  assignedBy: string | null,
  reason?: string
): Promise<void> => {
  const db = getDb();
  const tier = await getTierByKey(tierKey);
  if (!tier) throw new Error(`Tier not found: ${tierKey}`);
  const existing = await db.collection('user_tiers')
    .where('userId', '==', userId)
    .where('effectiveTo', '==', null)
    .get();
  const batch = db.batch();
  const now = nowIso();
  for (const doc of existing.docs) {
    batch.update(doc.ref, { effectiveTo: now });
  }
  const newRef = db.collection('user_tiers').doc(randomUUID());
  batch.set(newRef, { userId, tierId: tier.id, tierKey, source, reason: reason ?? null, assignedBy, effectiveFrom: now, effectiveTo: null, createdAt: now });
  await batch.commit();
};

export const ensureCurrentUserTier = async (userId: string, tierKey = 'free'): Promise<void> => {
  const current = await getCurrentUserTier(userId);
  if (current) return;
  await setUserTier(userId, tierKey, 'system', null, 'Automatic default tier assignment');
};

export const upsertTier = async (key: string, displayName: string, rank: number): Promise<void> => {
  const db = getDb();
  const ref = db.collection('tiers').doc(key);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ displayName, rank, isActive: true, createdAt: nowIso() });
  }
};

export const upsertFeature = async (key: string, description: string, defaultEnabled: boolean): Promise<void> => {
  const db = getDb();
  const ref = db.collection('features').doc(key);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ key, description, defaultEnabled, createdAt: nowIso() });
  }
};

export const getFeatureFlag = async (key: string): Promise<FeatureFlag | null> => {
  const db = getDb();
  const doc = await db.collection('feature_flags').doc(key).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { id: doc.id, key: doc.id, enabled: data.enabled, scope: 'global', updatedBy: data.updatedBy ?? null, updatedAt: data.updatedAt ?? nowIso(), createdAt: data.createdAt ?? nowIso() };
};

export const listFeatureFlags = async (): Promise<FeatureFlag[]> => {
  const db = getDb();
  const snap = await db.collection('feature_flags').get();
  return snap.docs
    .map(d => {
      const data = d.data();
      return { id: d.id, key: d.id, enabled: data.enabled, scope: 'global' as const, updatedBy: data.updatedBy ?? null, updatedAt: data.updatedAt ?? nowIso(), createdAt: data.createdAt ?? nowIso() };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
};

export const setFeatureFlag = async (key: string, enabled: boolean, updatedBy: string | null): Promise<void> => {
  const db = getDb();
  await db.collection('feature_flags').doc(key).set({ key, enabled, updatedBy, updatedAt: nowIso() }, { merge: true });
};

export const getUsageCounter = async (userId: string, metricKey: string, windowKey: string): Promise<number> => {
  const db = getDb();
  const docId = `${userId}_${metricKey}_${windowKey}`;
  const doc = await db.collection('usage_counters').doc(docId).get();
  return doc.exists ? (doc.data()!.count ?? 0) : 0;
};

export const incrementUsageCounter = async (
  userId: string,
  metricKey: string,
  windowKey: string,
  amount = 1
): Promise<number> => {
  const db = getDb();
  const docId = `${userId}_${metricKey}_${windowKey}`;
  const ref = db.collection('usage_counters').doc(docId);
  await ref.set({ userId, metricKey, windowKey, count: FieldValue.increment(amount), updatedAt: nowIso() }, { merge: true });
  const updated = await ref.get();
  return updated.data()!.count ?? amount;
};

export const setUsageCounter = async (
  userId: string,
  metricKey: string,
  windowKey: string,
  count: number
): Promise<void> => {
  const db = getDb();
  const docId = `${userId}_${metricKey}_${windowKey}`;
  await db.collection('usage_counters').doc(docId).set(
    { userId, metricKey, windowKey, count, updatedAt: nowIso() },
    { merge: true }
  );
};

export const appendUsageEvent = async (
  userId: string,
  metricKey: string,
  amount = 1,
  metadata?: Record<string, unknown> | null
): Promise<void> => {
  const db = getDb();
  const createdAt = nowIso();
  await db.collection('usage_events').doc(randomUUID()).set({
    userId,
    metricKey,
    amount,
    metadata: metadata ?? null,
    createdAt,
  });
  await incrementAdminUserAnalyticsMetric(userId, metricKey, amount, createdAt);
};

export const getApiCostCounter = async (provider: string, windowKey: string): Promise<number> => {
  const db = getDb();
  const doc = await db.collection('api_cost_counters').doc(`${provider}_${windowKey}`).get();
  return doc.exists ? Number(doc.data()!.amountMicros ?? 0) : 0;
};

export const incrementApiCostCounter = async (
  provider: string,
  windowKey: string,
  amountMicros: number
): Promise<number> => {
  const db = getDb();
  const ref = db.collection('api_cost_counters').doc(`${provider}_${windowKey}`);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const current = doc.exists ? Number(doc.data()!.amountMicros ?? 0) : 0;
    const nextAmountMicros = current + amountMicros;
    tx.set(
      ref,
      {
        provider,
        windowKey,
        amountMicros: nextAmountMicros,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    return nextAmountMicros;
  });
};

export const getApiUsageCount = async (
  provider: string,
  caller: string,
  scope: 'overall' | 'caller',
  windowKey: string
): Promise<number> => {
  const db = getDb();
  const docId = `${scope}_${provider}_${caller}_${windowKey}`;
  const doc = await db.collection('api_usage_counters').doc(docId).get();
  return doc.exists ? Number(doc.data()!.count ?? 0) : 0;
};

export const atomicIncrementApiUsageIfUnderLimit = async (params: {
  provider: string;
  caller: string;
  scope: 'overall' | 'caller';
  windowKey: string;
  limit: number;
}): Promise<{ allowed: boolean; newCount: number }> => {
  const db = getDb();
  const docId = `${params.scope}_${params.provider}_${params.caller}_${params.windowKey}`;
  const ref = db.collection('api_usage_counters').doc(docId);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const current = doc.exists ? Number(doc.data()!.count ?? 0) : 0;
    if (current >= params.limit) {
      return { allowed: false, newCount: current };
    }
    const nextCount = current + 1;
    tx.set(
      ref,
      {
        provider: params.provider,
        caller: params.caller,
        scope: params.scope,
        windowKey: params.windowKey,
        count: nextCount,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    return { allowed: true, newCount: nextCount };
  });
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
  const db = getDb();
  const snap = await db.collection('api_usage_counters').get();
  return snap.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      provider: String(data.provider ?? ''),
      caller: String(data.caller ?? ''),
      scope: String(data.scope ?? 'caller') as 'overall' | 'caller',
      windowKey: String(data.windowKey ?? ''),
      count: Number(data.count ?? 0),
    };
  });
};

export const resetApiUsageCounters = async (): Promise<void> => {
  const db = getDb();
  const snap = await db.collection('api_usage_counters').get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
};

export const listApiCostCounters = async (): Promise<
  Array<{
    provider: string;
    windowKey: string;
    amountMicros: number;
  }>
> => {
  const db = getDb();
  const snap = await db.collection('api_cost_counters').get();
  return snap.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      provider: String(data.provider ?? ''),
      windowKey: String(data.windowKey ?? ''),
      amountMicros: Number(data.amountMicros ?? 0),
    };
  });
};

export const resetApiCostCounters = async (): Promise<void> => {
  const db = getDb();
  const snap = await db.collection('api_cost_counters').get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
};

export const atomicIncrementIfUnderLimit = async (
  userId: string,
  metricKey: string,
  windowKey: string,
  limit: number
): Promise<{ allowed: boolean; newCount: number }> => {
  const db = getDb();
  const docId = `${userId}_${metricKey}_${windowKey}`;
  const ref = db.collection('usage_counters').doc(docId);
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const current = doc.exists ? (doc.data()!.count ?? 0) : 0;
    if (current >= limit) {
      return { allowed: false, newCount: current };
    }
    if (doc.exists) {
      tx.update(ref, { count: FieldValue.increment(1), updatedAt: nowIso() });
    } else {
      tx.set(ref, { userId, metricKey, windowKey, count: 1, updatedAt: nowIso() });
    }
    return { allowed: true, newCount: current + 1 };
  });
};

export const getGenerationIdempotency = async (key: string) => {
  const db = getDb();
  const doc = await db.collection('generation_idempotency').doc(key).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    key: doc.id,
    userId: data.userId,
    tripId: data.tripId,
    usageKey: data.usageKey ?? null,
    windowKey: data.windowKey ?? null,
    status: data.status ?? 'pending',
    resultRef: data.resultRef ?? null,
    responseBody: data.responseBody ?? null,
    errorMessage: data.errorMessage ?? null,
    createdAt: data.createdAt ?? nowIso(),
    expiresAt: data.expiresAt ?? nowIso(),
  };
};

export const reserveGenerationIdempotency = async (params: {
  key: string;
  userId: string;
  tripId: string;
  usageKey: string;
  windowKey: string;
  ttlSeconds?: number;
}) => {
  const db = getDb();
  const ref = db.collection('generation_idempotency').doc(params.key);
  const ttlSeconds = Math.max(60, params.ttlSeconds ?? 3600);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  let created = false;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) {
      created = true;
      tx.set(ref, {
        userId: params.userId,
        tripId: params.tripId,
        usageKey: params.usageKey,
        windowKey: params.windowKey,
        status: 'pending',
        resultRef: null,
        responseBody: null,
        errorMessage: null,
        createdAt: nowIso(),
        expiresAt,
      });
    }
  });
  return { created, record: await getGenerationIdempotency(params.key) };
};

export const completeGenerationIdempotency = async (key: string, responseBody: Record<string, unknown>, resultRef?: string | null): Promise<void> => {
  const db = getDb();
  await db.collection('generation_idempotency').doc(key).set({
    status: 'completed',
    resultRef: resultRef ?? null,
    responseBody,
    errorMessage: null,
  }, { merge: true });
};

export const failGenerationIdempotency = async (key: string, errorMessage: string): Promise<void> => {
  const db = getDb();
  await db.collection('generation_idempotency').doc(key).set({
    status: 'failed',
    errorMessage,
  }, { merge: true });
};

export const countReservedOrCompletedUsage = async (userId: string, usageKey: string, windowKey: string): Promise<number> => {
  const db = getDb();
  const now = nowIso();
  const snap = await db.collection('generation_idempotency')
    .where('userId', '==', userId)
    .where('usageKey', '==', usageKey)
    .where('windowKey', '==', windowKey)
    .get();
  return snap.docs.filter((doc) => {
    const data = doc.data();
    return ['pending', 'completed'].includes(data.status) && String(data.expiresAt ?? now) > now;
  }).length;
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
  const db = getDb();
  const id = randomUUID();
  const createdAt = nowIso();
  await db.collection('audit_log').doc(id).set({
    actorUserId: entry.actorUserId ?? null,
    targetUserId: entry.targetUserId ?? null,
    action: entry.action,
    beforeState: entry.beforeState ?? null,
    afterState: entry.afterState ?? null,
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt,
  });
  return { id, ...entry, actorUserId: entry.actorUserId ?? null, targetUserId: entry.targetUserId ?? null, beforeState: entry.beforeState ?? null, afterState: entry.afterState ?? null, reason: entry.reason ?? null, ipAddress: entry.ipAddress ?? null, userAgent: entry.userAgent ?? null, createdAt };
};

export const listAuditLog = async (opts: {
  actorUserId?: string;
  targetUserId?: string;
  action?: string;
  page?: number;
  limit?: number;
}): Promise<{ entries: AuditLogEntry[]; total: number }> => {
  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection('audit_log').orderBy('createdAt', 'desc');
  if (opts.actorUserId) query = query.where('actorUserId', '==', opts.actorUserId);
  if (opts.targetUserId) query = query.where('targetUserId', '==', opts.targetUserId);
  if (opts.action) query = query.where('action', '==', opts.action);
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = (page - 1) * limit;
  const allSnap = await query.get();
  const total = allSnap.size;
  const entries = allSnap.docs.slice(offset, offset + limit).map(d => {
    const data = d.data();
    return {
      id: d.id,
      actorUserId: data.actorUserId ?? null,
      targetUserId: data.targetUserId ?? null,
      action: data.action as AuditAction,
      beforeState: data.beforeState ?? null,
      afterState: data.afterState ?? null,
      reason: data.reason ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      createdAt: data.createdAt,
    };
  });
  return { entries, total };
};

export const deleteAuditLog = async (opts: {
  targetUserId?: string;
  action?: string;
}): Promise<void> => {
  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection('audit_log');
  if (opts.targetUserId) query = query.where('targetUserId', '==', opts.targetUserId);
  if (opts.action) query = query.where('action', '==', opts.action);
  if (!opts.targetUserId && !opts.action) return;
  const snap = await query.get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  if (snap.size > 0) await batch.commit();
};

export const setPasswordSetupRequired = async (userId: string, required: boolean): Promise<void> => {
  const db = getDb();
  await db.collection('web_users').doc(userId).update({ passwordSetupRequired: required });
};

export const countGroupMembers = async (groupId: string): Promise<number> => {
  const db = getDb();
  const snap = await db.collection('group_members')
    .where('groupId', '==', groupId)
    .where('removedAt', '==', null)
    .get();
  return snap.size;
};

import type { AdminUserRow } from './db.postgres';
export { AdminUserRow };

export const adminSearchUsers = async (opts: {
  search?: string; page?: number; limit?: number;
}): Promise<{ users: AdminUserRow[]; total: number }> => {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = (page - 1) * limit;
  const search = opts.search?.trim().toLowerCase() ?? '';

  const [userSnap, webUserSnap, tierSnap, userTierSnap, userEmailSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('web_users').get(),
    db.collection('tiers').get(),
    db.collection('user_tiers').where('effectiveTo', '==', null).get(),
    db.collection('user_emails').get(),
  ]);

  const webUsersById = new Map(
    webUserSnap.docs.map((doc) => [doc.id, doc.data()] as const)
  );
  const tiersById = new Map<string, Record<string, unknown>>(
    tierSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
  );
  const activeTierByUserId = new Map(
    userTierSnap.docs.map((doc) => [String(doc.data().userId), doc.data()] as const)
  );
  const userEmailsByUserId = new Map<string, string[]>();

  userEmailSnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    const userId = String(data.userId ?? '');
    const email = String(data.email ?? '').toLowerCase();
    if (!userId || !email) return;
    const existing = userEmailsByUserId.get(userId) ?? [];
    existing.push(email);
    userEmailsByUserId.set(userId, existing);
  });

  const allUsers: AdminUserRow[] = await Promise.all(userSnap.docs.map(async (doc) => {
    const user = doc.data();
    const webUser = webUsersById.get(doc.id) ?? {};
    const activeTier = activeTierByUserId.get(doc.id) ?? null;
    const tier = activeTier ? tiersById.get(String(activeTier.tierId ?? activeTier.tierKey ?? '')) : null;
    const role = ((user.role as string | null) ?? 'user');
    let tierKey = (activeTier?.tierKey as string | null) ?? (tier ? (tier.id as string) : null);
    let tierDisplayName = tier ? ((tier.displayName as string | null) ?? null) : null;

    if (role === 'admin' && tierKey !== 'pro') {
      await setUserTier(doc.id, 'pro', 'system', null, 'Admin users are automatically assigned Pro tier');
      const proTier = tiersById.get('pro');
      tierKey = 'pro';
      tierDisplayName = proTier ? ((proTier.displayName as string | null) ?? 'Pro') : 'Pro';
    }

    return {
      id: doc.id,
      email: (user.email as string | null) ?? '',
      firstName: (webUser.firstName as string | null) ?? (user.firstName as string | null) ?? null,
      lastName: (webUser.lastName as string | null) ?? (user.lastName as string | null) ?? null,
      role,
      tierKey,
      tierDisplayName,
      tierSince: (activeTier?.effectiveFrom as string | null) ?? null,
      createdAt: (user.createdAt as string | null) ?? nowIso(),
    };
  }));

  const filtered = search
    ? allUsers.filter((user) => {
        const haystack = [
          user.email ?? '',
          user.firstName ?? '',
          user.lastName ?? '',
          ...(userEmailsByUserId.get(user.id) ?? []),
          user.id,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      })
    : allUsers;

  filtered.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

  return {
    users: filtered.slice(offset, offset + limit),
    total: filtered.length,
  };
};

export const adminGetUser = async (userId: string): Promise<{
  id: string; email: string; firstName: string | null; lastName: string | null;
  role: string; tierKey: string | null; tierDisplayName: string | null;
  tierSince: string | null; tierSource: string | null; createdAt: string;
  usage: { metricKey: string; windowKey: string; count: number }[];
} | null> => {
  const db = getDb();
  const [userDoc, webUserDoc, activeTierSnap, tierSnap, usageSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('web_users').doc(userId).get(),
    db.collection('user_tiers')
      .where('userId', '==', userId)
      .where('effectiveTo', '==', null)
      .get(),
    db.collection('tiers').get(),
    db.collection('usage_counters').where('userId', '==', userId).get(),
  ]);

  if (!userDoc.exists) return null;

  const user = userDoc.data() ?? {};
  const webUser = webUserDoc.exists ? webUserDoc.data() ?? {} : {};
  const activeTierDoc = getLatestActiveUserTierDoc(activeTierSnap.docs);
  const activeTier = activeTierDoc ? activeTierDoc.data() : null;
  const tiersById = new Map<string, Record<string, unknown>>(
    tierSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
  );
  const tier = activeTier ? tiersById.get(String(activeTier.tierId ?? activeTier.tierKey ?? '')) : null;
  const role = ((user.role as string | null) ?? 'user');
  let tierKey = (activeTier?.tierKey as string | null) ?? (tier ? (tier.id as string) : null);
  let tierDisplayName = tier ? ((tier.displayName as string | null) ?? null) : null;

  if (role === 'admin' && tierKey !== 'pro') {
    await setUserTier(userId, 'pro', 'system', null, 'Admin users are automatically assigned Pro tier');
    const proTier = tiersById.get('pro');
    tierKey = 'pro';
    tierDisplayName = proTier ? ((proTier.displayName as string | null) ?? 'Pro') : 'Pro';
  }

  return {
    id: userId,
    email: (user.email as string | null) ?? '',
    firstName: (webUser.firstName as string | null) ?? (user.firstName as string | null) ?? null,
    lastName: (webUser.lastName as string | null) ?? (user.lastName as string | null) ?? null,
    role,
    tierKey,
    tierDisplayName,
    tierSince: (activeTier?.effectiveFrom as string | null) ?? null,
    tierSource: (activeTier?.source as string | null) ?? null,
    createdAt: (user.createdAt as string | null) ?? nowIso(),
    usage: usageSnap.docs
      .map((doc) => doc.data())
      .map((data) => ({
        metricKey: String(data.metricKey ?? ''),
        windowKey: String(data.windowKey ?? ''),
        count: Number(data.count ?? 0),
      }))
      .sort((a, b) => `${b.windowKey}:${a.metricKey}`.localeCompare(`${a.windowKey}:${b.metricKey}`)),
  };
};

export const adminGetUserData = async (opts: {
  window?: '7d' | '30d' | 'all-time'; page?: number; limit?: number;
}): Promise<{
  summary: { totalUsers: number; byTier: Record<string, number> };
  users: Array<{ id: string; email: string; role: string; tierKey: string | null; tripCount: number; tripCreations: number; aiGenerations: number; tokens: number; apiCalls: Record<string, number>; createdAt: string }>;
  total: number;
}> => {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = (page - 1) * limit;
  const providerKeys = Object.keys(getApiLimitsConfig().providers ?? {});
  const windowDays = opts.window === '7d' ? 7 : opts.window === '30d' ? 30 : null;
  const windowStartDayKey = windowDays
    ? getDayKey(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString())
    : null;

  const [userSnap, tierSnap, userTierSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('tiers').get(),
    db.collection('user_tiers').where('effectiveTo', '==', null).get(),
  ]);

  const tiersById = new Map<string, Record<string, unknown>>(
    tierSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
  );
  const activeTierByUserId = new Map<string, Record<string, unknown>>(
    userTierSnap.docs.map((doc) => [String(doc.data().userId), doc.data()])
  );

  const allUsers = userSnap.docs.map((doc) => {
    const data = doc.data();
    const activeTier = activeTierByUserId.get(doc.id) ?? null;
    const tier = activeTier ? tiersById.get(String(activeTier.tierId ?? activeTier.tierKey ?? '')) : null;
    return {
      id: doc.id,
      email: (data.email as string | null) ?? '',
      role: ((data.role as string | null) ?? 'user'),
      tierKey: (activeTier?.tierKey as string | null) ?? (tier ? (tier.id as string) : null),
      createdAt: (data.createdAt as string | null) ?? nowIso(),
    };
  });

  allUsers.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const byTier: Record<string, number> = {};
  for (const user of allUsers) {
    const key = user.tierKey ?? 'none';
    byTier[key] = (byTier[key] ?? 0) + 1;
  }

  const pagedUsers = allUsers.slice(offset, offset + limit);
  const analyticsRefs = pagedUsers.map((user) => db.collection('admin_user_analytics').doc(user.id));
  let analyticsDocs = analyticsRefs.length ? await db.getAll(...analyticsRefs) : [];

  const usersNeedingBackfill = analyticsDocs
    .filter((doc) => {
      const data = doc.exists ? doc.data() as any : null;
      return !doc.exists || !data?.backfilledAt;
    })
    .map((doc) => doc.id);

  if (usersNeedingBackfill.length) {
    await Promise.all(usersNeedingBackfill.map((userId) => backfillAdminAnalyticsForUser(userId)));
    analyticsDocs = analyticsRefs.length ? await db.getAll(...analyticsRefs) : [];
  }

  const analyticsByUserId = new Map(
    analyticsDocs.map((doc) => [doc.id, (doc.exists ? doc.data() : null) as any])
  );

  const dailyMetricsByUser = new Map<string, Record<string, number>>();
  if (windowStartDayKey) {
    const userIds = pagedUsers.map((user) => user.id);
    for (let i = 0; i < userIds.length; i += 10) {
      const chunk = userIds.slice(i, i + 10);
      const dailySnap = await db.collection('admin_user_analytics_daily').where('userId', 'in', chunk).get();
      for (const doc of dailySnap.docs) {
        const data = doc.data() as any;
        const dayKey = String(data.dayKey ?? '');
        if (!dayKey || dayKey < windowStartDayKey) continue;
        const userId = String(data.userId ?? '');
        const sourceMetrics = (data.metrics ?? {}) as Record<string, number>;
        const bucket = dailyMetricsByUser.get(userId) ?? {};
        for (const [metricKey, rawValue] of Object.entries(sourceMetrics)) {
          bucket[metricKey] = (bucket[metricKey] ?? 0) + Number(rawValue ?? 0);
        }
        dailyMetricsByUser.set(userId, bucket);
      }
    }
  }

  return {
    summary: { totalUsers: allUsers.length, byTier },
    total: allUsers.length,
    users: pagedUsers.map((user) => {
      const aggregate = analyticsByUserId.get(user.id) ?? {};
      const metrics = windowStartDayKey
        ? (dailyMetricsByUser.get(user.id) ?? {})
        : ((aggregate.metrics ?? {}) as Record<string, number>);
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        tierKey: user.tierKey,
        tripCount: Number(aggregate.tripCount ?? 0),
        tripCreations: metrics.trip_creations ?? 0,
        aiGenerations: metrics.ai_itinerary_generations ?? 0,
        tokens: metrics.openai_tokens ?? 0,
        apiCalls: providerKeys.reduce<Record<string, number>>((acc, providerKey) => {
          const metricKey = `api_calls_${providerKey.toLowerCase()}`;
          acc[providerKey] =
            metrics[metricKey] ??
            (providerKey === 'OPENAI' ? metrics.ai_itinerary_generations ?? 0 : 0);
          return acc;
        }, {}),
        createdAt: user.createdAt,
      };
    }),
  };
};

export const countActiveTripsForUser = async (userId: string): Promise<number> => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const tripIds = await listWritableTripIdsForUser(userId);
  if (!tripIds.length) return 0;
  const chunk = <T>(items: T[], size = 200): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };
  let count = 0;
  for (const tripIdChunk of chunk(tripIds)) {
    const tripRefs = tripIdChunk.map((tripId) => db.collection('trips').doc(tripId));
    const tripDocs = await db.getAll(...tripRefs);
    for (const tripDoc of tripDocs) {
      if (!tripDoc.exists) continue;
      const endDate = (tripDoc.data() as any)?.endDate;
      if (!endDate || endDate >= today) {
        count += 1;
      }
    }
  }
  return count;
};


// ---------------------------------------------------------------------------
// Chat / Messaging
// ---------------------------------------------------------------------------

export const listTripMessages = async (
  tripId: string,
  limit = 200,
): Promise<TripChatMessage[]> => {
  const db = getDb();
  const snap = await db
    .collection('trip_messages')
    .where('tripId', '==', tripId)
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();

  const messages: TripChatMessage[] = snap.docs.map((doc) => {
    const d = doc.data() as any;
    return {
      id: doc.id,
      appId: d.appId ?? 'WanderBunnies',
      tripId: d.tripId,
      senderId: d.senderId,
      senderName: d.senderName ?? '',
      senderInitials: d.senderInitials ?? '',
      body: d.body ?? '',
      createdAt: d.createdAt ?? nowIso(),
      readBy: d.readBy ?? [],
    };
  });

  return messages;
};

export const addTripMessage = async (msg: {
  appId: string;
  tripId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  body: string;
}): Promise<TripChatMessage> => {
  const db = getDb();
  const text = String(msg.body ?? '').trim();
  if (!text) throw new Error('Message body is required');
  const id = randomUUID();
  const createdAt = nowIso();
  const payload: TripChatMessage = {
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
  await db.collection('trip_messages').doc(id).set(payload);
  return payload;
};

export const markMessagesRead = async (
  tripId: string,
  userId: string,
  upToMessageId: string,
): Promise<void> => {
  const db = getDb();
  // Get the createdAt of the upToMessage
  const upToDoc = await db.collection('trip_messages').doc(upToMessageId).get();
  if (!upToDoc.exists) return;
  const upToCreatedAt = (upToDoc.data() as any).createdAt ?? '';

  const snap = await db
    .collection('trip_messages')
    .where('tripId', '==', tripId)
    .where('createdAt', '<=', upToCreatedAt)
    .get();

  const batch = db.batch();
  for (const doc of snap.docs) {
    const readBy: string[] = (doc.data() as any).readBy ?? [];
    if (!readBy.includes(userId)) {
      batch.update(doc.ref, { readBy: FieldValue.arrayUnion(userId) });
    }
    // Also write to message_reads sub-collection for cross-referencing
    const readRef = db
      .collection('message_reads')
      .doc(`${doc.id}_${userId}`);
    batch.set(readRef, { messageId: doc.id, userId, readAt: nowIso() }, { merge: true });
  }
  await batch.commit();
};

export const countUnreadMessages = async (
  tripId: string,
  userId: string,
): Promise<number> => {
  const db = getDb();
  const snap = await db
    .collection('trip_messages')
    .where('tripId', '==', tripId)
    .get();
  let count = 0;
  for (const doc of snap.docs) {
    const readBy: string[] = (doc.data() as any).readBy ?? [];
    if (!readBy.includes(userId)) count++;
  }
  return count;
};
import { searchBundledAirportDataset } from './services/airportCatalog';
