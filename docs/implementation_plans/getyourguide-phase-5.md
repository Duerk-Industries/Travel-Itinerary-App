# GetYourGuide Phase 5 Partner API enrichment

Phase 5 adds an optional, server-only Partner API layer. It is fail-closed and
does not change the Phase-A deep-link behavior: if the API is disabled,
unconfigured, rate-limited, malformed, stale beyond its permitted window, or
unavailable, the ordinary activity and Phase-A descriptor remain usable.

## Configuration and safety gates

The exact Partner API endpoint and token are supplied by the approved account
contract, not guessed in code:

- `GETYOURGUIDE_API_BASE_URL` — exact HTTPS endpoint from the partner account.
- `GETYOURGUIDE_API_TOKEN` (or the existing key fallback) — server-only token.
- `GETYOURGUIDE_API_CURRENCY` and `GETYOURGUIDE_API_LANGUAGE` — explicit API
  request locale values.
- `GETYOURGUIDE_API_CACHE_PERMISSION=true` — only when written permission to
  persist normalized partner data exists; default is false.

The YAML defaults keep `maxPartnerApiLookupsPerGeneration` and
`maxPartnerApiLookupsPerDay` at zero. The general `GETYOURGUIDE` limiter has a
one-request-per-hour safety ceiling until an account-specific quota is
approved and configured. Request pricing is tracked as `GETYOURGUIDE: 0` by
default and remains editable in the general cost-estimator admin panel.

## HTTP and resilience behavior

`server/src/apis/getYourGuideApi.ts` owns the low-level request. It sends the
required `X-ACCESS-TOKEN` and `Accept: application/json` headers, reserves the
general API limiter and records request cost before every attempt, enforces a
timeout, and retries only bounded 429/5xx responses. It never retries invalid
credentials, other 4xx responses, malformed JSON/schema, timeouts, or aborts.
An in-process circuit breaker opens after repeated provider failures. Logs and
metrics contain status/error categories only—never tokens, user IDs, or raw
traveler text.

Responses are schema-validated and reduced to verified fields only: product ID,
name, duration, currency/price, locale, meeting point, cancellation,
accessibility, and server-side `lastVerifiedAt`. Product URLs, raw payloads,
images, and unverified claims are not retained.

## Callers and caching

`getYourGuideCallers.ts` provides named callers for itinerary and activity-tab
lookups. Cache keys are versioned hashes of destination/country, activity
concept, date bucket, party-size bucket, language, accessibility, budget, and
rounded coordinates; they never contain a user ID.

With written permission, positive and negative results use stale-while-
revalidate caching (fresh 15 minutes, stale up to 24 hours by default), with
single-flight de-duplication. Without permission, only an in-flight promise is
held and responses are discarded after completion. Cache hits avoid limiter
reservations and provider cost records; stale responses are returned
immediately while one background refresh runs.

Phase 4 schedules this work after the itinerary response/job is complete. It
is best-effort and bounded; no Partner API latency is added to itinerary
generation. A Phase-A descriptor remains the fallback when no normalized
product is available.

## Tests

The API tests mock all HTTP and cover successful normalization, negative and
malformed responses, 429/5xx retry bounds, 4xx behavior, timeout/abort,
circuit-open behavior, limiter denial, and cost-accounting failure. Caller
tests cover privacy-safe keys, stampede de-duplication, fresh/stale/negative
SWR behavior, generation budgets, and no-persistence mode.
