/// <reference types="jest" />
/// <reference types="node" />

/**
 * Covers the two entitlement-layer decisions made for the AI assistant's
 * action mode (see docs/implementation_plans/implementation-plan-ai-assistant.md,
 * "Narrow-tool-set retest result"):
 *  1. ai_assistant_actions fails CLOSED when its DB row is unseeded --
 *     deliberately the opposite of ai_assistant_guide, which fails open --
 *     since this flag gates real mutations, not read-only Q&A.
 *  2. GET /api/account reports entitlements.aiAssistantActions, mirroring
 *     the existing aiAssistantGuide entry, so the client can gate the
 *     action-mode UI the same way it already gates guide mode.
 */
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, setFeatureFlag } from '../src/db';
import { isFeatureEnabled, clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

describe('ai_assistant_actions entitlement', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail(['ai-assistant-actions-test@example.com']);
    await closePool();
  });

  it('fails closed with no seeded DB row, unlike ai_assistant_guide which fails open', async () => {
    clearFeatureFlagCacheForTesting();
    expect(await isFeatureEnabled('ai_assistant_actions')).toBe(false);
    expect(await isFeatureEnabled('ai_assistant_guide')).toBe(true);
  });

  it('reports entitlements.aiAssistantActions on GET /api/account, reflecting the live flag value', async () => {
    const { token } = await registerAndLoginWebUser({
      firstName: 'Action',
      lastName: 'Tester',
      email: 'ai-assistant-actions-test@example.com',
      password: 'testtest',
    });

    clearFeatureFlagCacheForTesting();
    const beforeRes = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`).expect(200);
    expect(beforeRes.body.entitlements).toHaveProperty('aiAssistantActions', false);

    await setFeatureFlag('ai_assistant_actions', true, null);
    clearFeatureFlagCacheForTesting();
    const afterRes = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`).expect(200);
    expect(afterRes.body.entitlements).toHaveProperty('aiAssistantActions', true);
  });
});
