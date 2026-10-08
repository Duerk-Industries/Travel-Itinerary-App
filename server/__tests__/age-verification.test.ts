/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, setFeatureFlag, hasUserDateOfBirth, isUserAgeVerified } from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { clearAgeVerificationCacheForTesting } from '../src/services/ageVerificationService';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const isoDateYearsAgo = (years: number, extraDays = 0): string => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - extraDays));
  return d.toISOString().slice(0, 10);
};

describe('account age verification', () => {
  const EMAIL = 'age-verification-test@example.com';
  const PASSWORD = 'ageverifytest';
  let token: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  beforeEach(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
    clearAgeVerificationCacheForTesting();
    clearFeatureFlagCacheForTesting();
    await setFeatureFlag('age_gate_enforcement', false, null);
    // Registration without a date of birth is still accepted ("pending") so
    // older clients keep working; the post-login check covers these accounts.
    ({ token, userId } = await registerAndLoginWebUser({ firstName: 'Age', lastName: 'Check', email: EMAIL, password: PASSWORD }));
  });

  afterAll(async () => {
    await setFeatureFlag('age_gate_enforcement', false, null);
    clearFeatureFlagCacheForTesting();
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('reports verification required for an account without a date of birth', async () => {
    const res = await request(app).get('/api/account/age-verification').set(auth()).expect(200);
    expect(res.body).toEqual({ required: true, enforced: false, minimumAge: 16 });
  });

  it('rejects malformed and future dates without storing them', async () => {
    for (const dateOfBirth of ['not-a-date', '2001-02-30', '2999-01-01', undefined]) {
      const res = await request(app).post('/api/account/age-verification').set(auth()).send({ dateOfBirth }).expect(400);
      expect(res.body.code).toBe('INVALID_DATE_OF_BIRTH');
    }
    expect(await hasUserDateOfBirth(userId)).toBe(false);
  });

  it('refuses an under-16 declaration and does not store it', async () => {
    const res = await request(app)
      .post('/api/account/age-verification')
      .set(auth())
      .send({ dateOfBirth: isoDateYearsAgo(16, -1) }) // turns 16 tomorrow
      .expect(403);
    expect(res.body.code).toBe('UNDER_MINIMUM_AGE');
    expect(await hasUserDateOfBirth(userId)).toBe(false);
    const status = await request(app).get('/api/account/age-verification').set(auth()).expect(200);
    expect(status.body.required).toBe(true);
  });

  it('accepts a declaration on the 16th birthday', async () => {
    await request(app).post('/api/account/age-verification').set(auth()).send({ dateOfBirth: isoDateYearsAgo(16) }).expect(200);
    expect(await hasUserDateOfBirth(userId)).toBe(true);
    const status = await request(app).get('/api/account/age-verification').set(auth()).expect(200);
    expect(status.body.required).toBe(false);
  });

  it('does not block other endpoints while enforcement is off', async () => {
    await request(app).get('/api/account').set(auth()).expect(200);
  });

  describe('Apple Declared Age Range shortcut', () => {
    it.each([16, 18, 21])('accepts a confirmed lower bound of %i without storing a birthdate', async (lowerBound) => {
      await request(app).post('/api/account/age-verification/apple').set(auth()).send({ lowerBound }).expect(200);
      const status = await request(app).get('/api/account/age-verification').set(auth()).expect(200);
      expect(status.body.required).toBe(false);
      expect(await hasUserDateOfBirth(userId)).toBe(false);
      expect(await isUserAgeVerified(userId)).toBe(true);
    });

    it.each([
      ['under the minimum', 13],
      ['missing (Apple: below the lowest gate)', null],
      ['not an integer', 16.5],
      ['a string', '18'],
    ])('rejects a lower bound that is %s so the client falls back to the prompt', async (_label, lowerBound) => {
      const res = await request(app).post('/api/account/age-verification/apple').set(auth()).send({ lowerBound }).expect(400);
      expect(res.body.code).toBe('AGE_RANGE_NOT_CONFIRMED');
      const status = await request(app).get('/api/account/age-verification').set(auth()).expect(200);
      expect(status.body.required).toBe(true);
    });

    it('is reachable while enforcement blocks other endpoints, and lifts the block', async () => {
      await setFeatureFlag('age_gate_enforcement', true, null);
      clearFeatureFlagCacheForTesting();
      await request(app).get('/api/account').set(auth()).expect(403);
      await request(app).post('/api/account/age-verification/apple').set(auth()).send({ lowerBound: 16 }).expect(200);
      await request(app).get('/api/account').set(auth()).expect(200);
    });
  });

  describe('with age_gate_enforcement enabled', () => {
    beforeEach(async () => {
      await setFeatureFlag('age_gate_enforcement', true, null);
      clearFeatureFlagCacheForTesting();
    });

    it('blocks unverified accounts with AGE_VERIFICATION_REQUIRED', async () => {
      const res = await request(app).get('/api/account').set(auth()).expect(403);
      expect(res.body.code).toBe('AGE_VERIFICATION_REQUIRED');
    });

    it('still allows status, declaration, export, and deletion', async () => {
      await request(app).get('/api/account/age-verification').set(auth()).expect(200);
      await request(app).get('/api/account/export').set(auth()).expect(200);
      await request(app).post('/api/account/age-verification').set(auth()).send({ dateOfBirth: isoDateYearsAgo(30) }).expect(200);
      await request(app).get('/api/account').set(auth()).expect(200);
    });

    it('lets an unverified account delete itself', async () => {
      await request(app).delete('/api/account').set(auth()).expect(204);
    });

    it('keeps blocking after an under-age declaration', async () => {
      await request(app).post('/api/account/age-verification').set(auth()).send({ dateOfBirth: isoDateYearsAgo(10) }).expect(403);
      const res = await request(app).get('/api/account').set(auth()).expect(403);
      expect(res.body.code).toBe('AGE_VERIFICATION_REQUIRED');
    });
  });
});
