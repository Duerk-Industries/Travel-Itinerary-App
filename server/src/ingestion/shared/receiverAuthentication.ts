import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { getFeatureFlag, getUserById } from '../../db';
import { getEnvValue } from '../../env';
import { isVerifiedSender, normalizeSenderEmail } from './verifiedSenders';
import type { RawMail } from './mailAdmission';

export const MAIL_CONTENT_FIELDS = ['subject', 'sender', 'from', 'recipient', 'Message-Id', 'message-id', 'message-headers', 'Date', 'stripped-text', 'body-plain', 'text', 'stripped-html', 'body-html', 'html'] as const;
const mailbox = z.string().max(254).refine(value => normalizeSenderEmail(value) === value);
const identity = z.object({ email: mailbox, domain: z.string().min(1).max(253), method: z.enum(['authenticated-submission', 'validated-forwarding-chain']) }).strict();
const schema = z.object({ version: z.literal(1), receiverId: z.string().min(1).max(80), policyVersion: z.string().min(1).max(80), issuedAt: z.number().int(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), author: z.object({ email: mailbox, dkim: z.enum(['pass', 'fail', 'unknown']), signingDomain: z.string().max(253) }).strict(), forwarder: identity.optional() }).strict();
export type ReceiverAuthentication = z.infer<typeof schema>;
/** The trusted receiver must construct observations itself, never copy message auth headers.
 * This covers every retained body field and attachment byte, not only a transport timestamp/token. */
export const receiverContentHash = (raw: RawMail): string => createHash('sha256').update(JSON.stringify({
  transport: raw.transport ? [raw.transport.token.trim(), raw.transport.timestamp.trim()] : null,
  body: MAIL_CONTENT_FIELDS.filter(key => typeof raw.body[key] === 'string').map(key => [key, raw.body[key]]),
  files: raw.files.map(file => [file.originalname, file.mimetype, createHash('sha256').update(Buffer.from(file.bytes, 'base64')).digest('hex')]),
})).digest('hex');
export const signReceiverAuthentication = (authentication: ReceiverAuthentication, secret: string): string => {
  const encoded = Buffer.from(JSON.stringify(schema.parse(authentication))).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('hex')}`;
};
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const claimedAuthor = (body: Record<string, string>): string | null => {
  const text = body.from || '';
  const match = text.match(/^[^<>\r\n]*<([^<>]+)>$/);
  return normalizeSenderEmail(match ? match[1] : text);
};
export async function receiverAuthenticationEnabled(): Promise<boolean> {
  return (await getFeatureFlag('feature_ingest_receiver_auth'))?.enabled === true;
}
export async function verifyReceiverAuthentication(header: unknown, raw: RawMail): Promise<ReceiverAuthentication | undefined> {
  if (typeof header !== 'string' || header.length > 4096 || !await receiverAuthenticationEnabled()) return undefined;
  const secret = getEnvValue('INGESTION_RECEIVER_AUTH_SECRET');
  const receiverId = getEnvValue('INGESTION_RECEIVER_AUTH_ID');
  const policy = getEnvValue('INGESTION_RECEIVER_AUTH_POLICY_VERSION');
  if (!secret || secret.length < 32 || !receiverId || !policy) return undefined;
  const parts = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(header);
  if (!parts || !same(createHmac('sha256', secret).update(parts[1]).digest('hex'), parts[2])) return undefined;
  try {
    const result = schema.parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
    const deliveredAt = Number(raw.transport?.timestamp) * 1000;
    if (!Number.isFinite(deliveredAt) || Math.abs(result.issuedAt - deliveredAt) > 60_000) return undefined;
    if (result.receiverId !== receiverId || result.policyVersion !== policy || !same(result.contentHash, receiverContentHash(raw))
      || result.issuedAt > Date.now() + 60_000 || Date.now() - result.issuedAt > 9 * 60 * 60_000 || result.author.email !== claimedAuthor(raw.body)) return undefined;
    if (result.author.dkim === 'pass' && result.author.signingDomain !== result.author.email.split('@')[1]) return undefined;
    if (result.forwarder && result.forwarder.domain !== result.forwarder.email.split('@')[1]) return undefined;
    return result;
  } catch { return undefined; }
}
export async function ownerVerifiedAddress(userId: string, rawEmail: unknown): Promise<boolean> {
  const email = normalizeSenderEmail(rawEmail); if (!email) return false;
  const user = await getUserById(userId);
  if (user?.emailVerified === true && normalizeSenderEmail(user.email) === email) return true;
  return isVerifiedSender(userId, email);
}
/** Domain authentication alone never identifies the forwarding mailbox. */
export const receiverPolicyCurrent = (auth?: ReceiverAuthentication): boolean => Boolean(auth
  && (getEnvValue('INGESTION_RECEIVER_AUTH_SECRET') || '').length >= 32
  && auth.receiverId === getEnvValue('INGESTION_RECEIVER_AUTH_ID') && auth.policyVersion === getEnvValue('INGESTION_RECEIVER_AUTH_POLICY_VERSION'));
export async function trustedForwarder(userId: string, auth?: ReceiverAuthentication): Promise<boolean> {
  if (!auth || !receiverPolicyCurrent(auth) || !await receiverAuthenticationEnabled()) return false;
  // DKIM authenticates a signing domain, not the forwarding account's local part.
  // The receiver policy must independently establish that mailbox identity.
  return Boolean(auth.forwarder && await ownerVerifiedAddress(userId, auth.forwarder.email));
}
