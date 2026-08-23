import request from 'supertest';
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
