import { getAdminSetting, setAdminSetting, writeAuditLog, listApiCostCounters } from '../db';
import { getApiLimitsConfig, normalizeApiLimitKeyPart, updateApiRequestPricingConfig } from '../config/apiLimits';
import { PLAN_DEFAULTS } from '../config/stripeBilling';

// Phase 2 of cost-estimator-admin-panel-plan.md. Request-per-provider pricing is intentionally NOT
// stored in admin_settings — it lives directly in api-limits.yaml (see providerBudgeting.ts's
// recordProviderRequestCost / apiLimits.ts's getApiRequestPricingUsd from Phase 1), the same
// mechanism the 4 LLM providers' token pricing already uses. Reads go through getCostEstimatorConfig()
// below; writes go through updateCostEstimatorRequestPricing (Phase 3), which delegates to
// apiLimits.ts's own YAML writer rather than duplicating storage here.

export type CostEstimatorAssumptions = {
  totalUsers: number;
  premiumConversionPercent: number;
  freeGenerationsPerMonth: number;
  premiumGenerationsPerMonth: number;
  costPerGenerationUsd: number;
  premiumMonthlyPriceUsdOverride: number | null;
  stripeFeePercent: number;
  stripeFeeFixedUsd: number;
  providerCallsPerUserPerMonth: Record<string, number>;
};

export type HostingLineItem = {
  id: string;
  name: string;
  monthlyCostUsd: number;
};

export type CostEstimatorConfig = {
  assumptions: CostEstimatorAssumptions;
  hostingLineItems: HostingLineItem[];
  requestPricing: Record<string, number>;
};

export type ProjectedCostBreakdown = {
  llmCostUsd: number;
  requestApiCostUsd: number;
  hostingCostUsd: number;
  totalCostUsd: number;
  premiumMonthlyPriceUsd: number;
  netRevenuePerPremiumUserUsd: number;
  // null when net revenue per premium user is <= 0 (e.g. price fully consumed by fees) — there is
  // no finite number of premium users that would break even in that case.
  breakEvenPremiumUsers: number | null;
  byProvider: Array<{ provider: string; costUsd: number }>;
};

export type MonthlyProviderSpend = {
  windowKey: string;
  byProvider: Array<{ provider: string; spendUsd: number }>;
  totalUsd: number;
};

const ASSUMPTIONS_SETTING_KEY = 'cost_estimator_assumptions';
const HOSTING_LINE_ITEMS_SETTING_KEY = 'cost_estimator_hosting_line_items';

/** Complete allowlist of non-token providers whose request pricing is admin-editable. */
export const REQUEST_PRICED_PROVIDER_KEYS = [
  'SERPAPI', 'WIKIMEDIA', 'GOOGLE_ROUTES', 'UNSPLASH', 'SMTP',
  'COUNTRY_NOW', 'GEONAMES', 'AIRPORT_DATASET', 'FRANKFURTER', 'OPEN_METEO',
] as const;

// Defaults reproduce this project's own hand-verified reference estimate (10,000 users, 3% premium,
// ~7-day/2-destination trip, gpt-4o-mini pricing) so a fresh install shows a sane starting point
// rather than all-zero. See computeProjectedMonthlyCost's test fixtures for the derivation.
const DEFAULT_ASSUMPTIONS: CostEstimatorAssumptions = {
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

const DEFAULT_HOSTING_LINE_ITEMS: HostingLineItem[] = [];

type StoredJson<T> = { schemaVersion: 1; value: T; updatedAt: string; updatedBy: string | null };

const readStoredJson = async <T>(key: string, fallback: T): Promise<T> => {
  const row = await getAdminSetting(key);
  if (!row?.value) return fallback;
  try {
    const parsed = JSON.parse(row.value) as StoredJson<T>;
    return parsed?.schemaVersion === 1 && parsed.value !== undefined ? parsed.value : fallback;
  } catch {
    return fallback;
  }
};

const writeStoredJson = async <T>(key: string, value: T, actorId: string): Promise<void> => {
  const payload: StoredJson<T> = {
    schemaVersion: 1,
    value,
    updatedAt: new Date().toISOString(),
    updatedBy: actorId,
  };
  await setAdminSetting({ key, value: JSON.stringify(payload), updatedBy: actorId });
};

const sanitizeAssumptions = (raw: Partial<CostEstimatorAssumptions> | undefined): CostEstimatorAssumptions => {
  const base = DEFAULT_ASSUMPTIONS;
  const nonNegative = (value: unknown, fallback: number): number =>
    Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  return {
    totalUsers: nonNegative(raw?.totalUsers, base.totalUsers),
    premiumConversionPercent: nonNegative(raw?.premiumConversionPercent, base.premiumConversionPercent),
    freeGenerationsPerMonth: nonNegative(raw?.freeGenerationsPerMonth, base.freeGenerationsPerMonth),
    premiumGenerationsPerMonth: nonNegative(raw?.premiumGenerationsPerMonth, base.premiumGenerationsPerMonth),
    costPerGenerationUsd: nonNegative(raw?.costPerGenerationUsd, base.costPerGenerationUsd),
    premiumMonthlyPriceUsdOverride:
      raw?.premiumMonthlyPriceUsdOverride == null ? null : nonNegative(raw.premiumMonthlyPriceUsdOverride, 0),
    stripeFeePercent: nonNegative(raw?.stripeFeePercent, base.stripeFeePercent),
    stripeFeeFixedUsd: nonNegative(raw?.stripeFeeFixedUsd, base.stripeFeeFixedUsd),
    providerCallsPerUserPerMonth:
      raw?.providerCallsPerUserPerMonth && typeof raw.providerCallsPerUserPerMonth === 'object'
        ? Object.fromEntries(
            Object.entries(raw.providerCallsPerUserPerMonth)
              .map(([provider, value]) => [normalizeApiLimitKeyPart(provider), nonNegative(value, 0)])
              .filter(([, value]) => (value as number) > 0)
          )
        : {},
  };
};

const sanitizeHostingLineItems = (raw: HostingLineItem[] | undefined): HostingLineItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      id: String(item?.id ?? '').trim(),
      name: String(item?.name ?? '').trim(),
      monthlyCostUsd: Number(item?.monthlyCostUsd),
    }))
    .filter((item) => item.id && item.name && Number.isFinite(item.monthlyCostUsd) && item.monthlyCostUsd >= 0);
};

export const getCostEstimatorConfig = async (): Promise<CostEstimatorConfig> => {
  const [storedAssumptions, storedHostingLineItems] = await Promise.all([
    readStoredJson<CostEstimatorAssumptions>(ASSUMPTIONS_SETTING_KEY, DEFAULT_ASSUMPTIONS),
    readStoredJson<HostingLineItem[]>(HOSTING_LINE_ITEMS_SETTING_KEY, DEFAULT_HOSTING_LINE_ITEMS),
  ]);
  return {
    assumptions: sanitizeAssumptions(storedAssumptions),
    hostingLineItems: sanitizeHostingLineItems(storedHostingLineItems),
    requestPricing: getApiLimitsConfig().requestPricing,
  };
};

export const updateCostEstimatorConfig = async (params: {
  assumptions?: Partial<CostEstimatorAssumptions>;
  hostingLineItems?: HostingLineItem[];
  actorId: string;
  reason: string;
}): Promise<CostEstimatorConfig> => {
  if (!params.assumptions && !params.hostingLineItems) {
    throw new Error('At least one of assumptions or hostingLineItems is required');
  }

  if (params.assumptions) {
    const current = await readStoredJson<CostEstimatorAssumptions>(ASSUMPTIONS_SETTING_KEY, DEFAULT_ASSUMPTIONS);
    const next = sanitizeAssumptions({ ...current, ...params.assumptions });
    await writeStoredJson(ASSUMPTIONS_SETTING_KEY, next, params.actorId);
  }
  if (params.hostingLineItems) {
    const next = sanitizeHostingLineItems(params.hostingLineItems);
    await writeStoredJson(HOSTING_LINE_ITEMS_SETTING_KEY, next, params.actorId);
  }

  await writeAuditLog({
    actorUserId: params.actorId,
    action: 'COST_ESTIMATOR_CONFIG_UPDATED',
    reason: params.reason,
    afterState: {
      key: params.assumptions ? ASSUMPTIONS_SETTING_KEY : HOSTING_LINE_ITEMS_SETTING_KEY,
      assumptions: params.assumptions ?? undefined,
      hostingLineItems: params.hostingLineItems ?? undefined,
    },
  });

  return getCostEstimatorConfig();
};

// Writes to api-limits.yaml (via apiLimits.ts's own writer), not admin_settings — see the module
// comment above. Kept as its own function rather than folded into updateCostEstimatorConfig because
// its storage/validation shape is genuinely different (known-provider-keyed non-negative numbers in a
// YAML file, not an arbitrary JSON blob in admin_settings).
export const updateCostEstimatorRequestPricing = async (params: {
  requestPricing: Record<string, number>;
  actorId: string;
  reason: string;
}): Promise<CostEstimatorConfig> => {
  const before = getApiLimitsConfig().requestPricing;
  const sanitized = Object.fromEntries(
    Object.entries(params.requestPricing)
      .map(([provider, value]) => [normalizeApiLimitKeyPart(provider), Number(value)])
      .filter(([, value]) => Number.isFinite(value) && (value as number) >= 0)
  );
  updateApiRequestPricingConfig(sanitized);
  await writeAuditLog({
    actorUserId: params.actorId,
    action: 'COST_ESTIMATOR_CONFIG_UPDATED',
    reason: params.reason,
    beforeState: { key: 'requestPricing', requestPricing: before },
    afterState: { key: 'requestPricing', requestPricing: sanitized },
  });
  return getCostEstimatorConfig();
};

const roundCents = (value: number): number => Math.round(value * 100) / 100;

// Net of standard Stripe per-transaction fees (percent + fixed). Clamped at 0 — a price that's
// fully consumed (or exceeded) by fees nets nothing, not a negative number.
export const computeNetRevenuePerPremiumUserUsd = (
  premiumMonthlyPriceUsd: number,
  stripeFeePercent: number,
  stripeFeeFixedUsd: number
): number => Math.max(0, premiumMonthlyPriceUsd - (premiumMonthlyPriceUsd * stripeFeePercent) / 100 - stripeFeeFixedUsd);

// Rounds UP: a fractional break-even count (e.g. 63.4 users) means 63 premium users would still
// leave the business short — you need the 64th. Returns null when net revenue per user is 0 (no
// finite number of premium users could ever cover costs).
export const computeBreakEvenPremiumUsers = (
  totalMonthlyCostUsd: number,
  netRevenuePerPremiumUserUsd: number
): number | null => {
  if (netRevenuePerPremiumUserUsd <= 0) return null;
  if (totalMonthlyCostUsd <= 0) return 0;
  return Math.ceil(totalMonthlyCostUsd / netRevenuePerPremiumUserUsd);
};

export const computeProjectedMonthlyCost = (config: CostEstimatorConfig): ProjectedCostBreakdown => {
  const { assumptions, hostingLineItems, requestPricing } = config;

  const premiumShare = Math.min(1, Math.max(0, assumptions.premiumConversionPercent / 100));
  const premiumUsers = assumptions.totalUsers * premiumShare;
  const freeUsers = assumptions.totalUsers - premiumUsers;
  const totalGenerations = freeUsers * assumptions.freeGenerationsPerMonth + premiumUsers * assumptions.premiumGenerationsPerMonth;
  const llmCostUsd = totalGenerations * assumptions.costPerGenerationUsd;

  const byProvider = Object.entries(assumptions.providerCallsPerUserPerMonth).map(([provider, callsPerUserPerMonth]) => {
    const normalizedProvider = normalizeApiLimitKeyPart(provider);
    const pricePerRequestUsd = requestPricing[normalizedProvider] ?? 0;
    const costUsd = roundCents(assumptions.totalUsers * callsPerUserPerMonth * pricePerRequestUsd);
    return { provider: normalizedProvider, costUsd };
  });
  const requestApiCostUsd = byProvider.reduce((sum, entry) => sum + entry.costUsd, 0);

  const hostingCostUsd = hostingLineItems.reduce((sum, item) => sum + item.monthlyCostUsd, 0);

  const totalCostUsd = llmCostUsd + requestApiCostUsd + hostingCostUsd;

  const premiumMonthlyPriceUsd =
    assumptions.premiumMonthlyPriceUsdOverride ?? PLAN_DEFAULTS.premiumMonthlyAmountCents / 100;
  const netRevenuePerPremiumUserUsd = computeNetRevenuePerPremiumUserUsd(
    premiumMonthlyPriceUsd,
    assumptions.stripeFeePercent,
    assumptions.stripeFeeFixedUsd
  );
  const breakEvenPremiumUsers = computeBreakEvenPremiumUsers(totalCostUsd, netRevenuePerPremiumUserUsd);

  return {
    llmCostUsd: roundCents(llmCostUsd),
    requestApiCostUsd: roundCents(requestApiCostUsd),
    hostingCostUsd: roundCents(hostingCostUsd),
    totalCostUsd: roundCents(totalCostUsd),
    premiumMonthlyPriceUsd: roundCents(premiumMonthlyPriceUsd),
    netRevenuePerPremiumUserUsd: roundCents(netRevenuePerPremiumUserUsd),
    breakEvenPremiumUsers,
    byProvider,
  };
};

const MICROS_PER_USD = 1_000_000;

const recentMonthWindowKeys = (monthsBack: number, now = new Date()): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < Math.max(1, monthsBack); i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

// Groups the full-history api_cost_counters rows (already retained indefinitely, see Phase 1) into
// the last `monthsBack` months, newest first, including months with zero recorded spend so the UI
// can render a stable grid rather than a sparse one.
export const getActualMonthlySpend = async (monthsBack: number): Promise<MonthlyProviderSpend[]> => {
  const windowKeys = recentMonthWindowKeys(monthsBack);
  const counters = await listApiCostCounters();
  const byWindowKey = new Map<string, Array<{ provider: string; spendUsd: number }>>();
  for (const counter of counters) {
    if (!windowKeys.includes(counter.windowKey)) continue;
    const bucket = byWindowKey.get(counter.windowKey) ?? [];
    const provider = normalizeApiLimitKeyPart(counter.provider);
    const spendUsd = roundCents(counter.amountMicros / MICROS_PER_USD);
    const existing = bucket.find((entry) => entry.provider === provider);
    if (existing) existing.spendUsd = roundCents(existing.spendUsd + spendUsd);
    else bucket.push({ provider, spendUsd });
    byWindowKey.set(counter.windowKey, bucket);
  }
  return windowKeys.map((windowKey) => {
    const byProvider = (byWindowKey.get(windowKey) ?? []).sort((a, b) => a.provider.localeCompare(b.provider));
    return {
      windowKey,
      byProvider,
      totalUsd: roundCents(byProvider.reduce((sum, entry) => sum + entry.spendUsd, 0)),
    };
  });
};
