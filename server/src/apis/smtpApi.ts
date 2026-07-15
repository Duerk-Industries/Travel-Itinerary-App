import type { SendMailOptions, Transporter } from 'nodemailer';
import { reserveApiUsageOrThrow } from './usageLimiter';
import { recordProviderRequestCost } from './providerBudgeting';

export const sendSmtpMail = async (params: {
  caller: string;
  transporter: Transporter;
  message: SendMailOptions;
}): Promise<void> => {
  await reserveApiUsageOrThrow({ provider: 'SMTP', caller: params.caller });
  await recordProviderRequestCost({ provider: 'SMTP' });
  await params.transporter.sendMail(params.message);
};

