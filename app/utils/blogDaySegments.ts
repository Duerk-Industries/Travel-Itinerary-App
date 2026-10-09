// The published blog only shows days that have something on them. Skipping empty days silently
// made the page read as if the trip jumped (Aug 15 → Aug 20 → Aug 22), so runs of empty days
// between posts become a small "No entries · Aug 16 – Aug 19" marker instead.

export type DaySegment<D> =
  | { kind: 'day'; day: D }
  | { kind: 'gap'; fromDate: string; toDate: string; dayCount: number };

/**
 * Splits days (sorted by localDate) into content days and the gaps between them. Empty days
 * before the first or after the last content day are dropped rather than shown as gaps.
 */
export const buildDaySegments = <D extends { localDate: string }>(
  days: D[],
  hasContent: (day: D) => boolean,
): DaySegment<D>[] => {
  const segments: DaySegment<D>[] = [];
  let pendingEmpty: D[] = [];
  let seenContent = false;
  for (const day of days) {
    if (!hasContent(day)) {
      if (seenContent) pendingEmpty.push(day);
      continue;
    }
    if (pendingEmpty.length) {
      segments.push({
        kind: 'gap',
        fromDate: pendingEmpty[0].localDate,
        toDate: pendingEmpty[pendingEmpty.length - 1].localDate,
        dayCount: pendingEmpty.length,
      });
      pendingEmpty = [];
    }
    segments.push({ kind: 'day', day });
    seenContent = true;
  }
  return segments;
};

const shortDate = (localDate: string): string => {
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return localDate;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** "No entries · Aug 21" or "No entries · Aug 16 – Aug 19". */
export const formatGapLabel = (gap: { fromDate: string; toDate: string }): string =>
  gap.fromDate === gap.toDate
    ? `No entries · ${shortDate(gap.fromDate)}`
    : `No entries · ${shortDate(gap.fromDate)} – ${shortDate(gap.toDate)}`;
