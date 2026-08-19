/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, setFeatureFlag } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb, cleanupTestUsersByEmail } from './helpers';
import * as itineraryDocumentImportService from '../src/services/itineraryDocumentImportService';
import { __testing as asyncDocumentImportTesting } from '../src/services/documentImportAsyncService';

const TS = Date.now();
const EMAIL = `document-import-async-test+${TS}@example.com`;

describe('document import async job (POST + GET /api/trips/:tripId/import-document)', () => {
  let token: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    await setFeatureFlag('itinerary_document_import', true, null);

    const user = await registerAndLoginWebUser({
      firstName: 'Doc',
      lastName: 'Import',
      email: EMAIL,
      password: 'TestPass1!',
    });
    token = user.token;
    await setUserTierInDb(user.userId, 'premium');

    const groupResponse = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Doc Import Group ${TS}` })
      .expect(201);
    const groupId = groupResponse.body.id ?? groupResponse.body.group?.id;

    const tripResponse = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Doc Import Trip ${TS}`, groupId, endDate: '2099-12-31' })
      .expect(201);
    tripId = tripResponse.body.id ?? tripResponse.body.trip?.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await setFeatureFlag('itinerary_document_import', false, null);
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 202 with a jobId immediately instead of blocking on extraction', async () => {
    jest.spyOn(itineraryDocumentImportService, 'extractItineraryDocumentCandidates').mockResolvedValue({
      candidates: [],
      unassignedNotes: '',
      dayNotes: [],
      usage: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
    });

    const res = await request(app)
      .post(`/api/trips/${tripId}/import-document`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentText: 'Flight AA100 JFK to LAX on 2026-09-01', sourceFilename: 'pasted.txt', dryRun: true })
      .expect(202);

    expect(res.body.jobId).toBeTruthy();
    expect(res.body.status).toBe('queued');
  });

  it('completes the job in the background and is pollable via GET', async () => {
    jest.spyOn(itineraryDocumentImportService, 'extractItineraryDocumentCandidates').mockResolvedValue({
      candidates: [
        {
          type: 'tour_activity',
          name: 'Louvre Museum tour',
          date: '2026-09-02',
          activityDate: '2026-09-02',
          sourceExcerpt: 'Louvre Museum tour on Sept 2',
        } as any,
      ],
      unassignedNotes: '',
      dayNotes: [],
      usage: { promptTokens: 10, completionTokens: 5, estimatedCostUsd: 0.001 },
    });

    const res = await request(app)
      .post(`/api/trips/${tripId}/import-document`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentText: 'Louvre Museum tour on Sept 2', sourceFilename: 'pasted.txt', dryRun: true })
      .expect(202);

    const job = await asyncDocumentImportTesting.waitForJob(res.body.jobId);
    expect(job?.status).toBe('completed');

    const statusRes = await request(app)
      .get(`/api/trips/${tripId}/import-document/${res.body.jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.result.added).toHaveLength(1);
    expect(statusRes.body.result.added[0].type).toBe('tour_activity');
  });

  it('surfaces extraction failures as a failed job rather than a hung request', async () => {
    jest.spyOn(itineraryDocumentImportService, 'extractItineraryDocumentCandidates').mockRejectedValue(
      new Error('upstream extraction provider error')
    );

    const res = await request(app)
      .post(`/api/trips/${tripId}/import-document`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentText: 'Some itinerary text', sourceFilename: 'pasted.txt', dryRun: true })
      .expect(202);

    await asyncDocumentImportTesting.waitForJob(res.body.jobId);

    const statusRes = await request(app)
      .get(`/api/trips/${tripId}/import-document/${res.body.jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(statusRes.body.status).toBe('failed');
    expect(statusRes.body.error).toContain('upstream extraction provider error');
  });

  it('rejects fast with 402 before enqueuing when the tier lacks the feature', async () => {
    const freeUser = await registerAndLoginWebUser({
      firstName: 'Free',
      lastName: 'Tier',
      email: `document-import-async-free+${TS}@example.com`,
      password: 'TestPass1!',
    });
    const groupResponse = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${freeUser.token}`)
      .send({ name: `Doc Import Free Group ${TS}` })
      .expect(201);
    const groupId = groupResponse.body.id ?? groupResponse.body.group?.id;
    const tripResponse = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${freeUser.token}`)
      .send({ name: `Doc Import Free Trip ${TS}`, groupId, endDate: '2099-12-31' })
      .expect(201);
    const freeTripId = tripResponse.body.id ?? tripResponse.body.trip?.id;

    const res = await request(app)
      .post(`/api/trips/${freeTripId}/import-document`)
      .set('Authorization', `Bearer ${freeUser.token}`)
      .send({ documentText: 'Some itinerary text', sourceFilename: 'pasted.txt', dryRun: true })
      .expect(402);

    expect(res.body.code).toBeTruthy();
    expect(res.body.jobId).toBeUndefined();

    await cleanupTestUsersByEmail([`document-import-async-free+${TS}@example.com`]);
  });

  it('returns 404 for a job that does not belong to the requesting user', async () => {
    jest.spyOn(itineraryDocumentImportService, 'extractItineraryDocumentCandidates').mockResolvedValue({
      candidates: [],
      unassignedNotes: '',
      dayNotes: [],
      usage: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
    });
    const submitRes = await request(app)
      .post(`/api/trips/${tripId}/import-document`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentText: 'Some itinerary text', sourceFilename: 'pasted.txt', dryRun: true })
      .expect(202);
    await asyncDocumentImportTesting.waitForJob(submitRes.body.jobId);

    const otherUser = await registerAndLoginWebUser({
      firstName: 'Other',
      lastName: 'User',
      email: `document-import-async-other+${TS}@example.com`,
      password: 'TestPass1!',
    });

    await request(app)
      .get(`/api/trips/${tripId}/import-document/${submitRes.body.jobId}`)
      .set('Authorization', `Bearer ${otherUser.token}`)
      .expect(404);

    await cleanupTestUsersByEmail([`document-import-async-other+${TS}@example.com`]);
  });
});
