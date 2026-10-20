import { MAIL_CONTENT_FIELDS, verifyReceiverAuthentication, ownerVerifiedAddress } from '../ingestion/shared/receiverAuthentication';
import { recognizeGmailConfirmation, isGmailConfirmationCandidate } from '../ingestion/shared/gmailConfirmation';
import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import multer from 'multer';
import bodyParser from 'body-parser';
import { logError, logInfo } from '../logger';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_FEATURE_FLAGS } from '../ingestion/config';
import { mailgunWebhookMiddleware, validateMailgunWebhookSignature } from '../ingestion/intake/mailgun';
import { getTierIngestionRules } from '../ingestion/shared/quota';
import { IngestionError } from '../ingestion/shared/userFailures';
import { admitMail, MAIL_MAX_BYTES, mailReceiptId, resolveMailAlias, type RawMail } from '../ingestion/shared/mailAdmission';
import { assertMailAdmissionReady } from '../ingestion/worker/mailReceiptWorker';
import { isSupportedMimeType, normalizeMimeType } from '../ingestion/shared/parserSelection';

const router = Router();
// Enforce the same aggregate limit and deadline at the ingress proxy.
const boundTransport: RequestHandler = (req, res, next) => {
  const limit = 512 * 1024;
  if (Number(req.get('content-length') || 0) > limit) {
    res.status(406).json({ error: 'Message is too large. Upload the confirmation manually.' }); return;
  }
  let bytes = 0;
  const count = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limit) { res.status(406).end(); req.destroy(); }
  };
  req.on('data', count);
  const timer = setTimeout(() => { if (!res.writableEnded) { res.status(503).end(); req.destroy(); } }, 15_000);
  res.on('close', () => { clearTimeout(timer); req.off('data', count); });
  next();
};
router.use(boundTransport);
router.use(bodyParser.json({ limit: '512kb' }));
router.use(bodyParser.urlencoded({ extended: false, limit: '512kb', parameterLimit: 32 }));

router.post('/mailgun', mailgunWebhookMiddleware, async (req, res) => {
  try {
    if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.forwardedMailbox))) {
      res.status(503).json({ error: 'Forwarded mail is temporarily unavailable. Please use manual upload.' }); return;
    }
    assertMailAdmissionReady();
    const body = (req.body ?? {}) as Record<string, unknown>;
    await validateMailgunWebhookSignature(body);
    const alias = await resolveMailAlias(body.recipient);
    // Includes the legacy shared address. From cannot attribute even a hold.
    if (!alias) { res.status(200).json({ accepted: true }); return; }
    const { tierKey, rules } = await getTierIngestionRules(alias.userId);
    if (tierKey === 'free') { res.status(200).json({ accepted: true }); return; }
    const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
    const safeBody: Record<string, string> = {};
    for (const name of MAIL_CONTENT_FIELDS) {
      if (typeof body[name] === 'string') safeBody[name] = body[name] as string;
    }
    const totalBytes = Buffer.byteLength(JSON.stringify(safeBody)) + files.reduce((sum, file) => sum + file.buffer.length, 0);
    if (totalBytes > MAIL_MAX_BYTES) throw new IngestionError('file_too_large', 406);
    if (!['stripped-text', 'body-plain', 'text', 'stripped-html', 'body-html', 'html'].some(name => safeBody[name]?.trim())
      && !files.some(file => isSupportedMimeType(normalizeMimeType(file.mimetype, file.originalname)))) {
      throw new IngestionError('unsupported_file_type', 406);
    }
    const raw: RawMail = { body: safeBody, transport: { token: String(body.token), timestamp: String(body.timestamp) }, files: files.map(file => ({ originalname: file.originalname, mimetype: file.mimetype, bytes: file.buffer.toString('base64') })) };
    const authentication = await verifyReceiverAuthentication(req.get('X-WanderBunnies-Receiver-Authentication'), raw);
    if (authentication) raw.authentication = authentication;
    const confirmation = await recognizeGmailConfirmation(alias.userId, raw, authentication);
    const unverifiedConfirmation = !confirmation && isGmailConfirmationCandidate(raw);
    const forceHold = unverifiedConfirmation || (authentication?.author.dkim === 'fail' && await ownerVerifiedAddress(alias.userId, authentication.author.email));
    raw.body['Message-Id'] ||= `mailgun-${mailReceiptId(alias.userId, body)}`;
    raw.body.Date ||= new Date().toISOString();
    const receipt = await admitMail({
      id: mailReceiptId(alias.userId, body), userId: alias.userId, aliasHash: alias.aliasHash, raw,
      monthlyLimit: rules.monthlyUploads, confirmation, forceHold, holdReason: unverifiedConfirmation ? 'GMAIL_CONFIRMATION_UNVERIFIED' : undefined,
      allowLargeLlm: rules.llmEscalations === 'LARGE_ALLOWED', allowSmallLlm: rules.llmEscalations !== 'NONE',
    });
    logInfo(`[ingestion][mailgun] delivery recorded receipt=${receipt?.id ?? 'dropped'} parts=${files.length + 1}`);
    // Durable receipt is the outbox. The authenticated scheduler processes it
    // on any instance; no detached Cloud Run work or local temp-file handoff.
    res.status(200).json({ accepted: true });
  } catch (error) {
    if (error instanceof IngestionError) {
      logError(`[ingestion][mailgun] admission failed code=${error.code}`);
      res.status(error.httpStatus === 406 ? 406 : 503).json({ error: error.message, code: error.code }); return;
    }
    logError('[ingestion][mailgun] temporary admission failure');
    res.status(503).json({ error: 'Mailbox processing failed temporarily.' });
  }
});
const handleTransportError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const status = typeof error === 'object' && error ? Number((error as { status?: number }).status) : 0;
  const invalid = error instanceof multer.MulterError || status === 400 || status === 413;
  if (!res.headersSent) res.status(invalid ? 406 : 503).json({ error: invalid ? 'Message could not be accepted. Upload the confirmation manually.' : 'Mailbox processing failed temporarily.' });
};
router.use(handleTransportError);
export default router;
