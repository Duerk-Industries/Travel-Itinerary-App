import { trustedForwarder, type ReceiverAuthentication } from '../shared/receiverAuthentication';
import crypto from 'crypto';
import multer from 'multer';
import type { Request, RequestHandler } from 'express';
import { getEnvValue } from '../../env';
import { logError } from '../../logger';
import {
  INGESTION_DEFAULT_FORWARDING_PROVIDER,
  INGESTION_MAX_FILE_BYTES,
  INGESTION_WEBHOOK_MAX_AGE_MS,
} from '../config';
import type { IngestionPayload } from '../contracts';
import { sha256 } from '../shared/hashing';
import { deleteTempBytes } from '../shared/tempStorage';
import { MAIL_MAX_BYTES, resolveMailAlias } from '../shared/mailAdmission';
import { isSupportedMimeType, normalizeMimeType } from '../shared/parserSelection';
import { IngestionError } from '../shared/userFailures';
import { buildWebhookPayload } from './index';

const mailgunMultipart = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAIL_MAX_BYTES,
    files: 8,
    fields: 32,
    parts: 40,
    fieldSize: 64 * 1024,
  },
}).any();

const extractEmailAddress = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const angleMatch = text.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const directMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return directMatch?.[0]?.trim().toLowerCase() ?? null;
};

const coerceString = (value: unknown): string => String(value ?? '').trim();

const getMailgunMessageHeaders = (body: Record<string, unknown>): Array<[string, string]> => {
  const raw = body['message-headers'];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is [string, string] => Array.isArray(entry) && entry.length >= 2)
      .map((entry) => [String(entry[0] ?? ''), String(entry[1] ?? '')]);
  } catch {
    return [];
  }
};

const getHeaderValue = (body: Record<string, unknown>, headerName: string): string | null => {
  const direct =
    body[headerName] ??
    body[headerName.toLowerCase()] ??
    body[headerName.toUpperCase()] ??
    body[headerName.replace(/-/g, '_')];
  if (direct) return coerceString(direct) || null;
  const found = getMailgunMessageHeaders(body).find(([name]) => name.toLowerCase() === headerName.toLowerCase());
  return found?.[1] ? coerceString(found[1]) : null;
};

const buildBodyFilename = (subject: string, extension: '.txt' | '.html'): string => {
  const normalized = (subject || 'forwarded-email')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${normalized || 'forwarded-email'}${extension}`;
};

const validateSignatureDigest = (timestamp: string, token: string, signature: string, signingKey: string): boolean => {
  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(signature, 'utf8');
  if (expectedBytes.length !== actualBytes.length) return false;
  return crypto.timingSafeEqual(expectedBytes, actualBytes);
};

export const mailgunWebhookMiddleware: RequestHandler = (req, res, next) => {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.startsWith('multipart/form-data')) {
    mailgunMultipart(req, res, next);
    return;
  }
  next();
};

export const validateMailgunWebhookSignature = async (body: Record<string, unknown>): Promise<void> => {
  const signingKey =
    getEnvValue('MAILGUN_WEBHOOK_SIGNING_KEY') ??
    getEnvValue('MAILGUN_HTTP_WEBHOOK_SIGNING_KEY');
  if (!signingKey) {
    throw new Error('Mailgun webhook signing key is not configured');
  }

  const timestamp = coerceString(body.timestamp);
  const token = coerceString(body.token);
  const signature = coerceString(body.signature);
  if (!timestamp || !token || !signature) {
    logError('[ingestion] mailgun webhook rejected missing signature fields');
    throw new IngestionError('mailbox_webhook_temporary_failure', 406, undefined, 'Missing Mailgun signature fields.');
  }

  const timestampMs = /^\d{10,12}$/.test(timestamp) ? Number(timestamp) * 1000 : NaN;
  // Route retries may carry their original signature. Accept the documented
  // eight-hour retry horizon plus one hour of skew; admission dedupes durably.
  // https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
  if (!Number.isFinite(timestampMs) || Date.now() - timestampMs > 9 * 60 * 60 * 1000 || timestampMs - Date.now() > INGESTION_WEBHOOK_MAX_AGE_MS) {
    logError('[ingestion] mailgun webhook rejected expired timestamp');
    throw new IngestionError('mailbox_webhook_temporary_failure', 406, undefined, 'Expired Mailgun timestamp.');
  }

  if (!validateSignatureDigest(timestamp, token, signature, signingKey)) {
    logError('[ingestion] mailgun webhook rejected invalid signature');
    throw new IngestionError('mailbox_webhook_temporary_failure', 406, undefined, 'Invalid Mailgun signature.');
  }

};

export const resolveMailgunWebhookUser = async (body: Record<string, unknown>): Promise<{ userId: string; senderEmail: string } | null> => {
  const alias = await resolveMailAlias(body.recipient);
  if (!alias) return null;
  // Claimed sender is metadata only, never authority to choose an account.
  const senderEmail = extractEmailAddress(body.sender) ?? extractEmailAddress(body.from) ?? '';
  return { userId: alias.userId, senderEmail };
};

export const buildMailgunWebhookPayloads = async (req: Request, userId: string, _senderEmail: string, authentication?: ReceiverAuthentication): Promise<IngestionPayload[]> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const files = ((req.files as Express.Multer.File[] | undefined) ?? []) as Express.Multer.File[];
  const subject = coerceString(body.subject) || 'Forwarded travel confirmation';
  const messageId =
    getHeaderValue(body, 'Message-Id') ??
    getHeaderValue(body, 'message-id') ??
    `mailgun-${crypto.randomUUID()}`;
  const receivedAtRaw = getHeaderValue(body, 'Date') ?? coerceString(body.Date) ?? new Date().toISOString();
  const receivedAt = Number.isNaN(new Date(receivedAtRaw).getTime()) ? new Date().toISOString() : new Date(receivedAtRaw).toISOString();
  const strippedText = coerceString(body['stripped-text'] ?? body['body-plain'] ?? body.text);
  const strippedHtml = coerceString(body['body-html'] ?? body['stripped-html'] ?? body.html);

  const payloads: IngestionPayload[] = [];
  const verifiedForwarder = await trustedForwarder(userId, authentication);
  const commonMetadata = {
    senderTrust: verifiedForwarder ? 'VERIFIED_FORWARDER' : 'UNVERIFIED_FORWARDER',
    automaticAssignmentAllowed: verifiedForwarder,
    provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
    sourceChannel: 'mailgun_inbound_webhook',
    // The claimed sender never grants trust or ownership.
    subject,
    messageId,
    attachmentCount: files.length,
  };

  try {
    if (strippedText) {
      payloads.push(
        await buildWebhookPayload({
          sourceType: 'FORWARDED_MAILBOX',
          userId,
          filename: buildBodyFilename(subject, '.txt'),
          mimeType: 'text/plain',
          bytes: Buffer.from(strippedText, 'utf8'),
          externalMessageId: `${messageId}::body:text`,
          metadata: {
            ...commonMetadata,
            bodyType: 'text',
          },
        })
      );
    } else if (strippedHtml) {
      payloads.push(
        await buildWebhookPayload({
          sourceType: 'FORWARDED_MAILBOX',
          userId,
          filename: buildBodyFilename(subject, '.html'),
          mimeType: 'text/html',
          bytes: Buffer.from(strippedHtml, 'utf8'),
          externalMessageId: `${messageId}::body:html`,
          metadata: {
            ...commonMetadata,
            bodyType: 'html',
          },
        })
      );
    }

    if (strippedText && strippedHtml && payloads[0]) {
      const scannedHtml = await buildWebhookPayload({ sourceType: 'FORWARDED_MAILBOX', userId,
        filename: 'structured-email.html', mimeType: 'text/html', bytes: Buffer.from(strippedHtml),
        externalMessageId: `${messageId}::structured-html`, metadata: commonMetadata });
      payloads[0].contentHash = sha256(`${payloads[0].contentHash}:${scannedHtml.contentHash}`);
      payloads[0].metadata.structuredHtml = strippedHtml;
      await deleteTempBytes(scannedHtml.contentBytesRef);
    }

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      if (!file.buffer || file.size > INGESTION_MAX_FILE_BYTES) {
        throw new IngestionError('file_too_large', 406);
      }
      const mimeType = normalizeMimeType(file.mimetype, file.originalname);
      if (!isSupportedMimeType(mimeType)) {
        continue;
      }
      payloads.push(
        await buildWebhookPayload({
          sourceType: 'FORWARDED_MAILBOX',
          userId,
          filename: file.originalname,
          mimeType,
          bytes: file.buffer,
          externalMessageId: `${messageId}::attachment:${index}`,
          metadata: {
            ...commonMetadata,
            attachmentIndex: index,
            attachmentFilename: file.originalname,
            attachmentMimeType: mimeType,
          },
        })
      );
    }

    if (!payloads.length) {
      throw new IngestionError('unsupported_file_type', 406, undefined, 'No supported Mailgun message parts were found.');
    }

    payloads.forEach((payload) => {
      payload.receivedAt = receivedAt;
      payload.metadata = {
        ...payload.metadata,
        receivedAt,
      };
    });

    return payloads;
  } catch (error) {
    for (const payload of payloads) await deleteTempBytes(payload.contentBytesRef);
    throw error;
  }
};
