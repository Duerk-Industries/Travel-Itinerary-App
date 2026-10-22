import { Parser } from 'htmlparser2';
import type { RawMail } from './mailAdmission';
import { ownerVerifiedAddress, type ReceiverAuthentication } from './receiverAuthentication';
import type { GmailForwardingConfirmation } from '../../types';
export type { GmailForwardingConfirmation } from '../../types';
export const GMAIL_CONFIRMATION_TTL_MS = 30 * 60_000;
const plainHtml = (html: string): string => {
  let text = ''; let hidden = 0;
  const parser = new Parser({ onopentag(name) { if (['script', 'style'].includes(name)) hidden++; if (!hidden) text += ' '; }, ontext(value) { if (!hidden) text += value; }, onclosetag(name) { if (['script', 'style'].includes(name)) hidden = Math.max(0, hidden - 1); if (!hidden) text += ' '; } }, { decodeEntities: true });
  parser.write(html); parser.end(); return text;
};
/** Narrow English template; unknown/localized provider formats remain suggestions.
 * URLs/HTML are never returned and no link is followed or approved. */
export async function recognizeGmailConfirmation(userId: string, raw: RawMail, auth?: ReceiverAuthentication): Promise<GmailForwardingConfirmation | null> {
  if (!auth || auth.author.email !== 'forwarding-noreply@google.com' || auth.author.dkim !== 'pass' || auth.author.signingDomain !== 'google.com' || raw.files.length) return null;
  const subject = raw.body.subject || '';
  if (!/^Gmail Forwarding Confirmation(?: - Receive Mail from [^<>\s]+@[^<>\s]+)?$/i.test(subject)) return null;
  const content = raw.body['body-plain'] || raw.body['stripped-text'] || raw.body.text || plainHtml(raw.body['body-html'] || raw.body['stripped-html'] || raw.body.html || '');
  if (content.length > 32_768) return null;
  const text = content.replace(/\s+/g, ' ');
  const request = /(?:^| )([a-z0-9._%+-]+@[a-z0-9.-]+) has requested to automatically forward mail to your email address ([a-z0-9._%+-]+@[a-z0-9.-]+)\b/i.exec(text);
  if (!request || request[2].toLowerCase() !== raw.body.recipient?.toLowerCase() || !await ownerVerifiedAddress(userId, request[1].toLowerCase())) return null;
  const subjectOwner = / - Receive Mail from (.+)$/i.exec(subject)?.[1]?.toLowerCase();
  if (subjectOwner && subjectOwner !== request[1].toLowerCase()) return null;
  const codes = [...text.matchAll(/(?:^| )Confirmation code:\s*([0-9]{9})(?![0-9])/gi)];
  if (codes.length !== 1) return null;
  const expiresAt = Math.min(Date.now(), auth.issuedAt) + GMAIL_CONFIRMATION_TTL_MS;
  return expiresAt > Date.now() ? { provider: 'gmail', code: codes[0][1], requestedBy: request[1].toLowerCase(), expiresAt } : null;
}

export const isGmailConfirmationCandidate = (raw: RawMail): boolean => /gmail.*forwarding.*confirmation/i.test(raw.body.subject || '') || /forwarding-noreply@google\.com/i.test(raw.body.from || '');
