/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { cleanupTestUsersByEmail, registerAndLoginDeviceUser, seedTiersForTest } from './helpers';

describe('Group authorization', () => {
  const suffix = Date.now();
  const owner = { email: `group-owner-${suffix}@example.com`, firstName: 'Owner', lastName: 'User', password: 'password123' };
  const outsider = { email: `group-outsider-${suffix}@example.com`, firstName: 'Out', lastName: 'Sider', password: 'password123' };
  const invited = { email: `group-invited-${suffix}@example.com`, firstName: 'Invited', lastName: 'Member', password: 'password123' };

  let ownerToken = '';
  let outsiderToken = '';
  let groupId = '';

  beforeAll(async () => {
    await initDb();
    await seedTiersForTest();
    ownerToken = (await registerAndLoginDeviceUser(owner)).token;
    outsiderToken = (await registerAndLoginDeviceUser(outsider)).token;
    await registerAndLoginDeviceUser(invited);

    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Authorized Group', members: [] })
      .expect(201);

    groupId = groupRes.body.id;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, outsider.email, invited.email]);
    await closePool();
  });

  it('rejects a non-member from adding a group member', async () => {
    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ email: invited.email })
      .expect(403);
  });

  it('allows an authorized member to add a group member', async () => {
    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: invited.email })
      .expect(201);
  });
});
