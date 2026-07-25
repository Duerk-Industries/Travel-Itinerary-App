/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

jest.mock('../../src/db', () => ({
  findUserByEmail: jest.fn(),
  isInternalCanaryAccount: jest.fn(),
}));
jest.mock('../../src/env', () => ({ getEnvValue: jest.fn() }));
jest.mock('../../src/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

import { assertCanarySideEffectAllowed, isCanaryRecipientEmail, isCanaryUserId, isInternalCanaryUser } from '../../src/middleware/canarySafeMode';
import { findUserByEmail, isInternalCanaryAccount } from '../../src/db';
import { getEnvValue } from '../../src/env';

const mockedFindUserByEmail = findUserByEmail as jest.MockedFunction<typeof findUserByEmail>;
const mockedIsInternalCanaryAccount = isInternalCanaryAccount as jest.MockedFunction<typeof isInternalCanaryAccount>;
const mockedGetEnvValue = getEnvValue as jest.MockedFunction<typeof getEnvValue>;

describe('canary safe mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects internal canary users using either persisted field shape', () => {
    expect(isInternalCanaryUser({ is_internal_canary: true })).toBe(true);
    expect(isInternalCanaryUser({ isInternalCanary: true })).toBe(true);
    expect(isInternalCanaryUser({ is_internal_canary: false })).toBe(false);
  });

  it('blocks side effects for internal canary accounts', () => {
    expect(() => assertCanarySideEffectAllowed({ is_internal_canary: true }, 'stripe_charge'))
      .toThrow(/Canary safe mode blocked side effect/);
    expect(() => assertCanarySideEffectAllowed({ is_internal_canary: false }, 'stripe_charge'))
      .not.toThrow();
  });

  it('isCanaryRecipientEmail skips the DB entirely when no canary account is configured (the common case for most environments)', async () => {
    mockedGetEnvValue.mockReturnValue(undefined);
    await expect(isCanaryRecipientEmail('anyone@user.com', 'sendTripInviteEmail')).resolves.toBe(false);
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });

  it('isCanaryRecipientEmail resolves the recipient by email and reports true only for the configured canary account', async () => {
    mockedGetEnvValue.mockReturnValue('canary@internal.wander-bunnies.com');

    mockedFindUserByEmail.mockResolvedValueOnce({ id: 'canary-1', email: 'canary@internal.wander-bunnies.com', provider: 'email', role: 'user', is_internal_canary: true } as any);
    await expect(isCanaryRecipientEmail('canary@internal.wander-bunnies.com', 'sendTripInviteEmail')).resolves.toBe(true);

    // Not the configured canary address -- must not even hit the DB.
    mockedFindUserByEmail.mockClear();
    await expect(isCanaryRecipientEmail('real@user.com', 'sendTripInviteEmail')).resolves.toBe(false);
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });

  it('isCanaryUserId skips the DB entirely when no canary account is configured', async () => {
    mockedGetEnvValue.mockReturnValue(undefined);
    await expect(isCanaryUserId('any-user', 'createCheckoutSession')).resolves.toBe(false);
    expect(mockedIsInternalCanaryAccount).not.toHaveBeenCalled();
  });

  it('isCanaryUserId defers to the DB-backed canary flag by userId once a canary account is configured', async () => {
    mockedGetEnvValue.mockReturnValue('canary@internal.wander-bunnies.com');

    mockedIsInternalCanaryAccount.mockResolvedValueOnce(true);
    await expect(isCanaryUserId('canary-1', 'createCheckoutSession')).resolves.toBe(true);

    mockedIsInternalCanaryAccount.mockResolvedValueOnce(false);
    await expect(isCanaryUserId('user-1', 'createCheckoutSession')).resolves.toBe(false);
  });

  it('is wired into the request pipeline and into the real email/billing side-effect boundaries (regression test for previously-dead-code middleware)', () => {
    const root = path.resolve(__dirname, '../../..');
    const appSource = fs.readFileSync(path.join(root, 'server/src/app.ts'), 'utf8');
    expect(appSource).toMatch(/app\.use\(canarySafeMode\)/);

    const mailerSource = fs.readFileSync(path.join(root, 'server/src/mailer.ts'), 'utf8');
    expect(mailerSource).toContain('isCanaryRecipientEmail');

    const billingSource = fs.readFileSync(path.join(root, 'server/src/billing/billingService.ts'), 'utf8');
    expect(billingSource).toContain('isCanaryUserId');
  });
});
