/// <reference types="jest" />
import { fetchAccountProfile } from '../tabs/account';

const response = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  clone() { return this; },
  json: async () => body,
});

describe('fetchAccountProfile and the date-of-birth gate', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => { (global as any).fetch = originalFetch; });

  const run = async (status: number, body: unknown) => {
    (global as any).fetch = jest.fn(async () => response(status, body));
    const logout = jest.fn();
    const result = await fetchAccountProfile({
      backendUrl: 'http://api', token: 'tok', logout,
      setAccountProfile: jest.fn(), setUserName: jest.fn(), setUserEmail: jest.fn(),
    } as any);
    return { result, logout };
  };

  it('keeps the session when the only problem is a missing date of birth', async () => {
    const { result, logout } = await run(403, { error: 'Date of birth required before accessing this endpoint.', code: 'AGE_VERIFICATION_REQUIRED' });
    expect(logout).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, ageVerificationRequired: true });
  });

  it('still signs out on other 403s and on 401', async () => {
    expect((await run(403, { error: 'Password setup required before accessing this endpoint.' })).logout).toHaveBeenCalled();
    expect((await run(401, { error: 'Invalid token' })).logout).toHaveBeenCalled();
  });
});
