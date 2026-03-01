import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DESTINATIONS_ATTRACTIONS_UPDATED_HEADER,
  ensureAttractionsUpdatedColumnAndBackfill,
  parseDestinationsCsv,
  serializeDestinationsCsv,
  shouldRefreshDestinationAttractions,
  writeDestinationsCsvLineUpdates,
} from '../src/services/destinationsAttractionsCsv';

describe('destinations attractions-updated behavior', () => {
  test('backfills missing column with today date', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-csv-'));
    const file = path.join(tmpDir, 'destinations.csv');
    fs.writeFileSync(
      file,
      [
        '"Destination English Name","Country","State/Provence","Nearest City","Destination Official Name"',
        '"Paris","France","","Paris","Paris"',
      ].join('\n'),
      'utf8'
    );

    const doc = parseDestinationsCsv(file);
    const changed = ensureAttractionsUpdatedColumnAndBackfill(doc, '2026-03-01');
    fs.writeFileSync(file, serializeDestinationsCsv(doc), 'utf8');
    const updated = fs.readFileSync(file, 'utf8');

    expect(changed).toBe(true);
    expect(updated).toContain(DESTINATIONS_ATTRACTIONS_UPDATED_HEADER);
    expect(updated).toContain('2026-03-01');
  });

  test('refresh eligibility is true only when age is >= 45 days', () => {
    expect(shouldRefreshDestinationAttractions('2026-02-20', '2026-03-01', 45)).toBe(false);
    expect(shouldRefreshDestinationAttractions('2026-01-15', '2026-03-01', 45)).toBe(true);
    expect(shouldRefreshDestinationAttractions('2025-12-31', '2026-02-14', 45)).toBe(true);
  });

  test('line update writes only changed rows when lengths match', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-csv-'));
    const file = path.join(tmpDir, 'destinations.csv');
    const original = [
      '"Destination English Name","Country","State/Provence","Nearest City","Destination Official Name","Attractions Updated"',
      '"Paris","France","","Paris","Paris","2026-01-01"',
      '"Rome","Italy","","Rome","Roma","2026-01-01"',
    ].join('\n') + '\n';
    fs.writeFileSync(file, original, 'utf8');

    const doc = parseDestinationsCsv(file);
    doc.rows[1].data['Attractions Updated'] = '2026-03-01';
    doc.lines[doc.rows[1].lineIndex] = doc.lines[doc.rows[1].lineIndex].replace('2026-01-01', '2026-03-01');
    writeDestinationsCsvLineUpdates(file, original, doc, new Set([doc.rows[1].lineIndex]));

    const updated = fs.readFileSync(file, 'utf8');
    expect(updated).toContain('"Paris","France","","Paris","Paris","2026-01-01"');
    expect(updated).toContain('"Rome","Italy","","Rome","Roma","2026-03-01"');
  });
});
