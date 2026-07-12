/// <reference types="jest" />
/// <reference types="node" />

jest.mock('../src/db', () => ({
  getAdminSetting: jest.fn(),
  setAdminSetting: jest.fn(),
  writeAuditLog: jest.fn(),
  listApiCostCounters: jest.fn(),
}));

import { getAdminSetting, setAdminSetting, writeAuditLog, listApiCostCounters } from '../src/db';
import {
  computeNetRevenuePerPremiumUserUsd,
  computeBreakEvenPremiumUsers,
  computeProjectedMonthlyCost,
  getCostEstimatorConfig,
  updateCostEstimatorConfig,
  getActualMonthlySpend,
  type CostEstimatorConfig,
} from '../src/services/costEstimatorService';

const mockedGetAdminSetting = getAdminSetting as jest.MockedFunction<typeof getAdminSetting>;
const mockedSetAdminSetting = setAdminSetting as jest.MockedFunction<typeof setAdminSetting>;
const mockedWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockedListApiCostCounters = listApiCostCounters as jest.MockedFunction<typeof listApiCostCounters>;

describe('computeNetRevenuePerPremiumUserUsd', () => {
  it('nets out Stripe percent + fixed fees from the monthly price', () => {
    expect(computeNetRevenuePerPremiumUserUsd(5, 2.9, 0.3)).toBeCloseTo(4.555, 5);
  });

  it('clamps at 0 rather than going negative when fees exceed the price', () => {
    expect(computeNetRevenuePerPremiumUserUsd(0.2, 2.9, 0.3)).toBe(0);
  });
});

describe('computeBreakEvenPremiumUsers', () => {
  it('rounds up — a fractional break-even count still leaves the business short', () => {
    // This session's original hand-estimate said "~63" as a loose approximation of 63.44; the
    // precise ceiling is 64 (63 premium users at $4.555 net = $286.97, short of $289).
    expect(computeBreakEvenPremiumUsers(289, 4.555)).toBe(64);
  });

  it('returns 0 when there is no cost to cover', () => {
    expect(computeBreakEvenPremiumUsers(0, 4.555)).toBe(0);
  });

  it('returns null when net revenue per user is 0 (can never break even)', () => {
    expect(computeBreakEvenPremiumUsers(100, 0)).toBeNull();
  });
});

describe('computeProjectedMonthlyCost', () => {
  const baseAssumptions = {
    totalUsers: 10000,
    premiumConversionPercent: 3,
    freeGenerationsPerMonth: 2,
    premiumGenerationsPerMonth: 6,
    costPerGenerationUsd: 0.0021,
    premiumMonthlyPriceUsdOverride: null,
    stripeFeePercent: 2.9,
    stripeFeeFixedUsd: 0.3,
    providerCallsPerUserPerMonth: {},
  };

  it('reproduces the hand-verified LLM-only baseline (10,000 users, 3% premium -> $44.52/mo)', () => {
    const config: CostEstimatorConfig = {
      assumptions: baseAssumptions,
      hostingLineItems: [],
      requestPricing: {},
    };
    const result = computeProjectedMonthlyCost(config);
    expect(result.llmCostUsd).toBe(44.52);
    expect(result.requestApiCostUsd).toBe(0);
    expect(result.hostingCostUsd).toBe(0);
    expect(result.totalCostUsd).toBe(44.52);
  });

  it('sums hosting line items (Cloud Run + Database + Storage + Misc -> $150/mo)', () => {
    const config: CostEstimatorConfig = {
      assumptions: { ...baseAssumptions, totalUsers: 0 },
      hostingLineItems: [
        { id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 50 },
        { id: 'database', name: 'Database', monthlyCostUsd: 40 },
        { id: 'storage', name: 'Storage', monthlyCostUsd: 10 },
        { id: 'misc', name: 'Misc/Domain/Monitoring', monthlyCostUsd: 50 },
      ],
      requestPricing: {},
    };
    const result = computeProjectedMonthlyCost(config);
    expect(result.hostingCostUsd).toBe(150);
    expect(result.totalCostUsd).toBe(150);
  });

  it('combines LLM + per-request + hosting costs and computes break-even premium users', () => {
    const config: CostEstimatorConfig = {
      assumptions: {
        ...baseAssumptions,
        providerCallsPerUserPerMonth: { SERPAPI: 0.01 },
      },
      hostingLineItems: [{ id: 'hosting', name: 'All hosting', monthlyCostUsd: 150 }],
      requestPricing: { SERPAPI: 0.1 },
    };
    const result = computeProjectedMonthlyCost(config);

    // requestApiCostUsd = 10,000 users * 0.01 calls/user/mo * $0.10/call = $10
    expect(result.byProvider).toEqual([{ provider: 'SERPAPI', costUsd: 10 }]);
    expect(result.requestApiCostUsd).toBe(10);
    expect(result.llmCostUsd).toBe(44.52);
    expect(result.hostingCostUsd).toBe(150);
    expect(result.totalCostUsd).toBe(204.52);
    // premiumMonthlyPriceUsd defaults to Stripe's live $5 price (PLAN_DEFAULTS), net $4.555/user.
    expect(result.premiumMonthlyPriceUsd).toBe(5);
    // ceil(204.52 / 4.555) = 45
    expect(result.breakEvenPremiumUsers).toBe(45);
  });

  it('respects an explicit premiumMonthlyPriceUsdOverride instead of the live Stripe price', () => {
    const config: CostEstimatorConfig = {
      assumptions: { ...baseAssumptions, totalUsers: 0, premiumMonthlyPriceUsdOverride: 10 },
      hostingLineItems: [],
      requestPricing: {},
    };
    const result = computeProjectedMonthlyCost(config);
    expect(result.premiumMonthlyPriceUsd).toBe(10);
  });
});

describe('getCostEstimatorConfig / updateCostEstimatorConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAdminSetting.mockResolvedValue(null);
    mockedSetAdminSetting.mockResolvedValue({} as any);
    mockedWriteAuditLog.mockResolvedValue({} as any);
    mockedListApiCostCounters.mockResolvedValue([]);
  });

  it('falls back to documented defaults when no admin_settings rows exist yet', async () => {
    const config = await getCostEstimatorConfig();
    expect(config.assumptions.totalUsers).toBe(10000);
    expect(config.assumptions.premiumConversionPercent).toBe(3);
    expect(config.hostingLineItems).toEqual([]);
    // requestPricing is sourced from api-limits.yaml (Phase 1), not admin_settings.
    expect(config.requestPricing.SERPAPI).toBe(0);
  });

  it('round-trips an assumptions update through admin_settings and writes an audit log entry', async () => {
    let stored: string | null = null;
    mockedGetAdminSetting.mockImplementation(async (key: string) =>
      stored ? { key, value: stored, updatedBy: 'admin-1', updatedAt: new Date().toISOString() } : null
    );
    mockedSetAdminSetting.mockImplementation(async (setting: any) => {
      stored = setting.value;
      return { key: setting.key, value: setting.value, updatedBy: setting.updatedBy, updatedAt: new Date().toISOString() };
    });

    await updateCostEstimatorConfig({
      assumptions: { totalUsers: 50000, premiumConversionPercent: 5 },
      actorId: 'admin-1',
      reason: 'Re-forecasting after growth',
    });

    const config = await getCostEstimatorConfig();
    expect(config.assumptions.totalUsers).toBe(50000);
    expect(config.assumptions.premiumConversionPercent).toBe(5);
    // Untouched fields are preserved from the (merged) previous value, not reset to defaults.
    expect(config.assumptions.freeGenerationsPerMonth).toBe(2);

    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'admin-1', action: 'COST_ESTIMATOR_CONFIG_UPDATED', reason: 'Re-forecasting after growth' })
    );
  });

  it('round-trips a hosting line item update', async () => {
    let stored: string | null = null;
    mockedGetAdminSetting.mockImplementation(async (key: string) =>
      stored ? { key, value: stored, updatedBy: 'admin-1', updatedAt: new Date().toISOString() } : null
    );
    mockedSetAdminSetting.mockImplementation(async (setting: any) => {
      stored = setting.value;
      return { key: setting.key, value: setting.value, updatedBy: setting.updatedBy, updatedAt: new Date().toISOString() };
    });

    await updateCostEstimatorConfig({
      hostingLineItems: [{ id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 75 }],
      actorId: 'admin-1',
      reason: 'Real Cloud Run invoice',
    });

    const config = await getCostEstimatorConfig();
    expect(config.hostingLineItems).toEqual([{ id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 75 }]);
  });

  it('rejects an update with neither assumptions nor hostingLineItems', async () => {
    await expect(updateCostEstimatorConfig({ actorId: 'admin-1', reason: 'nothing to change' })).rejects.toThrow();
  });

  it('drops malformed hosting line items (missing name, negative cost) rather than storing them', async () => {
    let stored: string | null = null;
    mockedGetAdminSetting.mockImplementation(async (key: string) =>
      stored ? { key, value: stored, updatedBy: 'admin-1', updatedAt: new Date().toISOString() } : null
    );
    mockedSetAdminSetting.mockImplementation(async (setting: any) => {
      stored = setting.value;
      return { key: setting.key, value: setting.value, updatedBy: setting.updatedBy, updatedAt: new Date().toISOString() };
    });

    await updateCostEstimatorConfig({
      hostingLineItems: [
        { id: 'ok', name: 'Cloud Run', monthlyCostUsd: 50 },
        { id: 'bad-1', name: '', monthlyCostUsd: 10 },
        { id: 'bad-2', name: 'Negative', monthlyCostUsd: -5 },
      ] as any,
      actorId: 'admin-1',
      reason: 'test',
    });

    const config = await getCostEstimatorConfig();
    expect(config.hostingLineItems).toEqual([{ id: 'ok', name: 'Cloud Run', monthlyCostUsd: 50 }]);
  });
});

describe('getActualMonthlySpend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('groups full-history cost counters into the requested lookback window, newest first', async () => {
    mockedListApiCostCounters.mockResolvedValue([
      { provider: 'OPENAI', windowKey: '2026-07', amountMicros: 44_520_000 },
      { provider: 'SERPAPI', windowKey: '2026-07', amountMicros: 10_000_000 },
      { provider: 'OPENAI', windowKey: '2026-06', amountMicros: 30_000_000 },
      { provider: 'OPENAI', windowKey: '2025-01', amountMicros: 999_000_000 }, // outside lookback
    ]);

    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00Z'));
    const months = await getActualMonthlySpend(3);
    jest.useRealTimers();

    expect(months.length).toBe(3);
    expect(months[0].windowKey).toBe('2026-07');
    expect(months[0].byProvider).toEqual([
      { provider: 'OPENAI', spendUsd: 44.52 },
      { provider: 'SERPAPI', spendUsd: 10 },
    ]);
    expect(months[0].totalUsd).toBe(54.52);
    expect(months.some((m) => m.windowKey === '2025-01')).toBe(false);
  });

  it('includes months with zero recorded spend rather than skipping them', async () => {
    mockedListApiCostCounters.mockResolvedValue([]);
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00Z'));
    const months = await getActualMonthlySpend(2);
    jest.useRealTimers();
    expect(months).toEqual([
      { windowKey: '2026-07', byProvider: [], totalUsd: 0 },
      { windowKey: '2026-06', byProvider: [], totalUsd: 0 },
    ]);
  });
});
