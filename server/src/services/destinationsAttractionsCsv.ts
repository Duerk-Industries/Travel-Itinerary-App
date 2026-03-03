import fs from 'fs';

export interface DestinationCsvRow {
  [key: string]: string | undefined;
}

export interface ParsedDestinationsCsv {
  headers: string[];
  rows: Array<{ data: DestinationCsvRow; lineIndex: number }>;
  lines: string[];
  eol: '\n' | '\r\n';
}

export const DESTINATIONS_ATTRACTIONS_UPDATED_HEADER = 'Attractions Updated';

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

export function escapeCsv(value: string): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"')) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function parseDestinationsCsv(filePath: string): ParsedDestinationsCsv {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const eol: '\n' | '\r\n' = csvData.includes('\r\n') ? '\r\n' : '\n';
  const rawLines = csvData.split(/\r?\n/);
  const lines = rawLines.filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], lines: [], eol };

  const headers = parseCsvLine(lines[0]);
  const rows: Array<{ data: DestinationCsvRow; lineIndex: number }> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;
    const destination: DestinationCsvRow = {};
    headers.forEach((header, index) => {
      destination[header] = values[index];
    });
    rows.push({ data: destination, lineIndex: i });
  }
  return { headers, rows, lines, eol };
}

export function destinationRowToCsv(headers: string[], destination: DestinationCsvRow): string {
  return headers.map((header) => escapeCsv(String(destination[header] ?? ''))).join(',');
}

export function serializeDestinationsCsv(doc: ParsedDestinationsCsv): string {
  const out: string[] = [];
  out.push(doc.headers.map((h) => escapeCsv(h)).join(','));
  for (const row of doc.rows) out.push(destinationRowToCsv(doc.headers, row.data));
  return `${out.join(doc.eol)}${doc.eol}`;
}

function parseYmdUtc(value: string | undefined): Date | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function shouldRefreshDestinationAttractions(
  lastUpdatedYmd: string | undefined,
  todayYmd: string,
  minDaysBetweenRefreshes = 45
): boolean {
  const today = parseYmdUtc(todayYmd);
  if (!today) return true;
  const lastUpdated = parseYmdUtc(lastUpdatedYmd);
  if (!lastUpdated) return true;
  const ageDays = Math.floor((today.getTime() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000));
  return ageDays >= minDaysBetweenRefreshes;
}

export function ensureAttractionsUpdatedColumnAndBackfill(doc: ParsedDestinationsCsv, todayYmd: string): boolean {
  let changed = false;
  if (!doc.headers.includes(DESTINATIONS_ATTRACTIONS_UPDATED_HEADER)) {
    doc.headers.push(DESTINATIONS_ATTRACTIONS_UPDATED_HEADER);
    changed = true;
  }

  for (const row of doc.rows) {
    const current = String(row.data[DESTINATIONS_ATTRACTIONS_UPDATED_HEADER] ?? '').trim();
    if (!current) {
      row.data[DESTINATIONS_ATTRACTIONS_UPDATED_HEADER] = todayYmd;
      changed = true;
    }
    doc.lines[row.lineIndex] = destinationRowToCsv(doc.headers, row.data);
  }
  doc.lines[0] = doc.headers.map((h) => escapeCsv(h)).join(',');
  return changed;
}

export function writeDestinationsCsvLineUpdates(
  filePath: string,
  originalRaw: string,
  doc: ParsedDestinationsCsv,
  lineIndexes: Set<number>
): void {
  if (lineIndexes.size === 0) return;
  const segments = originalRaw.match(/.*(?:\r\n|\n|$)/g)?.filter((s) => s.length > 0) ?? [];
  if (segments.length === 0) {
    fs.writeFileSync(filePath, serializeDestinationsCsv(doc), 'utf8');
    return;
  }
  const normalizedSegments = segments.map((segment) => {
    if (segment.endsWith('\r\n')) return { body: segment.slice(0, -2), nl: '\r\n' };
    if (segment.endsWith('\n')) return { body: segment.slice(0, -1), nl: '\n' };
    return { body: segment, nl: '' };
  });
  const ordered = Array.from(lineIndexes).sort((a, b) => a - b);
  const sameLength = ordered.every((idx) => {
    if (idx < 0 || idx >= normalizedSegments.length || idx >= doc.lines.length) return false;
    return Buffer.byteLength(normalizedSegments[idx].body, 'utf8') === Buffer.byteLength(doc.lines[idx], 'utf8');
  });
  if (!sameLength) {
    fs.writeFileSync(filePath, serializeDestinationsCsv(doc), 'utf8');
    return;
  }
  const fd = fs.openSync(filePath, 'r+');
  try {
    let offset = 0;
    let pointer = 0;
    for (const idx of ordered) {
      while (pointer < idx) {
        const seg = normalizedSegments[pointer];
        offset += Buffer.byteLength(seg.body, 'utf8') + Buffer.byteLength(seg.nl, 'utf8');
        pointer += 1;
      }
      const next = Buffer.from(doc.lines[idx], 'utf8');
      fs.writeSync(fd, next, 0, next.length, offset);
    }
  } finally {
    fs.closeSync(fd);
  }
}
