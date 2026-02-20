import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { getEnvValue } from '../src/env';

jest.mock('../src/env');
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: mockSendMail,
    })),
}));

const nodemailer = require('nodemailer');

describe('Mailer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nodemailer.createTransport.mockClear();
    mockSendMail.mockClear();
  });

  const getMockedEnv = () => {
    const envModule = jest.requireMock('../src/env') as typeof import('../src/env');
    return envModule.getEnvValue as jest.MockedFunction<typeof getEnvValue>;
  };

  describe('isEmailConfigured', () => {
    test('returns false if SMTP settings are not provided', () => {
      const mockedGetEnvValue = getMockedEnv();
      mockedGetEnvValue.mockReturnValue(undefined);
      let mailer: typeof import('../src/mailer');
      jest.isolateModules(() => {
        mailer = require('../src/mailer');
      });
      const { isEmailConfigured } = mailer!;
      expect(isEmailConfigured()).toBe(false);
    });

    test('returns true if SMTP settings are provided', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        const mockedGetEnvValue = getMockedEnv();
        mockedGetEnvValue.mockImplementation((key, _options) => {
            switch (key) {
                case 'SMTP_HOST': return 'smtp.example.com';
                case 'SMTP_PORT': return '587';
                case 'SMTP_FROM': return 'from@example.com';
                case 'SMTP_USER': return 'user';
                case 'SMTP_PASS': return 'pass';
                default: return undefined;
            }
        });
        let mailer: typeof import('../src/mailer');
        jest.isolateModules(() => {
          mailer = require('../src/mailer');
        });
        const { isEmailConfigured } = mailer!;
        expect(isEmailConfigured()).toBe(true);
        process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('sendShareEmail', () => {
    test('throws an error if email is not configured', async () => {
        const mockedGetEnvValue = getMockedEnv();
        mockedGetEnvValue.mockReturnValue(undefined);
        let mailer: typeof import('../src/mailer');
        jest.isolateModules(() => {
          mailer = require('../src/mailer');
        });
        const { sendShareEmail } = mailer!;
        await expect(sendShareEmail('to@example.com', 'subject', 'body')).rejects.toThrow(
            'Email is not configured; set SMTP_HOST, SMTP_PORT, and SMTP_FROM'
        );
    });

    test('calls sendMail with the correct arguments', async () => {
        const mockedGetEnvValue = getMockedEnv();
        mockedGetEnvValue.mockImplementation((key, _options) => {
            switch (key) {
                case 'SMTP_HOST': return 'smtp.example.com';
                case 'SMTP_PORT': return '587';
                case 'SMTP_FROM': return 'from@example.com';
                case 'SMTP_USER': return 'user';
                case 'SMTP_PASS': return 'pass';
                default: return undefined;
            }
        });

        let mailer: typeof import('../src/mailer');
        jest.isolateModules(() => {
          mailer = require('../src/mailer');
        });
        const { sendShareEmail } = mailer!;
        await sendShareEmail('to@example.com', 'Test Subject', 'Test Body');

        expect(nodemailer.createTransport).toHaveBeenCalled();
        expect(mockSendMail).toHaveBeenCalledWith({
            from: 'from@example.com',
            to: 'to@example.com',
            subject: 'Test Subject',
            text: 'Test Body',
        });
    });
  });
});
