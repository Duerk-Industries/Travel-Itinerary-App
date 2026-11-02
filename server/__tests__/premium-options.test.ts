import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { clearPremiumOptionCacheForTesting } from '../src/services/premiumOptionsService';
import { makeAdminUser, registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

type User = { token: string; userId: string };

// One `premium` flag turns off the popup, trials, upgrade and every Premium-only parsing option. Which parsing options are
// Premium-only is set per option in Admin > Billing; all start Premium-only.
describe('Premium master flag and parsing options', () => {
  let free: User, premium: User, admin: User;
  const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });
  const account = async (label: string): Promise<User> =>
    registerAndLoginWebUser({ firstName: label, lastName: 'Premium', email: `po-${randomUUID()}@example.com`, password: 'secret123' });
  const reload = () => { clearFeatureFlagCacheForTesting(); clearPremiumOptionCacheForTesting(); };
  const profile = async (user: User) => (await request(app).get('/api/account').set(auth(user)).expect(200)).body;
  const importFeatures = async (user: User) => (await request(app).get('/api/ingestion/config').set(auth(user)).expect(200)).body.features;
  const setOptions = async (body: Record<string, boolean>) =>
    request(app).patch('/api/admin/billing/premium-options').set(auth(admin)).send(body);

  beforeAll(async () => { await db.initDb(); await seedTiersForTest(); });
  beforeEach(async () => {
    await db.setFeatureFlag('premium', true, null);
    for (const flag of ['feature_ingest_manual_upload', 'feature_ingest_forwarded_mailbox', 'feature_ingest_gmail_import', 'flight_parser', 'itinerary_document_import']) {
      await db.setFeatureFlag(flag, true, null);
    }
    reload();
    free = await account('Free');
    premium = await account('Paid');
    await setUserTierInDb(premium.userId, 'premium');
    admin = await makeAdminUser({ firstName: 'Admin', lastName: 'Premium', email: `po-admin-${randomUUID()}@example.com`, password: 'secret123' });
    await setOptions({ pasteParsing: true, documentImport: true, fileUpload: true, emailForwarding: true, gmailImport: true, autoAssign: true });
    reload();
  });
  afterAll(async () => { await db.setFeatureFlag('premium', true, null); reload(); });

  it('keeps every parsing option behind Premium by default', async () => {
    expect((await profile(free)).parsingAccess).toEqual({ pasteParsing: false, documentImport: false, fileUpload: false, emailForwarding: false, gmailImport: false, autoAssign: false });
    expect((await profile(premium)).parsingAccess).toEqual({ pasteParsing: true, documentImport: true, fileUpload: true, emailForwarding: true, gmailImport: true, autoAssign: true });
    expect((await profile(free)).premiumEnabled).toBe(true);
    expect(await importFeatures(free)).toMatchObject({ manualUpload: false, forwardedMailbox: false, gmailImport: false });
    await request(app).get('/api/ingestion/review-items').set(auth(free)).expect(403);
    await request(app).post('/api/transfers/parse').set(auth(free)).send({ text: 'Flight AA100 on 2027-05-02' }).expect(402);
  });

  it('lets an admin open one option to everyone without opening the others', async () => {
    const changed = await setOptions({ fileUpload: false });
    expect(changed.status).toBe(200);
    expect(changed.body.premiumOnly).toMatchObject({ fileUpload: false, emailForwarding: true });
    reload();

    expect((await profile(free)).parsingAccess).toMatchObject({ fileUpload: true, emailForwarding: false, pasteParsing: false });
    expect(await importFeatures(free)).toMatchObject({ manualUpload: true, forwardedMailbox: false, gmailImport: false });
    // The review queue is shared by every source, so one open source lets a free account in.
    await request(app).get('/api/ingestion/review-items').set(auth(free)).expect(200);
    await request(app).get('/api/ingestion/forwarding').set(auth(free)).expect(403);
  });

  it('only lets admins change the options', async () => {
    await request(app).get('/api/admin/billing/premium-options').set(auth(free)).expect(403);
    await request(app).patch('/api/admin/billing/premium-options').set(auth(free)).send({ fileUpload: false }).expect(403);
    await request(app).patch('/api/admin/billing/premium-options').set(auth(admin)).send({}).expect(400);
    await request(app).patch('/api/admin/billing/premium-options').set(auth(admin)).send({ nonsense: true }).expect(400);
  });

  it('hides every premium feature from everyone, admins included, while the premium flag is off', async () => {
    await setOptions({ fileUpload: false });
    await db.setFeatureFlag('premium', false, null);
    reload();

    for (const user of [free, premium, admin]) {
      const body = await profile(user);
      expect(body.premiumEnabled).toBe(false);
      expect(Object.values(body.parsingAccess)).toEqual([false, false, false, false, false, false]);
    }
    expect(await importFeatures(premium)).toMatchObject({ manualUpload: false, forwardedMailbox: false, gmailImport: false, autoAssign: false });
    await request(app).get('/api/ingestion/review-items').set(auth(premium)).expect(403);
    await request(app).get('/api/ingestion/review-items').set(auth(admin)).expect(403);
    await request(app).post('/api/transfers/parse').set(auth(premium)).send({ text: 'Flight AA100 on 2027-05-02' }).expect(402);
    expect((await request(app).get('/api/auth/features')).body.featurePremium).toBe(false);
    expect((await request(app).get('/api/admin/billing/premium-options').set(auth(admin))).body.premiumEnabled).toBe(false);

    await db.setFeatureFlag('premium', true, null);
    reload();
    expect((await request(app).get('/api/auth/features')).body.featurePremium).toBe(true);
    expect((await profile(premium)).parsingAccess.fileUpload).toBe(true);
  });

  it('reports the premium flag state in the public feature list', async () => {
    expect((await request(app).get('/api/auth/features').expect(200)).body.featurePremium).toBe(true);
  });
});
