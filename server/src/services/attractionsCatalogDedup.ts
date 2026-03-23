function parseCsvLine(line: string): string[] {
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

function escapeCsv(value: string): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function dedupeAttractionsCatalogLines(lines: string[]): string[] {
  if (lines.length <= 1) return lines;

  const headerCols = parseCsvLine(lines[0]);
  const indexOf = (name: string) => headerCols.indexOf(name);
  const iId = indexOf('id');
  const iDestinationKey = indexOf('destination_key');
  const iDestinationDisplayName = indexOf('destination_display_name');
  const iName = indexOf('name');
  const iRank = indexOf('rank');
  const iSourceCount = indexOf('source_count');
  const iUpdatedAt = indexOf('updated_at');
  const iSitelinks = indexOf('sitelinks');
  const iQid = indexOf('qid');

  if (iDestinationDisplayName === -1 || iName === -1 || iRank === -1) return lines;

  const rowsByDestination = new Map<string, string[][]>();

  const buildRowKey = (cols: string[]): string => {
    const destination = normalizeKey(String(cols[iDestinationDisplayName] ?? ''));
    const qid = iQid >= 0 ? String(cols[iQid] ?? '').trim() : '';
    if (/^Q\d+$/i.test(qid)) return `${destination}::qid::${qid.toUpperCase()}`;
    const name = normalizeKey(String(cols[iName] ?? ''));
    return `${destination}::name::${name}`;
  };

  const scoreRow = (cols: string[]) => ({
    sourceCount: iSourceCount >= 0 ? Number(cols[iSourceCount] ?? 0) || 0 : 0,
    sitelinks: iSitelinks >= 0 ? Number(cols[iSitelinks] ?? 0) || 0 : 0,
    rank: Number(cols[iRank] ?? Number.MAX_SAFE_INTEGER) || Number.MAX_SAFE_INTEGER,
    updatedAt: iUpdatedAt >= 0 ? Date.parse(String(cols[iUpdatedAt] ?? '')) || 0 : 0,
  });

  const chooseBetterRow = (current: string[], candidate: string[]): string[] => {
    const a = scoreRow(current);
    const b = scoreRow(candidate);
    if (b.sourceCount !== a.sourceCount) return b.sourceCount > a.sourceCount ? candidate : current;
    if (b.sitelinks !== a.sitelinks) return b.sitelinks > a.sitelinks ? candidate : current;
    if (b.rank !== a.rank) return b.rank < a.rank ? candidate : current;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt > a.updatedAt ? candidate : current;
    return current;
  };

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length !== headerCols.length) continue;
    const destination = String(cols[iDestinationDisplayName] ?? '').trim();
    if (!destination) continue;
    if (!rowsByDestination.has(destination)) rowsByDestination.set(destination, []);
    rowsByDestination.get(destination)?.push(cols);
  }

  const out = [lines[0]];

  for (const destinationRows of rowsByDestination.values()) {
    const dedupedByKey = new Map<string, string[]>();
    for (const cols of destinationRows) {
      const key = buildRowKey(cols);
      const existing = dedupedByKey.get(key);
      dedupedByKey.set(key, existing ? chooseBetterRow(existing, cols) : cols);
    }

    const rerankedRows = Array.from(dedupedByKey.values()).sort((a, b) => {
      const rankDiff = (Number(a[iRank] ?? 0) || 0) - (Number(b[iRank] ?? 0) || 0);
      if (rankDiff !== 0) return rankDiff;
      const sitelinkDiff = (Number(b[iSitelinks] ?? 0) || 0) - (Number(a[iSitelinks] ?? 0) || 0);
      if (sitelinkDiff !== 0) return sitelinkDiff;
      return String(a[iName] ?? '').localeCompare(String(b[iName] ?? ''));
    });

    rerankedRows.forEach((cols, index) => {
      cols[iRank] = String(index + 1);
      if (iId >= 0 && iDestinationKey >= 0) {
        cols[iId] = `attr:${String(cols[iDestinationKey] ?? '').trim()}:${slugify(String(cols[iName] ?? ''))}`;
      }
      out.push(cols.map((value) => escapeCsv(value)).join(','));
    });
  }

  return out;
}
