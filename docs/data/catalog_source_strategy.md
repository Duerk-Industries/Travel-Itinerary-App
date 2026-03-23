# Destination + Attraction Source Strategy (Free, Non-Synthetic)

## Goals
- Use only free/public data sources.
- Prefer primary, verifiable sources over generated text.
- Enforce strict anti-synthetic quality gates before CSV rows are written.

## Source stack
- Destinations:
  - Rest Countries API (`https://restcountries.com/`) for global country coverage and baseline metadata.
  - World Bank tourism arrivals indicator (`ST.INT.ARVL`) for demand-aware scaling.
  - CountryNow city population API (`https://countriesnow.space/`) for broad city-population candidate discovery.
  - GeoNames city records via Opendatasoft (`https://documentation-resources.huwise.com/`) to cross-check large-city coverage.
  - Wikipedia + Wikidata APIs for US-English canonical destination names.
- Attractions:
  - Wikidata SPARQL endpoint (`https://query.wikidata.org/`) for structured attraction candidates.
  - English Wikipedia sitelinks (`https://en.wikipedia.org/`) as a required article-backed source.
  - Wikimedia Pageviews API (`https://wikimedia.org/api/rest_v1/`) for popularity-based ranking.

## US-English canonicalization
- Resolve destination entities through Wikidata search.
- Prefer the English Wikipedia sitelink title as canonical display name.
- Fallback to Wikipedia query/search disambiguation scoring when no high-confidence Wikidata match exists.

## Anti-synthetic controls
- Reject names that match fabricated/generic patterns (for example `Attraction 12`, disambiguation/list pages).
- Require valid entity identifiers (Wikidata `Q` IDs) for attraction candidates.
- Require source-backed attractions with `source_count >= 2`.
- Apply locality plausibility checks and dedupe by normalized keys.

## Ranking and scaling
- Destination count scales by:
  - country size
  - population
  - tourism demand
- Cities with `population >= 1,000,000` are force-included in addition to quota-based destination selection.
- Those 1M+ additions keep multiple web-source confirmations in the destination source manifest before CSV output is finalized.
- Attraction count scales by:
  - country signals
  - destination popularity (Wikimedia pageviews)
  - destination type boosts (major metros and nature-heavy destinations)
