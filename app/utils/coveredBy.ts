export const rollUpTotals = (
  totals: Record<string, number>,
  coveredBy: Record<string, string>
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

export const detectCycle = (coveredBy: Record<string, string>): boolean => {
  const path = new Set<string>(); // nodes in the current traversal path
  const visited = new Set<string>(); // nodes that have been fully explored

  const hasCycle = (memberId: string): boolean => {
    path.add(memberId);

    const coveringId = coveredBy[memberId];
    if (coveringId) {
      if (path.has(coveringId)) {
        return true; // Cycle detected
      }
      if (!visited.has(coveringId)) {
        if (hasCycle(coveringId)) {
          return true;
        }
      }
    }

    path.delete(memberId);
    visited.add(memberId);
    return false;
  };

  for (const memberId of Object.keys(coveredBy)) {
    if (!visited.has(memberId) && hasCycle(memberId)) {
      return true;
    }
  }

  return false;
};

export const detectCoveringConflict = (coveredBy: Record<string, string>): boolean => {
  const covered = new Set(Object.keys(coveredBy));
  const covering = new Set(Object.values(coveredBy).filter(Boolean));
  for (const memberId of covered) {
    if (covering.has(memberId)) return true;
  }
  return false;
};

export const validateCoveringRules = (coveredBy: Record<string, string>): { ok: true } | { ok: false; error: string } => {
  if (detectCycle(coveredBy)) {
    return {
      ok: false,
      error: 'Invalid covering rules. A circular dependency was detected (e.g., A covers B, and B covers A).',
    };
  }
  if (detectCoveringConflict(coveredBy)) {
    return {
      ok: false,
      error: 'Invalid covering rules. A traveler who covers someone cannot be covered by another traveler.',
    };
  }
  return { ok: true };
};
