# AI Request Replay

This document describes how to save itinerary-generation AI calls, how to replay the same request against multiple providers/models, and what fields the request accepts.

## Capture Settings

Use this setting to keep the raw prompt and model response text in local capture files:

```bash
ENABLE_RAW_AI_CAPTURE=1
```

Local/dev captures are written under:

```text
server/logs/ai-capture/itinerary_generation/<YYYY-MM-DD>/<captureId>.json.gz
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
  --request ./server/logs/ai-replay/example-request.json \
  --models openai:gpt-4o-mini,anthropic:claude-sonnet-4-5 \
  --raw-capture
```

Outputs are written to `server/logs/ai-replay/<timestamp>/` by default:

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
  "outputDir": "server/logs/ai-replay/california-comparison",
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

The script also accepts these input shapes directly:

- An unwrapped service request object with `destinations`.
- The API route body shape with `locations` or `country`.
- A compact prompt request object with `"$": "req1"`.
- A saved replay output containing `result.promptRequest`.
- A raw `itinerary_generation` capture record, as long as it was captured with `ENABLE_RAW_AI_CAPTURE=1` so the first stage contains `userPrompt`.

CLI `--models` overrides the file's `runs`.

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

## Parsing Replay Command

You can also replay parsing requests against multiple AI models from the command line.

Replay an existing intake/import job id:

```bash
npm --prefix server run replay:parsing -- \
  --intake <intakeId> \
  --models openai:gpt-4o-mini,anthropic:claude-sonnet-4-5
```

Multiple LLMs can also be passed as repeated `--llm` flags:

```bash
npm --prefix server run replay:parsing -- \
  --intake <intakeId> \
  --llm openai:gpt-4o-mini \
  --llm anthropic:claude-sonnet-4-5
```

This path uses the existing parsing replay service. It requires the original import payload and source bytes to still be available through the configured DB/storage backend. Use `--dry-run` to avoid persisting replay captures.

Replay a standalone normalized document JSON file:

```bash
npm --prefix server run replay:parsing -- \
  --request ./server/logs/ai-replay/parsing/example-parse-request.json \
  --models openai:gpt-4o-mini,gemini:gemini-2.5-flash \
  --persist-capture
```

Outputs are written to `server/logs/ai-replay/parsing/<timestamp>/` by default. Each output includes the selected provider/model, parsed LLM result, optional comparison report, and any error details. The command also writes `comparison.csv`, with one row per item field found by any parser and one value column per parser/model. It also writes `validation.json`, a codegen-oriented gap report containing fields where at least two successful AI model runs agree on the extracted value and the non-LLM parser is missing or different. LLM runs that are marked `skipped` in `summary.json` are omitted from both comparison artifacts.

Replay a local source file such as a PDF through both parser paths:

```bash
npm --prefix server run replay:parsing -- \
  --file "./test_inputs/transfers/Boston to Los Angeles.pdf" \
  --both-paths \
  --models openai:gpt-4o-mini,openai:gpt-5.4-mini \
  --out ./server/logs/ai-replay/parsing/boston-to-los-angeles
```

This mode first normalizes the source file, then writes:

- `00-normalized-document.json` - normalized text and metadata used by both paths
- `01-non-llm.json` - source-specific parser result, falling back to regex when needed
- `02-<model>.json`, `03-<model>.json`, etc. - LLM parser results compared against the non-LLM result
- `comparison.csv` - field-superset comparison across non-LLM and every requested LLM parser
- `validation.json` - fields to add or adjust in the non-LLM parser, based on agreement from at least two AI models

Replay every supported local source file in a directory:

```bash
npm --prefix server run replay:parsing -- \
  --dir ./test_inputs/transfers \
  --llm openai:gpt-4o-mini \
  --llm anthropic:claude-sonnet-4-5 \
  --out ./server/logs/ai-replay/parsing/transfers-batch
```

Directory mode scans only files directly inside the input directory with supported source extensions: `.pdf`, `.png`, `.jpg`, and `.jpeg`. It creates one output subdirectory per input file, each with its own `comparison.csv`, `validation.json`, per-run JSON files, and `summary.json`. The root output directory also gets a batch `summary.json` with the per-file output paths.

`validation.json` is intended as input for an LLM code generator. Its `gaps` list includes only AI-consensus fields that the deterministic parser did not capture:

```json
{
  "purpose": "non_llm_parser_update_validation",
  "sourceFile": "C:\\Git\\...\\Boston to Los Angeles.pdf",
  "nonLlmParser": "non-llm",
  "aiModels": ["openai-gpt-4o-mini", "anthropic-claude-sonnet-4-5"],
  "gaps": [
    {
      "itemIndex": 1,
      "itemType": "flight",
      "fieldName": "departureDate",
      "consensusValue": "2024-06-08",
      "nonLlmStatus": "missing",
      "agreementCount": 2,
      "agreeingModels": ["openai-gpt-4o-mini", "anthropic-claude-sonnet-4-5"]
    }
  ]
}
```

### Parsing Replay JSON Format

```json
{
  "outputDir": "server/logs/ai-replay/parsing/hotel-comparison",
  "runs": [
    { "provider": "openai", "model": "gpt-4o-mini", "label": "openai-mini" },
    { "provider": "anthropic", "model": "claude-sonnet-4-5", "label": "claude-sonnet" }
  ],
  "doc": {
    "importJobId": "hotel-email-001",
    "userId": "cli-replay-user",
    "sourceType": "GMAIL_IMPORT",
    "sourceId": "gmail",
    "originalFilename": "hotel-confirmation.txt",
    "mimeType": "text/plain",
    "contentHash": "hotel-email-001",
    "normalizedContentHash": "hotel-email-001-normalized",
    "normalizedText": "Hotel confirmation text goes here...",
    "extractedTextSource": "text",
    "normalizationQuality": "FULL_TEXT",
    "rawSourceReference": "local:hotel-confirmation.txt",
    "metadata": {},
    "receivedAt": "2026-07-09T00:00:00.000Z",
    "correlationId": "hotel-email-001"
  },
  "productionItems": [
    {
      "itemType": "hotel",
      "providerVendor": "Example Hotel",
      "confirmationNumber": "ABC123",
      "confidenceScore": 0.91,
      "reviewStatus": "READY_FOR_REVIEW",
      "extractedFields": {
        "name": "Example Hotel",
        "checkInDate": "2026-09-10",
        "checkOutDate": "2026-09-12"
      }
    }
  ]
}
```

`doc.normalizedText` is the key required field for standalone parsing replay. The script fills defaults for missing metadata fields, but supplying the full `NormalizedDocument` makes comparisons easier to trace.

`productionItems` is optional. When present, the script compares each model's parsed output against those captured/expected items using the same comparison engine as shadow parsing.

Parsing provider defaults are controlled by:

```bash
AI_INGESTION_LLM_PROVIDER=openai
AI_INGESTION_LLM_MODEL=gpt-4o-mini
```
