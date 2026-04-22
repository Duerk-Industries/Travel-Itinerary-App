/**
 * @jest-environment node
 */

import net from 'net';
import { randomUUID } from 'crypto';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore as getClientFirestore,
  setDoc,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';
import { initializeApp as initializeAdminApp, getApps, deleteApp as deleteAdminApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';

jest.setTimeout(60000);

const PROJECT_ID = process.env.GCLOUD_PROJECT_ID || 'firestore-rules-test';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const canConnect = async (host: string, port: number, timeoutMs = 1500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });

const expectDenied = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toMatchObject({ code: expect.stringMatching(/permission-denied/i) });
};

type ClientContext = {
  app: FirebaseApp;
  auth: Auth;
  db: ClientFirestore;
  uid: string;
  email: string;
};

const clientApps: FirebaseApp[] = [];

const createAuthedClient = async (label: string): Promise<ClientContext> => {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = 'testtest';
  const app = initializeClientApp(
    {
      apiKey: 'demo-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `rules-${label}-${randomUUID()}`
  );
  clientApps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getClientFirestore(app);
  const [firestoreEmulatorHost, firestorePortRaw] = FIRESTORE_HOST.split(':');
  connectFirestoreEmulator(db, firestoreEmulatorHost, Number(firestorePortRaw || 8080));
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return { app, auth, db, uid: cred.user.uid, email };
};

const createAnonClient = async (label: string): Promise<{ app: FirebaseApp; db: ClientFirestore }> => {
  const app = initializeClientApp(
    {
      apiKey: 'demo-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `rules-anon-${label}-${randomUUID()}`
  );
  clientApps.push(app);
  const db = getClientFirestore(app);
  const [firestoreEmulatorHost, firestorePortRaw] = FIRESTORE_HOST.split(':');
  connectFirestoreEmulator(db, firestoreEmulatorHost, Number(firestorePortRaw || 8080));
  return { app, db };
};

const adminApp = () => {
  const existing = getApps().find((app) => app.name === 'firestore-rules-admin');
  if (existing) return existing;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  try {
    return initializeAdminApp({ projectId: PROJECT_ID }, 'firestore-rules-admin');
  } catch {
    return initializeAdminApp({ projectId: PROJECT_ID, credential: applicationDefault() }, 'firestore-rules-admin');
  }
};

const seedBaseDocuments = async (
  db: AdminFirestore,
  owner: ClientContext,
  other: ClientContext,
  outsider: ClientContext,
  follower: ClientContext,
  removed: ClientContext
) => {
  await Promise.all([
    db.collection('locations').doc('public-location').set({ name: 'Paris', sourceFile: 'seed.json' }),
    db.collection('users').doc(owner.uid).set({ email: owner.email, firstName: 'Owner' }),
    db.collection('users').doc(other.uid).set({ email: other.email, firstName: 'Other' }),
    db.collection('users').doc(outsider.uid).set({ email: outsider.email, firstName: 'Outsider' }),
    db.collection('users').doc(follower.uid).set({ email: follower.email, firstName: 'Follower' }),
    db.collection('users').doc(removed.uid).set({ email: removed.email, firstName: 'Removed' }),
    db.collection('web_users').doc(owner.uid).set({ email: owner.email, preferredAirport: 'BOS' }),
    db.collection('web_users').doc(other.uid).set({ email: other.email, preferredAirport: 'JFK' }),
    db.collection('fellow_travelers').doc('traveler-1').set({ ownerId: owner.uid, name: 'Traveler One' }),
    db.collection('family_relationships').doc('rel-1').set({
      requesterId: owner.uid,
      relativeId: other.uid,
      status: 'pending',
    }),
    db.collection('groups').doc('group-1').set({ ownerId: owner.uid, name: 'Group One', createdAt: '2026-04-22T00:00:00.000Z' }),
    db.collection('group_access').doc(`group-1_${owner.uid}`).set({
      groupId: 'group-1',
      userId: owner.uid,
      role: 'owner',
      status: 'active',
      canRead: true,
      canWrite: true,
      canManageMembers: true,
    }),
    db.collection('group_access').doc(`group-1_${other.uid}`).set({
      groupId: 'group-1',
      userId: other.uid,
      role: 'member',
      status: 'active',
      canRead: true,
      canWrite: true,
      canManageMembers: false,
    }),
    db.collection('group_members').doc('gm-owner').set({
      groupId: 'group-1',
      userId: owner.uid,
      removedAt: null,
    }),
    db.collection('group_members').doc('gm-other').set({
      groupId: 'group-1',
      userId: other.uid,
      removedAt: null,
    }),
    db.collection('group_members').doc('gm-removed').set({
      groupId: 'group-1',
      userId: removed.uid,
      removedAt: null,
    }),
    db.collection('group_invites').doc('invite-1').set({
      groupId: 'group-1',
      inviteeUserId: other.uid,
      inviteeEmail: other.email,
      status: 'pending',
    }),
    db.collection('trips').doc('trip-1').set({
      groupId: 'group-1',
      name: 'Owner Trip',
      createdAt: '2026-04-22T00:00:00.000Z',
    }),
    db.collection('flights').doc('flight-1').set({
      tripId: 'trip-1',
      createdAt: '2026-04-22T00:00:00.000Z',
    }),
    db.collection('trip_access').doc(`trip-1_${owner.uid}`).set({
      tripId: 'trip-1',
      groupId: 'group-1',
      userId: owner.uid,
      role: 'owner',
      status: 'active',
      canRead: true,
      canWrite: true,
    }),
    db.collection('trip_access').doc(`trip-1_${other.uid}`).set({
      tripId: 'trip-1',
      groupId: 'group-1',
      userId: other.uid,
      role: 'member',
      status: 'active',
      canRead: true,
      canWrite: true,
    }),
    db.collection('trip_access').doc(`trip-1_${follower.uid}`).set({
      tripId: 'trip-1',
      groupId: 'group-1',
      userId: follower.uid,
      role: 'follower',
      status: 'active',
      canRead: true,
      canWrite: false,
    }),
    db.collection('trip_followers').doc('tf-1').set({
      tripId: 'trip-1',
      followerUserId: follower.uid,
      role: 'follower',
      createdAt: '2026-04-22T00:00:00.000Z',
    }),
    db.collection('trip_removals').doc('tr-1').set({
      tripId: 'trip-1',
      userId: removed.uid,
      createdAt: '2026-04-22T00:00:00.000Z',
    }),
    db.collection('audit_log').doc('audit-1').set({
      actorUserId: owner.uid,
      createdAt: '2026-04-22T00:00:00.000Z',
    }),
  ]);
};

describe('firestore security rules', () => {
  let emulatorReady = false;
  let db: AdminFirestore;
  let owner: ClientContext;
  let other: ClientContext;
  let outsider: ClientContext;
  let follower: ClientContext;
  let removed: ClientContext;

  beforeAll(async () => {
    const [firestoreHost, firestorePortRaw] = FIRESTORE_HOST.split(':');
    const [authHost, authPortRaw] = AUTH_HOST.split(':');
    const firestoreReady = await canConnect(firestoreHost, Number(firestorePortRaw || 8080));
    const authReady = await canConnect(authHost, Number(authPortRaw || 9099));
    emulatorReady = firestoreReady && authReady;
    if (!emulatorReady) {
      console.warn(`[TEST][firestore-rules] emulators not reachable at firestore=${FIRESTORE_HOST} auth=${AUTH_HOST}`);
      return;
    }

    db = getAdminFirestore(adminApp());
    owner = await createAuthedClient('owner');
    other = await createAuthedClient('other');
    outsider = await createAuthedClient('outsider');
    follower = await createAuthedClient('follower');
    removed = await createAuthedClient('removed');
    await seedBaseDocuments(db, owner, other, outsider, follower, removed);
  });

  afterAll(async () => {
    await Promise.all(
      clientApps.map(async (app) => {
        try {
          await signOut(getAuth(app));
        } catch {}
        await deleteClientApp(app).catch(() => undefined);
      })
    );
    const admin = getApps().find((app) => app.name === 'firestore-rules-admin');
    if (admin) {
      await deleteAdminApp(admin).catch(() => undefined);
    }
  });

  it('allows public reads of locations and denies public writes', async () => {
    if (!emulatorReady) return;
    const anon = await createAnonClient('public');
    await expect(getDoc(doc(anon.db, 'locations', 'public-location'))).resolves.toMatchObject({ exists: expect.any(Function) });
    await expectDenied(setDoc(doc(anon.db, 'locations', 'public-write'), { name: 'Blocked' }));
  });

  it('allows users to read only their own profile documents', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(owner.db, 'users', owner.uid))).resolves.toMatchObject({ id: owner.uid });
    await expect(getDoc(doc(owner.db, 'web_users', owner.uid))).resolves.toMatchObject({ id: owner.uid });
    await expectDenied(getDoc(doc(other.db, 'users', owner.uid)));
    await expectDenied(getDoc(doc(other.db, 'web_users', owner.uid)));
  });

  it('allows owner-scoped personal documents and blocks outsiders', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(owner.db, 'fellow_travelers', 'traveler-1'))).resolves.toMatchObject({ id: 'traveler-1' });
    await expectDenied(getDoc(doc(other.db, 'fellow_travelers', 'traveler-1')));
  });

  it('allows family relationship reads only to the involved users', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(owner.db, 'family_relationships', 'rel-1'))).resolves.toMatchObject({ id: 'rel-1' });
    await expect(getDoc(doc(other.db, 'family_relationships', 'rel-1'))).resolves.toMatchObject({ id: 'rel-1' });
    await expectDenied(getDoc(doc(outsider.db, 'family_relationships', 'rel-1')));
  });

  it('allows owner and member group reads through group_access', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(owner.db, 'groups', 'group-1'))).resolves.toMatchObject({ id: 'group-1' });
    await expect(getDoc(doc(other.db, 'groups', 'group-1'))).resolves.toMatchObject({ id: 'group-1' });
    await expectDenied(getDoc(doc(outsider.db, 'groups', 'group-1')));
  });

  it('allows owner and member trip reads through trip_access', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(owner.db, 'trips', 'trip-1'))).resolves.toMatchObject({ id: 'trip-1' });
    await expect(getDoc(doc(owner.db, 'flights', 'flight-1'))).resolves.toMatchObject({ id: 'flight-1' });
    await expect(getDoc(doc(other.db, 'trips', 'trip-1'))).resolves.toMatchObject({ id: 'trip-1' });
    await expect(getDoc(doc(other.db, 'flights', 'flight-1'))).resolves.toMatchObject({ id: 'flight-1' });
  });

  it('allows follower read-only access through trip_access', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(follower.db, 'trips', 'trip-1'))).resolves.toMatchObject({ id: 'trip-1' });
    await expect(getDoc(doc(follower.db, 'flights', 'flight-1'))).resolves.toMatchObject({ id: 'flight-1' });
    await expectDenied(setDoc(doc(follower.db, 'trips', 'trip-1'), { name: 'blocked overwrite' }));
  });

  it('denies removed users and outsiders when no active trip_access grant exists', async () => {
    if (!emulatorReady) return;
    await expectDenied(getDoc(doc(removed.db, 'trips', 'trip-1')));
    await expectDenied(getDoc(doc(outsider.db, 'trips', 'trip-1')));
    await expectDenied(getDoc(doc(outsider.db, 'flights', 'flight-1')));
  });

  it('allows users to read only their own membership and invite records', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(other.db, 'group_members', 'gm-other'))).resolves.toMatchObject({ id: 'gm-other' });
    await expect(getDoc(doc(other.db, 'group_invites', 'invite-1'))).resolves.toMatchObject({ id: 'invite-1' });
    await expectDenied(getDoc(doc(outsider.db, 'group_members', 'gm-other')));
    await expectDenied(getDoc(doc(outsider.db, 'group_invites', 'invite-1')));
  });

  it('allows users to read only their own group_access record', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(other.db, 'group_access', `group-1_${other.uid}`))).resolves.toMatchObject({ id: `group-1_${other.uid}` });
    await expectDenied(getDoc(doc(outsider.db, 'group_access', `group-1_${other.uid}`)));
  });

  it('allows users to read only their own trip_access record', async () => {
    if (!emulatorReady) return;
    await expect(getDoc(doc(other.db, 'trip_access', `trip-1_${other.uid}`))).resolves.toMatchObject({ id: `trip-1_${other.uid}` });
    await expectDenied(getDoc(doc(outsider.db, 'trip_access', `trip-1_${other.uid}`)));
  });

  it('denies direct access to audit and system collections', async () => {
    if (!emulatorReady) return;
    await expectDenied(getDoc(doc(owner.db, 'audit_log', 'audit-1')));
    await expectDenied(setDoc(doc(owner.db, 'trips', 'trip-2'), { groupId: 'group-1', name: 'Direct write' }));
  });
});
