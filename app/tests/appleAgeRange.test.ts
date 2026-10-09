/// <reference types="jest" />
import { isAppleAgeRangeSupported, requestAppleAgeConfirmation, type AppleAgeRangeEnv } from '../utils/appleAgeRange';
import { verifyAgeWithAppleIfAvailable } from '../components/AgeVerificationDialog';

const makeEnv = (overrides: Partial<AppleAgeRangeEnv> = {}, response: unknown = { lowerBound: 16 }) => {
  const requestAgeRangeAsync = jest.fn().mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const env: AppleAgeRangeEnv = {
    platformOS: 'ios',
    platformVersion: '26.0',
    enabled: true,
    loadModule: () => ({ requestAgeRangeAsync }),
    ...overrides,
  };
  return { env, requestAgeRangeAsync };
};

const codedError = (code: string) => Object.assign(new Error(code), { code });

describe('appleAgeRange', () => {
  it.each([
    ['web', { platformOS: 'web' }],
    ['Android', { platformOS: 'android', platformVersion: 35 }],
    ['iOS 18 (expo-age-range would report an adult)', { platformVersion: '18.5' }],
    ['iOS 26 build without the entitlement flag', { enabled: false }],
  ])('never calls Apple on %s', async (_label, overrides) => {
    const { env, requestAgeRangeAsync } = makeEnv(overrides as Partial<AppleAgeRangeEnv>, { lowerBound: 18 });
    expect(await requestAppleAgeConfirmation(16, env)).toEqual({ confirmed: false, reason: 'unsupported' });
    expect(requestAgeRangeAsync).not.toHaveBeenCalled();
  });

  it('treats iOS 26.x and later as supported', () => {
    expect(isAppleAgeRangeSupported(makeEnv({ platformVersion: '26.2' }).env)).toBe(true);
    expect(isAppleAgeRangeSupported(makeEnv({ platformVersion: '27.0' }).env)).toBe(true);
  });

  it('confirms when Apple reports a lower bound at the minimum age, using one age gate', async () => {
    const { env, requestAgeRangeAsync } = makeEnv({}, { lowerBound: 16, upperBound: null });
    expect(await requestAppleAgeConfirmation(16, env)).toEqual({ confirmed: true, lowerBound: 16 });
    expect(requestAgeRangeAsync).toHaveBeenCalledWith({ threshold1: 16 });
  });

  it.each([
    ['below the gate (no lower bound)', { lowerBound: null, upperBound: 15 }],
    ['an explicit lower bound under the minimum', { lowerBound: 13 }],
    ['an empty response', {}],
  ])('falls back when Apple reports %s', async (_label, response) => {
    const { env } = makeEnv({}, response);
    expect(await requestAppleAgeConfirmation(16, env)).toEqual({ confirmed: false, reason: 'below_minimum' });
  });

  it('falls back when the user declines to share', async () => {
    const { env } = makeEnv({}, codedError('ERR_AGE_RANGE_USER_DECLINED'));
    expect(await requestAppleAgeConfirmation(16, env)).toEqual({ confirmed: false, reason: 'declined' });
  });

  it('falls back when Apple is unavailable or the module is missing', async () => {
    expect(await requestAppleAgeConfirmation(16, makeEnv({}, codedError('ERR_AGE_RANGE_NOT_AVAILABLE')).env)).toEqual({
      confirmed: false,
      reason: 'error',
    });
    expect(await requestAppleAgeConfirmation(16, makeEnv({ loadModule: () => null }).env)).toEqual({
      confirmed: false,
      reason: 'unsupported',
    });
  });
});

describe('verifyAgeWithAppleIfAvailable', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('records "16+ via Apple" on the server and skips the prompt', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const confirm = jest.fn().mockResolvedValue({ confirmed: true, lowerBound: 18 });
    expect(await verifyAgeWithAppleIfAvailable('http://api.test', 'token-1', 16, confirm)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/account/age-verification/apple');
    expect(JSON.parse(init.body)).toEqual({ lowerBound: 18 });
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  it('does not contact the server when Apple does not confirm', async () => {
    const confirm = jest.fn().mockResolvedValue({ confirmed: false, reason: 'declined' });
    expect(await verifyAgeWithAppleIfAvailable('http://api.test', 'token-1', 16, confirm)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the prompt when the server rejects or is unreachable', async () => {
    const confirm = jest.fn().mockResolvedValue({ confirmed: true, lowerBound: 16 });
    fetchMock.mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error('offline'));
    expect(await verifyAgeWithAppleIfAvailable('http://api.test', 'token-1', 16, confirm)).toBe(false);
    expect(await verifyAgeWithAppleIfAvailable('http://api.test', 'token-1', 16, confirm)).toBe(false);
  });
});
