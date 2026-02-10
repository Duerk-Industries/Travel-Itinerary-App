import nodemailer from 'nodemailer';
import { getEnvValue } from './env';
import { logError, logInfo } from './logger';

const isMailEnabled = (): boolean => {
  const raw = String(process.env.MAIL_ENABLED ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

const buildTransporter = () => {
  const SMTP_HOST = getEnvValue('SMTP_HOST');
  const SMTP_PORT = getEnvValue('SMTP_PORT');
  const SMTP_USER = getEnvValue('SMTP_USER');
  const SMTP_PASS = getEnvValue('SMTP_PASS');
  const SMTP_FROM = getEnvValue('SMTP_FROM');

  if (!isMailEnabled() || !SMTP_HOST || !SMTP_PORT || !SMTP_FROM || !SMTP_USER || !SMTP_PASS) {
    return { transporter: null, from: SMTP_FROM ?? undefined };
  }

  return {
    transporter: nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    }),
    from: SMTP_FROM,
  };
};

export const isEmailConfigured = (): boolean => {
  if (process.env.NODE_ENV === 'test') return false;
  if (!isMailEnabled()) return false;
  return Boolean(buildTransporter().transporter);
};

export const sendShareEmail = async (to: string, subject: string, body: string): Promise<void> => {
  const { transporter, from } = buildTransporter();
  if (!transporter) {
    throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
  }

  await transporter.sendMail({
    from,
    to,
    subject,
    text: body,
  });
};

const isRateLimitError = (err: any): boolean => {
  const message = String(err?.message ?? '');
  const response = String(err?.response ?? '');
  const code = String(err?.code ?? '');
  const responseCode = Number(err?.responseCode ?? 0);
  return (
    responseCode === 421 ||
    code === 'ETIMEDOUT' ||
    /421\b/.test(message) ||
    /daily request limit exceeded/i.test(message) ||
    /daily request limit exceeded/i.test(response)
  );
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const sendShareEmailBestEffort = async (
  to: string,
  subject: string,
  body: string,
  options: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<{ sent: boolean; attempts: number }> => {
  if (!isEmailConfigured()) {
    return { sent: false, attempts: 0 };
  }
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 750;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await sendShareEmail(to, subject, body);
      if (attempt > 1) {
        logInfo(`[mailer] succeeded after ${attempt} attempts for ${to}`);
      }
      return { sent: true, attempts: attempt };
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxAttempts) {
        logError(`[mailer] failed to send email to ${to}`, err);
        return { sent: false, attempts: attempt };
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  return { sent: false, attempts: maxAttempts };
};

export const sendVerificationEmail = async (to: string, token: string): Promise<void> => {
  const link = `https://duerk.org/confirm?token=${encodeURIComponent(token)}`;
  const subject = 'Confirm your Shared Trip Planner account';
  const body = [
    `Hi,`,
    ``,
    `Please confirm your email address to activate your Shared Trip Planner account.`,
    `This link expires in 24 hours.`,
    ``,
    link,
    ``,
    `If you did not create this account, you can ignore this email.`,
  ].join('\n');
  await sendShareEmail(to, subject, body);
};

export const sendVerificationEmailBestEffort = async (to: string, token: string): Promise<{ sent: boolean; attempts: number }> => {
  const link = `https://duerk.org/confirm?token=${encodeURIComponent(token)}`;
  const subject = 'Confirm your Shared Trip Planner account';
  const body = [
    `Hi,`,
    ``,
    `Please confirm your email address to activate your Shared Trip Planner account.`,
    `This link expires in 24 hours.`,
    ``,
    link,
    ``,
    `If you did not create this account, you can ignore this email.`,
  ].join('\n');
  return sendShareEmailBestEffort(to, subject, body);
};

export const sendTripInviteEmail = async (to: string, tripName: string, inviterEmail?: string | null): Promise<void> => {
  const link = `https://duerk.org`;
  const subject = inviterEmail
    ? `${inviterEmail} added you to a trip: ${tripName}`
    : `You've been added to a trip: ${tripName}`;
  const body = [
    `Hi,`,
    ``,
    inviterEmail ? `${inviterEmail} added you to the trip "${tripName}".` : `You've been added to the trip "${tripName}".`,
    `Log in to Shared Trip Planner to accept or decline the invite.`,
    ``,
    link,
  ].join('\n');
  await sendShareEmail(to, subject, body);
};

export const sendTripInviteEmailBestEffort = async (
  to: string,
  tripName: string,
  inviterEmail?: string | null
): Promise<{ sent: boolean; attempts: number }> => {
  const link = `https://duerk.org`;
  const subject = inviterEmail
    ? `${inviterEmail} added you to a trip: ${tripName}`
    : `You've been added to a trip: ${tripName}`;
  const body = [
    `Hi,`,
    ``,
    inviterEmail ? `${inviterEmail} added you to the trip "${tripName}".` : `You've been added to the trip "${tripName}".`,
    `Log in to Shared Trip Planner to accept or decline the invite.`,
    ``,
    link,
  ].join('\n');
  return sendShareEmailBestEffort(to, subject, body);
};
