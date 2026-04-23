export type CoveredByMap = Record<string, string>;

export const rollUpTotals = (
  totals: Record<string, number>,
  coveredBy: CoveredByMap
): Record<string, number> => {
  if (!Object.keys(coveredBy).length) return totals;

  const newTotals = { ...totals };

  for (const [coveredId, coveringId] of Object.entries(coveredBy)) {
    if (newTotals[coveredId]) {
      newTotals[coveringId] = (newTotals[coveringId] || 0) + newTotals[coveredId];
      delete newTotals[coveredId];
    }
  }
  return newTotals;
};

export const detectCycle = (coveredBy: CoveredByMap): boolean => {
  const path = new Set<string>();
  const visited = new Set<string>();

  const hasCycle = (memberId: string): boolean => {
    path.add(memberId);
    const coveringId = coveredBy[memberId];
    if (coveringId) {
      if (path.has(coveringId)) return true;
      if (!visited.has(coveringId) && hasCycle(coveringId)) return true;
    }
    path.delete(memberId);
    visited.add(memberId);
    return false;
  };

  for (const memberId of Object.keys(coveredBy)) {
    if (!visited.has(memberId) && hasCycle(memberId)) return true;
  }
  return false;
};

export const detectCoveringConflict = (coveredBy: CoveredByMap): boolean => {
  const covered = new Set(Object.keys(coveredBy));
  const covering = new Set(Object.values(coveredBy).filter(Boolean));
  for (const memberId of covered) {
    if (covering.has(memberId)) return true;
  }
  return false;
};

export type CoveringValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export const validateCoveringRules = (coveredBy: CoveredByMap): CoveringValidationResult => {
  if (detectCycle(coveredBy)) {
    return {
      ok: false,
      error:
        'Invalid covering rules. A circular dependency was detected (e.g., A covers B, and B covers A).',
    };
  }
  if (detectCoveringConflict(coveredBy)) {
    return {
      ok: false,
      error:
        'Invalid covering rules. A traveler who covers someone cannot be covered by another traveler.',
    };
  }
  return { ok: true };
};
