import { listProviderCostLedgerEntries, listProviderInvoiceRecords } from '../db';
import type { ProviderCostLedgerEntry, ProviderInvoiceRecord } from '../types';

/**
 * Monthly cost report built from provider_cost_ledger (docs/implementation-plans/analytics-upgrade.md
 * Phase 3, decision 4). Aggregate-only: no user IDs leave this module. Unknown-priced attempts are
 * counted separately and never folded into totals as $0; estimated ledger cost is kept distinct
 * from invoiced cost and from allocated shared cost.
 */

export const ALLOCATION_BASIS = 'allocation_v1';
/** |variance| within this share of the invoice counts as reconciled. */
export const RECONCILIATION_TOLERANCE = 0.05;
const LEDGER_ROW_LIMIT = 50_000;

type Bucket = {
  attempts: number;
  estimatedMicros: number;
  unknownAttempts: number;
  notBillableAttempts: number;
  failedAttempts: number;
};

const emptyBucket = (): Bucket => ({ attempts: 0, estimatedMicros: 0, unknownAttempts: 0, notBillableAttempts: 0, failedAttempts: 0 });

const addTo = (bucket: Bucket, entry: ProviderCostLedgerEntry): void => {
  bucket.attempts += 1;
  if (entry.costStatus === 'unknown') bucket.unknownAttempts += 1;
  else if (entry.costStatus === 'not_billable') bucket.notBillableAttempts += 1;
  else bucket.estimatedMicros += entry.estimatedCostMicros ?? 0;
  if (entry.outcome === 'failed') bucket.failedAttempts += 1;
};

/** Nearest-rank quantile over raw values (not averaged percentiles). */
const quantile = (sortedAsc: number[], q: number): number | null => {
  if (!sortedAsc.length) return null;
  const rank = Math.max(1, Math.ceil(q * sortedAsc.length));
  return sortedAsc[rank - 1];
};

const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMicros: quantile(sorted, 0.5),
    p95Micros: quantile(sorted, 0.95),
    maxMicros: sorted.length ? sorted[sorted.length - 1] : null,
  };
};

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

export type CostLedgerReportOptions = {
  windowKey: string;
  /** Shared infrastructure cost for the month (USD micros) to allocate; omitted → no allocation section. */
  sharedCostMicros?: number | null;
  /** Accounts active in the month. Defaults to distinct attributed ledger users (an undercount). */
  activeAccounts?: number | null;
};

export const buildCostLedgerReport = async (options: CostLedgerReportOptions) => {
  const [entries, invoices] = await Promise.all([
    listProviderCostLedgerEntries(options.windowKey, LEDGER_ROW_LIMIT),
    listProviderInvoiceRecords(options.windowKey),
  ]);

  const totals = emptyBucket();
  const byProvider = new Map<string, Bucket>();
  const byFeature = new Map<string, Bucket>();
  const userMicros = new Map<string, number>();
  const userAttempts = new Map<string, number>();
  let attributedMicros = 0;
  let attributedAttempts = 0;

  for (const entry of entries) {
    addTo(totals, entry);
    const provider = byProvider.get(entry.provider) ?? emptyBucket();
    addTo(provider, entry);
    byProvider.set(entry.provider, provider);
    const featureKey = entry.featureKey ?? 'unattributed';
    const feature = byFeature.get(featureKey) ?? emptyBucket();
    addTo(feature, entry);
    byFeature.set(featureKey, feature);
    if (entry.attribution === 'user' && entry.userId) {
      attributedAttempts += 1;
      const cost = entry.costStatus === 'estimated' ? entry.estimatedCostMicros ?? 0 : 0;
      attributedMicros += cost;
      userMicros.set(entry.userId, (userMicros.get(entry.userId) ?? 0) + cost);
      userAttempts.set(entry.userId, (userAttempts.get(entry.userId) ?? 0) + 1);
    }
  }

  const sortedEntries = (map: Map<string, Bucket>) =>
    Array.from(map.entries()).sort(([nameA, a], [nameB, b]) => b.estimatedMicros - a.estimatedMicros || nameA.localeCompare(nameB));

  const directPerUser = Array.from(userMicros.values());

  let allocation: Record<string, unknown> | null = null;
  const sharedCostMicros = options.sharedCostMicros ?? null;
  if (sharedCostMicros != null && sharedCostMicros >= 0) {
    const fallbackAccounts = userMicros.size;
    const activeAccounts = options.activeAccounts && options.activeAccounts > 0 ? options.activeAccounts : fallbackAccounts;
    const equalShareMicros = activeAccounts > 0 ? Math.round(sharedCostMicros / activeAccounts) : null;
    const totalUserAttempts = Array.from(userAttempts.values()).reduce((sum, n) => sum + n, 0);
    const volumeShares = Array.from(userAttempts.values()).map((n) =>
      totalUserAttempts > 0 ? Math.round((sharedCostMicros * n) / totalUserAttempts) : 0,
    );
    allocation = {
      basis: ALLOCATION_BASIS,
      sharedCostMicros,
      activeAccounts,
      activeAccountsSource: options.activeAccounts && options.activeAccounts > 0 ? 'provided' : 'ledger_attributed_users',
      equalShareMicrosPerAccount: equalShareMicros,
      // Direct cost + equal shared share per attributed user (accounts with no direct cost carry the share alone).
      totalPerUser: distribution(directPerUser.map((direct) => direct + (equalShareMicros ?? 0))),
      // Sensitivity view: shared cost split by each user's share of attributed attempts.
      requestVolumeSplit: distribution(volumeShares),
    };
  }

  const reconciliation = invoices.map((invoice: ProviderInvoiceRecord) => {
    const ledger = byProvider.get(invoice.provider) ?? emptyBucket();
    const invoicedNetUsdMicros = Math.round((invoice.invoicedMicros - invoice.creditsMicros) * invoice.fxRateToUsd);
    const varianceMicros = invoicedNetUsdMicros - ledger.estimatedMicros;
    const varianceRatio = ratio(varianceMicros, invoicedNetUsdMicros);
    return {
      provider: invoice.provider,
      currency: invoice.currency,
      fxRateToUsd: invoice.fxRateToUsd,
      invoicedMicros: invoice.invoicedMicros,
      creditsMicros: invoice.creditsMicros,
      invoicedNetUsdMicros,
      ledgerEstimatedMicros: ledger.estimatedMicros,
      ledgerUnknownAttempts: ledger.unknownAttempts,
      varianceMicros,
      varianceRatio,
      withinTolerance: varianceRatio != null && Math.abs(varianceRatio) <= RECONCILIATION_TOLERANCE,
      recordedAt: invoice.recordedAt,
      notes: invoice.notes,
    };
  });

  return {
    windowKey: options.windowKey,
    truncated: entries.length >= LEDGER_ROW_LIMIT,
    totals,
    coverage: {
      // Share of estimated spend tied to an initiating account (the rest is system/background).
      attributionRatio: ratio(attributedMicros, totals.estimatedMicros),
      attributedAttempts,
      systemAttempts: totals.attempts - attributedAttempts,
      // Share of attempts with a known price (estimated or not billable).
      pricingRatio: ratio(totals.attempts - totals.unknownAttempts, totals.attempts),
    },
    byProvider: sortedEntries(byProvider).map(([provider, bucket]) => ({ provider, ...bucket })),
    byFeature: sortedEntries(byFeature).map(([featureKey, bucket]) => ({ featureKey, ...bucket })),
    directCostPerUser: distribution(directPerUser),
    allocation,
    reconciliation,
    notes: [
      'Ledger costs are estimates from configured prices; invoiced figures come only from reconciliation rows.',
      'Unknown-priced attempts are excluded from cost totals, not treated as $0.',
      'Attempts recorded before the ledger existed (pre-Phase 3) are absent; budget counters remain the source for those months.',
    ],
  };
};
