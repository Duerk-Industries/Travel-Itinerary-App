import request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag, getUsageCounter } from '../src/db';
import { registerAndLoginWebUser, setUserTierInDb, seedTiersForTest } from './helpers';
import { getMailAlias, resolveMailAlias, listMailReceipts, getMailReceipt, readGmailConfirmation, type RawMail } from '../src/ingestion/shared/mailAdmission';
import { receiverContentHash, signReceiverAuthentication, MAIL_CONTENT_FIELDS, type ReceiverAuthentication } from '../src/ingestion/shared/receiverAuthentication';
import { drainMailReceipts } from '../src/ingestion/worker/mailReceiptWorker';
import { INGESTION_USAGE_KEYS } from '../src/ingestion/config';
const signingKey = 'test-only-mailgun-key'; const receiverKey = 'test-only-receiver-key-32-bytes-minimum';
describe('receiver authenticated Gmail forwarding confirmation', () => {
  let userId = ''; let token = ''; let otherToken = ''; let address = ''; let email = '';
  beforeAll(async () => {
    await initDb(); await seedTiersForTest();
    for (const flag of ['feature_ingest_forwarded_mailbox', 'feature_ingest_receiver_auth']) await setFeatureFlag(flag, true, null);
    email = `receiver-${randomUUID().slice(0, 8)}@example.com`;
    const owner = await registerAndLoginWebUser({ firstName: 'Receiver', lastName: 'Owner', email, password: 'secret123' });
    userId = owner.userId; token = owner.token; await setUserTierInDb(userId, 'premium');
    const other = await registerAndLoginWebUser({ firstName: 'Other', lastName: 'Owner', email: `other-${randomUUID().slice(0, 8)}@example.com`, password: 'secret123' });
    otherToken = other.token; await setUserTierInDb(other.userId, 'premium');
    address = await getMailAlias(userId);
  });
  beforeEach(() => {
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY = signingKey;
    process.env.INGESTION_RECEIVER_AUTH_SECRET = receiverKey; process.env.INGESTION_RECEIVER_AUTH_ID = 'receiver-test'; process.env.INGESTION_RECEIVER_AUTH_POLICY_VERSION = 'v1';
  });
  afterAll(() => { for (const key of ['MAILGUN_WEBHOOK_SIGNING_KEY', 'INGESTION_RECEIVER_AUTH_SECRET', 'INGESTION_RECEIVER_AUTH_ID', 'INGESTION_RECEIVER_AUTH_POLICY_VERSION']) delete process.env[key]; });
  const message = () => {
    const timestamp = String(Math.floor(Date.now() / 1000)); const delivery = randomUUID();
    const body: Record<string, string> = { timestamp, token: delivery, signature: createHmac('sha256', signingKey).update(timestamp + delivery).digest('hex'),
      recipient: address, from: 'Gmail Team <forwarding-noreply@google.com>', sender: 'bounces@google.com', subject: `Gmail Forwarding Confirmation - Receive Mail from ${email}`,
      'Message-Id': `<${delivery}@google.com>`, Date: new Date().toUTCString(), 'body-plain': `${email} has requested to automatically forward mail to your email address ${address}. Confirmation code: 123456789` };
    const raw: RawMail = { body: Object.fromEntries(MAIL_CONTENT_FIELDS.filter(key => body[key] !== undefined).map(key => [key, body[key]])), transport: { token: delivery, timestamp }, files: [] };
    const authentication: ReceiverAuthentication = { version: 1, receiverId: 'receiver-test', policyVersion: 'v1', issuedAt: Date.now(), contentHash: receiverContentHash(raw), author: { email: 'forwarding-noreply@google.com', dkim: 'pass', signingDomain: 'google.com' } };
    return { body, raw, authentication, header: signReceiverAuthentication(authentication, receiverKey) };
  };
  it('never treats a spoofed From/auth header as a confirmation or booking', async () => {
    const mail = message(); mail.body['message-headers'] = JSON.stringify([['Authentication-Results', 'mx.google.com; dkim=pass header.d=google.com']]);
    await request(app).post('/api/ingestion/webhooks/mailgun').type('form').send(mail.body).expect(200);
    const receipts = await listMailReceipts(userId);
    const held = receipts.find(r => r.holdReason === 'GMAIL_CONFIRMATION_UNVERIFIED')!;
    expect(held.state).toBe('HELD'); expect(held.quotaReserved).toBe(false); expect(JSON.stringify(held)).not.toContain('123456789');
    expect((await drainMailReceipts()).processed).toBe(0);
    await request(app).post(`/api/ingestion/forwarding/receipts/${held.id}/release`).set('Authorization', `Bearer ${token}`).expect(404);
  });
  it('durably accepts a signed confirmation once, without quota/parser work; only its owner sees a sanitized expiring code', async () => {
    const mail = message();
    for (let n = 0; n < 2; n++) await request(app).post('/api/ingestion/webhooks/mailgun').set('X-WanderBunnies-Receiver-Authentication', mail.header).type('form').send(mail.body).expect(200);
    const confirmations = (await listMailReceipts(userId)).filter(r => r.state === 'CONFIRMATION');
    expect(confirmations).toHaveLength(1); expect(confirmations[0].quotaReserved).toBe(false);
    expect(JSON.stringify(confirmations)).not.toContain('123456789');
    expect(await getUsageCounter(userId, INGESTION_USAGE_KEYS.forwardedMailboxDeliveries, new Date().toISOString().slice(0, 7))).toBe(0);
    expect((await drainMailReceipts()).processed).toBe(0);
    const own = await request(app).get('/api/ingestion/forwarding/confirmations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(own.headers['cache-control']).toContain('no-store'); expect(own.body.confirmations[0].code).toBe('123456789');
    expect(Object.keys(own.body.confirmations[0]).sort()).toEqual(['code', 'expiresAt', 'id', 'provider', 'requestedBy']);
    expect((await request(app).get('/api/ingestion/forwarding/confirmations').set('Authorization', `Bearer ${otherToken}`).expect(200)).body.confirmations).toEqual([]);
    await request(app).get('/api/ingestion/forwarding/confirmations').expect(401);
    expect(await getMailReceipt(confirmations[0].id, randomUUID())).toBeNull();
    expect(readGmailConfirmation({ ...confirmations[0], expiresAt: Date.now() - 1 })).toBeNull();
    await getMailAlias(userId, true);
    expect((await request(app).get('/api/ingestion/forwarding/confirmations').set('Authorization', `Bearer ${token}`).expect(200)).body.confirmations).toEqual([]);
    address = await getMailAlias(userId);
    expect(await resolveMailAlias(address)).toBeTruthy();
  });
  it('keeps tampered setup mail held and never exposes its code', async () => {
    const mail = message(); mail.body['body-plain'] = mail.body['body-plain'].replace('123456789', '987654321');
    await request(app).post('/api/ingestion/webhooks/mailgun').set('X-WanderBunnies-Receiver-Authentication', mail.header).type('form').send(mail.body).expect(200);
    expect((await request(app).get('/api/ingestion/forwarding/confirmations').set('Authorization', `Bearer ${token}`).expect(200)).body.confirmations).toEqual([]);
  });
  it('holds authenticated failures claiming the owner before parsing or quota reservation', async () => {
    const mail = message(); mail.body.from = email; mail.body.subject = 'Flight confirmation'; mail.body['body-plain'] = 'A booking needing review';
    mail.raw.body = Object.fromEntries(MAIL_CONTENT_FIELDS.filter(key => mail.body[key] !== undefined).map(key => [key, mail.body[key]]));
    mail.authentication.author = { email, dkim: 'fail', signingDomain: 'example.com' }; mail.authentication.contentHash = receiverContentHash(mail.raw);
    await request(app).post('/api/ingestion/webhooks/mailgun').set('X-WanderBunnies-Receiver-Authentication', signReceiverAuthentication(mail.authentication, receiverKey)).type('form').send(mail.body).expect(200);
    const held = (await listMailReceipts(userId)).find(r => r.holdReason === 'SENDER_AUTH_FAILED');
    expect(held?.state).toBe('HELD'); expect(held?.quotaReserved).toBe(false);
  });
  it('propagates verified forwarder trust to payloads without trusting the preserved airline From', async () => {
    const mail = message(); mail.body.from = 'bookings@airline.example'; mail.body.subject = 'Flight confirmation'; mail.body['body-plain'] = 'A forwarded booking';
    mail.raw.body = Object.fromEntries(MAIL_CONTENT_FIELDS.filter(key => mail.body[key] !== undefined).map(key => [key, mail.body[key]]));
    mail.authentication.author = { email: 'bookings@airline.example', dkim: 'unknown', signingDomain: '' };
    mail.authentication.forwarder = { email, domain: 'example.com', method: 'authenticated-submission' }; mail.authentication.contentHash = receiverContentHash(mail.raw);
    await request(app).post('/api/ingestion/webhooks/mailgun').set('X-WanderBunnies-Receiver-Authentication', signReceiverAuthentication(mail.authentication, receiverKey)).type('form').send(mail.body).expect(200);
    const receipt = (await listMailReceipts(userId)).find(r => r.state === 'PENDING')!;
    const { readRawMail, updateMailReceipt } = await import('../src/ingestion/shared/mailAdmission');
    const { buildMailgunWebhookPayloads } = await import('../src/ingestion/intake/mailgun');
    const { deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const raw = readRawMail(receipt);
    const payloads = await buildMailgunWebhookPayloads({ body: raw.body, files: [] } as unknown as import('express').Request, userId, '', receipt.authentication);
    expect(payloads[0].metadata.senderTrust).toBe('VERIFIED_FORWARDER'); expect(payloads[0].metadata.automaticAssignmentAllowed).toBe(true);
    for (const payload of payloads) await deleteTempBytes(payload.contentBytesRef);
    await updateMailReceipt(receipt.id, current => ({ ...current, state: 'COMPLETE', encrypted: null }));
  });

});
