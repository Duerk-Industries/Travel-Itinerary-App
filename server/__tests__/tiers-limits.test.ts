/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, getCurrentUserTier, initDb } from '../src/db';
import { canUseFeature } from '../src/services/entitlementService';
import { cleanupTestUsersByEmail, makeAdminUser, registerAndLoginWebUser, seedTiersForTest, setUserTierInDb, type TestUser } from './helpers';

const TS = Date.now();

const createGroup = async (token: string, name: string) => {
  const response = await request(app)
    .post('/api/groups')
    .set('Authorization', `Bearer ${token}`)
    .send({ name })
    .expect(201);
  return response.body.id ?? response.body.group?.id;
};

describe('tier and trip enforcement', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([
      `tier-enforcement-test+default-${TS}@example.com`,
      `tier-enforcement-test+free-${TS}@example.com`,
      `tier-enforcement-test+past-user-${TS}@example.com`,
      `tier-enforcement-test+past-admin-${TS}@example.com`,
      `tier-enforcement-test+expense-free-${TS}@example.com`,
      `tier-enforcement-test+inherited-premium-${TS}@example.com`,
      `tier-enforcement-test+inherited-pro-${TS}@example.com`,
    ]);
    await closePool();
  });

  it('defaults new users to the free tier', async () => {
    const user = await registerAndLoginWebUser({
      firstName: 'Default',
      lastName: 'Tier',
      email: `tier-enforcement-test+default-${TS}@example.com`,
      password: 'TestPass1!',
    });
    const tierInfo = await getCurrentUserTier(user.userId);
    expect(tierInfo?.tierKey).toBe('free');
  });

  it('blocks a free user from creating a fourth active trip and allows premium to exceed it', async () => {
    const freeUser = await registerAndLoginWebUser({
      firstName: 'Free',
      lastName: 'Trips',
      email: `tier-enforcement-test+free-${TS}@example.com`,
      password: 'TestPass1!',
    });
    const groupId = await createGroup(freeUser.token, `Free Trips ${TS}`);

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/trips')
        .set('Authorization', `Bearer ${freeUser.token}`)
        .send({
          name: `Allowed Trip ${i + 1}`,
          groupId,
          endDate: '2099-12-31',
        })
        .expect(201);
    }

    const blocked = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${freeUser.token}`)
      .send({
        name: 'Blocked Trip',
        groupId,
        endDate: '2099-12-31',
      })
      .expect(402);

    expect(blocked.body.code).toBe('TIER_LIMIT_REACHED');

    await setUserTierInDb(freeUser.userId, 'premium');

    await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${freeUser.token}`)
      .send({
        name: 'Premium Trip',
        groupId,
        endDate: '2099-12-31',
      })
      .expect(201);
  });

  it('blocks non-admin past trips and allows admins to create them', async () => {
    const user: TestUser = {
      firstName: 'Past',
      lastName: 'Trip',
      email: `tier-enforcement-test+past-user-${TS}@example.com`,
      password: 'TestPass1!',
    };
    const regular = await registerAndLoginWebUser(user);
    const regularGroupId = await createGroup(regular.token, `Past Group ${TS}`);

    await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${regular.token}`)
      .send({
        name: 'Past Trip',
        groupId: regularGroupId,
        endDate: '2020-01-01',
      })
      .expect(403);

    const admin = await makeAdminUser({
      firstName: 'Admin',
      lastName: 'Past',
      email: `tier-enforcement-test+past-admin-${TS}@example.com`,
      password: 'TestPass1!',
    });
    const adminGroupId = await createGroup(admin.token, `Admin Past Group ${TS}`);

    await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Allowed Past Trip',
        groupId: adminGroupId,
        endDate: '2020-01-01',
      })
      .expect(201);
  });

  it('enforces premium-only cost tracking server-side', async () => {
    const freeUser = await registerAndLoginWebUser({
      firstName: 'Free',
      lastName: 'Expense',
      email: `tier-enforcement-test+expense-free-${TS}@example.com`,
      password: 'TestPass1!',
    });
    const groupId = await createGroup(freeUser.token, `Expense Group ${TS}`);
    const tripResponse = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${freeUser.token}`)
      .send({ name: 'Expense Trip', groupId, endDate: '2099-12-31' })
      .expect(201);
    const tripId = tripResponse.body.id ?? tripResponse.body.trip?.id;

    await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${freeUser.token}`)
      .expect(402);

    await setUserTierInDb(freeUser.userId, 'premium');

    await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${freeUser.token}`)
      .expect(200);
  });

  it('inherits lower-tier feature entitlements for higher tiers', async () => {
    const premiumUser = await registerAndLoginWebUser({
      firstName: 'Premium',
      lastName: 'Inherited',
      email: `tier-enforcement-test+inherited-premium-${TS}@example.com`,
      password: 'TestPass1!',
    });
    await setUserTierInDb(premiumUser.userId, 'premium');

    const proUser = await registerAndLoginWebUser({
      firstName: 'Pro',
      lastName: 'Inherited',
      email: `tier-enforcement-test+inherited-pro-${TS}@example.com`,
      password: 'TestPass1!',
    });
    await setUserTierInDb(proUser.userId, 'pro');

    await expect(canUseFeature(premiumUser.userId, 'csv_export', 'user')).resolves.toBe(true);
    await expect(canUseFeature(proUser.userId, 'csv_export', 'user')).resolves.toBe(true);
    await expect(canUseFeature(premiumUser.userId, 'trip_sharing', 'user')).resolves.toBe(true);
  });
});
