import nodemailer from 'nodemailer';
import { getEnvValue } from './env';

const buildTransporter = () => {
  const SMTP_HOST = getEnvValue('SMTP_HOST');
  const SMTP_PORT = getEnvValue('SMTP_PORT');
  const SMTP_USER = getEnvValue('SMTP_USER');
  const SMTP_PASS = getEnvValue('SMTP_PASS');
  const SMTP_FROM = getEnvValue('SMTP_FROM');

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_FROM) {
    return { transporter: null, from: SMTP_FROM ?? undefined };
  }

  return {
    transporter: nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    }),
    from: SMTP_FROM,
  };
};

export const isEmailConfigured = (): boolean => Boolean(buildTransporter().transporter);

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
