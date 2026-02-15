# API Usage FAQ

## How broad is the current API surface?

- 81 route handlers across `server/src/routes/*`.

## What are the main API domains?

- Auth: `authRoutes`, `webAuthRoutes`
- Account/family/fellow-travelers: `accountRoutes`
- Groups/invites: `groupsRouter`
- Trips/wizard/covered-by: `tripRoutes`
- Flights/lodging/tours: CRUD + expense sync
- Manual expenses: `expenseRoutes`
- Itinerary generation and itinerary records/details
- Traits and demographics
- Place search and location option endpoints

## Are any endpoints placeholders or intentionally limited?

- `GET /api/trips/followed` returns `[]` placeholder data.
- `POST /api/trips/follow` returns `501`.
- `GET /api/trips/:id/follow-code` returns `501`.
- `GET /api/places/:placeId` currently returns `404` ("temporarily unavailable").

## What key validation/authorization rules should clients expect?

- Most feature endpoints require `Authorization: Bearer <token>`.
- Trip/group membership checks gate writes for trips, flights, lodging, tours, and expenses.
- Passenger/payer/traveler IDs are validated against trip/group members.
- Covered-by rules reject cycles and conflict states.
- Flights, lodging, and tours create/update routes synchronize source-backed expense records.

## What external APIs/services are used?

Backend:

- OpenAI Chat Completions for itinerary generation
- Unsplash for destination imagery
- Google Cloud Storage for image cache/signed URLs
- SMTP via Nodemailer for verification/invite/share emails

Client:

- Frankfurter exchange-rate API
- Google Static Maps URL helper

Note: Google Places integration is mostly stubbed/disabled in `server/src/googlePlaces.ts`.

## How are API limits configured?

Set limits in `server/config/api-limits.yaml`:

Example structure:

```yaml
providers:
  OPENAI:
    window: hour
    windowHours: 24
    overall: 200
    callers:
      ITINERARY_GENERATE_PLAN: 200
```

Optional path override:

- `API_LIMITS_CONFIG_PATH`

## What happens when limits are reached?

- Usage is tracked per provider and per caller by UTC time window.
- Default window is `day`; Unsplash defaults to `hour`.
- For hourly windows, set duration with `windowHours` (for example `24`).
- Logs are emitted at `50%`, `75%`, `90%`, and `100%`.
- Calls are blocked at `100%` of configured limit.
- Missing/invalid/non-positive values are treated as unlimited for that scope.
