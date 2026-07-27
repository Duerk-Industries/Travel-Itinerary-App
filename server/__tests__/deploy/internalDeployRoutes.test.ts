/// <reference types="jest" />
/// <reference types="node" />

import express from 'express';
import request from 'supertest';

jest.mock('../../src/db', () => ({
  createTrip: jest.fn(),
  deleteTrip: jest.fn(),
  ensureDefaultGroupForUser: jest.fn(),
  findUserByEmail: jest.fn(),
  listGroupsForUser: jest.fn(),
  writeAuditLog: jest.fn(),
}));
jest.mock('../../src/env', () => ({ getEnvValue: jest.fn() }));
jest.mock('../../src/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

import internalDeployRoutes from '../../src/routes/internalDeployRoutes';
import {
  createTrip,
  deleteTrip,
  ensureDefaultGroupForUser,
  findUserByEmail,
  listGroupsForUser,
  writeAuditLog,
} from '../../src/db';
import { getEnvValue } from '../../src/env';

const mockedGetEnvValue = getEnvValue as jest.MockedFunction<typeof getEnvValue>;
const mockedFindUserByEmail = findUserByEmail as jest.MockedFunction<typeof findUserByEmail>;
const mockedListGroupsForUser = listGroupsForUser as jest.MockedFunction<typeof listGroupsForUser>;
const mockedCreateTrip = createTrip as jest.MockedFunction<typeof createTrip>;
const mockedDeleteTrip = deleteTrip as jest.MockedFunction<typeof deleteTrip>;
const mockedWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

const buildApp = () => {
  const app = express();
  app.use('/api/internal/deploy', internalDeployRoutes);
  return app;
};

const envValues: Record<string, string> = {
  DEPLOY_WORKER_SHARED_SECRET: 'test-shared-secret',
  CANARY_ACCOUNT_EMAIL: 'canary@internal.wander-bunnies.com',
};

describe('internal deploy routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetEnvValue.mockImplementation((key: string) => envValues[key]);
  });

  it('rejects requests with a missing or wrong shared secret', async () => {
    const app = buildApp();
    await request(app).post('/api/internal/deploy/canary-smoke-write').expect(403);
    await request(app)
      .post('/api/internal/deploy/canary-smoke-write')
      .set('X-Deploy-Worker-Secret', 'wrong-secret')
      .expect(403);
  });

  it('returns 503 when the shared secret is not configured server-side', async () => {
    mockedGetEnvValue.mockImplementation((key: string) => (key === 'DEPLOY_WORKER_SHARED_SECRET' ? undefined : envValues[key]));
    const app = buildApp();
    await request(app)
      .post('/api/internal/deploy/canary-smoke-write')
      .set('X-Deploy-Worker-Secret', 'anything')
      .expect(503);
  });

  it('canary-smoke-write creates a trip owned by the canary account and returns its ID', async () => {
    mockedFindUserByEmail.mockResolvedValue({ id: 'canary-1', email: 'canary@internal.wander-bunnies.com', provider: 'email', role: 'user', is_internal_canary: true } as any);
    mockedListGroupsForUser.mockResolvedValue([{ id: 'group-1' } as any]);
    mockedCreateTrip.mockResolvedValue({ id: 'trip-123' } as any);

    const app = buildApp();
    const res = await request(app)
      .post('/api/internal/deploy/canary-smoke-write')
      .set('X-Deploy-Worker-Secret', 'test-shared-secret')
      .send({ cutoverLabel: 'abc1234' })
      .expect(201);

    expect(res.body.tripId).toBe('trip-123');
    expect(ensureDefaultGroupForUser).toHaveBeenCalledWith('canary-1', 'canary@internal.wander-bunnies.com');
    expect(mockedCreateTrip).toHaveBeenCalledWith('canary-1', 'group-1', expect.stringContaining('abc1234'), expect.any(Object));
  });

  it('canary-smoke-write refuses when the resolved user is not actually flagged as canary (misconfiguration guard)', async () => {
    mockedFindUserByEmail.mockResolvedValue({ id: 'someone-else', email: 'canary@internal.wander-bunnies.com', provider: 'email', role: 'user', is_internal_canary: false } as any);

    const app = buildApp();
    await request(app)
      .post('/api/internal/deploy/canary-smoke-write')
      .set('X-Deploy-Worker-Secret', 'test-shared-secret')
      .expect(503);
    expect(mockedCreateTrip).not.toHaveBeenCalled();
  });

  it('canary-smoke-cleanup deletes every provided tripId under the canary account and reports counts', async () => {
    mockedFindUserByEmail.mockResolvedValue({ id: 'canary-1', email: 'canary@internal.wander-bunnies.com', provider: 'email', role: 'user', is_internal_canary: true } as any);
    mockedDeleteTrip.mockResolvedValueOnce(undefined as any).mockRejectedValueOnce(new Error('boom'));

    const app = buildApp();
    const res = await request(app)
      .post('/api/internal/deploy/canary-smoke-cleanup')
      .set('X-Deploy-Worker-Secret', 'test-shared-secret')
      .send({ tripIds: ['trip-1', 'trip-2'] })
      .expect(200);

    expect(res.body).toEqual({ deleted: 1, failed: 1 });
    expect(mockedDeleteTrip).toHaveBeenNthCalledWith(1, 'canary-1', 'trip-1');
    expect(mockedDeleteTrip).toHaveBeenNthCalledWith(2, 'canary-1', 'trip-2');
  });

  it('audit-log only accepts the allowlisted DEPLOY_* actions', async () => {
    mockedWriteAuditLog.mockResolvedValue({ id: 'audit-1' } as any);
    const app = buildApp();

    await request(app)
      .post('/api/internal/deploy/audit-log')
      .set('X-Deploy-Worker-Secret', 'test-shared-secret')
      .send({ action: 'NOT_A_REAL_ACTION' })
      .expect(400);

    const res = await request(app)
      .post('/api/internal/deploy/audit-log')
      .set('X-Deploy-Worker-Secret', 'test-shared-secret')
      .send({ action: 'DEPLOY_CUTOVER', reason: 'promotion', releaseManifest: 'dist/release/x.json' })
      .expect(201);

    expect(res.body.id).toBe('audit-1');
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPLOY_CUTOVER' }));
  });
});
