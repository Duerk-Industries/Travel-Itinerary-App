# Future Free Public Data Sources (Not Yet Integrated)

This list documents candidate sources to improve itinerary grounding and attraction metadata in future iterations.  
These are not currently wired into generation paths.

## Candidate sources

- OpenStreetMap + Overpass API
  - Use-case: pull POI categories, opening-hour tags, wheelchair/accessibility tags, and neighborhood-level density signals.
  - Benefit: strong global coverage and no per-request token cost for LLM calls.

- Wikimedia Commons + Wikidata media links
  - Use-case: attraction imagery and additional multilingual aliases for matching and de-duplication.
  - Benefit: free licensing and direct linkage to existing Wikidata entities already used in curation.

- Open-Meteo (or NOAA/NWS for US-specific enrichment)
  - Use-case: month/day climate context for activity sequencing (outdoor vs. indoor fallback planning).
  - Benefit: better day-level realism without expensive web search loops.

- GTFS public transit feeds (city/regional feeds where available)
  - Use-case: estimate realistic transfer friction and day coverage for transit-heavy itineraries.
  - Benefit: better mobility-aware scheduling for low-car traveler profiles.

- OpenTripMap (free tier constraints apply)
  - Use-case: additional POI scoring, tags, and quick fallback detail fields for lesser-covered destinations.
  - Benefit: broad supplemental POI index for destinations with sparse curated rows.

- National/statistical open datasets (country tourism boards, open data portals)
  - Use-case: seasonal events and cultural calendar grounding by destination.
  - Benefit: better non-synthetic event recommendations when APIs are unavailable.

## Integration guardrails for future work

- Prefer bulk/offline ingestion + cacheable local artifacts over per-request live fetches.
- Keep itinerary-time web calls optional and budget-capped by feature flag.
- Require source attribution fields (`source_url`, `source_label`, `source_count`) for new ingestion paths.
- Add per-source freshness windows and confidence thresholds before prompt inclusion.
