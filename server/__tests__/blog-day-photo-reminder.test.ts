import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { runBlogBackgroundJobs } from '../src/services/blogBackgroundWorker';

// End-of-day "add a photo" reminder — see blogBackgroundWorker.ts's runDayPhotoReminderJob.
describe('trip blog end-of-day photo reminder', () => {
  const owner = { firstName: 'Evening', lastName: 'Traveler', email: 'blog-photo-reminder@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';
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
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Evening Trip', startDate: todayStr, endDate: todayStr, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
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

  it('nudges a traveler who has not added a photo today, then stops once they have', async () => {
    await withEveningClock(async () => {
      await runBlogBackgroundJobs();
    });

    const firstCheck = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    const reminders = firstCheck.body.notifications.filter((n: any) => n.category === 'blog_day_photo_reminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].trip_id ?? reminders[0].tripId).toBe(tripId);

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

    const secondCheck = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    const remindersAfterPhoto = secondCheck.body.notifications.filter((n: any) => n.category === 'blog_day_photo_reminder');
    expect(remindersAfterPhoto).toHaveLength(1); // no new one — the first still stands, deduped
  });
});
