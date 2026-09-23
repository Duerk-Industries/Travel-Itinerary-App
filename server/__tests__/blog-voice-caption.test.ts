import request from 'supertest';
import axios from 'axios';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser, seedTiersForTest, setUserTierInDb } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('trip blog voice captions', () => {
  const traveler = { firstName: 'Voice', lastName: 'Traveler', email: 'blog-voice-traveler@example.com', password: 'Password123!' };
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  let token = '';
  let userId = '';
  let tripId = '';
  let assetId = '';

  beforeAll(async () => {
    // The route validates its OpenAI credential before invoking the mocked HTTP
    // client. Supply a fixture value so this test does not depend on .env or CI
    // secrets; axios remains fully mocked below.
    process.env.OPENAI_API_KEY = 'test-openai-api-key';
    await initDb();
    await seedTiersForTest();
    for (const key of ['trip_blog', 'trip_blog_photo_uploads', 'trip_blog_audio_transcription']) await setFeatureFlag(key, true, null);
    clearFeatureFlagCacheForTesting();
    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    const login = await loginWebUser(traveler);
    token = login.body.token;
    userId = login.body.user?.id ?? login.body.userId;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Voice Caption Trip', startDate: '2027-08-01', endDate: '2027-08-01', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'voice-photo-1').send({ dayDate: '2027-08-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 }).expect(201);
    assetId = init.body.asset.id;
    await request(app).post(`/api/trips/${tripId}/blog/media/${assetId}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 }).expect(200);
  });

  afterEach(() => { jest.clearAllMocks(); });
  afterAll(async () => {
    try {
      await cleanupTestUsersByEmail([traveler.email]);
    } finally {
      if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  });

  it('keeps voice captions behind the Premium/Pro entitlement', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/${assetId}/transcribe-caption`)
      .set('Authorization', `Bearer ${token}`)
      .attach('audio', Buffer.from('fake audio bytes'), { filename: 'caption.m4a', contentType: 'audio/m4a' })
      .expect(402);
    expect(res.body).toEqual(expect.objectContaining({ code: 'VOICE_CAPTION_QUOTA_OR_TIER' }));
    expect(mockedAxios.post).not.toHaveBeenCalled();

    // pg-mem's uuid_generate_v4() isn't properly random in this test environment (repeated calls
    // can collide on the same value), so the rest of this suite upgrades the traveler to Premium
    // exactly once here rather than re-calling setUserTierInDb per test.
    await setUserTierInDb(userId, 'premium');
  });

  it('rejects an unsupported audio format', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/${assetId}/transcribe-caption`)
      .set('Authorization', `Bearer ${token}`)
      .attach('audio', Buffer.from('not audio'), { filename: 'caption.txt', contentType: 'text/plain' })
      .expect(400);
    expect(res.body).toEqual({ error: 'Unsupported audio format' });
  });

  it('rejects a request with no recording attached', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/${assetId}/transcribe-caption`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(res.body).toEqual({ error: 'An audio recording is required' });
  });

  it('rejects a recording over the size limit', async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/${assetId}/transcribe-caption`)
      .set('Authorization', `Bearer ${token}`)
      .attach('audio', oversized, { filename: 'caption.m4a', contentType: 'audio/m4a' })
      .expect(400);
    expect(res.body).toEqual({ error: 'Recording is too large' });
  });

  it('transcribes a recording and cleans it up into a caption for a Premium traveler', async () => {
    mockedAxios.post.mockImplementation((url: string) => {
      if (String(url).includes('/audio/transcriptions')) {
        return Promise.resolve({ data: { text: 'um so this is, uh, the lake we saw today' } });
      }
      if (String(url).includes('/chat/completions')) {
        return Promise.resolve({ data: { choices: [{ message: { content: 'The lake we saw today.' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } });
      }
      return Promise.reject(new Error(`Unexpected URL in test: ${url}`));
    });

    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/${assetId}/transcribe-caption`)
      .set('Authorization', `Bearer ${token}`)
      .attach('audio', Buffer.from('fake audio bytes'), { filename: 'caption.m4a', contentType: 'audio/m4a' })
      .expect(200);

    expect(res.body).toEqual({ caption: 'The lake we saw today.' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }) })
    );
  });

  it('404s when the feature flag is disabled', async () => {
    await setFeatureFlag('trip_blog_audio_transcription', false, null);
    clearFeatureFlagCacheForTesting();
    try {
      const res = await request(app)
        .post(`/api/trips/${tripId}/blog/media/${assetId}/transcribe-caption`)
        .set('Authorization', `Bearer ${token}`)
        .attach('audio', Buffer.from('fake audio bytes'), { filename: 'caption.m4a', contentType: 'audio/m4a' })
        .expect(404);
      expect(res.body).toEqual({ error: 'Voice captions are not enabled' });
    } finally {
      await setFeatureFlag('trip_blog_audio_transcription', true, null);
      clearFeatureFlagCacheForTesting();
    }
  });
});
