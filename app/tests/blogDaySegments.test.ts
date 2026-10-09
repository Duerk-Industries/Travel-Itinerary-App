/// <reference types="jest" />
import { buildDaySegments, formatGapLabel } from '../utils/blogDaySegments';

const day = (localDate: string, posted: boolean) => ({ localDate, posted });
const hasContent = (d: { posted: boolean }) => d.posted;

describe('buildDaySegments', () => {
  it('marks the skipped days between posts instead of silently jumping (Aug 15 → 20 → 22)', () => {
    const days = [
      day('2026-08-15', true),
      day('2026-08-16', false), day('2026-08-17', false), day('2026-08-18', false), day('2026-08-19', false),
      day('2026-08-20', true),
      day('2026-08-21', false),
      day('2026-08-22', true),
    ];
    const segments = buildDaySegments(days, hasContent);
    expect(segments.map((s) => (s.kind === 'day' ? s.day.localDate : `gap ${s.fromDate}..${s.toDate} (${s.dayCount})`))).toEqual([
      '2026-08-15',
      'gap 2026-08-16..2026-08-19 (4)',
      '2026-08-20',
      'gap 2026-08-21..2026-08-21 (1)',
      '2026-08-22',
    ]);
  });

  it('drops empty days before the first post and after the last one', () => {
    const segments = buildDaySegments([day('2026-08-13', false), day('2026-08-14', true), day('2026-08-15', false)], hasContent);
    expect(segments).toEqual([{ kind: 'day', day: day('2026-08-14', true) }]);
  });

  it('returns nothing when no day has content', () => {
    expect(buildDaySegments([day('2026-08-13', false)], hasContent)).toEqual([]);
  });
});

describe('formatGapLabel', () => {
  it('labels a single day and a range', () => {
    expect(formatGapLabel({ fromDate: '2026-08-21', toDate: '2026-08-21' })).toBe('No entries · Aug 21');
    expect(formatGapLabel({ fromDate: '2026-08-16', toDate: '2026-08-19' })).toBe('No entries · Aug 16 – Aug 19');
  });
});
