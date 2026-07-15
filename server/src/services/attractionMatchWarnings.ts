import {
  searchDestinationLocationOptions,
  searchAttractionOptionsForSelectedLocations,
} from './destinationAttractionAutocompleteService';

const normalizeMatchKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isCloseMatch = (inputText: string, candidateText: string): boolean => {
  const a = normalizeMatchKey(inputText);
  const b = normalizeMatchKey(candidateText);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
};

/**
 * Checks every destination and must-see attraction in a generation request
 * against the same CSV-backed dataset the app's own autocomplete uses
 * (destinationAttractionAutocompleteService.ts), and returns a plain-text
 * warning for each one with no confident match. Never throws, never mutates
 * the request, and never blocks generation — callers decide how to surface
 * the warnings (e.g. the CLI replay script writes them to stderr, the live
 * generation path logs them via logError).
 */
export const computeUnmatchedDestinationAndAttractionWarnings = async (request: {
  destinations?: unknown;
  mustSeeAttractions?: unknown;
}): Promise<string[]> => {
  const warnings: string[] = [];

  const destinations = Array.isArray(request.destinations) ? request.destinations.map((value) => String(value ?? '')) : [];
  const matchedDestinationNames: string[] = [];
  for (const destinationText of destinations) {
    if (!destinationText.trim()) continue;
    const options = await searchDestinationLocationOptions(destinationText, 3);
    const top = options[0];
    if (top && isCloseMatch(destinationText, top.name)) {
      matchedDestinationNames.push(top.name);
    } else {
      warnings.push(`no confident destination match for "${destinationText}" — proceeding with the text as typed.`);
      matchedDestinationNames.push(destinationText);
    }
  }

  const mustSee = Array.isArray(request.mustSeeAttractions) ? request.mustSeeAttractions : [];
  for (const entry of mustSee) {
    const name = typeof entry === 'string' ? entry : String((entry as any)?.name ?? '');
    const destinationName = typeof entry === 'string' ? undefined : (entry as any)?.destinationName;
    if (!name.trim()) continue;
    const options = await searchAttractionOptionsForSelectedLocations({
      query: name,
      selectedLocationNames: destinationName ? [destinationName] : matchedDestinationNames,
      limit: 3,
    });
    const top = options[0];
    if (!top || !isCloseMatch(name, top.name)) {
      warnings.push(
        `no confident attraction match for "${name}"${destinationName ? ` in "${destinationName}"` : ''} — proceeding with the text as typed.`
      );
    }
  }

  return warnings;
};
