// Mirror of packages/domain/src/coveredBy.ts (detectCycle + detectCoveringConflict subset).
// Kept inline because server tsconfig restricts cross-workspace source imports.
// A contract test in server/__tests__/domainSync.test.ts catches drift.

export const detectCycle = (coveredBy: Record<string, string>): boolean => {
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

export const detectCoveringConflict = (coveredBy: Record<string, string>): boolean => {
  const covered = new Set(Object.keys(coveredBy));
  const covering = new Set(Object.values(coveredBy).filter(Boolean));
  for (const memberId of covered) {
    if (covering.has(memberId)) return true;
  }
  return false;
};
