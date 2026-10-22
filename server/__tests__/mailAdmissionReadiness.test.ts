import { assertMailAdmissionReady, mailAdmissionProblems } from '../src/ingestion/worker/mailReceiptWorker';

const KEYS = ['NODE_ENV', 'INGESTION_MAIL_RECEIPT_SCHEDULER_READY', 'INGESTION_ENCRYPTION_SECRET', 'INGESTION_VIRUS_SCAN_URL', 'INGESTION_VIRUS_SCAN_AUTH_TOKEN', 'INGESTION_VIRUS_SCAN_PROVIDER'] as const;

describe('forwarded mailbox readiness', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } });
  afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

  it('lists every missing setting at once, so one look at the log is enough', () => {
    process.env.NODE_ENV = 'production';
    const problems = mailAdmissionProblems();
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('INGESTION_MAIL_RECEIPT_SCHEDULER_READY'),
      expect.stringContaining('INGESTION_ENCRYPTION_SECRET'),
      expect.stringContaining('clamav_http'),
      expect.stringContaining('INGESTION_VIRUS_SCAN_URL'),
      expect.stringContaining('INGESTION_VIRUS_SCAN_AUTH_TOKEN'),
    ]));
  });

  it('still refuses to admit mail until every setting is present', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertMailAdmissionReady()).toThrow(/scheduler and encryption/);
    process.env.INGESTION_MAIL_RECEIPT_SCHEDULER_READY = '1';
    process.env.INGESTION_ENCRYPTION_SECRET = 'secret';
    expect(() => assertMailAdmissionReady()).toThrow(/clamav_http scanner/);
  });

  it('is never a problem in tests', () => {
    process.env.NODE_ENV = 'test';
    expect(mailAdmissionProblems()).toEqual([]);
  });
});
