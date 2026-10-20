import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import request from 'supertest';
import { createHash } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag, setAdminSetting } from '../src/db';
import { docs, isFirebase, sql } from './providerRows';
import { notify } from '../src/services/notificationService';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('notification service', () => {
  const user = { firstName: 'Notify', lastName: 'User', email: `notify-test-${Date.now()}@example.com`, password: 'Password123!' };
  let token = '';
  let userId = '';

  beforeAll(async () => {
    await initDb();
    // Phases 0-7 audit: notifications_in_app is fail-closed (architecture §9.1) and was
    // discovered with no seeded flag row at all — this route group 404s without it.
    await setFeatureFlag('notifications_in_app', true, null);
    await registerWebUser(user);
    await confirmWebUser(user.email);
    const login = await loginWebUser(user);
    token = login.body.token;
    userId = login.body.user.id;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([user.email]);
  });

  it('restricts inbox access to the current cohort without an admin bypass', async () => {
    const settingKey = 'feature_cohort:notifications_in_app';
    await setAdminSetting({ key: settingKey, value: JSON.stringify({ userIds: [], owner: 'Notifications', retireAfter: '2099-01-01T00:00:00Z' }), updatedBy: null });
    clearFeatureFlagCacheForTesting();
    await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(404);
    await setAdminSetting({ key: settingKey, value: JSON.stringify({ userIds: [userId], owner: 'Notifications', retireAfter: '2099-01-01T00:00:00Z' }), updatedBy: null });
    clearFeatureFlagCacheForTesting();
    await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    await setAdminSetting({ key: settingKey, value: 'null', updatedBy: null }); clearFeatureFlagCacheForTesting();
  });

  it('preserves a digest schedule during ordinary channel changes', async () => {
    const digestTiming = { timezone: 'America/New_York', time: '08:00' };
    const preference = { category: 'trip_digest', inApp: true, push: false, email: false };
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).send({ preferences: [{ ...preference, digestTiming }] }).expect(204);
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).send({ preferences: [preference] }).expect(204);
    const saved = await request(app).get('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).expect(200);
    expect(saved.body.preferences.find((row: { category: string }) => row.category === 'trip_digest').digestTiming).toEqual(digestTiming);
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).send({ preferences: [{ ...preference, digestTiming: null }] }).expect(204);
  });

  it('round-trips quiet hours, preserves them on channel-only edits, and validates timezones', async () => {
    const quietTiming = { timezone: 'America/New_York', quietStart: '22:00', quietEnd: '08:00' };
    const preference = { category: 'ai_finished', inApp: true, push: false, email: false };
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`)
      .send({ preferences: [{ ...preference, quietTiming }] }).expect(204);
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`)
      .send({ preferences: [preference] }).expect(204);
    const saved = await request(app).get('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).expect(200);
    expect(saved.body.preferences.find((row: { category: string }) => row.category === 'ai_finished').quietTiming).toEqual(quietTiming);
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`)
      .send({ preferences: [{ ...preference, quietTiming: { ...quietTiming, timezone: 'not-a-zone' } }] }).expect(400);
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`)
      .send({ preferences: [{ ...preference, quietTiming: null }] }).expect(204);
  });

  it('notify creates an in-app notification and enqueues to outbox', async () => {
    await notify({
      userIds: [userId],
      category: 'blog_mention',
      title: 'Test Title',
      body: 'Test Body',
      dedupeKey: 'test-dedupe-1',
    });

    const notifications = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(notifications.body.notifications).toHaveLength(1);
    expect(notifications.body.notifications[0].title).toBe('Test Title');

    const outbox = isFirebase() ? await docs('notification_outbox') : (await sql('SELECT * FROM notification_outbox')).rows;
    expect(outbox.length).toBeGreaterThan(0);
  });

  it('dedupe_key prevents duplicate notifications for the same user', async () => {
    await notify({
      userIds: [userId],
      category: 'blog_mention',
      title: 'Dedupe Title',
      body: 'Dedupe Body',
      dedupeKey: 'dedupe-123',
    });
    await notify({
      userIds: [userId],
      category: 'blog_mention',
      title: 'Dedupe Title',
      body: 'Dedupe Body',
      dedupeKey: 'dedupe-123',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const match = res.body.notifications.filter((n: any) => n.title === 'Dedupe Title');
    expect(match).toHaveLength(1);
  });

  it('registers a device, encrypting the raw push token before it is ever stored', async () => {
    await request(app)
      .post('/api/notifications/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'ios', pushToken: 'ExponentPushToken[abc123]', deviceLabel: 'Test iPhone' })
      .expect(204);

    const stored = isFirebase()
      ? (await docs('notification_devices', [['userId', userId]])).map(d => ({ push_token_ciphertext: d.pushTokenCiphertext, push_token_hash: d.pushTokenHash }))
      : (await sql('SELECT push_token_ciphertext, push_token_hash FROM notification_devices WHERE user_id = $1', [userId])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].push_token_ciphertext).not.toContain('ExponentPushToken');
    expect(stored[0].push_token_hash).toBe(createHash('sha256').update('ExponentPushToken[abc123]').digest('hex'));

    // The public GET /devices response must never leak the ciphertext back out.
    const listed = await request(app).get('/api/notifications/devices').set('Authorization', `Bearer ${token}`).expect(200);
    expect(listed.body.devices).toHaveLength(1);
    for (const secret of ['push_token_ciphertext', 'pushTokenCiphertext', 'push_token_hash', 'pushTokenHash']) expect(listed.body.devices[0]).not.toHaveProperty(secret);
    expect(listed.body.devices[0].device_label).toBe('Test iPhone');
  });

  it('rejects device registration with a missing token or unsupported platform', async () => {
    await request(app)
      .post('/api/notifications/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'ios' })
      .expect(400);
    await request(app)
      .post('/api/notifications/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'smart-fridge', pushToken: 'x' })
      .expect(400);
  });

  it('markAsRead updates read_at', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const id = res.body.notifications[0].id;

    await request(app)
      .post('/api/notifications/read')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [id] })
      .expect(204);

    const updated = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(updated.body.notifications.find((n: any) => n.id === id).readAt).toBeTruthy();
  });
  it('honors email-only consent without showing a row in the inbox and dedupes its outbox intent', async () => {
    await request(app).patch('/api/notifications/preferences').set('Authorization', `Bearer ${token}`).send({ preferences: [{ category: 'trip_digest', inApp: false, push: false, email: true }] }).expect(204);
    const options = { userIds: [userId], category: 'trip_digest' as const, title: 'Email only', body: 'Summary', dedupeKey: 'email-only-dedupe' };
    await notify(options); await notify(options);
    const stored = isFirebase()
      ? (await docs('notifications', [['userId', userId], ['dedupeKey', options.dedupeKey]])).map(d => ({ id: d._id, in_app: d.inApp }))
      : (await sql('SELECT id,in_app FROM notifications WHERE user_id=$1 AND dedupe_key=$2', [userId, options.dedupeKey])).rows;
    expect(stored).toHaveLength(1); expect(stored[0].in_app).toBe(false);
    const queued = isFirebase()
      ? (await docs('notification_outbox', [['notificationId', stored[0].id]])).map(d => ({ channel: d.channel }))
      : (await sql('SELECT channel FROM notification_outbox WHERE notification_id=$1', [stored[0].id])).rows;
    expect(queued).toEqual([{ channel: 'email' }]);
    const inbox = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.notifications.some((row: any) => row.id === stored[0].id)).toBe(false);
  });

  it("will not let one person disable another person's device", async () => {
    const other = { firstName: 'Other', lastName: 'Person', email: `notify-other-${Date.now()}@example.com`, password: 'Password123!' };
    await registerWebUser(other); await confirmWebUser(other.email);
    const otherToken = (await loginWebUser(other)).body.token;
    await request(app).post('/api/notifications/devices').set('Authorization', `Bearer ${token}`).send({ platform: 'android', pushToken: 'ExponentPushToken[owner-device]', deviceLabel: 'Owner phone' }).expect(204);
    const before = (await request(app).get('/api/notifications/devices').set('Authorization', `Bearer ${token}`).expect(200)).body.devices;
    const target = before.find((d: any) => d.device_label === 'Owner phone');
    expect(target).toBeTruthy();
    await request(app).delete(`/api/notifications/devices/${target.id}`).set('Authorization', `Bearer ${otherToken}`).expect(204);
    const after = (await request(app).get('/api/notifications/devices').set('Authorization', `Bearer ${token}`).expect(200)).body.devices;
    expect(after.some((d: any) => d.id === target.id)).toBe(true);
    await request(app).delete(`/api/notifications/devices/${target.id}`).set('Authorization', `Bearer ${token}`).expect(204);
    await cleanupTestUsersByEmail([other.email]);
  });
});
