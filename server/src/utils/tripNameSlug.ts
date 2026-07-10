/**
 * Trip name -> filename-safe slug: whitespace runs become "-", characters
 * unsafe in filenames are stripped, repeated dashes collapse. Case is
 * preserved (unlike the codebase's lowercase CSV-key slugify helpers) since
 * this is for human file-browsing, not a DB lookup key.
 */
export const tripNameToFileSlug = (tripName: string): string =>
  String(tripName ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'trip';
