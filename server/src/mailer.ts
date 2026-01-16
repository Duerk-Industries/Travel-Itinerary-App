import nodemailer from 'nodemailer';
import { getEnvValue } from './env';

const SMTP_HOST = getEnvValue('SMTP_HOST');
const SMTP_PORT = getEnvValue('SMTP_PORT');
const SMTP_USER = getEnvValue('SMTP_USER');
const SMTP_PASS = getEnvValue('SMTP_PASS');
const SMTP_FROM = getEnvValue('SMTP_FROM');

const hasConfig = Boolean(SMTP_HOST && SMTP_PORT && SMTP_FROM);

const transporter = hasConfig
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

export const isEmailConfigured = (): boolean => Boolean(transporter);

export const sendShareEmail = async (to: string, subject: string, body: string): Promise<void> => {
  if (!transporter) {
    throw new Error('Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM');
  }

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text: body,
  });
};
