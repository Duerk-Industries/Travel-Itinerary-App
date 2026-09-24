import fs from 'fs';
import path from 'path';
import {
  ACTIVITY_HEADER_ALIASES,
  LODGING_HEADER_ALIASES,
  mapColumns,
  parseCsv,
  toActivityReviewRows,
  toCsv,
  toLodgingReviewRows,
} from '../utils/dataTransfer';

const fixture = (name: string) => fs.readFileSync(path.resolve(__dirname, '../../docs/implementation_plans/itinerary_improvement', name), 'utf8');

describe('activity and lodging CSV transfer', () => {
  it('parses and maps the supplied activity fixture without dropping duplicates', () => {
    const parsed = parseCsv(fixture('Japan Checklist - Activities-1.csv'));
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(parsed.rows).toHaveLength(101);
    const mapped = mapColumns(parsed.headers, ACTIVITY_HEADER_ALIASES);
    const rows = toActivityReviewRows(parsed.rows, mapped.mapping, '2026-11-10', '2026-12-08');
    expect(rows).toHaveLength(101);
    expect(rows.filter((row) => row.fields.name === 'Momiji Corridor')).toHaveLength(2);
    expect(rows.find((row) => row.fields.name === 'Nakasendo trail')?.fields.activityType).toBe('Hike');
  });

  it('preserves unbooked lodging legs and qualified amenities', () => {
    const parsed = parseCsv(fixture('Japan Checklist - Lodging.csv'));
    expect(parsed.rows).toHaveLength(12);
    const mapped = mapColumns(parsed.headers, LODGING_HEADER_ALIASES);
    const rows = toLodgingReviewRows(parsed.rows, mapped.mapping, '2026-11-10', '2026-12-08');
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => String(row.fields.name).startsWith('Lodging in '))).toHaveLength(4);
    expect(rows.find((row) => row.fields.name === 'Hotel Kanazawa Zoushi')?.fields.features).toContain('Breakfast');
    expect(rows.find((row) => row.fields.name === 'Hotel Kanazawa Zoushi')?.fields.notes).toContain('$9/per');
  });

  it('quotes cells and neutralizes formula-like text in exports', () => {
    const output = toCsv(['Name', 'Notes'], [{ Name: '=SUM(A1:A2)', Notes: 'line, two\nquoted' }]);
    expect(output).toContain("'=SUM(A1:A2)");
    expect(output).toContain('"line, two\nquoted"');
  });
});
