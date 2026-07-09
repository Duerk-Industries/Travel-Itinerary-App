# Itinerary Generation Request Replay

This document describes how to save itinerary-generation AI calls, how to replay the same request against multiple providers/models, and what fields the request accepts.

## Capture Settings

Use this setting to keep the raw prompt and model response text in local capture files:

```bash
ENABLE_RAW_AI_CAPTURE=1
```

Local/dev captures are written under:

```text
server/data/ai-capture/itinerary_generation/<YYYY-MM-DD>/<captureId>.json.gz
```

Without `ENABLE_RAW_AI_CAPTURE=1`, capture records still exist, but raw prompt/response text is stripped. In production, sanitized capture records are written to Google Cloud Storage. Set `AI_CAPTURE_BUCKET` to override the bucket; otherwise the app uses `LOCATION_BUCKET` with the `ai-capture/` object prefix.

Provider/model defaults for itinerary generation are:

```bash
AI_ITINERARY_PROVIDER=openai
AI_ITINERARY_MODEL=gpt-4o-mini
```

Supported provider ids are `openai`, `anthropic`, `gemini`, `zai`, and `openai_compatible`.

## Replay Command

The replay command reads one JSON request and runs it against one or more providers/models:

```bash
npm --prefix server run replay:itinerary -- \
  --request ./server/data/ai-replay/example-request.json \
  --models openai:gpt-4o-mini,anthropic:claude-sonnet-4-5 \
  --raw-capture
```

Outputs are written to `server/data/ai-replay/<timestamp>/` by default:

```text
01-openai-gpt-4o-mini.json
02-anthropic-claude-sonnet-4-5.json
summary.json
```

Each output JSON contains the run config, capture id, timestamps, and full `generateItineraryViaPromptPlan` result.

## Replay JSON Format

Use a wrapped file when comparing multiple models:

```json
{
  "outputDir": "server/data/ai-replay/california-comparison",
  "captureRaw": true,
  "runs": [
    { "provider": "openai", "model": "gpt-4o-mini", "label": "openai-mini" },
    { "provider": "anthropic", "model": "claude-sonnet-4-5", "label": "claude-sonnet" },
    { "provider": "gemini", "model": "gemini-2.5-flash", "label": "gemini-flash" }
  ],
  "request": {
    "destinations": ["California"],
    "days": 3,
    "budgetMin": 1000,
    "budgetMax": 5000,
    "departureAirport": "LAX",
    "tripStyle": "Explorer trip",
    "mustSeeAttractions": ["Yosemite Valley", "Golden Gate Bridge"],
    "tripStartDate": "2026-09-10",
    "tripEndDate": "2026-09-12",
    "promptTraits": {
      "tt": {
        "p": "B",
        "c": "M",
        "mob": "M",
        "car": "D",
        "is": "mixed",
        "w": {
          "outdoors": 20,
          "adventure": 15,
          "culture": 15,
          "food": 15,
          "nightlife": 5,
          "relax": 10,
          "photography": 10,
          "authentic_local": 5,
          "iconic_landmarks": 5
        }
      },
      "ut": {
        "po": "R",
        "mob": "M",
        "i": ["Hiking", "Museums"],
        "eb": false,
        "no": false
      }
    },
    "groupTraits": [
      { "userId": "traveler-1", "name": "Traveler 1", "traits": ["Museums", "Photography"] }
    ],
    "tripIdSeed": "california-replay"
  }
}
```

The script also accepts an unwrapped service request object directly. CLI `--models` overrides the file's `runs`.

## Service Request Fields

These are the fields consumed directly by `generateItineraryViaPromptPlan`.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `destinations` | Yes | `string[]` | Ordered destination names. The API route builds this from `locations` or `country`. |
| `days` | Yes | `number` | Positive trip duration. |
| `budgetMin` | Yes | `number` | Minimum total budget. Must be >= 0. |
| `budgetMax` | Yes | `number` | Maximum total budget. Must be >= `budgetMin`. |
| `groupTraits` | Yes | `{ userId, name, traits[] }[]` | Traveler profile traits. Use `[]` for no profile traits. |
| `apiKey` | No | `string` | Optional API key override for providers that support context API keys. Env vars are preferred. |
| `userId` | No | `string` | Enables user-scoped attraction shortlist loading and usage metadata. Omit for offline replay. |
| `usageWindowKey` | No | `string` | Usage accounting window, usually `YYYY-MM`. |
| `aiProvider.provider` | No | `string` | Per-request provider override. Prefer replay `runs` for comparisons. |
| `aiProvider.model` | No | `string` | Per-request model override. Prefer replay `runs` for comparisons. |
| `mustSeeAttractions` | No | `string[]` | Attractions the model should preserve in the itinerary. |
| `departureAirport` | No | `string` | Preferred origin airport or city. |
| `tripStyle` | No | `string` | Free-text style hint, such as `Explorer trip` or `Family-friendly`. |
| `promptTraits.tt` | No | object | Trip-level prompt profile. See below. |
| `promptTraits.ut` | No | object | Current user profile overrides. See below. |
| `tripStartDate` | No | `YYYY-MM-DD \| null` | Exact start date. |
| `tripEndDate` | No | `YYYY-MM-DD \| null` | Exact end date. |
| `tripStartMonth` | No | `number \| null` | Month number when exact dates are unknown. |
| `tripStartYear` | No | `number \| null` | Year paired with `tripStartMonth`. |
| `tripIdSeed` | No | `string` | Used as capture/job id seed. |
| `captureId` | No | `string` | Explicit capture id. Replay sets one per model run. |

## API Route Body Fields

The HTTP route `/api/itinerary` and async route `/api/itinerary/async` accept the user-facing request body:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `country` | Conditionally | `string` | Required when `locations` is empty. Used as the destination summary. |
| `locations` | Conditionally | `string[]` | Preferred over `country`; at least one of `locations` or `country` is required. |
| `mustSeeAttractions` | No | `string[]` | Mapped to service `mustSeeAttractions`. |
| `days` | Yes | `number` | Positive duration. |
| `budgetMin` | Yes | `number` | Minimum budget. |
| `budgetMax` | Yes | `number` | Maximum budget. |
| `departureAirport` | No | `string` | Mapped to service `departureAirport`. |
| `tripId` | Yes | `string` | Required so the server can load group/user profile traits and trip dates. |
| `tripStyle` | No | `string` | Mapped to service `tripStyle`. |
| `tt` | No | object | Trip-level prompt traits. |
| `ut` | No | object | Current-user prompt trait overrides. |
| `itineraryId` | Async only | `string` | Used by the async route to attach generated details/items to an existing itinerary. |
| `idempotencyKey` | No | `string` | May also be supplied with the `Idempotency-Key` header. |

## Prompt Trait Fields

`promptTraits.tt` describes the trip-wide profile:

| Field | Required | Values | Meaning |
| --- | --- | --- | --- |
| `p` | No | `R`, `B`, `F` | Pace: Relaxed, Balanced, Fast. |
| `c` | No | `B`, `M`, `L` | Comfort: Budget, Midrange, Luxury. |
| `mob` | No | `L`, `M`, `H` | Mobility: Low, Medium, High. |
| `car` | No | `P`, `D`, `R` | Car preference: PublicTransitOnly, DayTripsOnly, FullTripRental. |
| `is` | No | `self_guided`, `mixed`, `guided` | Interaction style. |
| `w` | No | weights object | Interest weights. The server normalizes them to sum to 100. |

Interest weight keys are:

```text
outdoors, adventure, culture, food, nightlife, relax, photography, authentic_local, iconic_landmarks
```

`promptTraits.ut` describes the current user's profile overrides:

| Field | Required | Values | Meaning |
| --- | --- | --- | --- |
| `po` | No | `R`, `B`, `F` | User pace override; wins over trip pace. |
| `mob` | No | `L`, `M`, `H` | User mobility override; wins over trip mobility. |
| `i` | No | `string[]` | User interest labels, such as `Hiking`, `Museums`, `Food`. |
| `eb` | No | `boolean` | Early-bird preference. |
| `no` | No | `boolean` | Night-owl preference. |

`groupTraits` comes from traveler profiles for the trip. Each item includes a profile owner and their trait names:

```json
{ "userId": "traveler-1", "name": "Alex", "traits": ["Museums", "Low mobility"] }
```

## Provider Env Vars

Provider API keys:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
ZAI_API_KEY=...
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1
```

Optional model lists:

```bash
OPENAI_MODELS=gpt-4o-mini,gpt-5-mini
ANTHROPIC_MODELS=claude-sonnet-4-5
GEMINI_MODELS=gemini-2.5-flash
ZAI_MODELS=glm-4.7
OPENAI_COMPATIBLE_MODELS=llama-3.1-8b-instruct
```
