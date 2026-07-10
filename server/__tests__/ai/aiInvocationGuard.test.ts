/// <reference types="jest" />
/// <reference types="node" />

import type { AiCallContext } from '../../src/ai/types/aiChat';
import { EntitlementError } from '../../src/errors';
import {
  failGenerationUsage,
  reserveGenerationUsage,
} from '../../src/services/entitlementService';
import { reserveApiUsageOrThrow } from '../../src/apis/usageLimiter';
import { authorizeAiCall } from '../../src/services/aiInvocationGuard';

jest.mock('../../src/services/entitlementService', () => ({
  reserveGenerationUsage: jest.fn(),
  finalizeGenerationUsage: jest.fn(),
  failGenerationUsage: jest.fn(),
}));

jest.mock('../../src/apis/usageLimiter', () => ({
  reserveApiUsageOrThrow: jest.fn(),
}));

const mockedReserveGenerationUsage = reserveGenerationUsage as jest.MockedFunction<typeof reserveGenerationUsage>;
const mockedFailGenerationUsage = failGenerationUsage as jest.MockedFunction<typeof failGenerationUsage>;
const mockedReserveApiUsageOrThrow = reserveApiUsageOrThrow as jest.MockedFunction<typeof reserveApiUsageOrThrow>;

const buildContext = (): AiCallContext & {
  generationUsage: {
    tripId: string;
    windowKey: string;
    idempotencyKey: string;
    role: 'user';
  };
} => ({
  correlationId: 'corr-1',
  requestId: 'req-1',
  jobId: 'job-1',
  featureKey: 'itinerary_generation',
  userId: 'user-1',
  anonymousUserId: 'anon-1',
  tier: 'free',
  role: 'user',
  provider: 'openai',
  model: 'gpt-4o-mini',
  callerId: 'ITINERARY_PLAN_P0_NORM',
  generationUsage: {
    tripId: 'trip-1',
    windowKey: '2026-07',
    idempotencyKey: 'idem-1',
    role: 'user',
  },
});

describe('aiInvocationGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns both reservations when tier and provider reservations succeed', async () => {
    mockedReserveGenerationUsage.mockResolvedValueOnce({ status: 'reserved', key: 'idem-1' });
    mockedReserveApiUsageOrThrow.mockResolvedValueOnce(undefined);

    const result = await authorizeAiCall(buildContext());

    expect(result).toEqual({
      generationReservation: { status: 'reserved', key: 'idem-1' },
      providerReserved: true,
    });
    expect(mockedReserveGenerationUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      tripId: 'trip-1',
      role: 'user',
      windowKey: '2026-07',
      idempotencyKey: 'idem-1',
    });
    expect(mockedReserveApiUsageOrThrow).toHaveBeenCalledWith({
      provider: 'OPENAI',
      caller: 'ITINERARY_PLAN_P0_NORM',
    });
  });

  it('does not reserve provider usage when tier reservation rejects', async () => {
    const err = new EntitlementError('TIER_LIMIT_REACHED', 'tier exhausted');
    mockedReserveGenerationUsage.mockRejectedValueOnce(err);

    await expect(authorizeAiCall(buildContext())).rejects.toBe(err);

    expect(mockedReserveApiUsageOrThrow).not.toHaveBeenCalled();
    expect(mockedFailGenerationUsage).not.toHaveBeenCalled();
  });

  it('fails the tier reservation when provider reservation rejects after tier succeeds', async () => {
    const providerErr = new Error('provider exhausted');
    mockedReserveGenerationUsage.mockResolvedValueOnce({ status: 'reserved', key: 'idem-1' });
    mockedReserveApiUsageOrThrow.mockRejectedValueOnce(providerErr);

    await expect(authorizeAiCall(buildContext())).rejects.toBe(providerErr);

    expect(mockedFailGenerationUsage).toHaveBeenCalledTimes(1);
    expect(mockedFailGenerationUsage).toHaveBeenCalledWith('idem-1', 'provider exhausted');
  });
});
