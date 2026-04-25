import express from 'express';
import request from 'supertest';

const setWorkerEnv = () => {
  process.env.INGESTION_WORKER_SHARED_SECRET = 'test-worker-secret';
};

describe('POST /api/internal/ingestion/jobs/:jobId/run', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    setWorkerEnv();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.dontMock('../src/ingestion/orchestrator');
  });

  const createApp = async (processImportJob: jest.Mock) => {
    jest.doMock('../src/ingestion/orchestrator', () => ({
      processImportJob,
      requeueDeadLetterImportJob: jest.fn(),
    }));
    const routeModule = await import('../src/routes/internalIngestionWorkerRoutes');
    const router = (routeModule as any).default?.default ?? (routeModule as any).default ?? routeModule;
    const app = express();
    app.use('/api/internal/ingestion', router);
    return app;
  };

  it('acknowledges the worker request before the import job finishes', async () => {
    const processImportJob = jest.fn().mockResolvedValue({
      id: 'job-1',
      state: 'COMPLETED',
    });
    const app = await createApp(processImportJob);

    const res = await request(app)
      .post('/api/internal/ingestion/jobs/job-1/run')
      .set('X-Ingestion-Worker-Secret', 'test-worker-secret')
      .send({ jobId: 'job-1' })
      .expect(202);

    expect(res.body).toEqual({ accepted: true, jobId: 'job-1', mode: 'async-detached' });
    expect(processImportJob).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(processImportJob).toHaveBeenCalledWith('job-1');
  });

  it('still returns 202 when the background import job fails', async () => {
    const processImportJob = jest.fn().mockRejectedValue(new Error('parse failed'));
    const app = await createApp(processImportJob);

    await request(app)
      .post('/api/internal/ingestion/jobs/job-fail/run')
      .set('X-Ingestion-Worker-Secret', 'test-worker-secret')
      .send({ jobId: 'job-fail' })
      .expect(202);

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(processImportJob).toHaveBeenCalledWith('job-fail');
  });

  it('rejects requests without the worker secret', async () => {
    const app = await createApp(jest.fn());

    await request(app)
      .post('/api/internal/ingestion/jobs/job-1/run')
      .expect(403);
  });
});
