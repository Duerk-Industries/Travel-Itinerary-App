import type { SendMailOptions, Transporter } from 'nodemailer';
import { sendSmtpMail } from './smtpApi';

const SMTP_CALLER_SHARE_EMAIL = 'SHARE_EMAIL';
const SMTP_CALLER_VERIFICATION_EMAIL = 'VERIFICATION_EMAIL';
const SMTP_CALLER_TRIP_INVITE_EMAIL = 'TRIP_INVITE_EMAIL';

export const sendShareEmailViaSmtpApi = async (
  transporter: Transporter,
  message: SendMailOptions
): Promise<void> => {
  await sendSmtpMail({
    caller: SMTP_CALLER_SHARE_EMAIL,
    transporter,
    message,
  });
};

export const sendVerificationEmailViaSmtpApi = async (
  transporter: Transporter,
  message: SendMailOptions
): Promise<void> => {
  await sendSmtpMail({
    caller: SMTP_CALLER_VERIFICATION_EMAIL,
    transporter,
    message,
  });
};

export const sendTripInviteEmailViaSmtpApi = async (
  transporter: Transporter,
  message: SendMailOptions
): Promise<void> => {
  await sendSmtpMail({
    caller: SMTP_CALLER_TRIP_INVITE_EMAIL,
    transporter,
    message,
  });
};

