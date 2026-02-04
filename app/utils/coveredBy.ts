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