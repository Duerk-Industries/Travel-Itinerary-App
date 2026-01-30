import request from 'supertest';
import type { Firestore } from 'firebase-admin/firestore';
import net from 'net';
import { randomUUID } from 'crypto';

const TEST_TAG = `firestore-group-members-${randomUUID()}`;
const OWNER_EMAIL = `${TEST_TAG}-owner@example.com`;
const MEMBER_EMAIL = `${TEST_TAG}-member@example.com`;
const GROUP_NAME = `${TEST_TAG}-group`;

jest.setTimeout(60000);

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const canConnect = async (host: string, port: number, timeoutMs = 1500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const onDone = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => onDone(true));
    socket.once('timeout', () => onDone(false));
    socket.once('error', () => onDone(false));
    socket.connect(port, host);
  });

const deleteDocs = async (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
  await Promise.all(docs.map((doc) => doc.ref.delete()));
};

const cleanupFirestore = async (db: Firestore) => {
  const groupsSnap = await db.collection('groups').where('name', '==', GROUP_NAME).get();
  for (const groupDoc of groupsSnap.docs) {
    const groupId = groupDoc.id;
    const membersSnap = await db.collection('group_members').where('groupId', '==', groupId).get();
    const invitesSnap = await db.collection('group_invites').where('groupId', '==', groupId).get();
    const tripsSnap = await db.collection('trips').where('groupId', '==', groupId).get();
    for (const tripDoc of tripsSnap.docs) {
      const tripId = tripDoc.id;
      const flightsSnap = await db.collection('flights').where('tripId', '==', tripId).get();
      const lodgingsSnap = await db.collection('lodgings').where('tripId', '==', tripId).get();
      const toursSnap = await db.collection('tours').where('tripId', '==', tripId).get();
      await deleteDocs(flightsSnap.docs);
      await deleteDocs(lodgingsSnap.docs);
      await deleteDocs(toursSnap.docs);
      await tripDoc.ref.delete();
    }
    await deleteDocs(membersSnap.docs);
    await deleteDocs(invitesSnap.docs);
    await groupDoc.ref.delete();
  }

  const usersSnap = await db.collection('users').where('email', 'in', [OWNER_EMAIL, MEMBER_EMAIL]).get();
  for (const userDoc of usersSnap.docs) {
    await db.collection('web_users').doc(userDoc.id).delete().catch(() => undefined);
    await userDoc.ref.delete();
  }
};

describe('Firestore group members (emulator)', () => {
  let app: any;
  let db: Firestore;
  let emulatorReady = false;

  beforeAll(async () => {
    process.env.DB_PROVIDER = 'firebase';
    process.env.USE_IN_MEMORY_DB = '0';
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
    process.env.GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID ?? 'firestore-emulator-test';

    const [host, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    const port = Number(portRaw || 8080);
    emulatorReady = await canConnect(host, port);
    if (!emulatorReady) {
      // Skip test run when emulator isn't available.
      console.warn(`[TEST][firestore] emulator not reachable at ${process.env.FIRESTORE_EMULATOR_HOST}`);
      return;
    }

    jest.resetModules();
    const { resetDbAdapter } = await import('../src/db.providers');
    resetDbAdapter();
    const firebase = await import('../src/db.firebase');
    db = firebase.getDb();
    await withTimeout(db.listCollections(), 15000, 'Firestore emulator connection');

    const mod = await import('../src/app');
    app = mod.app;
  });

  afterAll(async () => {
    if (emulatorReady && db) {
      await withTimeout(cleanupFirestore(db), 20000, 'Firestore cleanup (afterAll)');
    }
    const { closePool } = await import('../src/db');
    await closePool();
  });

  beforeEach(async () => {
    if (emulatorReady) {
      await withTimeout(cleanupFirestore(db), 20000, 'Firestore cleanup (beforeEach)');
    }
  });

  afterEach(async () => {
    if (emulatorReady) {
      await withTimeout(cleanupFirestore(db), 20000, 'Firestore cleanup (afterEach)');
    }
  });

  test('adding member with email yields single entry with name + email', async () => {
    if (!emulatorReady) {
      return;
    }
    const ownerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: OWNER_EMAIL, firstName: 'Owner', lastName: 'Test', password: 'testtest', passwordConfirm: 'testtest' })
      .expect(201);
    const ownerToken = ownerRes.body.token;

    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: GROUP_NAME, members: [] })
      .expect(201);
    const groupId = groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: MEMBER_EMAIL, guestName: 'Vicky Duerk' })
      .expect(201);

    const membersRes = await request(app)
      .get(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const matches = membersRes.body.filter((m: any) => (m.email ?? m.userEmail) === MEMBER_EMAIL);
    expect(matches).toHaveLength(1);
    expect((matches[0].guestName ?? `${matches[0].firstName ?? ''} ${matches[0].lastName ?? ''}`.trim()) || '').toBe(
      'Vicky Duerk'
    );
  });
});
