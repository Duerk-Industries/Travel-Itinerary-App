// Firebase adapter (Firestore-backed)
import { initializeApp, cert, deleteApp, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldPath, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
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
  ItineraryDetailKind,
  ItineraryChecklistItem,
  Group,
  GroupMember,
  PlaceDetailsCache,
  LocationRecord,
  AttractionCatalogEntry,
  AttractionShortlistBlob,
  ItineraryPlanCacheEntry,
  AttractionDurationMetadata,
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
  PackingListItem,
  PackingListTraveler,
  TripPackingList,
  PackingPreset,
  PackingPresetPreference,
  PackingListV2Trip,
  BillingCustomer,
  BillingNotification,
  BillingTrialUsage,
  BillingSubscription,
  BillingSubscriptionScope,
  BillingSubscriptionStatus,
  StripeWebhookEvent,
  BillingPlanConfig,
  BillingPlanKey,
  BillingPriceHistory,
  AiProviderConfig,
  AdminSetting,
  AiAnalyticsMetric,
  AiAnalyticsMetricTable,
  AiAnalyticsPeriodType,
  AiExperiment,
  AiExperimentAssignment,
  AiAbTestMetric,
  AiProviderCertification,
  AiRecommendation,
  ItineraryGenerationMetrics,
  ItineraryComparison,
} from './types';
import type { AccountEmail, AppleProfile } from './db.postgres';
import { logError, logInfo } from './logger';
import { getEnvFlag, getEnvValue, isLocalEnv } from './env';
import { normalizeItineraryStatus } from './utils/itineraryStatus';
import { normalizePackingLabel } from './utils/packingListNormalize';
import { buildPackingListDisplayGroups } from './utils/packingListDisplay';
import { getApiLimitsConfig } from './config/apiLimits';
import { DEFAULT_PACKING_LIST_ITEMS } from './config/defaultPackingList';

let app: App | null = null;

const clearMissingGoogleApplicationCredentials = (): void => {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) return;
  const resolvedPath = path.resolve(credentialsPath);
  if (fs.existsSync(resolvedPath)) return;
  logInfo(`Ignoring missing GOOGLE_APPLICATION_CREDENTIALS file: ${credentialsPath}`);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS_FILE;
};
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
    sanitized.push({ id: typeof item.id === 'string' ? item.id : undefined, category, label, position: sanitized.length });
  }
  return sanitized;
};
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
  const mapped = mapUserDoc(doc);
  return mapped ? { id: mapped.id, data: mapped } : null;
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
        clearMissingGoogleApplicationCredentials();
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

  const billingPlanSeeds: Array<Omit<BillingPlanConfig, 'id' | 'updatedAt'>> = [
    {
      planKey: 'premium_monthly',
      stripeProductId: null,
      activeStripePriceId: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID ?? null,
      unitAmountCents: 500,
      currency: 'usd',
      interval: 'month',
      trialDays: 14,
      pastDueGraceDays: 14,
      automaticTaxEnabled: true,
      promotionCodesEnabled: false,
      isCheckoutEnabled: true,
      livemode: process.env.STRIPE_SECRET_KEY ? !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') : null,
      version: 1,
      updatedBy: null,
    },
    {
      planKey: 'premium_annual',
      stripeProductId: null,
      activeStripePriceId: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID ?? null,
      unitAmountCents: 3500,
      currency: 'usd',
      interval: 'year',
      trialDays: 14,
      pastDueGraceDays: 14,
      automaticTaxEnabled: true,
      promotionCodesEnabled: false,
      isCheckoutEnabled: true,
      livemode: process.env.STRIPE_SECRET_KEY ? !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') : null,
      version: 1,
      updatedBy: null,
    },
  ];
  for (const plan of billingPlanSeeds) {
    const ref = db.collection('billing_plan_config').doc(plan.planKey);
    if (!(await ref.get()).exists) {
      await ref.set({ id: plan.planKey, ...plan, updatedAt: nowIso() });
      logInfo(`[db.firebase] Seeded billing plan: ${plan.planKey}`);
    }
  }
  await seedUniversalPackingDefaults();
  if (
    process.env.FIREBASE_INIT_BACKFILL_PACKING !== '0' &&
    (process.env.NODE_ENV !== 'test' || process.env.FIREBASE_INIT_BACKFILL_PACKING === '1')
  ) {
    await backfillUserPackingLists();
  }

  // Permanent canary fixture (Chapter 16 §6) used by cutover-test-to-prod.sh's
  // smoke write/cleanup. Only bootstrapped when explicitly configured — most
  // environments (local/dev/CI) have no canary account and shouldn't get one.
  const canaryAccountEmail = getEnvValue('CANARY_ACCOUNT_EMAIL');
  if (canaryAccountEmail) {
    await ensureCanaryAccountBootstrap(canaryAccountEmail);
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

const universalPackingCollection = () => getDb().collection('universal_packing_list_items');
const nestedCollection = (root: string, docId: string, child: string) => {
  const docRef = getDb().collection(root).doc(docId);
  if (typeof (docRef as any).collection === 'function') {
    return (docRef as any).collection(child);
  }
  return getDb().collection(`${root}/${docId}/${child}`);
};
const userPackingCollection = (userId: string) => nestedCollection('user_packing_lists', userId, 'items');
const tripPackingCollection = (tripId: string) => nestedCollection('trip_packing_lists', tripId, 'items');
const tripPackingChecksCollection = (tripId: string) => nestedCollection('trip_packing_lists', tripId, 'checks');
type FirestoreDocLike = { id: string; ref?: any; data: () => any };
type FirestoreSnapshotLike = { empty?: boolean; docs: FirestoreDocLike[] };
const collectionSnapshot = async (collectionRef: any, limit?: number): Promise<FirestoreSnapshotLike> => {
  if (limit && typeof collectionRef.limit === 'function') {
    return collectionRef.limit(limit).get();
  }
  return collectionRef.get();
};
const collectionHasAny = async (collectionRef: any): Promise<boolean> => {
  const snap = await collectionSnapshot(collectionRef, 1);
  return !snap.empty && (!Array.isArray(snap.docs) || snap.docs.length > 0);
};
const orderedCollectionSnapshot = async (collectionRef: any, field: string): Promise<FirestoreSnapshotLike> => {
  if (typeof collectionRef.orderBy === 'function') {
    return collectionRef.orderBy(field).get();
  }
  const snap = await collectionRef.get();
  if (!Array.isArray(snap.docs)) return snap;
  return {
    ...snap,
    docs: [...snap.docs].sort((a, b) => Number((a.data() as any)?.[field] ?? 0) - Number((b.data() as any)?.[field] ?? 0)),
  };
};

const seedUniversalPackingDefaults = async (): Promise<void> => {
  if (await collectionHasAny(universalPackingCollection())) return;
  const batch = getDb().batch();
  DEFAULT_PACKING_LIST_ITEMS.forEach((item, index) => {
    const ref = universalPackingCollection().doc();
    batch.set(ref, { category: item.category, label: item.label, position: index, createdAt: nowIso(), updatedAt: nowIso() });
  });
  await batch.commit();
};

const ensurePackingListForUser = async (userId: string): Promise<void> => {
  if (await collectionHasAny(userPackingCollection(userId))) return;
  await seedUniversalPackingDefaults();
  const defaults = await getUniversalPackingList();
  const batch = getDb().batch();
  defaults.forEach((item, index) => {
    const ref = userPackingCollection(userId).doc();
    batch.set(ref, { category: item.category, label: item.label, position: index, createdAt: nowIso(), updatedAt: nowIso() });
  });
  await batch.commit();
};

const backfillUserPackingLists = async (): Promise<void> => {
  const users = await getDb().collection('users').get();
  for (const user of users.docs) {
    await ensurePackingListForUser(user.id);
  }
};

const mergeUserPackingListIntoTrip = async (tripId: string, userId: string): Promise<void> => {
  await ensurePackingListForUser(userId);
  const [existingSnap, userItems] = await Promise.all([
    tripPackingCollection(tripId).get(),
    getUserPackingList(userId),
  ]);
  const existing = new Set(existingSnap.docs.map((doc: any) => {
    const data = doc.data() as any;
    return normalizePackingKey(data.category ?? '', data.label ?? '');
  }));
  let nextPosition = existingSnap.docs.reduce((max: number, doc: any) => Math.max(max, Number((doc.data() as any).position ?? 0)), -1) + 1;
  const batch = getDb().batch();
  for (const item of userItems) {
    const key = normalizePackingKey(item.category, item.label);
    if (existing.has(key)) continue;
    existing.add(key);
    const ref = tripPackingCollection(tripId).doc();
    batch.set(ref, {
      category: item.category,
      label: item.label,
      position: nextPosition,
      sourceUserId: userId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    nextPosition += 1;
  }
  await batch.commit();
};

const ensureTripPackingList = async (tripId: string): Promise<void> => {
  if (await collectionHasAny(tripPackingCollection(tripId))) return;
  const trip = await getTripById(tripId);
  if (!trip) return;
  const members = await getDb().collection('group_members').where('groupId', '==', trip.groupId).where('removedAt', '==', null).get();
  for (const member of members.docs) {
    const userId = (member.data() as any).userId;
    if (typeof userId === 'string' && userId) {
      await mergeUserPackingListIntoTrip(tripId, userId);
    }
  }
  if (await collectionHasAny(tripPackingCollection(tripId))) return;
  const defaults = await getUniversalPackingList();
  const batch = getDb().batch();
  defaults.forEach((item, index) => {
    batch.set(tripPackingCollection(tripId).doc(), {
      category: item.category,
      label: item.label,
      position: index,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  });
  await batch.commit();
};

export const getUniversalPackingList = async (): Promise<PackingListItem[]> => {
  await seedUniversalPackingDefaults();
  const snap = await orderedCollectionSnapshot(universalPackingCollection(), 'position');
  return snap.docs.map((doc, index) => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      category: data.category ?? '',
      label: data.label ?? '',
      position: Number(data.position ?? index),
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
    };
  });
};

export const replaceUniversalPackingList = async (itemsInput: Array<{ id?: string; category?: unknown; label?: unknown }>): Promise<PackingListItem[]> => {
  const items = sanitizePackingItems(itemsInput);
  if (!items.length) throw new Error('At least one packing item is required');
  const db = getDb();
  const existing = await universalPackingCollection().get();
  let batch = db.batch();
  existing.docs.forEach((doc: any) => batch.delete(doc.ref));
  items.forEach((item) => batch.set(universalPackingCollection().doc(), {
    category: item.category,
    label: item.label,
    position: item.position,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  await batch.commit();
  if (
    process.env.FIREBASE_INIT_BACKFILL_PACKING !== '0' &&
    (process.env.NODE_ENV !== 'test' || process.env.FIREBASE_INIT_BACKFILL_PACKING === '1')
  ) {
    await backfillUserPackingLists();
  }
  return getUniversalPackingList();
};

export const getUserPackingList = async (userId: string): Promise<PackingListItem[]> => {
  await ensurePackingListForUser(userId);
  const snap = await orderedCollectionSnapshot(userPackingCollection(userId), 'position');
  return snap.docs.map((doc, index) => {
    const data = doc.data() as any;
    return { id: doc.id, category: data.category ?? '', label: data.label ?? '', position: Number(data.position ?? index), createdAt: data.createdAt ?? null, updatedAt: data.updatedAt ?? null };
  });
};

export const replaceUserPackingList = async (userId: string, itemsInput: Array<{ id?: string; category?: unknown; label?: unknown }>): Promise<PackingListItem[]> => {
  const items = sanitizePackingItems(itemsInput);
  if (!items.length) throw new Error('At least one packing item is required');
  const db = getDb();
  const existing = await userPackingCollection(userId).get();
  const batch = db.batch();
  existing.docs.forEach((doc: any) => batch.delete(doc.ref));
  items.forEach((item) => batch.set(userPackingCollection(userId).doc(), {
    category: item.category,
    label: item.label,
    position: item.position,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  await batch.commit();
  return getUserPackingList(userId);
};

export const getTripPackingList = async (userId: string, tripId: string): Promise<{ items: TripPackingList[]; travelers: PackingListTraveler[] }> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  await ensureTripPackingList(tripId);
  const members = await listGroupMembers(access.groupId, userId);
  const travelers = members
    .filter((member) => !member.removedAt)
    .map((member) => ({
      id: member.id,
      userId: member.userId ?? null,
      name: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.guestName || member.email || 'Traveler',
      email: member.email ?? null,
  }));
  const [itemSnap, checkSnap] = await Promise.all([
    orderedCollectionSnapshot(tripPackingCollection(tripId), 'position'),
    tripPackingChecksCollection(tripId).where('packed', '==', true).get(),
  ]);
  const packedBy = new Map<string, string[]>();
  checkSnap.docs.forEach((doc: any) => {
    const data = doc.data() as any;
    const itemId = String(data.itemId ?? '');
    const travelerId = String(data.travelerId ?? '');
    if (!itemId || !travelerId) return;
    packedBy.set(itemId, [...(packedBy.get(itemId) ?? []), travelerId]);
  });
  const items = itemSnap.docs.map((doc, index) => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      category: data.category ?? '',
      label: data.label ?? '',
      position: Number(data.position ?? index),
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
      packedBy: packedBy.get(doc.id) ?? [],
    };
  });
  return { items, travelers };
};

export const replaceTripPackingList = async (userId: string, tripId: string, itemsInput: Array<{ id?: string; category?: unknown; label?: unknown }>): Promise<{ items: TripPackingList[]; travelers: PackingListTraveler[] }> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const items = sanitizePackingItems(itemsInput);
  if (!items.length) throw new Error('At least one packing item is required');
  const existingItems = await tripPackingCollection(tripId).get();
  const checks = await tripPackingChecksCollection(tripId).get();
  const batch = getDb().batch();
  existingItems.docs.forEach((doc: any) => batch.delete(doc.ref));
  checks.docs.forEach((doc: any) => batch.delete(doc.ref));
  items.forEach((item) => batch.set(tripPackingCollection(tripId).doc(), {
    category: item.category,
    label: item.label,
    position: item.position,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  await batch.commit();
  return getTripPackingList(userId, tripId);
};

export const setTripPackingItemPacked = async (userId: string, tripId: string, itemId: string, travelerId: string, packed: boolean): Promise<void> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const [item, member] = await Promise.all([
    tripPackingCollection(tripId).doc(itemId).get(),
    getDb().collection('group_members').doc(travelerId).get(),
  ]);
  if (!item.exists || !member.exists || (member.data() as any).groupId !== access.groupId || (member.data() as any).removedAt) {
    throw new Error('Packing item or traveler not found');
  }
  const ref = tripPackingChecksCollection(tripId).doc(`${itemId}_${travelerId}`);
  if (packed) {
    await ref.set({ itemId, travelerId, packed: true, updatedAt: nowIso() }, { merge: true });
  } else {
    await ref.delete();
  }
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
  if (!groups.empty) {
    await rebuildGroupAccessForGroup(groups.docs[0].id);
    return;
  }
  const groupId = randomUUID();
  await db.collection('groups').doc(groupId).set({ ownerId: userId, name: 'My Trips', createdAt: nowIso() });
  await db.collection('group_members').doc(randomUUID()).set({
    groupId,
    userId,
    email: normalizeEmail(email),
    addedBy: userId,
    createdAt: nowIso(),
    removedAt: null,
  });
  await rebuildGroupAccessForGroup(groupId);
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
  const found = await findUserByEmailDoc(email);
  if (!found) return null;
  const data = found.data as User;
  return { id: found.id, email: data.email, username: data.username, provider: data.provider, role: (data.role ?? 'user') as UserRole, is_internal_canary: data.is_internal_canary === true };
};

export const findUserByIdentifier = async (identifier: string): Promise<User | null> => {
  const normalized = normalizeLoginIdentifier(identifier);
  if (!isEmailLikeIdentifier(normalized)) {
    const usersByUsername = await getDb().collection('users').where('username', '==', normalized).limit(1).get();
    if (usersByUsername.empty) return null;
    const doc = usersByUsername.docs[0];
    const data = doc.data() as User;
    return { id: doc.id, email: data.email, username: data.username, provider: data.provider, role: (data.role ?? 'user') as UserRole, is_internal_canary: data.is_internal_canary === true };
  }
  return findUserByEmail(normalized);
};

export const isInternalCanaryAccount = async (userId: string): Promise<boolean> => {
  const doc = await getDb().collection('users').doc(userId).get();
  if (!doc.exists) return false;
  return (doc.data() as User | undefined)?.is_internal_canary === true;
};

export const ensureCanaryAccountBootstrap = async (email: string): Promise<{ id: string }> => {
  const existing = await findUserByEmailDoc(email);
  if (existing) {
    await getDb().collection('users').doc(existing.id).set({ is_internal_canary: true }, { merge: true });
    return { id: existing.id };
  }
  const doc = getDb().collection('users').doc();
  await doc.set({
    email: normalizeEmail(email),
    provider: 'email',
    role: 'user',
    is_internal_canary: true,
    createdAt: nowIso(),
  });
  return { id: doc.id };
};

export const createWebUser = async (
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  usernameInput?: string,
  dateOfBirth?: string | null
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
      ...(dateOfBirth ? { dateOfBirth } : {}),
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
      dateOfBirth: updatedUserData.dateOfBirth ?? dateOfBirth ?? null,
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
    ...(dateOfBirth ? { dateOfBirth } : {}),
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
  return { id, email: normalizedEmail, firstName, lastName, emailVerified: false, dateOfBirth: dateOfBirth ?? null };
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

const mapUserDoc = (doc: FirebaseFirestore.DocumentSnapshot): User | null => {
  if (!doc.exists) return null;
  const data = doc.data() as any;
  // Combine all possible field name variants (camel/snake) into a consistent User object.
  // This handles parity with Postgres (snake) and legacy Firebase (camel) implementations.
  return {
    ...data,
    id: doc.id,
    firstName: data.firstName ?? data.first_name,
    lastName: data.lastName ?? data.last_name,
    emailVerified: data.emailVerified ?? data.email_verified,
    emailVerifiedAt: data.emailVerifiedAt ?? data.email_verified_at,
    apple_id: data.apple_id ?? data.appleId,
    google_id: data.google_id ?? data.googleId,
    username: data.username,
    username_normalized: data.username_normalized ?? data.usernameNormalized,
    role: (data.role ?? 'user') as UserRole,
  };
};

export const getUserById = async (userId: string): Promise<User | null> => {
  const doc = await getDb().collection('users').doc(userId).get();
  return mapUserDoc(doc);
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

export const listUserEmails = async (userId: string): Promise<AccountEmail[]> => {
  const stored = await listStoredUserEmails(userId);
  if (stored.length) {
    return stored.map(({ email, isPrimary, isVerified, verifiedAt, createdAt }) => ({
      email,
      isPrimary,
      isVerified,
      verifiedAt: verifiedAt ?? null,
      createdAt: createdAt ?? null,
    }));
  }
  const db = getDb();
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return [];
  const email = String((userDoc.data() as any).email ?? '').trim().toLowerCase();
  if (!email) return [];
  const isVerified = Boolean((userDoc.data() as any).emailVerified ?? true);
  const verifiedAt = isVerified ? nowIso() : null;
  const createdAt = nowIso();
  await upsertUserEmail(userId, email, { isPrimary: true, isVerified, verifiedAt });
  return [{ email, isPrimary: true, isVerified, verifiedAt, createdAt }];
};

export const addUserEmail = async (userId: string, email: string): Promise<AccountEmail> => {
  const normalizedEmail = normalizeEmail(email);
  const existing = await getUserEmailDocRef(normalizedEmail).get();
  if (existing.exists && String((existing.data() as any).userId ?? '') !== userId) {
    const err: any = new Error('Email is already associated with another account');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  await upsertUserEmail(userId, normalizedEmail, { isPrimary: false, isVerified: false, verifiedAt: null });
  const saved = (await getUserEmailDocRef(normalizedEmail).get()).data() as any;
  return {
    email: normalizedEmail,
    isPrimary: Boolean(saved?.isPrimary),
    isVerified: Boolean(saved?.isVerified),
    verifiedAt: saved?.verifiedAt ?? null,
    createdAt: saved?.createdAt ?? null,
  };
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

export const setPrimaryUserEmail = async (userId: string, email: string): Promise<AccountEmail[]> => {
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

export const removeUserEmail = async (userId: string, email: string): Promise<AccountEmail[]> => {
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
      temperatureUnit: data.temperatureUnit ?? null,
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
      temperatureUnit: data.temperatureUnit ?? null,
    };
  }

  return null;
};

export const updateWebUserProfile = async (
  userId: string,
  payload: {
    firstName?: string;
    lastName?: string;
    email?: string;
    homeAddress?: string;
    preferredAirport?: string;
    mapPreference?: string;
    appearancePreference?: string;
    temperatureUnit?: string;
    age?: number;
    gender?: string;
  }
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
    temperatureUnit:
      (payload as any).temperatureUnit === 'fahrenheit' || (payload as any).temperatureUnit === 'celsius'
        ? (payload as any).temperatureUnit
        : typeof (payload as any).temperatureUnit === 'undefined'
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
    temperatureUnit: data.temperatureUnit ?? null,
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
    billingSubscriptions,
  ] = await Promise.all([
    db.collection('group_members').where('userId', '==', userId).get(),
    db.collection('group_invites').where('inviteeUserId', '==', userId).get(),
    db.collection('group_access').where('userId', '==', userId).get(),
    db.collection('trip_access').where('userId', '==', userId).get(),
    db.collection('trip_followers').where('followerUserId', '==', userId).get(),
    db.collection('trip_removals').where('userId', '==', userId).get(),
    db.collection('user_emails').where('userId', '==', userId).get(),
    db.collection('billing_subscriptions').where('userId', '==', userId).get(),
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
    db.collection('billing_customers').doc(userId),
    ...billingSubscriptions.docs.map((doc) => doc.ref),
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
    groupId?: string;
    userId?: string | null;
    guestName?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    preferredAirport?: string | null;
    isGroupOwner?: boolean;
    status?: string;
    removedAt?: string | null;
    addedBy?: string | null;
    createdAt?: string | null;
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
      groupId: data.groupId ?? groupId,
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
      addedBy: data.addedBy ?? null,
      createdAt: data.createdAt ?? null,
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

export const listGroupsForUser = async (
  userId: string,
  sort: 'created' | 'name' = 'created'
): Promise<Array<Group & { members: GroupMember[]; invites: { id: string; inviteeEmail: string; status: string }[] }>> => {
  const db = getDb();
  const groupIds = await listReadableGroupIdsForUser(userId);
  if (!groupIds.length) return [];
  const groupsSnap = await db.collection('groups').where(FieldPath.documentId(), 'in', groupIds).get();
  const groups = await Promise.all(groupsSnap.docs.map(async (g) => {
    const data = g.data() as any;
    const rawMembers = await listGroupMembers(g.id, userId).catch(() => []);
    const members: GroupMember[] = rawMembers.map((m) => ({
      ...m,
      groupId: m.groupId ?? g.id,
      userId: m.userId ?? undefined,
      addedBy: m.addedBy ?? '',
      createdAt: m.createdAt ?? '',
    }));
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
  if (sort === 'name') {
    groups.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  } else {
    groups.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }
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
  const tripIds = await listWritableTripIdsForUser(userId);
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
        mustSeeAttractions: Array.isArray(data.mustSeeAttractions) ? data.mustSeeAttractions : [],
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
  details: Partial<Trip> = {}
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
    mustSeeAttractions: Array.isArray(details.mustSeeAttractions) ? details.mustSeeAttractions : [],
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
  await ensureTripPackingList(id);
  const activeUserIds = await listActiveGroupUserIds(groupId);
  await Promise.all(activeUserIds.map((memberUserId) => incrementAdminUserTripCount(memberUserId, 1, payload.createdAt)));
  return { id, ...payload } as any;
};

export const updateTripDetails = async (
  userId: string,
  tripId: string,
  updates: Partial<Trip>
): Promise<Trip> => {
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) throw new Error('Trip not found');
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
      mustSeeAttractions: Array.isArray(updates.mustSeeAttractions) ? updates.mustSeeAttractions : (Array.isArray(data.mustSeeAttractions) ? data.mustSeeAttractions : []),
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

// Deletes every artifact scoped to a trip once the last active traveler has
// left it — Firestore has no FK cascade, so (unlike the Postgres adapter,
// which relies on ON DELETE CASCADE for most of these tables) each
// collection must be cleared explicitly here.
const deleteAllTripArtifacts = async (tripId: string): Promise<void> => {
  const db = getDb();

  const deleteQueryBatch = async (query: any): Promise<void> => {
    const snap = await query.get();
    if (!snap.size) return;
    const batch = db.batch();
    snap.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
  };

  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };

  // Itineraries + their details/checklist items/reactions.
  const itinerariesSnap = await db.collection('itineraries').where('tripId', '==', tripId).get();
  for (const itineraryDoc of itinerariesSnap.docs) {
    const detailsSnap = await db.collection('itinerary_details').where('itineraryId', '==', itineraryDoc.id).get();
    const detailIds = detailsSnap.docs.map((d) => d.id);
    for (const ids of chunk(detailIds)) {
      await deleteQueryBatch(db.collection('itinerary_checklist_items').where('detailId', 'in', ids));
    }
    if (detailsSnap.size) {
      const batch = db.batch();
      detailsSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    await itineraryDoc.ref.delete();
  }
  await deleteQueryBatch(db.collection('itinerary_detail_reactions').where('tripId', '==', tripId));

  // Chat: messages, their per-message reads, and the per-user watermark.
  const messagesSnap = await db.collection('trip_messages').where('tripId', '==', tripId).get();
  const messageIds = messagesSnap.docs.map((d) => d.id);
  for (const ids of chunk(messageIds)) {
    await deleteQueryBatch(db.collection('message_reads').where('messageId', 'in', ids));
  }
  if (messagesSnap.size) {
    const batch = db.batch();
    messagesSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  await deleteQueryBatch(db.collection('chat_read_watermarks').where('tripId', '==', tripId));

  // Packing list nested subcollections are keyed directly by tripId.
  await deleteQueryBatch(tripPackingCollection(tripId));
  await deleteQueryBatch(tripPackingChecksCollection(tripId));

  // Remaining trip-scoped collections and booking records (deleted
  // unconditionally here regardless of remaining traveler ids, since the
  // trip itself is going away).
  await deleteQueryBatch(db.collection('car_rentals').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('item_votes').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('trip_activity').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('trip_comments').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('trip_followers').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('follow_codes').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('trip_share_invites').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('trip_payments').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('trip_removals').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('expenses').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('flights').where('tripId', '==', tripId));
  await deleteQueryBatch(db.collection('lodgings').where('trip_id', '==', tripId));
  await deleteQueryBatch(db.collection('tours').where('tripId', '==', tripId));
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
    await deleteAllTripArtifacts(tripId);
    await trip.ref.delete();
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
  members: Array<{ email?: string; guestName?: string }>
): Promise<{ groupId: string; invites: { id: string; email: string }[] }> => {
  const db = getDb();
  const groupId = randomUUID();
  await db.collection('groups').doc(groupId).set({ ownerId, name: groupName, createdAt: nowIso() });
  await db
    .collection('group_members')
    .doc(randomUUID())
    .set({ groupId, userId: ownerId, addedBy: ownerId, createdAt: nowIso(), removedAt: null });
  const invites: { id: string; email: string }[] = [];
  for (const member of members) {
    const guestName = member.guestName?.trim();
    if (guestName) {
      await db.collection('group_members').doc(randomUUID()).set({
        groupId,
        guestName,
        addedBy: ownerId,
        createdAt: nowIso(),
        removedAt: null,
      });
      continue;
    }
    const normalized = member.email ? normalizeEmail(member.email) : '';
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
  mustSeeAttractions?: string[];
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
    payload.members
  );
  const trip = await createTrip(payload.ownerId, group.groupId, payload.tripName, {
    description: payload.description ?? null,
    destination: payload.destination ?? null,
    locationIds: Array.isArray(payload.locationIds) ? payload.locationIds : [],
    mustSeeAttractions: Array.isArray(payload.mustSeeAttractions) ? payload.mustSeeAttractions : [],
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
      email: normalizeEmail(email ?? data.inviteeEmail ?? ''),
      inviteEmail: null,
      claimedAt: nowIso(),
      removedAt: null,
    });
  } else {
    await db.collection('group_members').doc(randomUUID()).set({
      groupId: data.groupId,
      userId,
      email: normalizeEmail(email ?? data.inviteeEmail ?? ''),
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
  const trips = await db.collection('trips').where('groupId', '==', data.groupId).get();
  await Promise.all(trips.docs.map((trip) => mergeUserPackingListIntoTrip(trip.id, userId)));
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
  if (role === 'member') {
    await mergeUserPackingListIntoTrip(tripId, userId);
  }
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
  if (role === 'member') {
    await mergeUserPackingListIntoTrip(tripId, userId);
  }
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

  // Block members from following their own trip — they already have full access.
  const tripForGroup = await db.collection('trips').doc(tripId).get();
  const groupId = tripForGroup.exists ? String((tripForGroup.data() as any).groupId ?? '') : '';
  if (groupId) {
    const memberSnap = await db
      .collection('group_members')
      .where('groupId', '==', groupId)
      .where('userId', '==', userId)
      .where('removedAt', '==', null)
      .limit(1)
      .get();
    if (!memberSnap.empty) throw new Error('You are already a member of this trip and cannot follow it.');
  }

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
    const activeMembership = await db
      .collection('group_members')
      .where('groupId', '==', trip.groupId)
      .where('userId', '==', userId)
      .where('removedAt', '==', null)
      .get();
    if (!activeMembership.empty) continue;
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

export const updateFlight = async (flightId: string, userId: string, updates: Partial<Flight>): Promise<Flight> => {
  const db = getDb();
  const doc = await db.collection('flights').doc(flightId).get();
  if (!doc.exists) throw new Error('Flight not found');
  const data = doc.data() as any;
  const tripId = (updates as any).tripId ?? (updates as any).trip_id ?? data.tripId ?? data.trip_id;
  if (!tripId) throw new Error('Flight not found');
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
    return mergeAirportSearchResults(exactResults, query);
  }

  // Fallback for partial airport queries when Firestore only has exact search tokens.
  const airports = await db.collection('airports').get().catch(() => null);
  if (!airports || airports.empty) return searchBundledAirportDataset(query);

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
    .map((airport) => airport.label)
    .filter(Boolean);

  return mergeAirportSearchResults(matches, query);
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
    popularityScore: payload.popularityScore != null && Number.isFinite(Number(payload.popularityScore)) ? Number(payload.popularityScore) : null,
    primaryTag: typeof payload.primaryTag === 'string' ? payload.primaryTag as AttractionCatalogEntry['primaryTag'] : null,
    wikipediaTitle: typeof payload.wikipediaTitle === 'string' ? payload.wikipediaTitle : null,
    wikipediaPageId: payload.wikipediaPageId != null && Number.isFinite(Number(payload.wikipediaPageId)) ? Number(payload.wikipediaPageId) : null,
    wikipediaSummary: typeof payload.wikipediaSummary === 'string' ? payload.wikipediaSummary : null,
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
  notes: data.notes ?? '',
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

const toDurationMetadataId = (destinationKey: string, name: string): string => {
  const clean = (value: string) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `attr-dur:${clean(destinationKey)}:${clean(name)}`.slice(0, 180);
};

const toAttractionDurationMetadata = (id: string, data: any): AttractionDurationMetadata | null => {
  const payload = data?.payload && typeof data.payload === 'object' ? data.payload : {};
  const destinationKey = String(payload.destinationKey ?? '').trim();
  const name = String(payload.name ?? '').trim();
  const estimatedDurationMinutes = Number(payload.estimatedDurationMinutes);
  if (!destinationKey || !name || !Number.isFinite(estimatedDurationMinutes)) return null;
  return {
    id,
    destinationKey,
    destinationDisplayName: String(payload.destinationDisplayName ?? '').trim(),
    name,
    activityType: String(payload.activityType ?? 'Tour') as AttractionDurationMetadata['activityType'],
    estimatedDurationMinutes,
    durationSource: payload.durationSource === 'override' ? 'override' : 'heuristic',
    requiresPreOrderTickets: Boolean(payload.requiresPreOrderTickets),
    preOrderNotes: typeof payload.preOrderNotes === 'string' ? payload.preOrderNotes : null,
    description: typeof payload.description === 'string' ? payload.description : null,
    descriptionSource:
      payload.descriptionSource === 'wikipedia' || payload.descriptionSource === 'catalog_snippet'
        ? payload.descriptionSource
        : null,
    updatedAt: String(data.updatedAt ?? nowIso()),
  };
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
    popularityScore: entry.popularityScore != null && Number.isFinite(Number(entry.popularityScore)) ? Number(entry.popularityScore) : null,
    primaryTag: entry.primaryTag ?? null,
    wikipediaTitle: entry.wikipediaTitle ?? null,
    wikipediaPageId: entry.wikipediaPageId != null && Number.isFinite(Number(entry.wikipediaPageId)) ? Number(entry.wikipediaPageId) : null,
    wikipediaSummary: entry.wikipediaSummary ?? null,
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

const toItineraryPlanCacheEntry = (id: string, data: any): ItineraryPlanCacheEntry | null => {
  if (!data?.cacheKey || !['route', 'day'].includes(data.stage) || !data.signature || !data.dependencyFingerprint) return null;
  // payload and fragments are stored as JSON strings because they can contain
  // nested arrays (e.g. PromptDay.it), which Firestore rejects.
  let payload = data.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      // return null if payload is unparseable
      return null;
    }
  }
  let fragments = data.fragments;
  if (typeof fragments === 'string') {
    try {
      fragments = JSON.parse(fragments);
    } catch {
      fragments = [];
    }
  }
  return { id, cacheKey: String(data.cacheKey), stage: data.stage, signature: String(data.signature), dependencyFingerprint: String(data.dependencyFingerprint), payload, fragments: Array.isArray(fragments) ? fragments : [], expiresAt: String(data.expiresAt), updatedAt: String(data.updatedAt ?? nowIso()) };
};

export const getItineraryPlanCacheEntry = async (cacheKey: string): Promise<ItineraryPlanCacheEntry | null> => {
  const doc = await getDb().collection('itinerary_plan_cache').doc(cacheKey).get();
  return doc.exists ? toItineraryPlanCacheEntry(doc.id, doc.data()) : null;
};

export const upsertItineraryPlanCacheEntry = async (entry: ItineraryPlanCacheEntry): Promise<ItineraryPlanCacheEntry> => {
  const ref = getDb().collection('itinerary_plan_cache').doc(entry.id);
  // payload and fragments can contain arrays nested directly inside arrays
  // (e.g. PromptDay.it), which Firestore rejects outright
  // ("Property payload contains an invalid nested entity").
  await ref.set({
    cacheKey: entry.cacheKey,
    stage: entry.stage,
    signature: entry.signature,
    dependencyFingerprint: entry.dependencyFingerprint,
    payload: JSON.stringify(entry.payload),
    fragments: JSON.stringify(entry.fragments ?? []),
    expiresAt: entry.expiresAt,
    updatedAt: nowIso(),
  });
  const saved = await ref.get();
  const parsed = toItineraryPlanCacheEntry(saved.id, saved.data());
  if (!parsed) throw new Error('Failed to parse itinerary plan cache entry after upsert.');
  return parsed;
};

export const getAttractionDurationMetadata = async (
  _userId: string,
  destinationKey: string,
  name: string
): Promise<AttractionDurationMetadata | null> => {
  const key = String(destinationKey ?? '').trim().toLowerCase();
  const cleanName = String(name ?? '').trim().toLowerCase();
  if (!key || !cleanName) return null;
  const id = toDurationMetadataId(key, cleanName);
  const db = getDb();
  const doc = await db.collection('locations').doc(id).get();
  if (!doc.exists) return null;
  return toAttractionDurationMetadata(doc.id, doc.data() as any);
};

export const listAttractionDurationMetadataByDestination = async (
  _userId: string,
  destinationKey: string
): Promise<AttractionDurationMetadata[]> => {
  const key = String(destinationKey ?? '').trim().toLowerCase();
  if (!key) return [];
  const db = getDb();
  const snapshot = await db
    .collection('locations')
    .where('sourceType', '==', 'attraction_duration_metadata')
    .where('destinationKey', '==', key)
    .get();
  return snapshot.docs
    .map((doc) => toAttractionDurationMetadata(doc.id, doc.data()))
    .filter(Boolean) as AttractionDurationMetadata[];
};

// Manual cache-invalidation trigger (plan §2C "Maintainability" requirement):
// mirrors db.postgres.ts's deleteAttractionDurationMetadata for adapter parity.
export const deleteAttractionDurationMetadata = async (
  destinationKey: string,
  name?: string | null
): Promise<number> => {
  const key = String(destinationKey ?? '').trim().toLowerCase();
  if (!key) return 0;
  const db = getDb();
  if (name && String(name).trim()) {
    const id = toDurationMetadataId(key, String(name).trim().toLowerCase());
    const docRef = db.collection('locations').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return 0;
    await docRef.delete();
    return 1;
  }
  const snapshot = await db
    .collection('locations')
    .where('sourceType', '==', 'attraction_duration_metadata')
    .where('destinationKey', '==', key)
    .get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
};

export const upsertAttractionDurationMetadata = async (
  entry: AttractionDurationMetadata
): Promise<AttractionDurationMetadata> => {
  const db = getDb();
  const id = toDurationMetadataId(entry.destinationKey, entry.name);
  const payload = {
    destinationKey: entry.destinationKey,
    destinationDisplayName: entry.destinationDisplayName,
    name: entry.name,
    activityType: entry.activityType,
    estimatedDurationMinutes: Number(entry.estimatedDurationMinutes) || 0,
    durationSource: entry.durationSource ?? 'heuristic',
    requiresPreOrderTickets: Boolean(entry.requiresPreOrderTickets),
    preOrderNotes: entry.preOrderNotes ?? null,
    description: entry.description ?? null,
    descriptionSource: entry.descriptionSource ?? null,
    updatedAt: entry.updatedAt,
  };
  const docRef = db.collection('locations').doc(id);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    const existing = doc.exists ? (doc.data() as any) : {};
    const mergedPayload = { ...(existing.payload || {}), ...payload };
    tx.set(
      docRef,
      {
        id,
        sourceType: 'attraction_duration_metadata',
        category: 'attraction_duration_metadata',
        name: entry.name,
        address: null,
        searchName: `${entry.name} ${entry.destinationDisplayName} attraction duration`.toLowerCase(),
        // Top-level destinationKey for indexed Firestore compound queries
        destinationKey: String(entry.destinationKey ?? '').trim().toLowerCase(),
        payload: mergedPayload,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
  });
  const saved = await docRef.get();
  const parsed = toAttractionDurationMetadata(saved.id, saved.data() as any);
  if (!parsed) {
    throw new Error('Failed to parse attraction duration metadata after upsert.');
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
  status?: string;
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
  imageUrl?: string | null;
  image_url?: string;
}): Promise<Lodging> => {
  const db = getDb();

  const placeId = lodging.place_id || lodging.placeId;
  if (placeId) {
    const { ensureLodgingLocation } = require('./services/lodgingLocationService');
    await ensureLodgingLocation(placeId, lodging.name, lodging.address);
  }

  const id = randomUUID();
  const payload: Lodging = {
    id,
    user_id: lodging.userId,
    trip_id: lodging.tripId,
    status: normalizeItineraryStatus(lodging.status),
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

  const placeId = updates.place_id || (updates as any).placeId;
  if (placeId) {
    const { ensureLodgingLocation } = require('./services/lodgingLocationService');
    await ensureLodgingLocation(placeId, updates.name || data.name, updates.address || data.address);
  }

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
  const current = normalizeActivityRecord(doc.data()) as Activity;
  const membership = await ensureUserInTrip(current.tripId, userId);
  if (!membership) return null;
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

export const deleteActivity = async (tourId: string, userId: string): Promise<boolean> => {
  const db = getDb();
  const doc = await db.collection('tours').doc(tourId).get();
  if (!doc.exists) return false;
  const current = normalizeActivityRecord(doc.data()) as Activity;
  const membership = await ensureUserInTrip(current.tripId, userId);
  if (!membership) return false;
  await db.collection('tours').doc(tourId).delete();
  return true;
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

export const getItineraryDetailContext = async (
  detailId: string
): Promise<{ tripId: string; itineraryId: string } | null> => {
  const db = getDb();
  const detail = await db.collection('itinerary_details').doc(detailId).get();
  if (!detail.exists) return null;
  const detailData = detail.data() as any;
  const itineraryId = String(detailData?.itineraryId ?? '');
  if (!itineraryId) return null;
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) return null;
  const tripId = String((itinerary.data() as any)?.tripId ?? '');
  if (!tripId) return null;
  return { tripId, itineraryId };
};

const getReactionDocId = (detailId: string, userId: string): string => `${detailId}_${userId}`;

export const castItineraryDetailReaction = async (
  userId: string,
  tripId: string,
  detailId: string,
  value: 1 | -1
): Promise<void> => {
  const db = getDb();
  const ref = db.collection('itinerary_detail_reactions').doc(getReactionDocId(detailId, userId));
  const existing = await ref.get();
  const payload = { tripId, detailId, userId, value, updatedAt: nowIso() };
  if (existing.exists) {
    await ref.update(payload);
    return;
  }
  await ref.set({ ...payload, createdAt: nowIso() });
};

export const clearItineraryDetailReaction = async (
  userId: string,
  detailId: string
): Promise<void> => {
  const db = getDb();
  await db.collection('itinerary_detail_reactions').doc(getReactionDocId(detailId, userId)).delete();
};

export const getItineraryDetailReactionSummaries = async (
  userId: string,
  detailIds: string[]
): Promise<Record<string, { score: number; upCount: number; downCount: number; userValue: 1 | -1 | null }>> => {
  const normalized = Array.from(new Set((detailIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
  const result: Record<string, { score: number; upCount: number; downCount: number; userValue: 1 | -1 | null }> = {};
  normalized.forEach((id) => {
    result[id] = { score: 0, upCount: 0, downCount: 0, userValue: null };
  });
  if (!normalized.length) return result;
  const db = getDb();
  const chunk = <T>(items: T[], size = 10): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };
  for (const ids of chunk(normalized)) {
    const snap = await db
      .collection('itinerary_detail_reactions')
      .where('detailId', 'in', ids)
      .get();
    snap.docs.forEach((doc) => {
      const row = doc.data() as any;
      const detailId = String(row.detailId ?? '');
      if (!result[detailId]) return;
      const value: 1 | -1 = row.value === -1 ? -1 : 1;
      result[detailId].score += value;
      if (value === 1) result[detailId].upCount += 1;
      else result[detailId].downCount += 1;
      if (String(row.userId) === String(userId)) {
        result[detailId].userValue = value;
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
  vendor?: string | null;
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
    vendor: expense.vendor ?? null,
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
  vendor?: string | null;
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
    vendor: expense.vendor ?? null,
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

export const updateTrait = async (userId: string, traitId: string, updates: Partial<Trait>): Promise<Trait> => {
  const db = getDb();
  const doc = await db.collection('traits').doc(traitId).get();
  if (!doc.exists) throw new Error('Trait not found');
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
  let data: any[] = [];
  try {
    data = await downloadAirportDatasetForDailyRefresh();
  } catch (err) {
    logError('Failed to download airports dataset, falling back to local file', err);
    try {
      const localPath = path.resolve(__dirname, '../data/airport_codes.json');
      if (fs.existsSync(localPath)) {
        data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        logInfo(`[airports] Loaded ${Array.isArray(data) ? data.length : 0} airports from local fallback`);
      }
    } catch (localErr) {
      logError('Failed to load local airports fallback', localErr);
      return;
    }
  }

  const filtered = normalizeAirportDataset(data);
  if (!filtered.length) {
    logError('[airports] no records to process', null);
    return;
  }

  const db = getDb();
  const chunkSize = 400; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < filtered.length; i += chunkSize) {
    const chunk = filtered.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const airport of chunk) {
      const search = Array.from(
        new Set(
          [
            airport.iata_code.toLowerCase(),
            airport.city.toLowerCase(),
            ...airport.name.toLowerCase().split(/\s+/),
          ].filter(Boolean)
        )
      );
      batch.set(db.collection('airports').doc(airport.iata_code), {
        iata_code: airport.iata_code,
        name: airport.name,
        city: airport.city,
        country: airport.country,
        lat: airport.lat,
        lng: airport.lng,
        label: airport.label,
        search,
        updatedAt: nowIso(),
      });
    }
    try {
      await batch.commit();
    } catch (err) {
      logError('Failed to refresh airports batch', err);
    }
  }
  logInfo(`[airports] Refreshed ${filtered.length} airports in Firestore`);
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

export const listTraitsForGroupTrip = async (
  userId: string,
  tripId: string
): Promise<Array<{ userId: string; name: string; traits: string[] }>> => {
  const db = getDb();
  const tripDoc = await db.collection('trips').doc(tripId).get();
  if (!tripDoc.exists) throw new Error('Trip not found');
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized for this trip');
  const groupId = (tripDoc.data() as any).groupId;
  const members = await listGroupMembers(groupId, userId);
  const memberUserIds = Array.from(
    new Set(members.map((m) => m.userId).filter((id): id is string => typeof id === 'string' && id.length > 0))
  );
  const traitsByUser = new Map<string, string[]>();
  await Promise.all(
    memberUserIds.map(async (id) => {
      const traits = await listTraits(id);
      traitsByUser.set(id, traits.map((t) => t.name));
    })
  );
  return members
    .filter((m) => typeof m.userId === 'string' && m.userId.length > 0)
    .map((m) => ({
      userId: m.userId as string,
      name: m.firstName?.trim() || m.email || 'Traveler',
      traits: traitsByUser.get(m.userId as string) ?? [],
    }));
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
    .where('destinationLower', '==', normalizedDestination)
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
  // destinationLower is a Firestore-only field enabling case-insensitive dupe
  // detection (Firestore has no LOWER()-equivalent query operator, unlike the
  // postgres adapter's `LOWER(destination) = LOWER($2)`); not part of the
  // Itinerary type since callers never read it back.
  await db.collection('itineraries').doc(id).set({ ...payload, destinationLower: normalizedDestination });

  return { ...payload, tripName };
};

export const deleteItineraryRecord = async (userId: string, itineraryId: string): Promise<void> => {
  const db = getDb();
  const doc = await db.collection('itineraries').doc(itineraryId).get();
  if (!doc.exists) throw new Error('Itinerary not found');
  const tripId = (doc.data() as any).tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to delete this itinerary');
  await db.collection('itineraries').doc(itineraryId).delete();
};

export const updateItineraryRecord = async (
  userId: string,
  itineraryId: string,
  destination: string,
  days: number,
  budget?: number | null
): Promise<Itinerary & { tripName: string }> => {
  const db = getDb();
  const doc = await db.collection('itineraries').doc(itineraryId).get();
  if (!doc.exists) throw new Error('Itinerary not found');
  const tripId = (doc.data() as any).tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');

  const normalizedDestination = destination.trim().toLowerCase();
  const roundedDays = Math.max(1, Math.round(days));
  const budgetValue = budget ?? null;

  const dupeQuery = await db
    .collection('itineraries')
    .where('tripId', '==', tripId)
    .where('destinationLower', '==', normalizedDestination)
    .where('days', '==', roundedDays)
    .where('budget', '==', budgetValue)
    .get();
  if (dupeQuery.docs.some((d) => d.id !== itineraryId)) {
    const err = new Error('Itinerary already exists for this trip');
    (err as any).code = 'ITINERARY_EXISTS';
    throw err;
  }

  await db.collection('itineraries').doc(itineraryId).update({
    destination: destination.trim(),
    destinationLower: normalizedDestination,
    days: roundedDays,
    budget: budgetValue,
    updatedAt: nowIso(),
  });
  const updated = await db.collection('itineraries').doc(itineraryId).get();
  const trip = await db.collection('trips').doc(tripId).get();
  const tripName = trip.exists ? (trip.data() as Trip).name : '';
  return { ...(updated.data() as Itinerary), tripName };
};

export const listItineraryDetails = async (userId: string, itineraryId: string): Promise<ItineraryDetail[]> => {
  const db = getDb();
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) throw new Error('Itinerary not found');
  const itineraryData = itinerary.data() as any;
  const membership = await ensureUserCanReadTrip(String(itineraryData.tripId ?? ''), userId);
  if (!membership) throw new Error('Not authorized');
  const detailDocs = await db.collection('itinerary_details').where('itineraryId', '==', itineraryId).get();
  const details = detailDocs.docs.map((d) => d.data() as ItineraryDetail);
  if (!details.length) return [];
  const detailIds = details.map((d) => d.id);
  const childrenByDetail = new Map<string, ItineraryChecklistItem[]>();
  // Firestore 'in' operator caps at 10 ids per query.
  for (let i = 0; i < detailIds.length; i += 10) {
    const chunk = detailIds.slice(i, i + 10);
    const childDocs = await db
      .collection('itinerary_checklist_items')
      .where('detailId', 'in', chunk)
      .get();
    childDocs.docs.forEach((doc) => {
      const child = doc.data() as ItineraryChecklistItem;
      const list = childrenByDetail.get(child.detailId) ?? [];
      list.push(child);
      childrenByDetail.set(child.detailId, list);
    });
  }
  for (const list of childrenByDetail.values()) {
    list.sort((a, b) => a.position - b.position);
  }
  return details.map((d) => ({
    ...d,
    kind: (d.kind as ItineraryDetailKind) ?? 'activity',
    checklistItems: childrenByDetail.get(d.id) ?? [],
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
  const db = getDb();
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) throw new Error('Itinerary not found');

  const tripId = (itinerary.data() as Itinerary).tripId;
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');

  const id = randomUUID();
  const kind: ItineraryDetailKind = detail.kind ?? 'activity';
  const payload: ItineraryDetail = {
    id,
    itineraryId,
    day: Math.max(1, Math.round(detail.day)),
    time: detail.time ?? null,
    activity: detail.activity.trim(),
    cost: detail.cost ?? null,
    kind,
    placeId: detail.placeId ?? null,
    noteBody: detail.noteBody ?? null,
    position: detail.position != null ? Math.round(detail.position) : 0,
    updatedAt: nowIso(),
  };
  await db.collection('itinerary_details').doc(id).set(payload);

  let createdChildren: ItineraryChecklistItem[] = [];
  if (kind === 'checklist' && Array.isArray(detail.checklistItems) && detail.checklistItems.length) {
    for (let idx = 0; idx < detail.checklistItems.length; idx += 1) {
      const child = detail.checklistItems[idx];
      const label = String(child.label ?? '').trim();
      if (!label) continue;
      const childId = randomUUID();
      const childPayload: ItineraryChecklistItem = {
        id: childId,
        detailId: id,
        position: child.position != null ? Math.round(child.position) : idx,
        label,
        checkedBy: null,
        checkedAt: null,
        createdAt: nowIso(),
      };
      await db.collection('itinerary_checklist_items').doc(childId).set(childPayload);
      createdChildren.push(childPayload);
    }
  }

  await writeActivity(tripId, userId, 'ITINERARY_ITEM_ADDED', 'Itinerary item added', payload.activity, {
    itineraryId,
    detailId: id,
    day: payload.day,
    time: payload.time ?? null,
    cost: payload.cost ?? null,
    kind,
  });
  return { ...payload, checklistItems: createdChildren };
};

export const deleteItineraryDetail = async (userId: string, detailId: string): Promise<void> => {
  const db = getDb();
  const detail = await db.collection('itinerary_details').doc(detailId).get();
  if (!detail.exists) throw new Error('Itinerary detail not found');
  const detailData = detail.data() as any;
  const itineraryId = detailData.itineraryId;
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) throw new Error('Itinerary detail not found');
  const tripId = String((itinerary.data() as any).tripId ?? '');
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
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
): Promise<ItineraryDetail> => {
  const db = getDb();
  const detail = await db.collection('itinerary_details').doc(detailId).get();
  if (!detail.exists) throw new Error('Itinerary detail not found');
  const itineraryId = (detail.data() as any).itineraryId;
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) throw new Error('Itinerary detail not found');
  const tripId = String((itinerary.data() as any).tripId ?? '');
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  await db.collection('itinerary_details').doc(detailId).update({ ...updates, updatedAt: nowIso() });
  const updated = await db.collection('itinerary_details').doc(detailId).get();
  const payload = updated.data() as ItineraryDetail;
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

export const addItineraryChecklistItem = async (
  userId: string,
  detailId: string,
  input: { label: string; position?: number }
): Promise<ItineraryChecklistItem> => {
  const db = getDb();
  const detail = await db.collection('itinerary_details').doc(detailId).get();
  if (!detail.exists) throw new Error('Itinerary detail not found');
  const detailData = detail.data() as any;
  if (detailData.kind !== 'checklist') throw new Error('Detail is not a checklist');
  const itinerary = await db.collection('itineraries').doc(String(detailData.itineraryId)).get();
  if (!itinerary.exists) throw new Error('Itinerary not found');
  const tripId = String((itinerary.data() as any).tripId ?? '');
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  const label = String(input.label ?? '').trim();
  if (!label) throw new Error('Label is required');

  let position = input.position;
  if (position == null) {
    const existing = await db
      .collection('itinerary_checklist_items')
      .where('detailId', '==', detailId)
      .get();
    position = existing.docs.reduce(
      (max, doc) => Math.max(max, Number((doc.data() as any).position ?? 0) + 1),
      0
    );
  }

  const id = randomUUID();
  const payload: ItineraryChecklistItem = {
    id,
    detailId,
    position: Math.round(position),
    label,
    checkedBy: null,
    checkedAt: null,
    createdAt: nowIso(),
  };
  await db.collection('itinerary_checklist_items').doc(id).set(payload);
  return payload;
};

const loadChecklistItemContextFirebase = async (
  itemId: string
): Promise<{ tripId: string; detailId: string; itineraryId: string } | null> => {
  const db = getDb();
  const item = await db.collection('itinerary_checklist_items').doc(itemId).get();
  if (!item.exists) return null;
  const itemData = item.data() as any;
  const detail = await db.collection('itinerary_details').doc(String(itemData.detailId ?? '')).get();
  if (!detail.exists) return null;
  const itineraryId = String((detail.data() as any).itineraryId ?? '');
  const itinerary = await db.collection('itineraries').doc(itineraryId).get();
  if (!itinerary.exists) return null;
  const tripId = String((itinerary.data() as any).tripId ?? '');
  if (!tripId) return null;
  return { tripId, detailId: String(itemData.detailId), itineraryId };
};

export const updateItineraryChecklistItem = async (
  userId: string,
  itemId: string,
  patch: { label?: string; checked?: boolean; position?: number }
): Promise<ItineraryChecklistItem> => {
  const db = getDb();
  const ctx = await loadChecklistItemContextFirebase(itemId);
  if (!ctx) throw new Error('Checklist item not found');
  const membership = await ensureUserInTrip(ctx.tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  const updates: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = String(patch.label ?? '').trim();
    if (!label) throw new Error('Label cannot be empty');
    updates.label = label;
  }
  if (patch.position !== undefined) updates.position = Math.round(patch.position);
  if (patch.checked !== undefined) {
    if (patch.checked) {
      updates.checkedBy = userId;
      updates.checkedAt = nowIso();
    } else {
      updates.checkedBy = null;
      updates.checkedAt = null;
    }
  }
  if (Object.keys(updates).length) {
    await db.collection('itinerary_checklist_items').doc(itemId).update(updates);
  }
  const updated = await db.collection('itinerary_checklist_items').doc(itemId).get();
  return updated.data() as ItineraryChecklistItem;
};

export const deleteItineraryChecklistItem = async (
  userId: string,
  itemId: string
): Promise<void> => {
  const ctx = await loadChecklistItemContextFirebase(itemId);
  if (!ctx) return;
  const membership = await ensureUserInTrip(ctx.tripId, userId);
  if (!membership) throw new Error('Not authorized to edit this itinerary');
  const db = getDb();
  await db.collection('itinerary_checklist_items').doc(itemId).delete();
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
        provider,
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
  return id;
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
  const status: 'pending' | 'accepted' = rawEmail && user.provider !== 'family' ? 'pending' : 'accepted';
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
  return { id, status, relativeId: user.id, needsAcceptance: status === 'pending' };
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

    const existing = await db.collection('users').where('google_id', '==', id).limit(1).get();
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
            username_normalized: normalizeUsername(currentData.username ?? await generateUniqueUsername(name?.givenName ?? '', name?.familyName ?? '', normalizedEmail, undefined, doc.id)),
        };
        await doc.ref.update(updateData);
        await upsertUserEmail(doc.id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
        const updatedDoc = await doc.ref.get();
        const data = updatedDoc.data() as User;
        return { ...data, id: doc.id };
    }

    const existingByEmail = await findUserByEmailDoc(normalizedEmail);
    if (existingByEmail) {
        const doc = db.collection('users').doc(existingByEmail.id);
        const currentData = existingByEmail.data as any;
        const username = currentData.username ?? await generateUniqueUsername(name?.givenName ?? '', name?.familyName ?? '', normalizedEmail, undefined, existingByEmail.id);
        const updateData = {
            google_id: id,
            picture: photos?.[0]?.value,
            firstName: name?.givenName,
            lastName: name?.familyName,
            emailVerified: true,
            emailVerifiedAt: nowIso(),
            username,
            username_normalized: normalizeUsername(username),
        };
        await doc.set(updateData, { merge: true });
        await upsertUserEmail(existingByEmail.id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
        const updatedDoc = await doc.get();
        const data = updatedDoc.data() as User;
        return { ...data, id: existingByEmail.id };
    }

    const newUserId = randomUUID();
    const username = await generateUniqueUsername(name?.givenName ?? '', name?.familyName ?? '', normalizedEmail);
    const newUser = {
        email: normalizedEmail,
        username,
        username_normalized: normalizeUsername(username),
        provider: 'google',
        google_id: id,
        picture: photos?.[0]?.value,
        firstName: name?.givenName,
        lastName: name?.familyName,
        emailVerified: true,
        emailVerifiedAt: nowIso(),
        role: 'user',
        createdAt: nowIso(),
    };
    await db.collection('users').doc(newUserId).set(newUser);
    await upsertUserEmail(newUserId, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });

    return { ...newUser, id: newUserId } as User;
};

export const findOrCreateAppleUser = async (profile: AppleProfile): Promise<User> => {
    const db = getDb();
    const { appleId, firstName, lastName, emailVerified } = profile;
    const normalizedEmail = profile.email ? normalizeEmail(profile.email) : undefined;

    // A matching apple_id already proves identity via the signed id_token's `sub`
    // claim, independent of email_verified — so a returning user must still be
    // able to log in even if Apple ever reports an unverified email on this
    // login. The verified-email requirement below only guards the paths that
    // use email as the identity signal: linking-by-email and new-account creation.
    const existing = await db.collection('users').where('apple_id', '==', appleId).limit(1).get();
    if (!existing.empty) {
        const doc = existing.docs[0];
        const currentData = doc.data() as any;
        if (normalizedEmail && emailVerified) {
            const updateData = {
                email: normalizedEmail,
                firstName: firstName ?? currentData.firstName,
                lastName: lastName ?? currentData.lastName,
                emailVerified: true,
                emailVerifiedAt: nowIso(),
            };
            await doc.ref.update(updateData);
            await upsertUserEmail(doc.id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
        }
        const updatedDoc = await doc.ref.get();
        const data = updatedDoc.data() as User;
        return { ...data, id: doc.id };
    }

    if (normalizedEmail && !emailVerified) {
        throw new Error('Apple sign-in email is not verified');
    }

    if (!normalizedEmail) {
        throw new Error('Apple sign-in did not return an email for a new user');
    }

    const existingByEmail = await findUserByEmailDoc(normalizedEmail);
    if (existingByEmail) {
        const doc = db.collection('users').doc(existingByEmail.id);
        const currentData = existingByEmail.data as any;
        const username = currentData.username ?? await generateUniqueUsername(firstName ?? '', lastName ?? '', normalizedEmail, undefined, existingByEmail.id);
        const updateData = {
            apple_id: appleId,
            firstName: firstName ?? currentData.firstName,
            lastName: lastName ?? currentData.lastName,
            emailVerified: true,
            emailVerifiedAt: nowIso(),
            username,
            username_normalized: normalizeUsername(username),
        };
        await doc.set(updateData, { merge: true });
        await upsertUserEmail(existingByEmail.id, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });
        const updatedDoc = await doc.get();
        const data = updatedDoc.data() as User;
        return { ...data, id: existingByEmail.id };
    }

    const newUserId = randomUUID();
    const username = await generateUniqueUsername(firstName ?? '', lastName ?? '', normalizedEmail);
    const newUser = {
        email: normalizedEmail,
        username,
        username_normalized: normalizeUsername(username),
        provider: 'apple',
        apple_id: appleId,
        firstName,
        lastName,
        emailVerified: true,
        emailVerifiedAt: nowIso(),
        role: 'user',
        createdAt: nowIso(),
    };
    await db.collection('users').doc(newUserId).set(newUser);
    await upsertUserEmail(newUserId, normalizedEmail, { isPrimary: true, isVerified: true, verifiedAt: nowIso() });

    return { ...newUser, id: newUserId } as User;
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

const mapAiProviderConfigDoc = (id: string, data: FirebaseFirestore.DocumentData): AiProviderConfig => ({
  featureKey: id,
  provider: String(data.provider ?? 'openai'),
  model: String(data.model ?? 'gpt-4o-mini'),
  enabled: data.enabled !== false,
  updatedBy: data.updatedBy ?? null,
  updatedAt: data.updatedAt ?? nowIso(),
});

export const getAiProviderConfig = async (featureKey: string): Promise<AiProviderConfig | null> => {
  const doc = await getDb().collection('ai_provider_config').doc(featureKey).get();
  return doc.exists ? mapAiProviderConfigDoc(doc.id, doc.data()!) : null;
};

export const listAiProviderConfigs = async (): Promise<AiProviderConfig[]> => {
  const snap = await getDb().collection('ai_provider_config').get();
  return snap.docs
    .map((doc) => mapAiProviderConfigDoc(doc.id, doc.data()))
    .sort((a, b) => a.featureKey.localeCompare(b.featureKey));
};

export const setAiProviderConfig = async (config: {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  updatedBy: string | null;
}): Promise<AiProviderConfig> => {
  const updatedAt = nowIso();
  await getDb().collection('ai_provider_config').doc(config.featureKey).set({
    featureKey: config.featureKey,
    provider: config.provider,
    model: config.model,
    enabled: config.enabled,
    updatedBy: config.updatedBy,
    updatedAt,
  }, { merge: true });
  return {
    featureKey: config.featureKey,
    provider: config.provider,
    model: config.model,
    enabled: config.enabled,
    updatedBy: config.updatedBy,
    updatedAt,
  };
};

const mapAdminSettingDoc = (id: string, data: FirebaseFirestore.DocumentData): AdminSetting => ({
  key: id,
  value: String(data.value ?? ''),
  updatedBy: data.updatedBy ?? null,
  updatedAt: data.updatedAt ?? nowIso(),
});

export const getAdminSetting = async (key: string): Promise<AdminSetting | null> => {
  const doc = await getDb().collection('admin_settings').doc(key).get();
  return doc.exists ? mapAdminSettingDoc(doc.id, doc.data()!) : null;
};

export const setAdminSetting = async (setting: {
  key: string;
  value: string;
  updatedBy: string | null;
}): Promise<AdminSetting> => {
  const updatedAt = nowIso();
  await getDb().collection('admin_settings').doc(setting.key).set({
    key: setting.key,
    value: setting.value,
    updatedBy: setting.updatedBy,
    updatedAt,
  }, { merge: true });
  return { ...setting, updatedAt };
};

const AI_ANALYTICS_TABLES: AiAnalyticsMetricTable[] = [
  'ai_daily_metrics',
  'ai_provider_metrics',
  'ai_prompt_metrics',
  'ai_parser_metrics',
  'ai_field_metrics',
  'ai_cost_metrics',
];

const metricDocId = (metric: Omit<AiAnalyticsMetric, 'updatedAt'>): string => {
  const dims = Object.entries(metric.dimensions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
  return [metric.periodStart, metric.periodType, dims, metric.metricKey].join('|').replace(/[\/#?]/g, '_');
};

const mapAiAnalyticsDoc = (
  table: AiAnalyticsMetricTable,
  data: FirebaseFirestore.DocumentData,
): AiAnalyticsMetric => ({
  table,
  periodStart: String(data.periodStart ?? ''),
  periodType: (data.periodType ?? 'day') as AiAnalyticsPeriodType,
  dimensions: data.dimensions && typeof data.dimensions === 'object' ? data.dimensions as Record<string, string> : {},
  metricKey: String(data.metricKey ?? ''),
  metricValue: Number(data.metricValue ?? 0),
  updatedAt: String(data.updatedAt ?? nowIso()),
});

export const upsertAiAnalyticsMetric = async (metric: Omit<AiAnalyticsMetric, 'updatedAt'>): Promise<AiAnalyticsMetric> => {
  const updatedAt = nowIso();
  const row = { ...metric, updatedAt };
  await getDb().collection(metric.table).doc(metricDocId(metric)).set(row, { merge: true });
  return row;
};

export const listAiAnalyticsMetrics = async (options: {
  table?: AiAnalyticsMetricTable;
  periodType?: AiAnalyticsPeriodType;
  periodStart?: string;
  limit?: number;
} = {}): Promise<AiAnalyticsMetric[]> => {
  const tables = options.table ? [options.table] : AI_ANALYTICS_TABLES;
  const limit = Math.max(1, Math.min(Number(options.limit ?? 250), 1000));
  const out: AiAnalyticsMetric[] = [];
  for (const table of tables) {
    let query: FirebaseFirestore.Query = getDb().collection(table);
    if (options.periodType) query = query.where('periodType', '==', options.periodType);
    if (options.periodStart) query = query.where('periodStart', '==', options.periodStart);
    const snap = await query.limit(limit).get();
    out.push(...snap.docs.map((doc) => mapAiAnalyticsDoc(table, doc.data())));
  }
  return out.sort((a, b) => b.periodStart.localeCompare(a.periodStart)).slice(0, limit);
};

const mapAiExperimentDoc = (id: string, data: FirebaseFirestore.DocumentData): AiExperiment => ({
  experimentId: id,
  featureKey: String(data.featureKey ?? ''),
  experimentKind: data.experimentKind ?? 'shadow_compare',
  name: String(data.name ?? ''),
  status: data.status ?? 'draft',
  variants: Array.isArray(data.variants) ? data.variants : [],
  controlVariantId: data.controlVariantId ?? null,
  minSampleSize: Number(data.minSampleSize ?? 200),
  maxDurationDays: Number(data.maxDurationDays ?? 30),
  startedAt: data.startedAt ?? null,
  endsAt: data.endsAt ?? null,
  winningVariantId: data.winningVariantId ?? null,
  createdBy: data.createdBy ?? null,
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
});

export const createAiExperiment = async (experiment: {
  featureKey: string;
  experimentKind?: AiExperiment['experimentKind'];
  name: string;
  variants: AiExperiment['variants'];
  controlVariantId?: string | null;
  minSampleSize?: number;
  maxDurationDays?: number;
  createdBy?: string | null;
}): Promise<AiExperiment> => {
  const ref = getDb().collection('ai_experiments').doc(randomUUID());
  const now = nowIso();
  const row = {
    featureKey: experiment.featureKey,
    experimentKind: experiment.experimentKind ?? 'shadow_compare',
    name: experiment.name,
    status: 'draft',
    variants: experiment.variants,
    controlVariantId: experiment.controlVariantId ?? null,
    minSampleSize: experiment.minSampleSize ?? 200,
    maxDurationDays: experiment.maxDurationDays ?? 30,
    startedAt: null,
    endsAt: null,
    winningVariantId: null,
    createdBy: experiment.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(row);
  return mapAiExperimentDoc(ref.id, row);
};

export const listAiExperiments = async (options: {
  featureKey?: string;
  experimentKind?: AiExperiment['experimentKind'];
  status?: AiExperiment['status'];
  limit?: number;
} = {}): Promise<AiExperiment[]> => {
  let query: FirebaseFirestore.Query = getDb().collection('ai_experiments');
  if (options.featureKey) query = query.where('featureKey', '==', options.featureKey);
  if (options.experimentKind) query = query.where('experimentKind', '==', options.experimentKind);
  if (options.status) query = query.where('status', '==', options.status);
  const snap = await query.limit(Math.max(1, Math.min(Number(options.limit ?? 100), 500))).get();
  return snap.docs.map((doc) => mapAiExperimentDoc(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const getAiExperiment = async (experimentId: string): Promise<AiExperiment | null> => {
  const doc = await getDb().collection('ai_experiments').doc(experimentId).get();
  return doc.exists ? mapAiExperimentDoc(doc.id, doc.data()!) : null;
};

export const updateAiExperimentStatus = async (params: {
  experimentId: string;
  status: AiExperiment['status'];
  winningVariantId?: string | null;
}): Promise<AiExperiment> => {
  const ref = getDb().collection('ai_experiments').doc(params.experimentId);
  const current = await ref.get();
  if (!current.exists) throw new Error(`AI experiment not found: ${params.experimentId}`);
  const data = current.data()!;
  const patch: Record<string, unknown> = { status: params.status, updatedAt: nowIso() };
  if (params.status === 'running' && !data.startedAt) patch.startedAt = nowIso();
  if (params.status === 'completed' && !data.endsAt) patch.endsAt = nowIso();
  if (params.winningVariantId) patch.winningVariantId = params.winningVariantId;
  await ref.set(patch, { merge: true });
  const updated = await ref.get();
  return mapAiExperimentDoc(updated.id, updated.data()!);
};

const assignmentDocId = (assignmentKey: string, experimentId: string): string =>
  `${experimentId}_${assignmentKey}`.replace(/[\/#?]/g, '_');

const mapAiAssignmentDoc = (data: FirebaseFirestore.DocumentData): AiExperimentAssignment => ({
  assignmentKey: String(data.assignmentKey),
  experimentId: String(data.experimentId),
  variantId: String(data.variantId),
  originalVariantId: data.originalVariantId ?? null,
  assignedAt: String(data.assignedAt ?? nowIso()),
  reassignedAt: data.reassignedAt ?? null,
});

export const getOrCreateAiExperimentAssignment = async (assignment: {
  assignmentKey: string;
  experimentId: string;
  variantId: string;
}): Promise<AiExperimentAssignment> => {
  const ref = getDb().collection('ai_experiment_assignments').doc(assignmentDocId(assignment.assignmentKey, assignment.experimentId));
  return getDb().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return mapAiAssignmentDoc(existing.data()!);
    const row = { ...assignment, assignedAt: nowIso(), originalVariantId: null, reassignedAt: null };
    tx.set(ref, row);
    return mapAiAssignmentDoc(row);
  });
};

export const reassignAiExperimentVariantToControl = async (params: {
  experimentId: string;
  variantId: string;
  controlVariantId: string;
}): Promise<number> => {
  const snap = await getDb().collection('ai_experiment_assignments')
    .where('experimentId', '==', params.experimentId)
    .where('variantId', '==', params.variantId)
    .get();
  const batch = getDb().batch();
  snap.docs.forEach((doc) => batch.set(doc.ref, {
    variantId: params.controlVariantId,
    originalVariantId: doc.data().originalVariantId ?? params.variantId,
    reassignedAt: nowIso(),
  }, { merge: true }));
  await batch.commit();
  return snap.size;
};

export const listAiExperimentAssignments = async (options: { experimentId?: string; limit?: number } = {}): Promise<AiExperimentAssignment[]> => {
  let query: FirebaseFirestore.Query = getDb().collection('ai_experiment_assignments');
  if (options.experimentId) query = query.where('experimentId', '==', options.experimentId);
  const snap = await query.limit(Math.max(1, Math.min(Number(options.limit ?? 500), 2000))).get();
  return snap.docs.map((doc) => mapAiAssignmentDoc(doc.data()))
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
};

export const deleteCompletedAiExperimentAssignmentsOlderThan = async (cutoffIso: string): Promise<number> => {
  const experiments = await getDb().collection('ai_experiments')
    .where('status', '==', 'completed')
    .get();
  const eligibleIds = new Set(
    experiments.docs
      .map((doc) => ({ id: doc.id, endsAt: String(doc.data().endsAt ?? '') }))
      .filter((row) => row.endsAt && row.endsAt < cutoffIso)
      .map((row) => row.id),
  );
  if (!eligibleIds.size) return 0;
  const assignments = await getDb().collection('ai_experiment_assignments').get();
  const batch = getDb().batch();
  let deleted = 0;
  assignments.docs.forEach((doc) => {
    if (!eligibleIds.has(String(doc.data().experimentId))) return;
    batch.delete(doc.ref);
    deleted += 1;
  });
  if (deleted > 0) await batch.commit();
  return deleted;
};

const abMetricDocId = (metric: Pick<AiAbTestMetric, 'experimentId' | 'variantId' | 'day'>): string =>
  `${metric.experimentId}_${metric.variantId}_${metric.day}`.replace(/[\/#?]/g, '_');

const mapAiAbMetricDoc = (data: FirebaseFirestore.DocumentData): AiAbTestMetric => ({
  experimentId: String(data.experimentId),
  variantId: String(data.variantId),
  day: String(data.day),
  requestCount: Number(data.requestCount ?? 0),
  successRate: Number(data.successRate ?? 0),
  avgQualityScore: Number(data.avgQualityScore ?? 0),
  avgCostUsd: Number(data.avgCostUsd ?? 0),
  avgLatencyMs: Number(data.avgLatencyMs ?? 0),
  groundTruthAgreement: data.groundTruthAgreement ?? null,
  groundTruthSignal: data.groundTruthSignal ?? null,
  updatedAt: String(data.updatedAt ?? nowIso()),
});

export const upsertAiAbTestMetric = async (metric: Omit<AiAbTestMetric, 'updatedAt'>): Promise<AiAbTestMetric> => {
  const row = { ...metric, updatedAt: nowIso() };
  await getDb().collection('ai_ab_test_metrics').doc(abMetricDocId(metric)).set(row, { merge: true });
  return row;
};

export const listAiAbTestMetrics = async (options: { experimentId?: string; limit?: number } = {}): Promise<AiAbTestMetric[]> => {
  let query: FirebaseFirestore.Query = getDb().collection('ai_ab_test_metrics');
  if (options.experimentId) query = query.where('experimentId', '==', options.experimentId);
  const snap = await query.limit(Math.max(1, Math.min(Number(options.limit ?? 250), 1000))).get();
  return snap.docs.map((doc) => mapAiAbMetricDoc(doc.data())).sort((a, b) => b.day.localeCompare(a.day));
};

const mapAiProviderCertificationDoc = (id: string, data: FirebaseFirestore.DocumentData): AiProviderCertification => ({
  providerId: id,
  certifiedAt: String(data.certifiedAt ?? nowIso()),
  certifiedBy: data.certifiedBy ?? null,
  contractSuiteVersion: String(data.contractSuiteVersion ?? ''),
  notes: data.notes ?? null,
});

export const getAiProviderCertification = async (providerId: string): Promise<AiProviderCertification | null> => {
  const doc = await getDb().collection('ai_provider_certifications').doc(providerId).get();
  return doc.exists ? mapAiProviderCertificationDoc(doc.id, doc.data()!) : null;
};

export const listAiProviderCertifications = async (): Promise<AiProviderCertification[]> => {
  const snap = await getDb().collection('ai_provider_certifications').get();
  return snap.docs.map((doc) => mapAiProviderCertificationDoc(doc.id, doc.data())).sort((a, b) => a.providerId.localeCompare(b.providerId));
};

export const setAiProviderCertification = async (cert: {
  providerId: string;
  certifiedBy: string | null;
  contractSuiteVersion: string;
  notes?: string | null;
}): Promise<AiProviderCertification> => {
  const row = {
    providerId: cert.providerId,
    certifiedAt: nowIso(),
    certifiedBy: cert.certifiedBy,
    contractSuiteVersion: cert.contractSuiteVersion,
    notes: cert.notes ?? null,
  };
  await getDb().collection('ai_provider_certifications').doc(cert.providerId).set(row, { merge: true });
  return row;
};

export const deleteAiProviderCertification = async (providerId: string): Promise<void> => {
  await getDb().collection('ai_provider_certifications').doc(providerId).delete();
};

const mapAiRecommendationDoc = (id: string, data: FirebaseFirestore.DocumentData): AiRecommendation => ({
  recommendationId: id,
  recommendationType: String(data.recommendationType ?? ''),
  featureKey: String(data.featureKey ?? ''),
  subjectCurrent: data.subjectCurrent ?? {},
  subjectProposed: data.subjectProposed ?? {},
  rationale: String(data.rationale ?? ''),
  qualityDeltaEstimate: Number(data.qualityDeltaEstimate ?? 0),
  costDeltaEstimateUsdMonthly: Number(data.costDeltaEstimateUsdMonthly ?? 0),
  confidence: String(data.confidence ?? 'low'),
  supportingEvidenceRef: data.supportingEvidenceRef ?? null,
  supportingEvidenceQuery: data.supportingEvidenceQuery ?? null,
  engineVersion: String(data.engineVersion ?? ''),
  status: data.status ?? 'proposed',
  createdAt: String(data.createdAt ?? nowIso()),
  respondedBy: data.respondedBy ?? null,
  respondedAt: data.respondedAt ?? null,
  outcomeMeasuredAt: data.outcomeMeasuredAt ?? null,
  outcomeQualityDelta: data.outcomeQualityDelta ?? null,
  outcomeCostDeltaUsdMonthly: data.outcomeCostDeltaUsdMonthly ?? null,
});

export const upsertAiRecommendation = async (rec: Partial<AiRecommendation> & {
  recommendationType: string;
  featureKey: string;
  subjectCurrent: Record<string, unknown>;
  subjectProposed: Record<string, unknown>;
  rationale: string;
  engineVersion: string;
}): Promise<AiRecommendation> => {
  const id = rec.recommendationId ?? randomUUID();
  const current = await getDb().collection('ai_recommendations').doc(id).get();
  const row = {
    recommendationType: rec.recommendationType,
    featureKey: rec.featureKey,
    subjectCurrent: rec.subjectCurrent,
    subjectProposed: rec.subjectProposed,
    rationale: rec.rationale,
    qualityDeltaEstimate: rec.qualityDeltaEstimate ?? 0,
    costDeltaEstimateUsdMonthly: rec.costDeltaEstimateUsdMonthly ?? 0,
    confidence: rec.confidence ?? 'low',
    supportingEvidenceRef: rec.supportingEvidenceRef ?? null,
    supportingEvidenceQuery: rec.supportingEvidenceQuery ?? null,
    engineVersion: rec.engineVersion,
    status: rec.status ?? 'proposed',
    createdAt: current.exists ? current.data()!.createdAt ?? nowIso() : nowIso(),
  };
  await getDb().collection('ai_recommendations').doc(id).set(row, { merge: true });
  return mapAiRecommendationDoc(id, row);
};

export const listAiRecommendations = async (options: { status?: AiRecommendation['status']; limit?: number } = {}): Promise<AiRecommendation[]> => {
  let query: FirebaseFirestore.Query = getDb().collection('ai_recommendations');
  if (options.status) query = query.where('status', '==', options.status);
  const snap = await query.limit(Math.max(1, Math.min(Number(options.limit ?? 100), 500))).get();
  return snap.docs.map((doc) => mapAiRecommendationDoc(doc.id, doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const updateAiRecommendationStatus = async (params: {
  recommendationId: string;
  status: AiRecommendation['status'];
  respondedBy: string | null;
}): Promise<AiRecommendation> => {
  const ref = getDb().collection('ai_recommendations').doc(params.recommendationId);
  await ref.set({ status: params.status, respondedBy: params.respondedBy, respondedAt: nowIso() }, { merge: true });
  const updated = await ref.get();
  if (!updated.exists) throw new Error(`AI recommendation not found: ${params.recommendationId}`);
  return mapAiRecommendationDoc(updated.id, updated.data()!);
};

export const updateAiRecommendationOutcome = async (params: {
  recommendationId: string;
  outcomeQualityDelta: number | null;
  outcomeCostDeltaUsdMonthly: number | null;
  measuredAt?: string;
}): Promise<AiRecommendation> => {
  const ref = getDb().collection('ai_recommendations').doc(params.recommendationId);
  await ref.set({
    outcomeMeasuredAt: params.measuredAt ?? nowIso(),
    outcomeQualityDelta: params.outcomeQualityDelta,
    outcomeCostDeltaUsdMonthly: params.outcomeCostDeltaUsdMonthly,
  }, { merge: true });
  const updated = await ref.get();
  if (!updated.exists) throw new Error(`AI recommendation not found: ${params.recommendationId}`);
  return mapAiRecommendationDoc(updated.id, updated.data()!);
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

export const recordItineraryGenerationMetrics = async (metrics: ItineraryGenerationMetrics): Promise<void> => {
  const db = getDb();
  // metrics object can contain stage-level captures which might eventually
  // contain nested arrays, which Firestore rejects. Storing as a JSON string
  // ensures we don't hit "invalid nested entity" errors in production.
  await db.collection('itinerary_generation_metrics').doc(metrics.generationId).set(
    {
      generationId: metrics.generationId,
      tripId: metrics.tripId ?? null,
      userId: metrics.userId ?? null,
      provider: metrics.provider,
      model: metrics.model,
      outcome: metrics.outcome,
      metrics: JSON.stringify(metrics),
      createdAt: metrics.createdAt ?? nowIso(),
    },
    { merge: true }
  );
};

export const getItineraryGenerationMetrics = async (generationId: string): Promise<ItineraryGenerationMetrics | null> => {
  const doc = await getDb().collection('itinerary_generation_metrics').doc(generationId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  if (typeof data.metrics === 'string') {
    try {
      return JSON.parse(data.metrics);
    } catch {
      return null;
    }
  }
  return data.metrics ?? null;
};

export const recordItineraryComparison = async (comparison: ItineraryComparison): Promise<void> => {
  const db = getDb();
  await db.collection('itinerary_comparisons').add({
    ...comparison,
    createdAt: comparison.createdAt ?? nowIso(),
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
  units?: number;
}): Promise<{ allowed: boolean; newCount: number }> => {
  const db = getDb();
  const units = Math.max(1, Math.floor(params.units ?? 1));
  const docId = `${params.scope}_${params.provider}_${params.caller}_${params.windowKey}`;
  const ref = db.collection('api_usage_counters').doc(docId);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const current = doc.exists ? Number(doc.data()!.count ?? 0) : 0;
    if (current + units > params.limit) {
      return { allowed: false, newCount: current };
    }
    const nextCount = current + units;
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
  // responseBody is stored as a JSON string (see completeGenerationIdempotency) because
  // Firestore rejects arrays nested directly inside arrays ("invalid nested entity"),
  // which AI-generated itinerary plans can contain.
  let responseBody: Record<string, unknown> | null = null;
  if (typeof data.responseBody === 'string') {
    try {
      responseBody = JSON.parse(data.responseBody);
    } catch {
      responseBody = null;
    }
  } else if (data.responseBody && typeof data.responseBody === 'object') {
    responseBody = data.responseBody;
  }
  return {
    key: doc.id,
    userId: data.userId,
    tripId: data.tripId,
    usageKey: data.usageKey ?? null,
    windowKey: data.windowKey ?? null,
    status: data.status ?? 'pending',
    resultRef: data.resultRef ?? null,
    responseBody,
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
  // Stored as a JSON string, not a native Firestore map/array — AI-generated plans can
  // contain arrays nested directly inside arrays, which Firestore rejects outright
  // ("Property responseBody contains an invalid nested entity").
  await db.collection('generation_idempotency').doc(key).set({
    status: 'completed',
    resultRef: resultRef ?? null,
    responseBody: JSON.stringify(responseBody),
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

const docToChatMessage = (doc: any): TripChatMessage => {
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
};

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
  return snap.docs.map(docToChatMessage);
};

/**
 * Fetch a page of messages newest-first via a `beforeId` cursor; returns page
 * in ascending chronological order with `hasMore` for older-page availability.
 */
export const listTripMessagesPage = async (
  tripId: string,
  options: { limit?: number; beforeId?: string } = {},
): Promise<{ messages: TripChatMessage[]; hasMore: boolean }> => {
  const db = getDb();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  let cursorCreatedAt: string | null = null;
  if (options.beforeId) {
    const cursorDoc = await db.collection('trip_messages').doc(options.beforeId).get();
    if (!cursorDoc.exists) return { messages: [], hasMore: false };
    cursorCreatedAt = (cursorDoc.data() as any)?.createdAt ?? null;
    if (!cursorCreatedAt) return { messages: [], hasMore: false };
  }

  let query = db
    .collection('trip_messages')
    .where('tripId', '==', tripId)
    .orderBy('createdAt', 'desc');
  if (cursorCreatedAt) {
    query = query.where('createdAt', '<', cursorCreatedAt);
  }

  const snap = await query.limit(limit + 1).get();
  const rows = snap.docs.map(docToChatMessage);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { messages: page.slice().reverse(), hasMore };
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

  // Legacy per-message reads (readBy array + message_reads docs) are behind
  // the same soak-window env flag as the Postgres adapter. Default ON.
  const legacyReadsEnabled = getEnvFlag('CHAT_LEGACY_READS_ENABLED', { defaultValue: true });
  if (legacyReadsEnabled) {
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
  }

  // Dual-write the per-user watermark. Only advance forward so a stale
  // MARK_READ (re-opened panel scrolling back) can't regress the watermark.
  const watermarkRef = db.collection('chat_read_watermarks').doc(`${userId}_${tripId}`);
  const existing = await watermarkRef.get();
  const existingCutoff = existing.exists ? ((existing.data() as any).lastReadCreatedAt ?? '') : '';
  if (!existing.exists || String(upToCreatedAt) > String(existingCutoff)) {
    await watermarkRef.set(
      {
        userId,
        tripId,
        lastReadMessageId: upToMessageId,
        lastReadCreatedAt: upToCreatedAt,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  }
};

export const countUnreadMessages = async (
  tripId: string,
  userId: string,
): Promise<number> => {
  const db = getDb();

  // Prefer the per-user watermark when one exists.
  const watermarkDoc = await db
    .collection('chat_read_watermarks')
    .doc(`${userId}_${tripId}`)
    .get();
  if (watermarkDoc.exists) {
    const cutoff = (watermarkDoc.data() as any).lastReadCreatedAt ?? '';
    const newerSnap = await db
      .collection('trip_messages')
      .where('tripId', '==', tripId)
      .where('createdAt', '>', cutoff)
      .get();
    return newerSnap.size;
  }

  // Fall back to the legacy readBy array count.
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

/**
 * Firestore companion to the Postgres export aggregator. Same contract: return
 * every user-authored row across the item collections. Runs queries in
 * parallel; returns plain objects safe for JSON serialization.
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
  const db = getDb();
  const fetchCollection = async (name: string, fields: string[]) => {
    const docsById = new Map<string, any>();
    await Promise.all(fields.map(async (field) => {
      const snap = await db.collection(name).where(field, '==', userId).get();
      snap.docs.forEach((d: any) => docsById.set(d.id, { id: d.id, ...(d.data() as any) }));
    }));
    return Array.from(docsById.values());
  };
  const [flights, lodgings, tours, carRentals, expenses, tripMessages] = await Promise.all([
    fetchCollection('flights', ['userId', 'user_id']),
    fetchCollection('lodgings', ['userId', 'user_id']),
    fetchCollection('tours', ['userId', 'user_id']),
    fetchCollection('car_rentals', ['userId', 'user_id']),
    fetchCollection('expenses', ['userId', 'user_id']),
    fetchCollection('trip_messages', ['senderId', 'sender_id']),
  ]);
  return { flights, lodgings, tours, carRentals, expenses, tripMessages };
};

// ---------------------------------------------------------------------------
// Stripe Billing
// ---------------------------------------------------------------------------

const toIsoOrNull = (value: Date | string | null | undefined): string | null =>
  value == null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

export const getBillingCustomerByUserId = async (userId: string): Promise<BillingCustomer | null> => {
  const doc = await getDb().collection('billing_customers').doc(userId).get();
  return doc.exists ? (doc.data() as BillingCustomer) : null;
};

export const getBillingCustomerByStripeId = async (stripeCustomerId: string): Promise<BillingCustomer | null> => {
  const snap = await getDb().collection('billing_customers').where('stripeCustomerId', '==', stripeCustomerId).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as BillingCustomer);
};

export const upsertBillingCustomer = async (data: {
  userId: string;
  stripeCustomerId: string;
  emailSnapshot?: string | null;
  livemode: boolean;
}): Promise<BillingCustomer> => {
  const ref = getDb().collection('billing_customers').doc(data.userId);
  return getDb().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const previous = existing.exists ? existing.data() as BillingCustomer : null;
    const timestamp = nowIso();
    const customer: BillingCustomer = {
      id: previous?.id ?? randomUUID(),
      userId: data.userId,
      stripeCustomerId: previous?.stripeCustomerId ?? data.stripeCustomerId,
      emailSnapshot: data.emailSnapshot ?? previous?.emailSnapshot ?? null,
      livemode: data.livemode,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    tx.set(ref, customer);
    return customer;
  });
};

export const getBillingTrialUsageByEmail = async (
  emailNormalized: string,
): Promise<BillingTrialUsage | null> => {
  const doc = await getDb().collection('billing_trial_usage').doc(emailNormalized).get();
  return doc.exists ? (doc.data() as BillingTrialUsage) : null;
};

export const markBillingTrialUsed = async (data: {
  emailNormalized: string;
  userId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  trialUsedAt?: Date | null;
}): Promise<BillingTrialUsage> => {
  const ref = getDb().collection('billing_trial_usage').doc(data.emailNormalized);
  return getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.exists ? snapshot.data() as BillingTrialUsage : null;
    const timestamp = nowIso();
    const trialUsedAt = data.trialUsedAt ? data.trialUsedAt.toISOString() : timestamp;
    const usage: BillingTrialUsage = {
      id: previous?.id ?? randomUUID(),
      emailNormalized: data.emailNormalized,
      userId: previous?.userId ?? data.userId ?? null,
      stripeCustomerId: previous?.stripeCustomerId ?? data.stripeCustomerId ?? null,
      stripeSubscriptionId: previous?.stripeSubscriptionId ?? data.stripeSubscriptionId ?? null,
      trialUsedAt: previous?.trialUsedAt ?? trialUsedAt,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    tx.set(ref, usage);
    return usage;
  });
};

export const claimBillingNotification = async (data: {
  userId: string;
  type: BillingNotification['type'];
  notificationKey: string;
  title: string;
  message: string;
  stripeSubscriptionId?: string | null;
  stripeEventId?: string | null;
}): Promise<{ notification: BillingNotification; created: boolean }> => {
  const ref = getDb().collection('billing_notifications').doc(data.notificationKey);
  return getDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.exists ? snapshot.data() as BillingNotification : null;
    if (previous) return { notification: previous, created: false };
    const timestamp = nowIso();
    const notification: BillingNotification = {
      id: randomUUID(),
      userId: data.userId,
      type: data.type,
      notificationKey: data.notificationKey,
      title: data.title,
      message: data.message,
      stripeSubscriptionId: data.stripeSubscriptionId ?? null,
      stripeEventId: data.stripeEventId ?? null,
      emailSentAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.set(ref, notification);
    return { notification, created: true };
  });
};

export const markBillingNotificationEmailSent = async (
  notificationId: string,
  sentAt: Date = new Date(),
): Promise<void> => {
  const snap = await getDb()
    .collection('billing_notifications')
    .where('id', '==', notificationId)
    .limit(1)
    .get();
  if (snap.empty) return;
  await snap.docs[0].ref.set({ emailSentAt: sentAt.toISOString(), updatedAt: nowIso() }, { merge: true });
};

export const listBillingNotificationsForUser = async (
  userId: string,
  limit = 10,
): Promise<BillingNotification[]> => {
  const snap = await getDb()
    .collection('billing_notifications')
    .where('userId', '==', userId)
    .get();
  return snap.docs
    .map((doc) => doc.data() as BillingNotification)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
};

export const getBillingSubscriptionByStripeId = async (
  stripeSubscriptionId: string,
): Promise<BillingSubscription | null> => {
  const doc = await getDb().collection('billing_subscriptions').doc(stripeSubscriptionId).get();
  return doc.exists ? (doc.data() as BillingSubscription) : null;
};

export const listActiveBillingSubscriptionsForUser = async (userId: string): Promise<BillingSubscription[]> => {
  const snap = await getDb().collection('billing_subscriptions').where('userId', '==', userId).get();
  return snap.docs
    .map((doc) => doc.data() as BillingSubscription)
    .filter((sub) =>
      (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') || Boolean(sub.pastDueSince),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const claimBillingCheckout = async (data: {
  userId: string;
  claimToken: string;
  planKey: BillingPlanKey;
  expiresAt: Date;
}): Promise<{ claimed: boolean; checkoutUrl: string | null }> => {
  const ref = getDb().collection('billing_checkout_claims').doc(data.userId);
  return getDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() as any : null;
    const existingExpiry = existing?.expiresAt ? new Date(existing.expiresAt).getTime() : 0;
    if (existing && existingExpiry > Date.now()) {
      return { claimed: false, checkoutUrl: existing.checkoutUrl ?? null };
    }
    const now = new Date().toISOString();
    transaction.set(ref, {
      userId: data.userId,
      claimToken: data.claimToken,
      planKey: data.planKey,
      stripeCheckoutSessionId: null,
      checkoutUrl: null,
      expiresAt: data.expiresAt.toISOString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return { claimed: true, checkoutUrl: null };
  });
};

export const completeBillingCheckoutClaim = async (data: {
  userId: string;
  claimToken: string;
  stripeCheckoutSessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}): Promise<void> => {
  const ref = getDb().collection('billing_checkout_claims').doc(data.userId);
  await getDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || (snapshot.data() as any).claimToken !== data.claimToken) return;
    transaction.update(ref, {
      stripeCheckoutSessionId: data.stripeCheckoutSessionId,
      checkoutUrl: data.checkoutUrl,
      expiresAt: data.expiresAt.toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
};

export const releaseBillingCheckoutClaim = async (userId: string, claimToken: string): Promise<void> => {
  const ref = getDb().collection('billing_checkout_claims').doc(userId);
  await getDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && (snapshot.data() as any).claimToken === claimToken) {
      transaction.delete(ref);
    }
  });
};

export const clearBillingCheckoutClaim = async (userId: string): Promise<void> => {
  await getDb().collection('billing_checkout_claims').doc(userId).delete();
};

export const upsertBillingSubscription = async (data: {
  stripeSubscriptionId: string;
  userId: string;
  subscriptionScope?: BillingSubscriptionScope;
  scopeOwnerId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  planKey: BillingPlanKey;
  status: BillingSubscriptionStatus;
  livemode: boolean;
  cancelAtPeriodEnd: boolean;
  cancelAt?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  trialEnd?: Date | null;
  endedAt?: Date | null;
  latestInvoiceId?: string | null;
  pastDueSince?: Date | null;
  accessRevokedAt?: Date | null;
  accessRevocationReason?: string | null;
  disputeId?: string | null;
  refundedAt?: Date | null;
  lastStripeEventCreated?: number | null;
}): Promise<BillingSubscription> => {
  const ref = getDb().collection('billing_subscriptions').doc(data.stripeSubscriptionId);
  return getDb().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const previous = existing.exists ? existing.data() as BillingSubscription : null;
    const timestamp = nowIso();
    const subscription: BillingSubscription = {
      id: previous?.id ?? randomUUID(),
      stripeSubscriptionId: data.stripeSubscriptionId,
      userId: data.userId,
      subscriptionScope: data.subscriptionScope ?? previous?.subscriptionScope ?? 'individual',
      scopeOwnerId: data.scopeOwnerId,
      stripeCustomerId: data.stripeCustomerId,
      stripePriceId: data.stripePriceId,
      planKey: data.planKey,
      status: data.status,
      livemode: data.livemode,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      cancelAt: toIsoOrNull(data.cancelAt),
      currentPeriodStart: toIsoOrNull(data.currentPeriodStart),
      currentPeriodEnd: toIsoOrNull(data.currentPeriodEnd),
      trialEnd: toIsoOrNull(data.trialEnd),
      endedAt: toIsoOrNull(data.endedAt),
      latestInvoiceId: data.latestInvoiceId ?? null,
      pastDueSince: data.pastDueSince === undefined ? previous?.pastDueSince ?? null : toIsoOrNull(data.pastDueSince),
      accessRevokedAt: data.accessRevokedAt === undefined ? previous?.accessRevokedAt ?? null : toIsoOrNull(data.accessRevokedAt),
      accessRevocationReason: data.accessRevocationReason === undefined
        ? previous?.accessRevocationReason ?? null
        : data.accessRevocationReason,
      disputeId: data.disputeId === undefined ? previous?.disputeId ?? null : data.disputeId,
      refundedAt: data.refundedAt === undefined ? previous?.refundedAt ?? null : toIsoOrNull(data.refundedAt),
      lastStripeEventCreated: data.lastStripeEventCreated ?? previous?.lastStripeEventCreated ?? null,
      lastSyncedAt: timestamp,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    tx.set(ref, subscription);
    return subscription;
  });
};

export const revokeBillingSubscriptionAccess = async (
  stripeSubscriptionId: string,
  reason: string,
  details?: { disputeId?: string | null; refundedAt?: Date | null },
): Promise<void> => {
  await getDb().collection('billing_subscriptions').doc(stripeSubscriptionId).set({
    accessRevokedAt: nowIso(),
    accessRevocationReason: reason,
    ...(details?.disputeId !== undefined ? { disputeId: details.disputeId } : {}),
    ...(details?.refundedAt !== undefined ? { refundedAt: toIsoOrNull(details.refundedAt) } : {}),
    updatedAt: nowIso(),
  }, { merge: true });
};

export const restoreBillingSubscriptionAccess = async (stripeSubscriptionId: string): Promise<void> => {
  await getDb().collection('billing_subscriptions').doc(stripeSubscriptionId).set({
    accessRevokedAt: null,
    accessRevocationReason: null,
    disputeId: null,
    refundedAt: null,
    updatedAt: nowIso(),
  }, { merge: true });
};

export const setPastDueSince = async (stripeSubscriptionId: string, since: Date): Promise<void> => {
  const ref = getDb().collection('billing_subscriptions').doc(stripeSubscriptionId);
  await getDb().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (doc.exists && !(doc.data() as BillingSubscription).pastDueSince) {
      tx.update(ref, { pastDueSince: since.toISOString(), updatedAt: nowIso() });
    }
  });
};

export const clearPastDueSince = async (stripeSubscriptionId: string): Promise<void> => {
  await getDb().collection('billing_subscriptions').doc(stripeSubscriptionId)
    .set({ pastDueSince: null, updatedAt: nowIso() }, { merge: true });
};

export const listStaleSubscriptionsForReconciliation = async (
  olderThanMinutes: number,
  limit: number,
): Promise<BillingSubscription[]> => {
  const cutoff = Date.now() - olderThanMinutes * 60_000;
  const snap = await getDb().collection('billing_subscriptions').get();
  return snap.docs
    .map((doc) => doc.data() as BillingSubscription)
    .filter((sub) =>
      sub.status !== 'canceled' &&
      sub.status !== 'incomplete_expired' &&
      (!sub.lastSyncedAt || new Date(sub.lastSyncedAt).getTime() < cutoff))
    .sort((a, b) => (a.lastSyncedAt ?? '').localeCompare(b.lastSyncedAt ?? ''))
    .slice(0, limit);
};

export const listPastDueBillingSubscriptions = async (): Promise<BillingSubscription[]> => {
  const snapshot = await getDb().collection('billing_subscriptions').get();
  return snapshot.docs
    .map((doc) => doc.data() as BillingSubscription)
    .filter((subscription) => Boolean(subscription.pastDueSince))
    .sort((a, b) => (a.pastDueSince ?? '').localeCompare(b.pastDueSince ?? ''));
};

export const claimStripeWebhookEvent = async (data: {
  stripeEventId: string;
  eventType: string;
  stripeObjectId?: string | null;
  livemode: boolean;
  eventCreated?: number | null;
}): Promise<boolean> => {
  const ref = getDb().collection('stripe_webhook_events').doc(data.stripeEventId);
  return getDb().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const previous = doc.exists ? doc.data() as StripeWebhookEvent : null;
    const pendingLeaseExpired =
      previous?.processingStatus === 'pending' &&
      Date.now() - new Date(previous.receivedAt).getTime() >= 5 * 60_000;
    if (previous && previous.processingStatus !== 'failed' && !pendingLeaseExpired) return false;
    const event: StripeWebhookEvent = {
      id: previous?.id ?? randomUUID(),
      stripeEventId: data.stripeEventId,
      eventType: data.eventType,
      stripeObjectId: data.stripeObjectId ?? null,
      livemode: data.livemode,
      eventCreated: data.eventCreated ?? null,
      processingStatus: 'pending',
      attemptCount: previous?.attemptCount ?? 0,
      lastError: null,
      receivedAt: previous?.receivedAt ?? nowIso(),
      processedAt: null,
    };
    tx.set(ref, event);
    return true;
  });
};

export const markStripeWebhookEventProcessed = async (stripeEventId: string): Promise<void> => {
  await getDb().collection('stripe_webhook_events').doc(stripeEventId)
    .set({ processingStatus: 'processed', processedAt: nowIso(), lastError: null }, { merge: true });
};

export const markStripeWebhookEventFailed = async (stripeEventId: string, error: string): Promise<void> => {
  await getDb().collection('stripe_webhook_events').doc(stripeEventId).set({
    processingStatus: 'failed',
    lastError: error,
    attemptCount: FieldValue.increment(1),
  }, { merge: true });
};

export const getStripeWebhookEvent = async (stripeEventId: string): Promise<StripeWebhookEvent | null> => {
  const doc = await getDb().collection('stripe_webhook_events').doc(stripeEventId).get();
  return doc.exists ? (doc.data() as StripeWebhookEvent) : null;
};

export const listBillingPlanConfigs = async (): Promise<BillingPlanConfig[]> => {
  const snap = await getDb().collection('billing_plan_config').get();
  return snap.docs
    .map((doc) => doc.data() as BillingPlanConfig)
    .sort((a, b) => a.planKey.localeCompare(b.planKey));
};

export const getBillingPlanConfig = async (planKey: BillingPlanKey): Promise<BillingPlanConfig | null> => {
  const doc = await getDb().collection('billing_plan_config').doc(planKey).get();
  return doc.exists ? (doc.data() as BillingPlanConfig) : null;
};

export const upsertBillingPlanConfig = async (
  data: Partial<Omit<BillingPlanConfig, 'id' | 'planKey'>> & { planKey: BillingPlanKey; updatedBy?: string | null },
): Promise<BillingPlanConfig> => {
  const ref = getDb().collection('billing_plan_config').doc(data.planKey);
  const has = (key: keyof typeof data): boolean => Object.prototype.hasOwnProperty.call(data, key);
  return getDb().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const previous = doc.exists ? doc.data() as BillingPlanConfig : null;
    const config: BillingPlanConfig = {
      id: previous?.id ?? data.planKey,
      planKey: data.planKey,
      stripeProductId: has('stripeProductId') ? data.stripeProductId ?? null : previous?.stripeProductId ?? null,
      activeStripePriceId: has('activeStripePriceId') ? data.activeStripePriceId ?? null : previous?.activeStripePriceId ?? null,
      unitAmountCents: data.unitAmountCents ?? previous?.unitAmountCents ?? 0,
      currency: data.currency ?? previous?.currency ?? 'usd',
      interval: data.interval ?? previous?.interval ?? 'month',
      trialDays: data.trialDays ?? previous?.trialDays ?? 14,
      pastDueGraceDays: data.pastDueGraceDays ?? previous?.pastDueGraceDays ?? 14,
      automaticTaxEnabled: data.automaticTaxEnabled ?? previous?.automaticTaxEnabled ?? true,
      promotionCodesEnabled: data.promotionCodesEnabled ?? previous?.promotionCodesEnabled ?? false,
      isCheckoutEnabled: data.isCheckoutEnabled ?? previous?.isCheckoutEnabled ?? true,
      livemode: has('livemode') ? data.livemode ?? null : previous?.livemode ?? null,
      version: previous ? previous.version + 1 : 1,
      updatedBy: data.updatedBy ?? null,
      updatedAt: nowIso(),
    };
    tx.set(ref, config);
    return config;
  });
};

export const listBillingPriceHistory = async (planKey?: BillingPlanKey): Promise<BillingPriceHistory[]> => {
  const snap = await getDb().collection('billing_price_history').get();
  return snap.docs
    .map((doc) => doc.data() as BillingPriceHistory)
    .filter((price) => !planKey || price.planKey === planKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const insertBillingPriceHistory = async (data: {
  stripePriceId: string;
  planKey: BillingPlanKey;
  stripeProductId: string | null;
  unitAmountCents: number;
  currency: string;
  interval: 'month' | 'year';
  livemode: boolean;
  activeForNewCheckout: boolean;
  createdBy: string | null;
}): Promise<BillingPriceHistory> => {
  const price: BillingPriceHistory = {
    id: randomUUID(),
    ...data,
    createdAt: nowIso(),
    retiredAt: null,
  };
  await getDb().collection('billing_price_history').doc(data.stripePriceId).set(price);
  return price;
};

export const deactivateOldPricesForPlan = async (
  planKey: BillingPlanKey,
  keepActivePriceId: string,
): Promise<void> => {
  const snap = await getDb().collection('billing_price_history').where('planKey', '==', planKey).get();
  const batch = getDb().batch();
  for (const doc of snap.docs) {
    const price = doc.data() as BillingPriceHistory;
    if (price.stripePriceId !== keepActivePriceId && price.activeForNewCheckout) {
      batch.update(doc.ref, { activeForNewCheckout: false, retiredAt: nowIso() });
    }
  }
  await batch.commit();
};

import { mergeAirportSearchResults, normalizeAirportDataset, searchBundledAirportDataset } from './services/airportCatalog';
import { downloadAirportDatasetForDailyRefresh } from './apis/airportDatasetCallers';

// ---------------------------------------------------------------------------
// Packing lists v2 (Firestore provider)
// ---------------------------------------------------------------------------
// Collections: preset_packing_lists_v2/{key}/items/{item},
// user_packing_list_preferences_v2/{userId}, trip_packing_lists_v2/{tripId}
// (presetKeys/manualItems), plus the existing trip checks subcollection.

const packingV2PresetCollection = () => getDb().collection('preset_packing_lists_v2');
const packingV2PreferenceCollection = () => getDb().collection('user_packing_list_preferences_v2');
const packingV2TripCollection = () => getDb().collection('trip_packing_lists_v2');

const firebasePackingItem = (data: any, id: string, index = 0): PackingListItem => ({
  id,
  category: String(data.category ?? ''),
  label: String(data.label ?? ''),
  position: Number(data.position ?? index),
  createdAt: data.createdAt ?? null,
  updatedAt: data.updatedAt ?? null,
});

export const syncPackingPresetCatalogV2 = async (presets: any[]): Promise<PackingPreset[]> => {
  const db = getDb();
  const activeKeys = new Set(presets.map((preset) => preset.key));
  const existing = await packingV2PresetCollection().get();
  const batch = db.batch();
  for (const doc of existing.docs) {
    if (!activeKeys.has(doc.id) && !String((doc.data() as any)?.sourceFilename ?? '').startsWith('admin:')) batch.set(doc.ref, { isActive: false, updatedAt: nowIso() }, { merge: true });
  }
  for (const preset of presets) {
    const ref = packingV2PresetCollection().doc(preset.key);
    batch.set(ref, {
      id: preset.key,
      key: preset.key,
      label: preset.label,
      description: preset.description ?? '',
      gendered: Boolean(preset.gendered),
      contentHash: preset.contentHash,
      sourceFilename: preset.filename,
      source: preset.filename.startsWith('admin:') ? 'admin' : 'disk',
      isActive: true,
      updatedAt: nowIso(),
    }, { merge: true });
    const itemCollection = ref.collection('items');
    const oldItems = await itemCollection.get();
    oldItems.docs.forEach((doc: any) => batch.delete(doc.ref));
    for (const item of preset.items) {
      batch.set(itemCollection.doc(), {
        category: item.category,
        label: item.label,
        normalizedLabel: item.normalizedLabel,
        position: item.position,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
  }
  await batch.commit();
  return listPackingPresetsV2(true);
};

export const listPackingPresetsV2 = async (includeInactive = false): Promise<PackingPreset[]> => {
  const snap = await packingV2PresetCollection().get();
  const result: PackingPreset[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    if (!includeInactive && data.isActive === false) continue;
    const itemSnap = await doc.ref.collection('items').get();
    const items = itemSnap.docs.map((itemDoc: any, index: number) => firebasePackingItem(itemDoc.data(), itemDoc.id, index));
    result.push({
      id: doc.id,
      key: String(data.key ?? doc.id),
      label: String(data.label ?? doc.id),
      description: String(data.description ?? ''),
      gendered: Boolean(data.gendered),
      contentHash: String(data.contentHash ?? ''),
      sourceFilename: String(data.sourceFilename ?? `${doc.id}.md`),
      isActive: data.isActive !== false,
      items,
    });
  }
  return result.sort((a, b) => {
    const rank = (key: string) => ({ general: 0, women: 1, men: 2 } as Record<string, number>)[key] ?? 3;
    return rank(a.key) - rank(b.key) || a.label.localeCompare(b.label);
  });
};

export const getUserPackingPreferencesV2 = async (userId: string): Promise<PackingPresetPreference> => {
  const doc = await packingV2PreferenceCollection().doc(userId).get();
  const keys = Array.isArray(doc.data()?.presetKeys) ? doc.data()?.presetKeys.filter((key: unknown): key is string => typeof key === 'string') : [];
  return { userId, presetKeys: Array.from(new Set(['general', ...keys])) };
};

export const getUserPackingListV2 = async (userId: string): Promise<PackingListItem[]> => {
  const preference = await packingV2PreferenceCollection().doc(userId).get();
  if (!preference.exists) return [];
  const snap = await userPackingCollection(userId).get();
  return snap.docs
    .map((doc: any, index: number) => firebasePackingItem(doc.data(), doc.id, index))
    .sort((a: PackingListItem, b: PackingListItem) => a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }) || a.position - b.position || a.label.localeCompare(b.label));
};

export const replaceUserPackingPreferencesV2 = async (
  userId: string,
  presetKeysInput: string[],
  personalItemsInput: Array<{ category?: unknown; label?: unknown }>
): Promise<{ preferences: PackingPresetPreference; items: PackingListItem[] }> => {
  const available = new Set((await listPackingPresetsV2()).map((preset) => preset.key));
  const presetKeys = Array.from(new Set(['general', ...presetKeysInput.filter((key) => available.has(key))]));
  const items = sanitizePackingItems(personalItemsInput);
  const db = getDb();
  const batch = db.batch();
  batch.set(packingV2PreferenceCollection().doc(userId), { userId, presetKeys, updatedAt: nowIso() }, { merge: true });
  const existing = await userPackingCollection(userId).get();
  existing.docs.forEach((doc: any) => batch.delete(doc.ref));
  for (const item of items) {
    batch.set(userPackingCollection(userId).doc(), {
      category: item.category,
      label: item.label,
      normalizedLabel: normalizePackingLabel(item.label),
      position: item.position,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  await batch.commit();
  return { preferences: { userId, presetKeys }, items: await getUserPackingListV2(userId) };
};

/**
 * Rebuild the derived packing-list view for every trip the user can currently
 * read. The Firebase implementation derives the view on demand in
 * getPackingListV2, so reconciliation consists of resolving each active
 * projected trip access entry just like the PostgreSQL adapter does.
 */
export const reconcileUserPackingListsV2 = async (userId: string): Promise<{ tripsReconciled: number }> => {
  const accessSnap = await getDb().collection('trip_access').where('userId', '==', userId).get();
  const tripIds = Array.from(new Set(
    accessSnap.docs
      .map((doc) => doc.data() as any)
      .filter((data) => data.status === 'active' && data.canRead === true)
      .map((data) => String(data.tripId ?? '').trim())
      .filter((tripId) => tripId.length > 0)
  ));

  for (const tripId of tripIds) {
    await getPackingListV2(userId, tripId);
  }

  return { tripsReconciled: tripIds.length };
};

export const getPackingListV2 = async (userId: string, tripId: string): Promise<PackingListV2Trip> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const travelers = (await listGroupMembers(access.groupId, userId)).filter((member) => !member.removedAt).map((member) => ({
    id: member.id,
    userId: member.userId ?? null,
    name: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.guestName || member.email || 'Traveler',
    email: member.email ?? null,
  }));
  const presets = await listPackingPresetsV2();
  const presetByKey = new Map(presets.map((preset) => [preset.key, preset]));
  const tripDoc = await packingV2TripCollection().doc(tripId).get();
  const tripData = tripDoc.data() as any;
  const tripPresetKeys = Array.isArray(tripData?.presetKeys) ? tripData.presetKeys.filter((key: unknown): key is string => typeof key === 'string') : [];
  const disabledPresetKeys = new Set<string>(Array.isArray(tripData?.disabledPresetKeys) ? tripData.disabledPresetKeys.filter((key: unknown): key is string => typeof key === 'string') : []);
  const disabledPersonalUserIds = new Set<string>(Array.isArray(tripData?.disabledPersonalUserIds) ? tripData.disabledPersonalUserIds.filter((key: unknown): key is string => typeof key === 'string') : []);
  const manualItems = Array.isArray(tripData?.manualItems) ? tripData.manualItems : [];
  const inputGroups: any[] = [];
  const attachedPresetKeys = new Set<string>(tripPresetKeys);
  for (const member of travelers) {
    if (!member.userId) continue;
    const preferences = await getUserPackingPreferencesV2(member.userId);
    for (const key of preferences.presetKeys) {
      if (disabledPresetKeys.has(key)) continue;
      const preset = presetByKey.get(key);
      if (!preset) continue;
      attachedPresetKeys.add(key);
      inputGroups.push({ key, label: preset.label, kind: 'preset', order: key === 'general' ? 0 : undefined, ownerMemberId: null, items: preset.items });
    }
    const personal = await getUserPackingListV2(member.userId);
    if (!disabledPersonalUserIds.has(member.userId) && personal.length) inputGroups.push({ key: `personal:${member.userId}`, label: `${member.name}'s list`, kind: 'personal', ownerMemberId: member.userId, items: personal.map((item) => ({ ...item, personalOwnerIds: [member.userId] })) });
  }
  for (const key of tripPresetKeys) {
    if (disabledPresetKeys.has(key)) continue;
    const preset = presetByKey.get(key);
    if (preset) inputGroups.push({ key, label: preset.label, kind: 'preset', items: preset.items });
  }
  if (manualItems.length) inputGroups.push({ key: 'trip_manual', label: 'Trip additions', kind: 'trip_manual', items: manualItems.map((item: any, index: number) => ({ ...item, id: item.id ?? `${tripId}-manual-${index}`, position: index })) });
  const checksSnap = await tripPackingChecksCollection(tripId).where('packed', '==', true).get();
  const packedBy = new Map<string, string[]>();
  checksSnap.docs.forEach((doc: any) => {
    const data = doc.data() as any;
    packedBy.set(String(data.itemId), [...(packedBy.get(String(data.itemId)) ?? []), String(data.travelerId)]);
  });
  const groupsWithChecks = inputGroups.map((group) => ({ ...group, items: group.items.map((item: any) => ({ ...item, packedBy: packedBy.get(item.id) ?? [] })) }));
  const groups = buildPackingListDisplayGroups(groupsWithChecks, userId) as any;
  return {
    groups,
    travelers,
    presets,
    currentTravelerId: travelers.find((traveler) => traveler.userId === userId)?.id ?? null,
    items: groups.flatMap((group: any) => group.items.map((item: any) => ({ ...item, category: item.category || group.label }))),
    tripPresetKeys,
    sources: [
      ...presets.map((preset) => ({ key: `preset:${preset.key}`, label: preset.label, kind: 'preset' as const, presetKey: preset.key, active: !disabledPresetKeys.has(preset.key) && attachedPresetKeys.has(preset.key) })),
      ...travelers.filter((traveler) => traveler.userId).map((traveler) => ({ key: `personal:${traveler.userId}`, label: `${traveler.name}'s list`, kind: 'personal' as const, ownerMemberId: traveler.userId, active: !disabledPersonalUserIds.has(traveler.userId as string) })),
    ],
    manualItems: manualItems.map((item: any, index: number) => ({ ...item, id: item.id ?? `${tripId}-manual-${index}`, position: index })),
  };
};

export const addTripPackingPresetV2 = async (userId: string, tripId: string, presetKey: string): Promise<PackingListV2Trip> => {
  return setTripPackingSourceV2(userId, tripId, 'preset', presetKey, true);
};

export const removeTripPackingPresetV2 = async (userId: string, tripId: string, presetKey: string): Promise<PackingListV2Trip> => {
  return setTripPackingSourceV2(userId, tripId, 'preset', presetKey, false);
};

export const setTripPackingSourceV2 = async (
  userId: string,
  tripId: string,
  kind: 'preset' | 'personal',
  sourceKey: string,
  enabled: boolean
): Promise<PackingListV2Trip> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const ref = packingV2TripCollection().doc(tripId);
  const current = (await ref.get()).data() as any;
  if (kind === 'preset') {
    const presetKey = sourceKey.replace(/^preset:/, '');
    if (!(await listPackingPresetsV2()).some((preset) => preset.key === presetKey && preset.isActive)) throw new Error('Packing preset not found');
    const currentKeys: string[] = Array.isArray(current?.presetKeys) ? current.presetKeys.filter((key: unknown): key is string => typeof key === 'string') : [];
    const disabled = new Set<string>(Array.isArray(current?.disabledPresetKeys) ? current.disabledPresetKeys.filter((key: unknown): key is string => typeof key === 'string') : []);
    if (enabled) {
      disabled.delete(presetKey);
      currentKeys.push(presetKey);
    } else {
      disabled.add(presetKey);
    }
    await ref.set({ tripId, presetKeys: Array.from(new Set(currentKeys)).filter((key: string) => !disabled.has(key)), disabledPresetKeys: Array.from(disabled), updatedAt: nowIso() }, { merge: true });
  } else {
    const ownerId = sourceKey.replace(/^personal:/, '');
    if (!ownerId) throw new Error('Packing list owner is required');
    const members = await listGroupMembers(access.groupId, userId);
    if (!members.some((member) => !member.removedAt && member.userId === ownerId)) throw new Error('Packing list owner is not a trip member');
    const disabled = new Set<string>(Array.isArray(current?.disabledPersonalUserIds) ? current.disabledPersonalUserIds.filter((key: unknown): key is string => typeof key === 'string') : []);
    if (enabled) disabled.delete(ownerId);
    else disabled.add(ownerId);
    await ref.set({ tripId, disabledPersonalUserIds: Array.from(disabled), updatedAt: nowIso() }, { merge: true });
  }
  return getPackingListV2(userId, tripId);
};

export const removePackingPresetV2 = async (presetKey: string): Promise<void> => {
  await packingV2PresetCollection().doc(presetKey).set({ isActive: false, updatedAt: nowIso() }, { merge: true });
};

export const reactivatePackingPresetV2 = async (presetKey: string): Promise<void> => {
  await packingV2PresetCollection().doc(presetKey).set({ isActive: true, updatedAt: nowIso() }, { merge: true });
};

export const updatePackingPresetV2 = async (presetKey: string, patch: { label?: string; description?: string; items?: Array<{ category: string; label: string }> }): Promise<PackingPreset | null> => {
  const ref = packingV2PresetCollection().doc(presetKey);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const update: any = { updatedAt: nowIso() };
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.items) {
    const batch = getDb().batch();
    const oldItems = await ref.collection('items').get();
    oldItems.docs.forEach((item: any) => batch.delete(item.ref));
    const seen = new Set<string>();
    for (const item of patch.items) {
      const normalizedLabel = normalizePackingLabel(item.label);
      if (!item.category.trim() || !normalizedLabel || seen.has(normalizedLabel)) continue;
      seen.add(normalizedLabel);
      batch.set(ref.collection('items').doc(), { category: item.category.trim(), label: item.label.trim(), normalizedLabel, position: seen.size - 1, updatedAt: nowIso() });
    }
    batch.set(ref, update, { merge: true });
    await batch.commit();
  } else {
    await ref.set(update, { merge: true });
  }
  return (await listPackingPresetsV2(true)).find((preset) => preset.key === presetKey) ?? null;
};

export const replaceTripPackingListV2 = async (userId: string, tripId: string, itemsInput: Array<{ category?: unknown; label?: unknown }>): Promise<PackingListV2Trip> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const items = sanitizePackingItems(itemsInput).map((item) => ({ ...item, normalizedLabel: normalizePackingLabel(item.label) }));
  await packingV2TripCollection().doc(tripId).set({ tripId, manualItems: items, updatedAt: nowIso() }, { merge: true });
  return getPackingListV2(userId, tripId);
};

export const addTripPackingItemV2 = async (userId: string, tripId: string, itemInput: { category?: unknown; label?: unknown }): Promise<PackingListV2Trip> => {
  const current = await getPackingListV2(userId, tripId);
  const manual = current.groups.find((group) => group.kind === 'trip_manual')?.items ?? [];
  return replaceTripPackingListV2(userId, tripId, [...manual, itemInput]);
};

export const removeTripPackingItemV2 = async (userId: string, tripId: string, itemId: string): Promise<PackingListV2Trip> => {
  const current = await getPackingListV2(userId, tripId);
  const manual = (current.groups.find((group) => group.kind === 'trip_manual')?.items ?? []).filter((item) => item.id !== itemId);
  return replaceTripPackingListV2(userId, tripId, manual);
};

export const getLodgingLocation = async (placeId: string): Promise<any | null> => {
  const doc = await getDb().collection('lodging_locations').doc(placeId).get();
  return doc.exists ? { place_id: doc.id, ...doc.data() } : null;
};

export const upsertLodgingLocation = async (location: any): Promise<void> => {
  await getDb().collection('lodging_locations').doc(location.placeId).set({
    name: location.name,
    address: location.address || null,
    phone_number: location.phoneNumber || null,
    iana_timezone: location.ianaTimezone || null,
    latitude: location.latitude || null,
    longitude: location.longitude || null,
    updatedAt: nowIso(),
  }, { merge: true });
};
