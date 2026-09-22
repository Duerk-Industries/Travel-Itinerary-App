import request from 'supertest';
import { createHash } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { notify } from '../src/services/notificationService';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('notification service', () => {
  const user = { firstName: 'Notify', lastName: 'User', email: 'notify-test@example.com', password: 'Password123!' };
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

    const outbox = await queryBlog('SELECT * FROM notification_outbox');
    expect(outbox.rows.length).toBeGreaterThan(0);
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

    const match = res.body.notifications.filter((n: any) => n.dedupe_key === 'dedupe-123');
    expect(match).toHaveLength(1);
  });

  it('registers a device, encrypting the raw push token before it is ever stored', async () => {
    await request(app)
      .post('/api/notifications/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'ios', pushToken: 'ExponentPushToken[abc123]', deviceLabel: 'Test iPhone' })
      .expect(204);

    const stored = await queryBlog('SELECT push_token_ciphertext, push_token_hash FROM notification_devices WHERE user_id = $1', [userId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].push_token_ciphertext).not.toContain('ExponentPushToken');
    expect(stored.rows[0].push_token_hash).toBe(createHash('sha256').update('ExponentPushToken[abc123]').digest('hex'));

    // The public GET /devices response must never leak the ciphertext back out.
    const listed = await request(app).get('/api/notifications/devices').set('Authorization', `Bearer ${token}`).expect(200);
    expect(listed.body.devices).toHaveLength(1);
    expect(listed.body.devices[0]).not.toHaveProperty('push_token_ciphertext');
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
    expect(updated.body.notifications.find((n: any) => n.id === id).read_at).toBeTruthy();
  });
});
