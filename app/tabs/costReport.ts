/**
 * Shared payer accumulator for cost reporting.
 * - Initializes all fallback payers to 0 so removals clear stale data.
 * - Splits cost evenly across payers and applies rounding remainder to the first payer.
 * - Can optionally fall back to all members when payers are missing (legacy data).
 */
export const computePayerTotals = <T,>(
  items: T[],
  getCost: (item: T) => number,
  getPayers: (item: T) => string[] | undefined,
  fallbackPayers: string[],
  options?: { fallbackOnEmpty?: boolean }
): Record<string, number> => {
  const totals: Record<string, number> = {};
  fallbackPayers.forEach((id) => {
    totals[id] = 0;
  });

  items.forEach((item) => {
    const cost = getCost(item);
    const payersRaw = getPayers(item);
    const payers = (payersRaw ?? []).filter(Boolean);

    const shouldFallback = options?.fallbackOnEmpty ? payers.length === 0 : payersRaw == null;
    const effective = payers.length ? payers : shouldFallback ? fallbackPayers : [];
    if (!cost || !effective.length) return;

    const share = cost / effective.length;
    effective.forEach((id) => {
      totals[id] = (totals[id] ?? 0) + share;
    });

    const remainder = cost - share * effective.length;
    if (Math.abs(remainder) > 1e-6 && effective[0]) {
      totals[effective[0]] = (totals[effective[0]] ?? 0) + remainder;
    }
  });

  return totals;
};

export default computePayerTotals;
