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
    const db = await import('../src/db');
    await db.initDb();
    const helpers = await import('./helpers');
    await helpers.seedTiersForTest();
  });

  it('advances a manual PDF upload beyond PENDING', async () => {
    const request = (await import('supertest')).default;
    const { app } = await import('../src/app');
    const helpers = await import('./helpers');
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
      return jobs.length === 1 && jobs[0].state !== 'PENDING';
    }, 10000, 100);

    const jobsRes = await request(app).get('/api/ingestion/jobs').set(auth).expect(200);
    expect(jobsRes.body.jobs).toHaveLength(1);
    expect(jobsRes.body.jobs[0].state).not.toBe('PENDING');
    expect(['RECEIVED', 'NORMALIZING', 'NORMALIZED', 'EXTRACTING', 'AWAITING_REVIEW', 'COMPLETED', 'FAILED', 'DEAD_LETTERED', 'DUPLICATE_IGNORED']).toContain(
      jobsRes.body.jobs[0].state
    );
  });
});
