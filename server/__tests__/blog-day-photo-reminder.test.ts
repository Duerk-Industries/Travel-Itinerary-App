import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { runBlogBackgroundJobs } from '../src/services/blogBackgroundWorker';

// End-of-day "add a photo" reminder — see blogBackgroundWorker.ts's runDayPhotoReminderJob.
// Two independent opt-ins gate this category (neither defaults on): the trip's blog
// (trip_blogs.day_photo_reminders_enabled, toggled via PATCH /:tripId/blog) and the traveler's own
// notification preference (PATCH /api/notifications/preferences) — both are required.
describe('trip blog end-of-day photo reminder', () => {
  const owner = { firstName: 'Evening', lastName: 'Traveler', email: 'blog-photo-reminder@example.com', password: 'Password123!' };
  let token = '';
  let todayStr = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await setFeatureFlag('trip_blog_nudges', true, null);
    await setFeatureFlag('notifications_in_app', true, null);

    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    const login = await loginWebUser(owner);
    token = login.body.token;
    todayStr = new Date().toISOString().slice(0, 10);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([owner.email]); });

  // Pins `new Date()` inside the job's end-of-day UTC window (see isEndOfDayWindow). Only Date is
  // faked — everything else (setTimeout, pg-mem's internal async work, supertest) keeps running on
  // real timers, since faking those too would stall the rest of the request/DB round trip.
  const withEveningClock = async (fn: () => Promise<void>) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
    jest.setSystemTime(new Date(`${todayStr}T21:00:00.000Z`));
    try {
      await fn();
    } finally {
      jest.useRealTimers();
    }
  };

  const createTrip = async (name: string) => {
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, startDate: todayStr, endDate: todayStr, participants: [] })
      .expect(201);
    return (trip.body.trip?.id ?? trip.body.id) as string;
  };

  const remindersFor = async (): Promise<any[]> => {
    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    return res.body.notifications.filter((n: any) => n.category === 'blog_day_photo_reminder');
  };

  it('nudges a traveler once both the trip and the traveler have opted in, then stops once they have a photo', async () => {
    const tripId = await createTrip('Evening Trip Both Opted In');
    await request(app)
      .patch(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dayPhotoRemindersEnabled: true })
      .expect(200);
    await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: [{ category: 'blog_day_photo_reminder', inApp: true, push: false, email: false }] })
      .expect(204);

    const before = await remindersFor();

    await withEveningClock(async () => {
      await runBlogBackgroundJobs();
    });

    const afterFirstRun = await remindersFor();
    expect(afterFirstRun.length).toBe(before.length + 1);
    const reminder = afterFirstRun.find((n) => (n.trip_id ?? n.tripId) === tripId);
    expect(reminder).toBeDefined();

    const init = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'evening-photo-1')
      .send({ dayDate: todayStr, mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 })
      .expect(201);
    await request(app)
      .post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ physicalBytes: 1024 })
      .expect(200);

    await withEveningClock(async () => {
      await runBlogBackgroundJobs();
    });

    const afterPhoto = await remindersFor();
    expect(afterPhoto.length).toBe(afterFirstRun.length); // no new one — deduped, the traveler already has a photo
  });

  it('does not nudge when the trip has not opted in, even if the traveler has', async () => {
    const tripId = await createTrip('Evening Trip Not Opted In');
    // Deliberately not calling PATCH /:tripId/blog — day_photo_reminders_enabled stays at its
    // migration default (false).
    await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: [{ category: 'blog_day_photo_reminder', inApp: true, push: false, email: false }] })
      .expect(204);

    const before = await remindersFor();
    await withEveningClock(async () => {
      await runBlogBackgroundJobs();
    });
    const after = await remindersFor();
    expect(after.filter((n) => (n.trip_id ?? n.tripId) === tripId)).toHaveLength(0);
    expect(after.length).toBe(before.length);
  });

  it('does not nudge when the traveler has not opted in, even if the trip has', async () => {
    const noOptInOwner = { firstName: 'NoOptIn', lastName: 'Traveler', email: 'blog-photo-reminder-no-optin@example.com', password: 'Password123!' };
    await registerWebUser(noOptInOwner);
    await confirmWebUser(noOptInOwner.email);
    const noOptInToken = (await loginWebUser(noOptInOwner)).body.token;
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${noOptInToken}`)
      .send({ name: 'Evening Trip Traveler Not Opted In', startDate: todayStr, endDate: todayStr, participants: [] })
      .expect(201);
    const tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app)
      .patch(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${noOptInToken}`)
      .send({ dayPhotoRemindersEnabled: true })
      .expect(200);
    // Deliberately no PATCH /api/notifications/preferences — the traveler never opted in, so
    // DEFAULT_PREFERENCES applies (blog_day_photo_reminder is off on every channel by default).

    await withEveningClock(async () => {
      await runBlogBackgroundJobs();
    });

    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${noOptInToken}`).expect(200);
    const reminders = res.body.notifications.filter((n: any) => n.category === 'blog_day_photo_reminder');
    expect(reminders).toHaveLength(0);

    await cleanupTestUsersByEmail([noOptInOwner.email]);
  });
});
