const cleanValue = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim()
    .replace(/^[,;:\-–]+/, '')
    .replace(/[,;:\-–]+$/, '')
    .trim();
  return cleaned || null;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildLooseLabelRegex = (label: string, global = false): RegExp =>
  new RegExp(`\\b${escapeRegex(label).replace(/\\ /g, '\\s*')}\\s*:?(?=\\s|[A-Z0-9]|$)`, global ? 'gi' : 'i');

export const extractLabeledFieldValue = (
  text: string,
  labels: string[],
  stopLabels: string[],
  preferLastOccurrence = false,
  maxWindow = 260
): string | null => {
  const labelMatches: Array<{ index: number; label: string }> = [];

  for (const label of labels) {
    const regex = buildLooseLabelRegex(label, true);
    for (const match of text.matchAll(regex)) {
      if (match.index !== undefined) {
        labelMatches.push({ index: match.index, label });
      }
    }
  }

  labelMatches.sort((a, b) => a.index - b.index);
  const ordered = preferLastOccurrence ? [...labelMatches].reverse() : labelMatches;

  for (const match of ordered) {
    let cursor = match.index + match.label.length;
    while (cursor < text.length && /[:\s]/.test(text[cursor])) {
      cursor += 1;
    }

    const window = text.slice(cursor, Math.min(text.length, cursor + maxWindow));
    const stopIndexes = stopLabels
      .map((stop) => {
        const stopMatch = window.match(buildLooseLabelRegex(stop));
        return stopMatch?.index ?? -1;
      })
      .filter((idx) => idx > 0);
    const cutAt = stopIndexes.length ? Math.min(...stopIndexes) : window.length;
    const candidate = cleanValue(window.slice(0, cutAt));
    if (candidate) {
      return candidate;
    }
  }

  return null;
};

export const toTitleCaseWords = (value: string, maxWords = 4): string =>
  value
    .split(/\s+/)
    .slice(0, maxWords)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

export const extractPhoneLikeValue = (text: string): string | null =>
  text.match(/\+\d[\d\s().-]{5,30}\d/)?.[0]?.trim() ?? null;
