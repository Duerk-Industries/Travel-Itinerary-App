import { clamavHttpAdapter, stubAdapter, getVirusScanner } from '../src/ingestion/virusScanProviders';

const ORIG_FETCH = global.fetch;
const ORIG_ENV = { ...process.env };

afterEach(() => {
  (global as any).fetch = ORIG_FETCH;
  process.env = { ...ORIG_ENV };
});

describe('getVirusScanner (provider selection)', () => {
  it('returns stubAdapter by default', () => {
    delete process.env.INGESTION_VIRUS_SCAN_PROVIDER;
    expect(getVirusScanner().name).toBe('stub');
  });

  it('returns clamavHttpAdapter when INGESTION_VIRUS_SCAN_PROVIDER=clamav_http', () => {
    process.env.INGESTION_VIRUS_SCAN_PROVIDER = 'clamav_http';
    expect(getVirusScanner().name).toBe('clamav_http');
  });

  it('falls back to the stub on an unknown provider value (no silent scan disable)', () => {
    process.env.INGESTION_VIRUS_SCAN_PROVIDER = 'not-a-real-provider';
    expect(getVirusScanner().name).toBe('stub');
  });
});

describe('stubAdapter.scanBatch', () => {
  it('returns SKIPPED in a test environment', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const result = await stubAdapter.scanBatch();
    expect(result.status).toBe('SKIPPED');
    expect(result.provider).toBe('stub');
    process.env.NODE_ENV = prev;
  });
});

describe('clamavHttpAdapter.scanBuffer', () => {
  const buf = Buffer.from('file-bytes');

  it('fails closed when INGESTION_VIRUS_SCAN_URL is not configured', async () => {
    delete process.env.INGESTION_VIRUS_SCAN_URL;
    const result = await clamavHttpAdapter.scanBuffer!(buf, 'boarding.pdf');
    expect(result.status).toBe('FAILED');
    expect(result.provider).toBe('clamav_http_unconfigured');
  });

  it('maps HTTP 200 to PASSED', async () => {
    process.env.INGESTION_VIRUS_SCAN_URL = 'http://clamav.test/scan';
    (global as any).fetch = jest.fn(async () => ({ status: 200, text: async () => 'CLEAN' } as any));
    const result = await clamavHttpAdapter.scanBuffer!(buf, 'clean.pdf');
    expect(result.status).toBe('PASSED');
    expect(result.provider).toBe('clamav_http');
  });

  it('maps HTTP 406 (ClamAV INFECTED convention) to FAILED', async () => {
    process.env.INGESTION_VIRUS_SCAN_URL = 'http://clamav.test/scan';
    (global as any).fetch = jest.fn(async () => ({
      status: 406,
      text: async () => 'Detected: Eicar-Signature-Test',
    } as any));
    const result = await clamavHttpAdapter.scanBuffer!(buf, 'eicar.pdf');
    expect(result.status).toBe('FAILED');
    expect(result.provider).toBe('clamav_http');
  });

  it('maps other HTTP statuses to FAILED with provider=clamav_http_error', async () => {
    process.env.INGESTION_VIRUS_SCAN_URL = 'http://clamav.test/scan';
    (global as any).fetch = jest.fn(async () => ({ status: 503, text: async () => '' } as any));
    const result = await clamavHttpAdapter.scanBuffer!(buf, 'timeout.pdf');
    expect(result.status).toBe('FAILED');
    expect(result.provider).toBe('clamav_http_error');
  });

  it('maps transport errors (thrown fetch) to FAILED with provider=clamav_http_error', async () => {
    process.env.INGESTION_VIRUS_SCAN_URL = 'http://clamav.test/scan';
    (global as any).fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await clamavHttpAdapter.scanBuffer!(buf, 'conn-refused.pdf');
    expect(result.status).toBe('FAILED');
    expect(result.provider).toBe('clamav_http_error');
  });

  it('POSTs the buffer under the FILES field with the given filename', async () => {
    process.env.INGESTION_VIRUS_SCAN_URL = 'http://clamav.test/scan';
    const fetchMock = jest.fn(async () => ({ status: 200, text: async () => '' } as any));
    (global as any).fetch = fetchMock;

    await clamavHttpAdapter.scanBuffer!(buf, 'boarding.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://clamav.test/scan');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });
});
