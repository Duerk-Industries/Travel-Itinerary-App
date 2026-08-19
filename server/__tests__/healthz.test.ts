/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';

jest.mock('../src/db.firebase');

describe('GET /api/healthz', () => {
  const originalSha = process.env.GIT_SHA;
  const originalRevision = process.env.K_REVISION;

  afterEach(() => {
    if (originalSha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = originalSha;
    if (originalRevision === undefined) delete process.env.K_REVISION;
    else process.env.K_REVISION = originalRevision;
  });

  it('returns deployment identity alongside the stable ok field', async () => {
    process.env.GIT_SHA = 'test-sha';
    process.env.K_REVISION = 'test-revision';
    const res = await request(app).get('/api/healthz').expect(200);
    expect(res.body).toEqual({ ok: true, sha: 'test-sha', revision: 'test-revision' });
  });
});
