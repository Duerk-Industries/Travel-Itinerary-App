import fs from 'fs';
import path from 'path';
import { receiverContentHash, signReceiverAuthentication, verifyReceiverAuthentication, trustedForwarder, type ReceiverAuthentication } from '../src/ingestion/shared/receiverAuthentication';
import { recognizeGmailConfirmation } from '../src/ingestion/shared/gmailConfirmation';
import { getFeatureFlag, getUserById } from '../src/db';
import { isVerifiedSender } from '../src/ingestion/shared/verifiedSenders';
import type { RawMail } from '../src/ingestion/shared/mailAdmission';
jest.mock('../src/db', () => ({ getFeatureFlag: jest.fn(), getUserById: jest.fn() }));
jest.mock('../src/ingestion/shared/verifiedSenders', () => ({ isVerifiedSender: jest.fn(), normalizeSenderEmail: (value: unknown) => typeof value === 'string' && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null }));
const secret = 'test-only-receiver-key-32-bytes-minimum';
const recipient = 'u-abcdefghijklmnopqrstuvwxyz@in.wander-bunnies.com';
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../tests/fixtures/gmail-forwarding-confirmation.en.redacted.json'), 'utf8')) as { from: string; subject: string; text: string };
const raw = (): RawMail => ({ body: { recipient, from: fixture.from, subject: fixture.subject, 'body-plain': fixture.text.replace('{{recipient}}', recipient) }, transport: { token: 'delivery-token', timestamp: String(Math.floor(Date.now() / 1000)) }, files: [] });
const evidence = (mail: RawMail): ReceiverAuthentication => ({ version: 1, receiverId: 'trusted-edge', policyVersion: 'v1', issuedAt: Date.now(), contentHash: receiverContentHash(mail), author: { email: 'forwarding-noreply@google.com', dkim: 'pass', signingDomain: 'google.com' } });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.INGESTION_RECEIVER_AUTH_SECRET = secret; process.env.INGESTION_RECEIVER_AUTH_ID = 'trusted-edge'; process.env.INGESTION_RECEIVER_AUTH_POLICY_VERSION = 'v1';
  (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: true });
  (getUserById as jest.Mock).mockResolvedValue({ email: 'owner@gmail.com', emailVerified: true });
  (isVerifiedSender as jest.Mock).mockResolvedValue(false);
});
afterEach(() => { for (const key of ['INGESTION_RECEIVER_AUTH_SECRET', 'INGESTION_RECEIVER_AUTH_ID', 'INGESTION_RECEIVER_AUTH_POLICY_VERSION']) delete process.env[key]; });
it('accepts a content-bound receiver attestation and recognizes a narrow sanitized Gmail confirmation', async () => {
  const mail = raw(); const auth = await verifyReceiverAuthentication(signReceiverAuthentication(evidence(mail), secret), mail);
  expect(auth?.author.dkim).toBe('pass');
  expect(await recognizeGmailConfirmation('owner', mail, auth)).toMatchObject({ provider: 'gmail', code: '123456789', requestedBy: 'owner@gmail.com' });
  expect(await trustedForwarder('owner', auth)).toBe(false);
});
it('does not trust claimed Authentication-Results or a Google From without authenticated receiver evidence', async () => {
  const mail = raw(); mail.body['message-headers'] = JSON.stringify([['Authentication-Results', 'mx.google.com; dkim=pass header.d=google.com']]);
  expect(await verifyReceiverAuthentication(undefined, mail)).toBeUndefined();
  expect(await recognizeGmailConfirmation('owner', mail)).toBeNull();
});
it('rejects wrong signatures, stale/future observations, unknown receiver policies and disabled/missing flags', async () => {
  const mail = raw();
  for (const patch of [{ receiverId: 'attacker' }, { policyVersion: 'v2' }, { issuedAt: Date.now() - 10 * 3600_000 }, { issuedAt: Date.now() + 120_000 }]) expect(await verifyReceiverAuthentication(signReceiverAuthentication({ ...evidence(mail), ...patch }, secret), mail)).toBeUndefined();
  expect(await verifyReceiverAuthentication(signReceiverAuthentication(evidence(mail), 'wrong-key'), mail)).toBeUndefined();
  (getFeatureFlag as jest.Mock).mockResolvedValue(null);
  expect(await verifyReceiverAuthentication(signReceiverAuthentication(evidence(mail), secret), mail)).toBeUndefined();
});
it.each(['body', 'alias', 'attachment', 'transport'])('rejects content/provenance tampering: %s', async kind => {
  const mail = raw(); const header = signReceiverAuthentication(evidence(mail), secret);
  if (kind === 'body') mail.body['body-plain'] += 'extra';
  if (kind === 'alias') mail.body.recipient = 'other@example.com';
  if (kind === 'attachment') mail.files.push({ originalname: 'a.txt', mimetype: 'text/plain', bytes: 'eA==' });
  if (kind === 'transport') mail.transport!.token = 'different-delivery';
  expect(await verifyReceiverAuthentication(header, mail)).toBeUndefined();
});
it('does not mistake airline DKIM or ARC claims for the owner forwarding mailbox', async () => {
  const auth = evidence(raw()); auth.author = { email: 'booking@airline.example', signingDomain: 'airline.example', dkim: 'pass' };
  expect(await trustedForwarder('owner', auth)).toBe(false);
  auth.forwarder = { email: 'owner@gmail.com', domain: 'gmail.com', method: 'validated-forwarding-chain' };
  expect(await trustedForwarder('owner', auth)).toBe(true);
  (getUserById as jest.Mock).mockResolvedValue({ email: 'owner@gmail.com', emailVerified: false });
  expect(await trustedForwarder('owner', auth)).toBe(false);
  (isVerifiedSender as jest.Mock).mockResolvedValue(true);
  expect(await trustedForwarder('owner', auth)).toBe(true);
});
it('requires the requesting account and alias to match and rejects ambiguous codes and malformed templates', async () => {
  for (const change of [
    (mail: RawMail) => { mail.body['body-plain'] = mail.body['body-plain'].replace(recipient, 'other@example.com'); },
    (mail: RawMail) => { mail.body['body-plain'] += ' Confirmation code: 987654321'; },
    (mail: RawMail) => { mail.body.subject = 'An unrelated booking'; },
    (mail: RawMail) => { mail.files.push({ originalname: 'file', mimetype: 'text/plain', bytes: 'eA==' }); },
    (mail: RawMail) => { mail.body['body-plain'] = mail.body['body-plain'].replace('owner@gmail.com', 'stranger@gmail.com'); },
  ]) { const mail = raw(); change(mail); expect(await recognizeGmailConfirmation('owner', mail, evidence(mail))).toBeNull(); }
});
it('extracts only safe text from HTML and never returns or follows provider/attacker links', async () => {
  const mail = raw(); mail.body['body-html'] = `<p>${mail.body['body-plain']}</p><a href="https://evil.test/approve">Click here</a>`; delete mail.body['body-plain'];
  const result = await recognizeGmailConfirmation('owner', mail, evidence(mail));
  expect(result?.code).toBe('123456789'); expect(JSON.stringify(result)).not.toContain('evil.test');
});

it('does not grant automatic-add trust from owner-aligned DKIM alone', async () => {
  const auth = evidence(raw()); auth.author = { email: 'owner@gmail.com', signingDomain: 'gmail.com', dkim: 'pass' };
  expect(await trustedForwarder('owner', auth)).toBe(false);
});

it('does not revive an old Gmail code when a transport retry arrives later', async () => {
  const mail = raw(); const observed = Date.now() - 31 * 60_000;
  mail.transport!.timestamp = String(Math.floor(observed / 1000));
  const auth = { ...evidence(mail), issuedAt: observed };
  const verified = await verifyReceiverAuthentication(signReceiverAuthentication(auth, secret), mail);
  expect(verified).toBeDefined(); expect(await recognizeGmailConfirmation('owner', mail, verified)).toBeNull();
  expect(await verifyReceiverAuthentication(signReceiverAuthentication({ ...auth, issuedAt: Date.now() }, secret), mail)).toBeUndefined();
});
