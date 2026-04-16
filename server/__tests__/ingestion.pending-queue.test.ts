import path from 'path';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('ingestion pending queue progression', () => {
  const repoInputPath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'test_inputs', ...parts);

  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  it('advances a manual PDF upload beyond PENDING', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = {
      firstName: 'Bryan',
      lastName: 'Admin',
      email: 'bryan.duerk@gmail.com',
      password: 'secret123',
    };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'pro');
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post('/api/ingestion/upload')
      .set(auth)
      .attach('files', repoInputPath('transfers', 'Boston to Los Angeles.pdf'))
      .expect(202);

    await helpers.waitFor(async () => {
      const jobsRes = await request(app).get('/api/ingestion/jobs').set(auth).expect(200);
      const jobs = jobsRes.body.jobs ?? [];
      return jobs.length === 1 && !['PENDING', 'RECEIVED', 'NORMALIZING', 'NORMALIZED', 'EXTRACTING'].includes(jobs[0].state);
    }, 10000, 100);

    const jobsRes = await request(app).get('/api/ingestion/jobs').set(auth).expect(200);
    expect(jobsRes.body.jobs).toHaveLength(1);
    expect(['AWAITING_REVIEW', 'COMPLETED', 'FAILED', 'DEAD_LETTERED', 'DUPLICATE_IGNORED']).toContain(
      jobsRes.body.jobs[0].state
    );
  });
});
