import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import nodemailer from 'nodemailer';
import { getEnvValue } from '../src/env';
import { isEmailConfigured, sendShareEmail } from '../src/mailer';

jest.mock('nodemailer');
jest.mock('../src/env');

const mockedNodemailer = nodemailer as jest.Mocked<typeof nodemailer>;
const mockedGetEnvValue = getEnvValue as jest.Mock<typeof getEnvValue>;

describe('Mailer', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('isEmailConfigured', () => {
    test('returns false if SMTP settings are not provided', () => {
      mockedGetEnvValue.mockReturnValue(undefined);
      const mailer = require('../src/mailer');
      expect(mailer.isEmailConfigured()).toBe(false);
    });

    test('returns true if SMTP settings are provided', () => {
      mockedGetEnvValue.mockImplementation((key) => {
        if (key === 'SMTP_HOST') return 'smtp.example.com';
        if (key === 'SMTP_PORT') return '587';
        if (key === 'SMTP_FROM') return 'from@example.com';
        return undefined;
      });
      const mailer = require('../src/mailer');
      expect(mailer.isEmailConfigured()).toBe(true);
    });
  });

  describe('sendShareEmail', () => {
    test('throws an error if email is not configured', async () => {
        mockedGetEnvValue.mockReturnValue(undefined);
        const { sendShareEmail } = require('../src/mailer');
        await expect(sendShareEmail('to@example.com', 'subject', 'body')).rejects.toThrow(
            'Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM'
        );
    });

    test('calls sendMail with the correct arguments', async () => {
      const sendMailMock = jest.fn();
      mockedNodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock } as any);

      mockedGetEnvValue.mockImplementation((key) => {
        if (key === 'SMTP_HOST') return 'smtp.example.com';
        if (key === 'SMTP_PORT') return '587';
        if (key === 'SMTP_FROM') return 'from@example.com';
        if (key === 'SMTP_USER') return 'user';
        if (key === 'SMTP_PASS') return 'pass';
        return undefined;
      });

      const { sendShareEmail } = require('../src/mailer');

      await sendShareEmail('to@example.com', 'Test Subject', 'Test Body');

      expect(sendMailMock).toHaveBeenCalledWith({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Test Subject',
        text: 'Test Body',
      });
    });
  });
});
