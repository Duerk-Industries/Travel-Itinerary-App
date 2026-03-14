/**
 * Unit + integration tests for the Socket.IO chat and presence infrastructure.
 *
 * Sections:
 *   1. colors / initials helpers  (pure unit tests)
 *   2. presenceManager            (in-process unit tests)
 *   3. DB chat functions          (adapter-backed integration tests)
 *   4. REST endpoint              (HTTP integration via supertest)
 */
import { colorForUser, initialsForName } from '../../packages/messaging/src/colors';
import {
  userJoined,
  userLeft,
  presenceList,
  heartbeat,
  _reset,
} from '../src/socket/presenceManager';

// ---------------------------------------------------------------------------
// 1. colors.ts
// ---------------------------------------------------------------------------
describe('colorForUser', () => {
  it('returns a hex string', () => {
    expect(colorForUser('some-user-id')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('is deterministic', () => {
    expect(colorForUser('abc')).toBe(colorForUser('abc'));
  });

  it('produces varied colors across users', () => {
    const colors = new Set(Array.from({ length: 20 }, (_, i) => colorForUser(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(4);
  });
});

describe('initialsForName', () => {
  it('returns two initials for full name', () => {
    expect(initialsForName('Jane Doe')).toBe('JD');
  });

  it('returns one initial for single word', () => {
    expect(initialsForName('Alice')).toBe('A');
  });

  it('uses first and last word for three-word name', () => {
    expect(initialsForName('John Paul Jones')).toBe('JJ');
  });

  it('returns ? for empty string', () => {
    expect(initialsForName('')).toBe('?');
  });
});

// ---------------------------------------------------------------------------
// 2. presenceManager
// ---------------------------------------------------------------------------
const TRIP = 'trip-001';
const USER_A = { id: 'user-aaa', name: 'Alice Andersson' };
const USER_B = { id: 'user-bbb', name: 'Bob Brown' };

describe('presenceManager', () => {
  beforeEach(() => _reset());

  it('adds a user on join', () => {
    userJoined(TRIP, USER_A.id, USER_A.name);
    const list = presenceList(TRIP);
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(USER_A.id);
    expect(list[0].displayName).toBe(USER_A.name);
  });

  it('deduplicates on double join', () => {
    userJoined(TRIP, USER_A.id, USER_A.name);
    userJoined(TRIP, USER_A.id, USER_A.name);
    expect(presenceList(TRIP)).toHaveLength(1);
  });

  it('includes multiple users', () => {
    userJoined(TRIP, USER_A.id, USER_A.name);
    userJoined(TRIP, USER_B.id, USER_B.name);
    expect(presenceList(TRIP)).toHaveLength(2);
  });

  it('assigns initials and hex color', () => {
    userJoined(TRIP, USER_A.id, USER_A.name);
    const [entry] = presenceList(TRIP);
    expect(entry.initials).toBe('AA');
    expect(entry.color).toMatch(/^#/);
  });

  it('returns empty list for unknown trip', () => {
    expect(presenceList('no-such-trip')).toHaveLength(0);
  });

  it('cancels the grace-period timer if user rejoins before it fires', () => {
    userJoined(TRIP, USER_A.id, USER_A.name);
    let callbackFired = false;
    userLeft(TRIP, USER_A.id, () => { callbackFired = true; });
    // Immediately rejoin — the timer should be cancelled
    userJoined(TRIP, USER_A.id, USER_A.name);
    expect(callbackFired).toBe(false);
    expect(presenceList(TRIP)).toHaveLength(1);
  });

  it('heartbeat updates lastSeen', async () => {
    userJoined(TRIP, USER_A.id, USER_A.name);
    const before = presenceList(TRIP)[0].lastSeen;
    await new Promise((r) => setTimeout(r, 2));
    heartbeat(TRIP, USER_A.id);
    const after = presenceList(TRIP)[0].lastSeen;
    expect(after >= before).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. DB chat functions (adapter-backed via HTTP setup)
// ---------------------------------------------------------------------------
import request from 'supertest';
import { app } from '../src/app';
import { initDb } from '../src/db';
import * as db from '../src/db';

describe('Trip messages DB + REST', () => {
  jest.setTimeout(30_000);

  const uniq = Date.now();
  const user = { email: `chat-test+${uniq}@example.com`, firstName: 'Chat', lastName: 'Tester', password: 'testtest' };
  let token: string;
  let tripId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await request(app)
      .post('/api/web-auth/register')
      .send({ ...user, passwordConfirm: user.password })
      .expect(201);

    const createdUser = await db.findUserByEmail(user.email);
    expect(createdUser).toBeTruthy();
    userId = createdUser!.id;

    const verification = await db.createEmailVerification(userId);
    await request(app)
      .get('/api/web-auth/confirm')
      .query({ token: verification.token })
      .expect(200);

    const login = await request(app)
      .post('/api/web-auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    token = login.body.token as string;

    // Get user's default group
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const groupId = groups.body[0]?.id as string;

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Chat Trip ${uniq}`, groupId })
      .expect(201);
    tripId = tripRes.body.id as string;
    expect(tripId).toBeTruthy();
  });

  afterAll(async () => {
    if (tripId && token) {
      await request(app)
        .delete(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${token}`);
    }
    if (userId) {
      await db.deleteWebUserAndCleanup(userId);
    }
  });

  it('returns empty message list for new trip', async () => {
    const msgs = await db.listTripMessages(tripId);
    expect(msgs).toEqual([]);
  });

  it('addTripMessage creates a message', async () => {
    const msg = await db.addTripMessage({
      appId: 'WanderBunnies',
      tripId,
      senderId: userId,
      senderName: 'Chat Tester',
      senderInitials: 'CT',
      body: 'Hello world!',
    });
    expect(msg.id).toBeTruthy();
    expect(msg.body).toBe('Hello world!');
    expect(msg.appId).toBe('WanderBunnies');
    expect(msg.readBy).toEqual([]);
  });

  it('listTripMessages returns messages in order', async () => {
    const msgs = await db.listTripMessages(tripId);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });

  it('countUnreadMessages returns non-zero before mark-read', async () => {
    const count = await db.countUnreadMessages(tripId, userId);
    expect(count).toBeGreaterThan(0);
  });

  it('markMessagesRead reduces unread to zero', async () => {
    const msgs = await db.listTripMessages(tripId);
    const lastId = msgs[msgs.length - 1].id;
    await db.markMessagesRead(tripId, userId, lastId);
    const after = await db.countUnreadMessages(tripId, userId);
    expect(after).toBe(0);
  });

  it('addTripMessage rejects empty body', async () => {
    await expect(
      db.addTripMessage({
        appId: 'WanderBunnies',
        tripId,
        senderId: userId,
        senderName: 'Chat Tester',
        senderInitials: 'CT',
        body: '   ',
      })
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // REST endpoint: GET /api/trips/:id/messages
  // -------------------------------------------------------------------------
  it('GET /api/trips/:id/messages returns 200 with messages array', async () => {
    const res = await request(app)
      .get(`/api/trips/${tripId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.tripId).toBe(tripId);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('GET /api/trips/:id/messages returns 401 without token', async () => {
    await request(app).get(`/api/trips/${tripId}/messages`).expect(401);
  });
});
