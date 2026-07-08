import nodemailer from 'nodemailer';
import { getBackendUrl, getEnvValue } from './env';
import { logError, logInfo } from './logger';
import {
  sendShareEmailViaSmtpApi,
  sendBillingTrialReminderEmailViaSmtpApi,
  sendTripInviteEmailViaSmtpApi,
  sendVerificationEmailViaSmtpApi,
} from './apis/smtpCallers';
import { isCanaryRecipientEmail } from './middleware/canarySafeMode';

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
  if (await isCanaryRecipientEmail(to, 'sendShareEmail')) return;
  const { transporter, from } = buildTransporter();
  if (!transporter) {
    throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
  }

  await sendShareEmailViaSmtpApi(transporter, {
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
  return sendWithRetry(() => sendShareEmail(to, subject, body), to, options);
};

const sendWithRetry = async (
  sender: () => Promise<void>,
  to: string,
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
      await sender();
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
  if (await isCanaryRecipientEmail(to, 'sendVerificationEmail')) return;
  const { transporter, from } = buildTransporter();
  if (!transporter) {
    throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
  }
  const rawWebUrl = String(getBackendUrl('https://duerk.org') ?? 'https://duerk.org').trim();
  const webUrl = rawWebUrl.endsWith('/') ? rawWebUrl.slice(0, -1) : rawWebUrl;
  const link = `${webUrl}/confirm?token=${encodeURIComponent(token)}`;
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
  await sendVerificationEmailViaSmtpApi(transporter, {
    from,
    to,
    subject,
    text: body,
  });
};

export const sendVerificationEmailBestEffort = async (
  to: string,
  token: string,
  options: { path?: string; subject?: string; intro?: string } = {}
): Promise<{ sent: boolean; attempts: number }> => {
  if (!options.path && !options.subject && !options.intro) {
    return sendWithRetry(() => sendVerificationEmail(to, token), to);
  }
  const sender = async () => {
    if (await isCanaryRecipientEmail(to, 'sendVerificationEmailBestEffort')) return;
    const { transporter, from } = buildTransporter();
    if (!transporter) {
      throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
    }
    const rawWebUrl = String(getBackendUrl('https://duerk.org') ?? 'https://duerk.org').trim();
    const webUrl = rawWebUrl.endsWith('/') ? rawWebUrl.slice(0, -1) : rawWebUrl;
    const path = options.path ?? '/confirm';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const link = `${webUrl}${normalizedPath}?token=${encodeURIComponent(token)}`;
    const subject = options.subject ?? 'Confirm your Shared Trip Planner account';
    const intro = options.intro ?? 'Please confirm your email address.';
    const body = ['Hi,', '', intro, 'This link expires in 24 hours.', '', link, '', 'If you did not request this, you can ignore this email.'].join('\n');
    await sendVerificationEmailViaSmtpApi(transporter, {
      from,
      to,
      subject,
      text: body,
    });
  };
  return sendWithRetry(sender, to);
};


export const sendTripInviteEmail = async (to: string, tripName: string, inviterEmail?: string | null): Promise<void> => {
  if (await isCanaryRecipientEmail(to, 'sendTripInviteEmail')) return;
  const { transporter, from } = buildTransporter();
  if (!transporter) {
    throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
  }
  const rawWebUrl = String(getBackendUrl('https://duerk.org') ?? 'https://duerk.org').trim();
  const link = rawWebUrl.endsWith('/') ? rawWebUrl.slice(0, -1) : rawWebUrl;
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
  await sendTripInviteEmailViaSmtpApi(transporter, {
    from,
    to,
    subject,
    text: body,
  });
};

export const sendTripInviteEmailBestEffort = async (
  to: string,
  tripName: string,
  inviterEmail?: string | null
): Promise<{ sent: boolean; attempts: number }> => {
  return sendWithRetry(() => sendTripInviteEmail(to, tripName, inviterEmail), to);
};

export const sendBillingTrialEndingEmail = async (
  to: string,
  trialEnd: Date,
): Promise<void> => {
  if (await isCanaryRecipientEmail(to, 'sendBillingTrialEndingEmail')) return;
  const { transporter, from } = buildTransporter();
  if (!transporter) {
    throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
  }
  const rawWebUrl = String(getBackendUrl('https://duerk.org') ?? 'https://duerk.org').trim();
  const webUrl = rawWebUrl.endsWith('/') ? rawWebUrl.slice(0, -1) : rawWebUrl;
  const trialEndLabel = trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const subject = 'Your WanderBunnies Premium trial ends soon';
  const body = [
    'Hi,',
    '',
    `Your WanderBunnies Premium trial ends on ${trialEndLabel}.`,
    'After the trial ends, your saved payment method will be charged unless you cancel before then.',
    '',
    'You can review or cancel your subscription from Account > Premium in WanderBunnies.',
    '',
    webUrl,
  ].join('\n');
  await sendBillingTrialReminderEmailViaSmtpApi(transporter, {
    from,
    to,
    subject,
    text: body,
  });
};

export const sendBillingTrialEndingEmailBestEffort = async (
  to: string,
  trialEnd: Date,
): Promise<{ sent: boolean; attempts: number }> => {
  return sendWithRetry(() => sendBillingTrialEndingEmail(to, trialEnd), to);
};
