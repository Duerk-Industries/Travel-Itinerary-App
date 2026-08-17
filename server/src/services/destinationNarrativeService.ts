import { fetchWikipediaEnrichment } from './wikipediaGeocodingService';
import { fetchWikipediaSummary } from './attractionDurationEstimationService';

const normalizeText = (value: unknown): string => String(value ?? '').trim();

// A short "why this place, what defines it" paragraph per unique destination in a trip —
// see docs/implementation_plans/itinerary-narrative-depth-and-validation.md §4 (P4). Reuses
// wikipediaGeocodingService's existing cache, usage-reservation/cost-tracking, and topical-
// relevance gate (isPlausibleMatch) rather than adding a second caching/validation layer: a
// destination narrative is exactly the same kind of fact — "what is this real place" — as an
// attraction description, just for the destination itself instead of one stop inside it.
// Deliberately NOT scoped per-user or per-trip: two different trips visiting Kyoto should get
// the same cached narrative, the same way AttractionDurationMetadata is destination-scoped, not
// trip-scoped, for attractions.
const MAX_NARRATIVE_SENTENCES = 3;

export const getDestinationNarrative = async (destinationDisplayName: string): Promise<string | null> => {
  const name = normalizeText(destinationDisplayName);
  if (!name) return null;
  // Search first (handles a destination name that isn't the exact Wikipedia article title, e.g.
  // "Fujikawaguchiko" vs. "Kawaguchiko, Yamanashi"), then fall back to the exact-title REST
  // endpoint — the same two-step pattern getOrCreateAttractionDurationMetadata already uses.
  const searched = await fetchWikipediaEnrichment(name, undefined, MAX_NARRATIVE_SENTENCES);
  if (searched?.summary) return searched.summary;
  return fetchWikipediaSummary(name, MAX_NARRATIVE_SENTENCES);
};

// Fetches (or reuses the cached) narrative for every unique destination in `destinationNames`,
// in the given order, skipping any that fail to resolve rather than failing the whole batch —
// this is enrichment, not required data; a trip should never fail to generate because one
// destination's Wikipedia lookup had a bad day.
export const getDestinationNarratives = async (
  destinationNames: string[]
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const seen = new Set<string>();
  for (const rawName of destinationNames) {
    const name = normalizeText(rawName);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    try {
      const narrative = await getDestinationNarrative(name);
      if (narrative) result.set(name, narrative);
    } catch {
      // Best-effort — see comment above.
    }
  }
  return result;
};

// Assembles the narratives into a standalone markdown section, in the given destination order
// (the itinerary's own visiting order, not alphabetical) — deterministic string assembly, not
// LLM-generated structure, so there's nothing here for the model to get wrong.
export const renderDestinationNarrativesMarkdown = (
  destinationOrder: string[],
  narrativesByName: Map<string, string>
): string => {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const rawName of destinationOrder) {
    const name = normalizeText(rawName);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const narrative = narrativesByName.get(name);
    if (!narrative) continue;
    sections.push(`### ${name}\n\n${narrative}`);
  }
  if (!sections.length) return '';
  return `## Destinations\n\n${sections.join('\n\n')}`;
};
