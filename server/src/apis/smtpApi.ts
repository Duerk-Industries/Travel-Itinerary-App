import type { SendMailOptions, Transporter } from 'nodemailer';
import { reserveApiUsageOrThrow } from './usageLimiter';

export const sendSmtpMail = async (params: {
  caller: string;
  transporter: Transporter;
  message: SendMailOptions;
}): Promise<void> => {
  reserveApiUsageOrThrow({ provider: 'SMTP', caller: params.caller });
  await params.transporter.sendMail(params.message);
};

