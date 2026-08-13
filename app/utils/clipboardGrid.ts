export type ClipboardMatrix = string[][];

export type MemberClipboardOption = {
  id: string;
  label: string;
  email?: string;
};

export type ClipboardParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const escapeCell = (value: string): string => {
  const normalized = String(value ?? '');
  return /[\t\r\n"]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
};

export const serializeClipboardMatrix = (matrix: ClipboardMatrix): string =>
  matrix.map((row) => row.map(escapeCell).join('\t')).join('\n');

export const parseClipboardMatrix = (text: string): ClipboardParseResult<ClipboardMatrix> => {
  const source = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!source) return { ok: true, value: [['']] };
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) return { ok: false, error: 'Clipboard text has an unterminated quoted value.' };
  row.push(cell);
  rows.push(row);
  return { ok: true, value: rows };
};

export const resolveMemberClipboardValue = (
  value: string,
  members: MemberClipboardOption[],
): ClipboardParseResult<string[]> => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { ok: true, value: [] };
  const byKey = new Map<string, string>();
  members.forEach((member) => {
    byKey.set(member.id.trim().toLowerCase(), member.id);
    byKey.set(member.label.trim().toLowerCase(), member.id);
    if (member.email) byKey.set(member.email.trim().toLowerCase(), member.id);
  });
  const resolved: string[] = [];
  for (const part of trimmed.split(';')) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    const id = byKey.get(key);
    if (!id) return { ok: false, error: `Unknown traveler: ${part.trim()}` };
    if (!resolved.includes(id)) resolved.push(id);
  }
  return { ok: true, value: resolved };
};

export const matrixDimensionsMatch = (matrix: ClipboardMatrix, height: number, width = 1): boolean =>
  matrix.length === height && matrix.every((row) => row.length === width);
