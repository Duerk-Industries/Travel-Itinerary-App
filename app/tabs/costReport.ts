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

/**
 * Normalize per-user totals for a category so rows/columns sum to the category total.
 * - Starts with provided per-user totals (defaults to 0).
 * - If the summed per-user totals don't match the category total, evenly distributes the remainder.
 * - Applies any rounding remainder to the first member to keep the grand total aligned.
 */
export const balanceCategoryTotals = (
  total: number,
  perUserTotals: Record<string, number>,
  memberIds: string[]
): Record<string, number> => {
  const balanced: Record<string, number> = {};
  memberIds.forEach((id) => {
    balanced[id] = Number(perUserTotals[id] ?? 0);
  });

  const assigned = memberIds.reduce((sum, id) => sum + (balanced[id] ?? 0), 0);
  const remainder = total - assigned;
  if (Math.abs(remainder) > 1e-6 && memberIds.length) {
    const evenShare = remainder / memberIds.length;
    memberIds.forEach((id) => {
      balanced[id] = (balanced[id] ?? 0) + evenShare;
    });
    const afterEven = memberIds.reduce((sum, id) => sum + (balanced[id] ?? 0), 0);
    const adjust = total - afterEven;
    if (Math.abs(adjust) > 1e-6) {
      const first = memberIds[0];
      balanced[first] = (balanced[first] ?? 0) + adjust;
    }
  }

  return balanced;
};

export default computePayerTotals;
