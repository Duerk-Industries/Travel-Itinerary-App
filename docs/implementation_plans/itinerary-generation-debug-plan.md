# Itinerary Generation Debug/Fix Plan

## What failed in the observed run
- Trip creation and itinerary record creation succeeded (`POST /api/trips/wizard`, `POST /api/itineraries`).
- AI generation did not run (`POST /api/itinerary` was not called).
- Because AI generation did not run, no `generatedItems` were produced, so no `Needed` transfers/lodgings/activities were posted.

## Debug instrumentation added
- Server (`/api/itinerary`) now logs:
  - request start context (trip, destination, days, budget, departure)
  - group-traits load count
  - trip date context resolution
  - generation result counts (details/transfers/lodgings/activities/car rentals)
  - request elapsed time and failure marker
- Prompt-plan service now logs each stage transition:
  - stage start and response size
  - sanitized output summary per stage
  - final generated-items counts and markdown fallback usage
- Wizard submit flow now logs:
  - whether itinerary setup runs or is skipped
  - itinerary record creation result
  - AI generation start/success/failure
  - generated-item save summary

## Fix plan
1. Make itinerary generation intent explicit in UI:
   - show a required/clear toggle choice for "Generate AI itinerary now" vs "Skip for now".
2. Prevent silent skip:
   - if itinerary step is enabled and both manual items and AI generation are off, show blocking validation (or explicit confirmation).
3. Persist a generation status on itinerary record:
   - `pending`, `generated`, `skipped`, `failed` with `reason`.
4. Surface generation status in UI:
   - show why details/items are empty (skipped vs failed) and a one-click "Generate now".
5. Add retry and backfill:
   - regenerate from existing itinerary record and then post `Needed` items.

## Related tests
- `app/tests/itineraryGeneration.test.ts`
  - verifies `Needed` transfers/lodgings/activities/car-rentals are created from generated items.
  - verifies preferred-airport grouping and owner fallback for terminal flights.
  - verifies no terminal preferred-airport flights are added when no preferred airport exists.
- `server/__tests__/itinerary-traits.test.ts`
  - verifies `/api/itinerary` returns `generatedItems` including `Needed` transfers, lodgings, and activities.
