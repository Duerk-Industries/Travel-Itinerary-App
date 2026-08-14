# Cached Itinerary Schema — Design Spec

**Scope:** shared activity/location content plus a low-cost, deterministic **road-trip-lite** overlay built only
from lodging, transfer, destination, and date data already supplied to the trip. Property discovery/booking,
global route optimization, and live traffic/weather are not part of the baseline; narrowly scoped provider
enhancements remain optional, independently flagged, capped, cached, costed, and safe to omit.

**Design goal:** move the lightweight LLM from *generating an itinerary* to *binding cached blocks into a cached
day shape*. Everything the user reads is pre-written and pre-validated; the model emits a short assignment
object containing IDs and reason codes, not prose. Code—not the LLM—owns route-time arithmetic, opening-hour
checks, base-stay assignment, hard deadlines, slack, optional-stop cuts, and whole-day variant selection.

**Status:** implementation plan, not the current production schema. This design must evolve the existing
`itineraryPlanCacheService.ts` and its Postgres/Firebase adapter methods; it must not create a second,
independent itinerary cache. Section 16 defines the migration and release gates.

### Non-negotiable production constraints

- Shared cache entries contain only allowlisted, traveler-independent data. Names, account/trip IDs,
  free-form traits, must-see text, home locations, reservations, and provider credentials never enter a
  shared key or value.
- A cache hit is a candidate, not proof of compatibility. Current hard constraints, closures, corpus
  dependencies, and the deterministic validator run after every read.
- Every external call, internal storage operation, retained byte, queue job, and background retry is
  admitted through the standard limiting architecture and appears in both runtime cost accounting and
  `server/config/cost-model.yaml`. A missing finite cap or price entry blocks rollout of the component.
- Major serving, binding, write-through, authoring, and prepopulation components have independent
  server-side feature flags and kill switches. Flags are checked again inside workers, not only at enqueue.
- Road-trip-lite has a provider-free baseline. Enabling it cannot implicitly enable routing, weather, schedule,
  geocoding, or other provider calls; every live enhancement has its own flag, finite caller cap, cache policy,
  cost record, and deterministic fallback.
- Cache and provider exhaustion may reduce personalization, but must never trigger an unmetered expensive
  fallback. The user receives the best bounded deterministic result plus an honest, actionable notice.
- Generated corpus material is untrusted. It cannot become live without independent evidence, schema/CI
  validation, human review, an auditable promotion record, and a reversible corpus release.

---

## 0. Relationship to the existing prompt-based pipeline

This is the question a reader hits first and the design did not previously answer: **is this a replacement
for the itinerary generator that ships today, or a new path alongside it?** It is the latter, and that must
be explicit before any other section, because it changes the blast radius of every flag, cache key, and cost
line item below.

`server/src/services/itineraryPromptPlanService.ts` (`ITINERARY_PIPELINE_VERSION = 'itinerary-pipeline-v8'`,
~3,800 lines) is a mature, already-shipped, staged full-generation pipeline: P0 normalize → P1 route → P2 days
→ P3 validate → P3b targeted repair → P4 render, each stage its own provider caller
(`ITINERARY_PLAN_P0_NORM` … `ITINERARY_PLAN_P4_RENDER` in `api-limits.yaml`), with its own route/day cache via
the very `readItineraryPlanCache`/`writeItineraryPlanCache` functions this design proposes to extend, plus its
own cost-control knobs already live in `caching.itineraryPlan.*` in `api-limits.yaml` — chunking, escalation,
shadow sampling, deterministic day-fill and day-fill-repair, skip-validator-when-clean. This system is not a
stub; it is the one currently generating every itinerary in production.

**This design does not replace it, touch its prompts, or remove its cache entries.** Binding-plan-v2 is a new,
narrower-scope serving path that only activates for destinations with a promoted corpus release. Concretely:

- `itineraryPlanCacheService.ts`'s `stage` parameter gains a third literal value, `'binding_plan'`, alongside
  the existing `'route'` and `'day'` (already reflected in §16.2's schema table). Cache keys and rows for the
  two systems never collide, and legacy `'route'`/`'day'` reads/writes are completely unaffected by this
  proposal at every rollout stage.
- Every location without a live corpus release — which is every location at launch, and the long tail
  indefinitely per §11's coverage targets — continues to be served exactly as today, through
  `itineraryPromptPlanService.ts`, with no behavior change and no new flag in its path. The "Tier 2 — cold"
  behavior in §10 is a bounded *interim* baseline shown while corpus authoring catches up for a destination
  that is on the corpus roadmap; it is not, and must not become, a second fallback generator competing with
  the existing one. For any location not being actively prepopulated, Tier 2 exhaustion routes straight to
  the existing pipeline unchanged, not to a bespoke degraded response.
- The `itinerary_block_cache` master flag (§18) gates only the new path's entry point. With it off, request
  routing is byte-for-byte what it is today — the flag check happens before any binding-plan-v2 code runs,
  not as a fallback caught after a failure.
- For a corpus-covered multi-base trip, the optional road-trip-lite pass runs after a valid binding plan and
  before rendering. It derives private base stays, travel legs, deadlines, and variants from the request's
  existing trip records; it does not put reservation or traveler data into shared cache entries. If its flag
  is off or its validation fails, the binding plan still renders through the normal path with no provider call.
- Cost and limit accounting for the two systems are additive, not overlapping: P0–P4's existing
  `ITINERARY_PLAN_P*` callers and `caching.itineraryPlan.*` settings keep their current meaning and budgets;
  §17's new `ITINERARY_BLOCK_BIND` / `ITINERARY_CORPUS_AUTHOR` / `ITINERARY_CACHE_STORAGE` /
  `ITINERARY_CACHE_JOBS` entries are entirely new provider/caller rows, never a reinterpretation of the
  existing ones. A request that falls through from binding-plan-v2 to the legacy pipeline is billed under the
  legacy pipeline's existing callers exactly as an unflagged request would be — it does not pay for both paths.
- Deprecating or retiring P0–P4 for corpus-covered destinations is plausible future work once binding-plan-v2
  has years, not months, of production evidence — but it is a separate proposal with its own rollout and
  rollback plan. Nothing in this document authorizes removing or bypassing the existing pipeline's validation,
  budget, or safety behavior.
- [x] **Implementation Note:** `reserveApiUsageOrThrow` and `atomicIncrementApiUsageIfUnderLimit` have been
  extended to support a `units` parameter (defaulting to 1). This allows reserving byte-weighted or
  token-weighted units against the standard architecture, rather than only counting request events.
  The DB adapters now check `count + units <= limit` atomically.

If a future revision of this design decides binding-plan-v2 should *call into* P0–P4 (for example, using P4's
renderer for prose that binding-plan-v2 does not otherwise produce) rather than remain fully independent, that
decision needs its own subsection here with the same rigor as everything else in this document — a silent
dependency between the two systems is exactly the kind of thing that turns two independently-reasoned-about
caches into one under-tested one.

---

## 1. Layer model

Six layers. Four may be shared; logistics and the rendered trip remain private and request-scoped.

| Layer | Cached? | Owns | Changes when |
|---|---|---|---|
| **LocationProfile** | Yes | Geography, zones, seasonality, rhythm | Rarely (annual review) |
| **ActivityBlock** | Yes | A single doable thing, with prose | Occasionally (venue churn) |
| **DayTemplate** | Yes | Abstract slot sequence + energy budget | Rarely |
| **BindingPlan** | Yes, if shared-safe | Block IDs, slot IDs, reason codes, dependency versions | On a compatible normalized request |
| **TripLogisticsOverlay** | Never in shared cache | Base stays, legs, deadlines, slack, checkpoints, day variants | Every request or private trip edit |
| **ItineraryInstance** | Never in shared cache | Private overlays, pinned items, dates, booking state, rendered copy | Every request |

The LLM only ever proposes the fourth layer, and only as allowlisted IDs plus reason codes. Code validates
that proposal, derives the fifth layer without inference, and renders the sixth by joining both against an
immutable corpus release. This is what
makes the caching pay for itself: output tokens collapse from a full document to an assignment map while
private trip data remains outside the shared value.

---

## 2. LocationProfile

One per destination. The `zones` array is the single most load-bearing field — without it the model produces days that crisscross the map.

```jsonc
{
  "location_id": "loc_lisbon",
  "name": "Lisbon",
  "location_type": "city",          // discriminator for the extension object
  "country_code": "PT",
  "timezone": "Europe/Lisbon",

  "zones": [
    {
      "zone_id": "z_alfama",
      "name": "Alfama & Graça",
      "name_local": "Alfama",
      "centroid": [38.7118, -9.1300],
      "traversal": "walk",
      "terrain_note": "steep, cobbled",
      "adjacency": [
        { "zone_id": "z_baixa", "minutes": 15, "mode": "walk" },
        { "zone_id": "z_belem", "minutes": 35, "mode": "tram",
          "line": "15E", "from_stop": "Praça da Figueira", "to_stop": "Belém" }
      ],

      "lodging": {
        "suitable": true,
        "rationale_by_trip_shape": {
          "culture_walk":  "Walk to the castle, cathedral, and miradouros; no transit needed for 2 of 3 days.",
          "food_nightlife": "Fado houses and tascas at street level, but steep stairs everywhere and noise until late.",
          "family":        "Avoid — the hills are punishing with a stroller. Use Baixa instead."
        },
        "access_note": "Tram 28 and metro Santa Apolónia; no direct airport link.",
        "cost_band": "mid",
        "alternative_zone_id": "z_baixa",
        "alternative_reason": "flatter, better transit, less atmosphere"
      }
    }
  ],

  "season_windows": [
    { "label": "peak",     "months": [6,7,8],        "crowd_factor": 1.0, "heat_flag": true },
    { "label": "shoulder", "months": [4,5,9,10],     "crowd_factor": 0.6 },
    { "label": "low",      "months": [11,12,1,2,3],  "crowd_factor": 0.3, "rain_flag": true }
  ],

  "local_rhythm": {
    "typical_dinner_start": "20:30",
    "midday_closure": null,
    "market_mornings": ["saturday"],
    "common_closure_day": "monday"        // drives museum-day placement
  },

  "default_day_template_id": "tpl_city_moderate",
  "extension": { /* see §5 */ }
}
```

`common_closure_day` alone prevents a whole class of embarrassing output.

---

## 3. ActivityBlock — the atomic cached unit

This is your cache's inventory. Everything the user reads about an activity lives here, pre-written and human-reviewed. The LLM never rewrites it.

```jsonc
{
  "block_id": "blk_lis_jeronimos",
  "location_id": "loc_lisbon",
  "zone_id": "z_belem",

  "role": "anchor",              // anchor | supporting | filler | meal | rest | contingency
  "category": "monument",        // for variety enforcement across days
  "title": "Jerónimos Monastery",
  "name_local": "Mosteiro dos Jerónimos",
  "name_script": null,

  "copy": {
    "teaser": "Manueline stonework at its most extravagant.",
    "body": "Pre-written 2–3 sentence description. Never regenerated.",
    "insider_tip": "Enter via the church side after 15:00; the cloister queue thins.",
    "etiquette": "Church side is active worship — cover shoulders, no flash.",
    "priority_signal": "dont_skip"      // dont_skip | most_visitors_miss | optional
  },

  "timing": {
    "optimal_arrival": "before 10:00 or after 15:00",
    "hard_deadline": null,
    "time_box": null,                   // e.g. "start by 08:00, down by 13:30"
    "after_dark_value": false
  },

  "seasonal_caveats": {                 // honest negatives, keyed by month
    "7": "Peak queue month — expect 45+ min without a timed ticket.",
    "8": "Peak queue month — expect 45+ min without a timed ticket."
  },

  "cost_band": { "currency": "EUR", "low": 12, "high": 18, "note": "combined with Torre" },

  "duration_minutes": { "typical": 90, "min": 45, "max": 150 },

  "time_fit": {                  // weights, not hard windows
    "early_morning": 0.9, "morning": 1.0, "midday": 0.4,
    "afternoon": 0.7, "evening": 0.0, "night": 0.0
  },

  "energy_cost": 2,              // 1–5; summed against the day's budget
  "setting": "indoor",           // indoor | outdoor | mixed  → weather contingency
  "weather_dependent": false,

  "availability": {
    "closed_days": ["monday"],
    "season_window": { "months": [1,2,3,4,5,6,7,8,9,10,11,12] },
    "operating_schedule": {
      "timezone": "Europe/Lisbon",
      "weekly": {
        "tuesday": [{ "opens": "10:00", "closes": "17:30", "last_entry": "16:45" }]
      },
      "seasonal_overrides": [
        { "from": "2026-10-01", "through": "2027-04-30", "closes": "17:00" }
      ],
      "exceptions": [
        { "date": "2026-12-25", "status": "closed", "note": "Public holiday" }
      ],
      "evidence_id": "ev_lis_jeronimos_hours_2026_06",
      "verified_at": "2026-06-01T12:00:00Z",
      "confidence": "verified"       // verified | provisional | unknown
    },
    "booking_lead_days": 2,      // >0 surfaces a "book ahead" warning
    "ticket_required": true,
    "sells_out_risk": "high",
    "booking_window_opens": "rolling_60d",  // rolling_Nd | annual:MM-DD | lottery:Nd
    "booking_note": "Timed entry released 60 days out; 09:30 slots go first."
  },

  "placement_rationale": {       // why the generator put this on THIS day
    "avoid_days": { "monday": "closed", "sunday": "free entry — three deep in the cloister" },
    "prefer_days": { "tuesday": "quietest of the week" },
    "sequence_note": "Pair with Torre de Belém — 10 min apart, same ticket window."
  },

  "interest_weights": {         // 1–10 each, all nine always present — see §3.1
    "outdoors": 2,
    "adventure": 1,
    "culture": 10,
    "food": 1,
    "nightlife": 1,
    "relaxing": 3,
    "photography": 8,
    "authentic_local": 3,
    "iconic_landmarks": 9
  },

  "audience": {
    "min_interesting_age": 8,
    "accessibility": {
      "step_free": true, "seating_available": true,
      "max_continuous_standing_min": 40, "sensory_load": "low"
    }
  },

  "relations": {
    "pairs_well_with": ["blk_lis_pasteis_belem", "blk_lis_torre_belem"],
    "conflicts_with": ["blk_lis_mosteiro_tour_guided"],   // same content, don't co-schedule
    "substitutes_for": ["blk_lis_se_cathedral"],          // KEY: cheap swap target
    "prerequisite_of": null,
    "foreshadows": ["blk_lis_maritime_museum"],
    "complements": ["blk_lis_river_walk"],
    "duplicates": ["blk_lis_mosteiro_tour_guided"],
    "skip_if_completed": []
  },

  "ops": {
    "crowd_peak": ["10:00-13:00"],
    "volatility": "low",         // low | medium | high → freshness re-check cadence
    "last_verified": "2026-06-01",
    "source": "curated"          // curated | partner | llm_draft
  }
}
```

### Notes on three fields that do disproportionate work

- **`substitutes_for`** is what turns modification into a cheap operation. A swap becomes `{"replace": "blk_a", "with": "blk_b"}` rather than a regenerated day.
- **`role`** enforces structure. A day is not a bag of activities; it's an anchor plus supporting cast. Research is unanimous that overscheduling is the dominant failure mode, and roles let you cap anchors per day directly.
- **`volatility`** drives your staleness pipeline. A cathedral is `low`; a pop-up food hall is `high`. Re-verification cost scales with this rather than uniformly across the corpus.
- **`operating_schedule`** is complete only for anchors, booked items, and other time-critical blocks. Supporting
  blocks may retain `closed_days` plus `confidence: unknown`; the renderer then asks the traveler to verify.
  This concentrates verification cost where an error can break the day.
- **Cross-day relations** (`foreshadows`, `complements`, `duplicates`, and `skip_if_completed`) preserve narrative
  and prevent repetition without another prompt. They are advisory except `duplicates` and
  `skip_if_completed`, which the deterministic validator treats as exclusion rules.

---

## 3.1 The interest vector

Nine fixed dimensions, every block scored 1–10 on **all nine**. No nulls, no sparse tags. A fixed-length dense vector means matching is arithmetic rather than set intersection, which keeps it in code and out of the model.

| Dimension | Scores high when the block is about… | Does *not* mean |
|---|---|---|
| `outdoors` | Being outside in nature — trails, coast, parks, gardens | Merely happening outdoors (a street market is food, not outdoors) |
| `adventure` | Physical challenge, adrenaline, mild risk, effort | Novelty alone |
| `culture` | History, art, architecture, religion, museums, local heritage | Any old building |
| `food` | Eating or drinking as the point — meals, markets, tastings, cooking | A café attached to a museum |
| `nightlife` | After dark and social — bars, live music, clubs, late scenes | A restaurant that happens to open at 20:00 |
| `relaxing` | Low effort, low decision load, restorative | Anything merely short |
| `photography` | Visually exceptional, or with a specific known shot | Generically pretty |
| `authentic_local` | Where residents actually go; low tourist density | Marketed as authentic |
| `iconic_landmarks` | The thing on the postcard; the reason people know the city | Locally famous |

### Scoring rubric — enforce this with authors

| Score | Meaning |
|---|---|
| 1–2 | Absent or incidental |
| 3–4 | Present but not why you'd go |
| 5–6 | A genuine part of the experience |
| 7–8 | A primary reason to go |
| 9–10 | Among the best in the destination for this dimension |

**9 and 10 are budgeted, not earned.** Cap them per location per dimension — roughly 2–3 blocks may score ≥9 on `culture` in Lisbon, no more. Without a cap, authors inflate and the vector loses all discriminating power within about two months of corpus growth.

### Matching

User profile uses the same nine dimensions, same 1–10 scale, from onboarding sliders or inferred from prior trips. Score with **mean-centered cosine similarity**:

```
score(block, user) = cos( b − m , u − m )      where m = per-dimension corpus mean
```

Two corrections are folded into that formula, both of which matter more than they look.

**Normalize (cosine, not dot product).** A user who rates everything 8 and a user who rates everything 3 have identical *preferences* and should get identical itineraries. A raw dot product would give the first user higher scores on everything and skew the top-N cut toward whichever blocks happen to have large vectors overall.

**Center before comparing.** Every vector on a 1–10 scale sits in the positive orthant, so raw cosine between any two blocks is bounded well away from zero — measured over a sample corpus, raw pairwise cosine spanned only `[0.61, 1.00]`, a usable range of 0.39, with a mean of 0.78. Subtracting the per-dimension corpus mean restores the full `[-1, +1]` range: the same pairs spanned `[-0.75, +0.98]`, a range of 1.73. **Roughly 4× the discriminating power for one subtraction.** Without centering, every block looks like a decent match for every user and the ranking is dominated by shared baseline rather than by preference.

Use a **global** corpus mean, recomputed on a schedule and pinned as a constant. Per-location means make fit scores incomparable across destinations and shift every time a block is authored.

Then apply the location-type floor: on a `hiking_region` trip, blocks scoring <4 on both `outdoors` and `adventure` are dropped regardless of score. Someone with a food-heavy profile visiting a national park still gets a park trip.

**Flat profiles bypass this entirely.** If a user's max dimension minus their mean is under ~2, centering amplifies noise rather than signal. Detect it and fall back to `default_rank`.

### Known dimension tensions

Three pairs are close to mutually exclusive in practice. Flag violations in authoring QA rather than forbidding them:

- `iconic_landmarks ≥ 8` **and** `authentic_local ≥ 7` — rare and usually an authoring error. The Eiffel Tower is not where locals go. Genuine exceptions exist (a working market that is also the postcard image) but should be reviewed individually.
- `adventure ≥ 7` **and** `relaxing ≥ 7` — near-contradictory; usually means the author scored intent rather than experience.
- `nightlife ≥ 7` on a block whose `time_fit.evening` and `time_fit.night` are both < 0.5 — internally inconsistent.

---

## 3.2 SubstitutionGroup — 3–4 blocks per anchor slot

An anchor slot is filled from a group, never from a single block. This is the homogenization fix and the cheap-modification mechanism in one structure.

```jsonc
{
  "group_id": "grp_lis_morning_anchor_belem",
  "location_id": "loc_lisbon",
  "zone_id": "z_belem",
  "role": "anchor",
  "period_fit": ["early_morning", "morning"],

  "members": [
    { "block_id": "blk_lis_jeronimos",     "dominant": "culture",          "default_rank": 1 },
    { "block_id": "blk_lis_torre_belem",   "dominant": "iconic_landmarks", "default_rank": 2 },
    { "block_id": "blk_lis_maat",          "dominant": "photography",      "default_rank": 3 },
    { "block_id": "blk_lis_tropical_gdn",  "dominant": "relaxing",         "default_rank": 4 }
  ],

  "coverage_check": {
    "distinct_dominants": 4,
    "max_centered_cosine": 0.42,
    "duration_spread_min": 45
  }
}
```

### The authoring rule that makes this work

A group of four blocks that all score `culture: 9` gives you four ways to write the same itinerary. The group must **span** the interest space, not cluster in it.

Enforce at authoring time:

- **Distinct dominant dimension per member.** No two members share a top-scoring dimension.
- **Max mean-centered pairwise cosine ≤ 0.75** across members. Above that they're substitutes in name only. Calibrated against known-good and known-duplicate groups: a genuinely duplicative pair (two similar cathedrals) scored +0.98, while the tightest acceptable pair in a well-spanned group scored +0.69. Use the centered form — raw cosine puts those at 1.00 and 0.96 respectively, which is not a usable gap.
- **Comparable duration and energy.** Members must be interchangeable in the same slot — `duration_minutes.typical` within ±40% and `energy_cost` within ±1. A 90-minute museum and a 4-hour day trip are not substitutes.
- **Same zone**, or adjacent zones within 15 minutes. Swapping a block must not break the day's geographic coherence.
- **`default_rank`** gives you a deterministic Tier-0 answer and a fallback when the user profile is empty or flat.

Groups become the unit of authoring. "Cover Lisbon" means building ~8–10 groups, not 40 loose blocks — and the coverage check tells you when a group is finished.

---

## 4. DayTemplate — the cached shape

Abstract slots, no content. This encodes the pacing wisdom once, centrally, instead of hoping the model rediscovers it per request.

```jsonc
{
  "template_id": "tpl_city_moderate",
  "applies_to": { "location_type": "city", "pace": "moderate" },
  "energy_budget": 8,
  "max_anchors": 2,
  "max_zones_per_day": 2,

  "slots": [
    { "slot_id": "s1", "period": "morning",   "role": "anchor",     "required": true,
      "source": "substitution_group" },
    { "slot_id": "s2", "period": "midday",    "role": "meal",       "required": true,
      "source": "substitution_group" },
    { "slot_id": "s3", "period": "afternoon", "role": "supporting", "required": false,
      "source": "block_pool" },
    { "slot_id": "s4", "period": "afternoon", "role": "rest",       "required": false,
      "note": "unstructured — leave empty deliberately" },
    { "slot_id": "s5", "period": "evening",   "role": "meal",       "required": true,
      "source": "substitution_group" },
    { "slot_id": "s6", "period": "evening",   "role": "filler",     "required": false,
      "source": "block_pool" }
  ],

  "contingency_slots": 1,       // one indoor fallback per outdoor-heavy day
  "contingency_must_be_named": true   // bind a specific block, don't leave it abstract
}
```

### Trip-level pacing rules (applied by code, not the LLM)

| Rule | Trigger |
|---|---|
| Arrival day gets `energy_budget × 0.4`, no anchors | Always |
| Long-haul arrival: first-day anchors suppressed entirely | Timezone delta ≥ 5h |
| Insert a rest day | `duration_days ≥ 5`, placed at day 4 |
| Mid-trip highlight | `duration_days ≥ 7`, one high-value anchor at the midpoint |
| Departure day is half-length | Always |
| Designate one late-trip day as an explicit **buffer** — user-visible, shufflable | `duration_days ≥ 6` |
| No two consecutive days with the same dominant `category` | Always |
| Museum-category anchors avoid `common_closure_day` | Always |

---

## 5. Type-specific extensions

The core above is shared. `location_type` selects an extension object on both LocationProfile and ActivityBlock. This is where trip types genuinely diverge — flattening these into one table gives you a sparse mess and lets the model schedule snow-closed trails in April.

### `city`
```jsonc
{ "walkability_score": 4, "transit_quality": "high",
  "reservation_culture": "strong", "typical_museum_hours": "10:00-18:00" }
```

### `hiking_region` / `national_park`
The heaviest divergence. Gating fields are hard filters, not preferences.

```jsonc
// LocationProfile extension
{
  "access": {
    "timed_entry_required": true,
    "timed_entry_window": { "months": [5,6,7,8,9] },
    "vehicle_reservation": true,
    "seasonal_road_closures": [
      { "road": "Going-to-the-Sun", "typical_open": "06-13", "typical_close": "09-28",
        "snow_dependent": true }
    ]
  },
  "daylight_hours_by_month": { "6": 15.5, "12": 9.0 },
  "elevation_range_m": [900, 3050],
  "altitude_acclimation_days": 1
}

// ActivityBlock extension
{
  "distance_km": 11.2,
  "elevation_gain_m": 640,
  "route_type": "out_and_back",     // loop | out_and_back | point_to_point | shuttle
  "route_markings": "red triangle",
  "difficulty": "moderate",
  "technical_notes": ["boulder field", "stream crossing"],
  "surface": ["rock", "forest trail"],
  "water_available": false,          // "carry all water" is a real safety line
  "trailhead_access": {
    "road_surface": "gravel",
    "low_clearance_vehicle_ok": true,
    "parking_capacity": "limited",
    "nearest_fuel_km": 38
  },
  "permit": {
    "required": true, "type": "lottery",
    "lottery_opens_days_before": 120, "success_rate": 0.33
  },
  "bailout_points": 2,               // turn-around consequence
  "exposure": "high",                // weather/lightning risk
  "season_window": { "months": [6,7,8,9] },
  "typical_pace_kmh": 3.0
}
```

Hard-filter implication: a hiking block is **excluded from the candidate set** — not deprioritized — if the month falls outside `season_window`, or if `permit.lottery_opens_days_before` exceeds days-to-departure. The model never sees it.

### `coastal` / `beach`
```jsonc
{ "tide_dependent": true, "water_temp_by_month": {...},
  "default_day_is_unstructured": true, "uv_peak_hours": "11:00-16:00" }
```
Distinct because the *default* day here is an empty day. City templates fill slots; beach templates deliberately leave them open and treat activities as optional garnish.

### `road_trip_corridor` and `multi_city_circuit`: deterministic road-trip-lite

The baseline must produce a useful road-trip backbone without buying route, weather, or additional LLM calls.
It derives the following private `TripLogisticsOverlay` from trip dates and existing lodging/transfer records.
Only coarse, traveler-independent corridor hints may be shared; the concrete overlay is never shared or
promoted into the corpus.

```ts
type BaseStay = {
  baseStayId: string;
  locationId: string;
  startDate: string;             // inclusive local date
  endDate: string;               // exclusive local date
  lodgingItemId?: string;        // private reference; never part of a shared key/value
  parkingNote?: string;
  source: 'trip_lodging' | 'trip_destination';
};

type TravelLeg = {
  legId: string;
  fromBaseStayId: string;
  toBaseStayId: string;
  mode: 'drive' | 'rail' | 'bus' | 'flight' | 'other';
  estimatedMinutes: number;
  bufferMultiplier: number;      // applied by code, clamped by config
  latestArrival?: string;        // local ISO date/time
  hardDeadline?: { at: string; reasonCode: string };
  source: 'supplied_transfer' | 'static_corridor' | 'heuristic' | 'provider';
  confidence: 'verified' | 'estimated' | 'low';
};

type TimedRouteDay = {
  date: string;
  hardDeadline?: { at: string; reasonCode: string };
  requiredSlackMinutes: number;
  checkpoints: Array<{
    checkpointId: string;
    earliestStart?: string;
    latestDeparture?: string;
    durationMinutes: number;
    required: boolean;
    cutPriority?: number;        // lower-priority optional stops are cut first
  }>;
};

type DayVariant = {
  variantId: string;
  labelReasonCode: string;
  blockIds: string[];
  legIds: string[];
  estimatedMinutes: number;
  conditions: Array<'dry' | 'poor_weather' | 'opening_hours' | 'reservation_confirmed'>;
  exclusiveGroup: string;        // exactly one member may be active
  tradeoffReasonCodes: string[];
};

type TripLogisticsOverlay = {
  baseStays: BaseStay[];
  travelLegs: TravelLeg[];
  timedRouteDays: TimedRouteDay[];
  dayVariants: DayVariant[];
};
```

The deterministic algorithm is deliberately modest:

1. Form `BaseStay` ranges from existing lodgings; if none exist, use explicit trip destinations and dates and
   label the base as provisional. Never infer or advertise a property.
2. Prefer existing transfer duration/time. Otherwise use a reviewed static corridor estimate; as the final
   provider-free fallback, use a coarse geodesic-distance heuristic and configured mode speed plus a
   conservative, clamped buffer. Surface its low confidence.
3. Schedule backward from each hard deadline, reserve `requiredSlackMinutes`, and remove optional checkpoints
   in deterministic `cutPriority` order until feasible. Required checkpoints are never silently removed.
4. Select one whole-day variant from each `exclusiveGroup` using hard constraints first, then opening hours,
   reservations, supplied near-term conditions, and user preference. Never blend exclusive variants into an
   overfull hybrid day.
5. If the required route is still impossible, return a structured conflict and ask the user to change a base,
   required stop, or deadline. The LLM may explain an allowlisted reason code but never performs the arithmetic.

Drive time is an energy cost, not a free transition: add a configured function of buffered drive minutes to
the day's energy spend. A provider-free result remains a complete supported result; optional live providers
may refine estimates but cannot make the trip dependent on their availability.

The shared `road_trip_corridor` extension stays intentionally coarse:

```jsonc
{
  "from_location_id": "loc_a",
  "to_location_id": "loc_b",
  "mode": "drive",
  "typical_minutes": { "low": 120, "high": 180 },
  "season_class": "summer",
  "source_revision": "curated-2026-06",
  "max_daily_drive_minutes": 240,
  "min_nights_per_node": 2,
  "transfer_day_energy_penalty": 3
}
```

### Cross-cutting: traveler-type modifiers
Applied over any location type, as a filter/weight overlay rather than a separate schema.

```jsonc
{
  "family_young_children": {
    "max_continuous_activity_min": 120,
    "nap_window": "13:00-15:00",
    "require": ["restroom_nearby", "stroller_accessible"],
    "energy_budget_multiplier": 0.6
  },
  "mobility_limited": {
    "require": ["step_free"], "max_walk_between_blocks_min": 10,
    "energy_budget_multiplier": 0.5
  },
  "foodie": { "meal_slots_are_anchors": true, "booking_lead_days_tolerance": 30 }
}
```

---

## 6. Cache key + retrieval

### Canonical compatibility projection

Do not concatenate user-facing strings into a key. Build a versioned, canonical JSON projection and hash
it with SHA-256. The stored `cache_key` is the opaque digest; logs expose only a short digest and coarse
dimensions. The unhashed projection is not persisted with the shared entry.

```jsonc
{
  "schema_version": "binding-plan-v2",
  "algorithm_version": "selector-v1",
  "corpus_release_id": "2026-08-14.3",
  "template_revision": "day-templates-v4",
  "validator_revision": "binding-validator-v2",
  "destinations": ["loc_lisbon"],       // ordered, canonical IDs
  "duration_bucket": 3,
  "local_date_shape": "thu-sat",        // weekday/season compatibility, not a raw timestamp
  "season_label": "shoulder",
  "pace": "moderate",
  "party_class": "adult_couple",
  "mobility_class": "standard",
  "transport_class": "no_car",
  "budget_band": "mid",
  "interest_signature": "culture+food",
  "language": "en"
}
```

Every field is allowlisted and normalized by one canonical function shared by read and write paths.
`dependency_fingerprint` additionally covers the exact LocationProfile, candidate block IDs and revisions,
templates, renderer reason-code catalog, and validator version. Any field that can change validity must be
in the compatibility projection or fingerprint; adding a field requires a schema-version bump and tests.

Exact dates, raw budgets, accessibility notes, dietary text, age details, pinned attractions, and other
private/high-cardinality data remain in the request-private overlay. Before using a shared hit, code applies
that overlay and reruns hard filters. If the overlay changes the day shape materially, bypass Tier 0 and use
a private deterministic/Tier 1 bind; never broaden the shared key with free text.

### Tier 0 — compatible binding-plan hit, no inference

A hit requires all of the following:

1. key, schema, dependency fingerprint, payload hash, and corpus release match;
2. entry is before `hard_expires_at` and passes the freshness policy below;
3. decoded payload is below the byte/depth/item caps and validates against the canonical schema;
4. every referenced block is live in the pinned corpus release; and
5. current request-private constraints pass the post-read validator.

A nine-dimensional 1–10 vector has too many distinct values to key on directly, so quantize it into an **interest signature**: the user's two highest-scoring dimensions, sorted alphabetically, ties broken by fixed dimension order.

That gives 36 signatures rather than 10⁹ keys, and it's the right lossy reduction — the top two dimensions determine which substitution-group members get picked, while dimensions 3 through 9 mostly reorder the supporting cast. Drop to a single dimension if hit rates stay low; go to three only if you have the traffic to fill 84 buckets.

Bucket duration into 2/3/4/5/7 days only for candidate lookup. The actual day count is validated before a
hit is accepted; unsupported lengths compose bounded day fragments or proceed to Tier 1. Never silently
truncate or pad a trip to improve hit rate.

**Flat profiles bypass the vector entirely.** If the user's max dimension minus their mean is under ~2, they have no meaningful preference signal; use `default_rank` from each substitution group and key on `|balanced|`.

### Tier 1 — near-miss, deterministic first, bounded LLM bind second

On a full-key miss but corpus hit, code assembles and validates a candidate set. First attempt the
deterministic selector (`default_rank`, cosine, geography, and template constraints). Call a lightweight
model only when deterministic selection cannot satisfy the request and the binding flag, request quota,
provider/caller limit, monthly provider budget, timeout, and concurrency cap all admit the call. This is
the main personalized path, but it is never an entitlement or limiter bypass.

### Tier 2 — cold

No live blocks exist for the location. Serve an explicitly limited baseline assembled from the existing
catalog, when possible, and enqueue at most one deduplicated authoring request only after all feature flags,
queue, provider, token, verification-API, and storage reservations succeed. Authoring never runs in the
user request and never writes directly to the live corpus.

### Freshness states and cache topology

Use a small bounded in-process LRU in front of the shared durable cache. Initial safety defaults are 256
entries or 32 MiB total, five-minute TTL, no unbounded map. No LRU library is a dependency of this repo today
and no equivalent bounded/evicting cache exists in `server/src` to reuse — evaluate a small, audited package
(e.g. `lru-cache`) against a hand-rolled bounded `Map` with manual eviction before implementation, rather than
assuming one is already available. Either choice needs its own eviction/byte-accounting unit tests regardless.
The durable entry has three deadlines:

- `fresh_until`: normal reads;
- `stale_until`: stale-while-revalidate is permitted for low-risk descriptive content; and
- `hard_expires_at`: no serve under any condition.

Add deterministic TTL jitter to prevent synchronized expiry. High-volatility availability, closures,
permits, pricing, safety, and accessibility claims are never served stale; suppress the affected block or
render a “verify before you go” state from current evidence. Negative cold-location/coverage results may be
cached for five minutes to absorb bursts, but a provider/auth error is not a negative fact.

Use a **tiered caching strategy**: L0 (in-process LRU) handles hot-key bursts and prevents redundant L1
fetches within a request window; L1 (durable DB) handles cross-instance sharing.

Road-trip data follows stricter topology rules:

- `BaseStay`, concrete `TravelLeg`, `TimedRouteDay`, `DayVariant`, reservation times, rental windows, flight
  times, and exact dates are private itinerary data. Keep them in the existing trip/itinerary persistence and
  private request cache only, subject to the same authorization, retention, operation, and retained-byte caps.
- A shared corridor estimate may key only on canonical coarse origin/destination IDs, mode, season class,
  provider/source revision, and schema version. It may not include dates, addresses, property IDs, account/trip
  IDs, reservation references, or exact deadlines.
- Reviewed static corridors use the immutable corpus-release lifetime. Provider-derived route estimates use a
  separately capped cache with a short configured TTL and no stale serve when current conditions are claimed.
  Opening schedules expire by source volatility; live weather is private, near-departure only, and never
  promoted into the shared corpus.
- On cache miss, expiry, cap exhaustion, or provider failure, fall back to the reviewed corridor or labeled
  heuristic. Do not cascade into another paid provider.

Use single-flight coalescing per cache key in process and a short, owner-tokened distributed lease for
cross-instance fills. Lease acquisition, renewal, and release are bounded storage operations. Waiters have
a short timeout and fall back deterministically; they do not start a second fill. Sample/batch hit metadata
updates rather than writing `last_accessed_at` on every read.

---

## 7. What the LLM actually receives and emits

### Pre-filter in code (no tokens spent)
1. Filter blocks by `location_id` ∈ trip locations.
2. Hard-drop on season window, permit lead time, closed days, accessibility requirements, and the location-type interest floor (§3.1).
3. Force-include the user's stated can't-miss attractions as pinned anchors. If a pinned block belongs to a substitution group, that group is resolved and removed from play.
4. Select the `DayTemplate` from `location_type × pace × party_type`.
5. For each anchor/meal slot, pull its substitution group and rank members by cosine against the user vector. **Send the top 2 of each group**, not the winner — the model needs room to resolve zone conflicts and same-category collisions across days.
6. For supporting/filler slots, rank the loose block pool by cosine; keep top ~12.

Sending two per group rather than one is the difference between the model *binding* and the model *rubber-stamping*. It also means a repair pass has somewhere to go without a re-prompt.

### Prompt structure (cache-friendly)
```
[STABLE PREFIX — provider prompt cache]
  system instructions
  DayTemplate definitions
  binding rules + output format

[SEMI-STABLE]
  LocationProfile (zones + rhythm)

[VARIABLE — private request data, never persisted in a shared entry]
  candidate blocks as compact rows:
    id | group_id | role | zone | dur | energy | time_fit | dominant_interest | fit_score
  pinned anchors
  trip params
```

Keep the stable prefix genuinely stable — reordering it invalidates the cache and quietly erases the savings.

Note that the **nine-dimensional vectors never enter the prompt**. Cosine is computed in code and only the scalar `fit_score` plus `dominant_interest` label are sent. Nine numbers per block across ~30 candidates is ~270 tokens of arithmetic the model would do worse than a two-line function.

### Output — assignment and allowlisted reason codes only, never prose
```jsonc
{
  "days": [
    { "day": 1, "template": "tpl_city_arrival",
      "bindings": { "s2": "blk_lis_timeout_mkt", "s5": "blk_lis_taberna" },
      "zone_focus": "z_baixa",
      "reason_codes": ["ARRIVAL_LOW_ENERGY", "SAME_ZONE"] },
    { "day": 2, "template": "tpl_city_moderate",
      "bindings": { "s1": "blk_lis_jeronimos", "s2": "blk_lis_pasteis_belem",
                    "s3": "blk_lis_torre_belem", "s4": null, "s5": "blk_lis_cervejaria" },
      "zone_focus": "z_belem",
      "reason_codes": ["GEOGRAPHIC_COHERENCE", "TOP_INTEREST_CULTURE"] }
  ],
  "contingency": { "day2": { "if": "rain", "replace": "s3", "with": "blk_lis_coaches_museum" } }
}
```

Target no more than 300 output tokens versus 1200–2000 for a full itinerary, with an explicit provider
`max_output_tokens` ceiling. The renderer joins `bindings` against the pinned block release and maps
`reason_codes` to reviewed localized copy. Unknown IDs, keys, codes, extra properties, excessive nesting,
or oversized arrays fail schema validation. The model cannot create text that later crosses users through
the shared cache.

---

## 8. Validation (deterministic, post-generation)

Run in code before rendering. Cheaper and more reliable than prompting for correctness.

- [ ] Every `block_id` exists and belongs to a trip location
- [ ] No block appears twice in the trip
- [ ] `conflicts_with` not violated within a day
- [ ] Day energy sum ≤ template budget (× traveler modifier)
- [ ] Zone count per day ≤ `max_zones_per_day`; adjacency exists between them
- [ ] Anchors per day ≤ `max_anchors`
- [ ] No block scheduled on its `closed_days`
- [ ] All pinned can't-miss attractions appear exactly once
- [ ] `sells_out_risk: high` blocks carry a booking warning
- [ ] No two consecutive days share a dominant `category`
- [ ] Every outdoor-heavy day has a contingency
- [ ] At most one member bound per substitution group across the whole trip
- [ ] Every `required: true` slot with `source: substitution_group` is filled
- [ ] Trip-level interest coverage: the user's top two dimensions each appear as a `dominant_interest` on at least one bound block per 3 days
- [ ] No dimension scoring ≤3 for the user dominates more than one bound anchor
- [ ] Payload satisfies a strict schema (`additionalProperties: false`), byte/depth/item limits, and an allowlist of reason codes
- [ ] Cache schema, algorithm, corpus release, dependency fingerprint, and payload checksum match
- [ ] Every private hard constraint is re-evaluated after the read; no cache field is treated as authorization
- [ ] Timezone-local weekday/date checks use the trip destination timezone, including DST boundaries
- [ ] Estimated per-day and trip totals remain within the user's budget band; uncertain prices are labeled estimates
- [ ] Every dated day maps to exactly one compatible `BaseStay`; no activity is placed before arrival or after departure
- [ ] Every travel leg occurs while its required transport is available (including car pickup/return windows)
- [ ] Buffered travel plus required checkpoints reaches every hard deadline with `requiredSlackMinutes` intact
- [ ] Optional checkpoints are removed only in stable `cutPriority` order; required checkpoints are never auto-cut
- [ ] Exactly one `DayVariant` per `exclusiveGroup` is active, and inactive variants do not leak blocks into the day
- [ ] Anchor/booked blocks fit the exact destination-local `operating_schedule`, including seasonal overrides and exceptions
- [ ] Heuristic/static/provider travel-time provenance and confidence are rendered honestly; no estimate is presented as live traffic
- [ ] Road-trip arithmetic is reproduced from stored inputs/config with no model output or nondeterministic tie-break

The last two catch the failure where cosine ranking is technically satisfied but the trip *feels* wrong — every block a mediocre 0.72 match and nothing the user actually asked for. Coverage is a separate property from average fit, and only the coverage check will catch it.

### Authoring-time checks (CI over the corpus, not per request)

- [ ] All nine dimensions present and in 1–10 on every block
- [ ] Per location per dimension, count of blocks scoring ≥9 is within the cap
- [ ] Every substitution group has 3–4 members
- [ ] Group members have distinct dominant dimensions
- [ ] Group `max_centered_cosine` ≤ 0.75
- [ ] Group members within ±40% duration and ±1 energy
- [ ] No unreviewed `iconic_landmarks ≥8` + `authentic_local ≥7` pairs
- [ ] No `nightlife ≥7` block with evening and night `time_fit` both <0.5
- [ ] IDs are unique and bounded; references resolve within the same location/release
- [ ] Strings, arrays, files, groups, and release payloads stay under declared hard caps
- [ ] Availability/safety/accessibility evidence has source, license, verification timestamp, volatility, and reviewer metadata
- [ ] Time-critical anchors have a complete timezone-aware operating schedule or are explicitly marked `unknown`
- [ ] Shared corridor rows contain only coarse allowlisted fields and never private addresses, dates, or reservation data
- [ ] No secrets, raw provider payloads, HTML, executable URLs, user/trip identifiers, or free-form personal data
- [ ] Release manifest hashes every file and records schema/tool versions; promotion is append-only and reversible

On failure: repair in code where possible (swap via `substitutes_for`), only re-prompt as a last resort.

---

## 9. Known risks

**Homogenization.** Substitution groups address this structurally, but only if the coverage checks are enforced — a group whose four members all score `culture: 9` reintroduces the problem while appearing to solve it. Watch the *realized* distribution in production: if one member of a group wins more than ~50% of the time, either the group doesn't span the space or that member's vector is inflated. Break near-ties with a short-lived random request seed or coarse experiment cohort. Do not persist a per-user salt in a shared key/value; that fragments the cache and creates an avoidable cross-request identifier.

**Score inflation.** The most likely way this schema degrades. Authors have every incentive to score their block high on everything, and a corpus where the mean vector is (7,7,7,7,7,7,7,7,7) has zero discriminating power — centered cosine collapses toward zero for every pair and selection becomes random. Monitor mean and variance per dimension per location as a corpus health metric, and treat rising means as a bug.

**Staleness.** You now own a freshness pipeline. Scope it with `volatility`: the authoring target may begin at quarterly for `high` and annually for `low`, but measured change rates determine the production cadence. Track evidence timestamps separately from editorial timestamps. Auto-suppress safety-, closure-, permit-, price-, and accessibility-sensitive facts after their freshness deadline; do not extend them with stale-while-revalidate.

**Constraint anchoring.** Small models over-copy exemplars. When a request carries a hard constraint (accessibility, dietary, age), the model tends to keep incompatible cached blocks. This is why those constraints are **code-side hard filters** and never left to the prompt. Build an eval set specifically of constraint-conflicting requests.

**Pinned-attraction conflicts.** A user's can't-miss list may be geographically incoherent or exceed the energy budget. Detect in the pre-filter and either relax `max_zones_per_day` or extend to more days, with an explicit note to the user — don't let the model silently drop a pinned item.

**Cache poisoning and prompt injection.** Partner/model text is data, never instructions. Normalize it into an
allowlisted schema, strip markup and control characters, cap URLs and strings, and keep raw source payloads
outside prompts and shared values. Promotion uses independent evidence, human review, an audit record, and
an immutable release; there is no `--force` path to live data.

**Stampedes and write amplification.** A popular expiry can multiply LLM calls, reads, and writes across
instances. Single-flight leases, TTL jitter, bounded retries, negative caching, and sampled hit metadata
are required before write-through or prepopulation is enabled.

**Cost inversion.** A cache intended to save tokens can cost more through low-value writes, revalidation,
or prepopulation. Track cost per accepted hit and net avoided generation cost. Automatically pause new
writes/authoring when a rolling cohort's storage + verification + binding cost is greater than its
conservative avoided-generation estimate; reads of already-valid entries may continue under their own flag.

---

## 10. Cache miss handling

A miss is a **diagnostic event**, not a generation trigger. The handler's first job is to classify what's actually missing, because the three cases have completely different responses and only two of them involve a frontier model at all.

### Miss classification

| Class | Condition | Response | Latency |
|---|---|---|---|
| **Unvisited combination** | Blocks exist, signature untried | Deterministic bind; bounded lightweight LLM only if needed | Synchronous, deadline-bound |
| **Coverage gap** | No block dominant in a needed dimension | Serve bounded baseline + deduplicated authoring candidate | Async, quota permitting |
| **Cold location** | No live blocks for the location | Existing catalog baseline + deduplicated cold-start candidate | Async, quota permitting |

The overwhelming majority of misses are the first class. That's the Tier 1 path this whole schema exists to serve — the model binds cached blocks into a cached day shape and emits an assignment. No frontier model is involved and nothing is enqueued.

### Fill gaps at the group layer, not the itinerary layer

The tempting repair for a missed `nightlife+photography` key in Lisbon is to have a frontier model generate a Lisbon nightlife-photography itinerary and cache it under that key. **This is the wrong repair.** You have spent a large generation to satisfy exactly one key out of `36 signatures × 5 durations × 3 seasons × 4 party types` ≈ 2,160 keys per location.

The actual defect is upstream: no substitution group in Lisbon has a nightlife-dominant member. Authoring that one block fixes the gap for **every signature where nightlife ranks in the top two** — 8 of the 36 — across all durations, seasons, and party types at once.

The arithmetic is the whole argument. A missing dominant dimension blocks 8 signatures; one authored block unblocks all 8. That ratio is why the `plan` command prioritises on `signatures_unlocked` rather than on miss frequency.

### Authoring cannot be synchronous

Serving and authoring produce different artifacts. A serving response is one bound itinerary — ~200 output tokens. An authoring response is a set of blocks with nine-dimensional vectors, pre-written copy, availability data, relations, and a group satisfying the span constraints — tens of thousands of output tokens, minutes of latency, and it must pass CI before anything ships.

Serve a bounded baseline now, author offline, and upgrade a later request after promotion. A fallback may use
the nearest-neighbour signature (drop to top-1 dimension) or `default_rank` members, but the UI must not
pretend it honored preferences it could not satisfy. Show a calm material notice such as “Some preferences
could not be matched for this destination,” identify which hard constraints were honored, and provide edit
or retry actions. Do not expose internal cache tiers or provider errors.

### The promotion gate

**A bad generated answer harms one user once. A bad cached block harms everyone who hits that group until someone notices.** That asymmetry sets the bar.

Frontier models hallucinate plausible venues. They will invent a trattoria with a convincing name and a specific street, and if that lands in the block cache it is served with confidence to every matching traveller for months.

So generated blocks land as `source: "llm_draft"` and are **excluded from the candidate set** until promoted. Promotion requires:

1. All authoring-time CI checks pass (§8)
2. Venue existence confirmed against a source that is **not the model that invented it** — a places API, your own POI database, a partner feed
3. Human review, at minimum for the first pass per location, tapering as you calibrate

`corpus_tools.py promote` is a local, read-only preflight that enforces schema and evidence metadata. The
production promotion service also requires an authenticated reviewer, an audited approval, immutable
release creation, and server-side revalidation. There is deliberately no force/bypass option.

### Write-through policy

Every valid Tier 1 binding is a *candidate* Tier 0 entry, but promoting all of them fills the cache with
single-use keys and destroys hit-rate economics. Require all of the following before write-through:

- the write flag is enabled and storage operation/byte reservations succeed;
- the same compatibility key produced the same validated payload at least three times in a bounded rolling
  window, counted idempotently;
- predicted reuse before expiry is greater than one and conservative avoided inference cost exceeds write,
  retention, read, and revalidation cost;
- payload is below the hard entry cap and references only the active corpus release; and
- no private overlay or free-form content is present.

The repetition threshold is an initial hypothesis, not a constant hidden in code. Keep it in numeric cache
configuration, bounded to a safe range, and evaluate it against hit/cost data. The long tail stays on the
deterministic/Tier 1 path.

### Scope limit

Miss-driven authoring is a **long-tail strategy**. It is the right approach for the destination you didn't anticipate and the wrong one for Paris. Your top destinations should never be discovered through cache misses — see §11.

---

## 11. Prepopulation

Reactive authoring alone gives every early user a degraded experience in your most popular destinations. Prepopulate the head from demand data before launch; let misses drive only the tail.

### Sequencing

**Rank by your own demand data, not by intuition.** Search queries, booking history, and wishlist adds are all better signals than a "top destinations" list. Feed the ranking to `plan --demand` as a weight map.

**Author the first ~10 locations by hand.** They become the reference corpus that calibrates the scoring rubric, the `≥9` caps, and the global mean vector. Generating against an uncalibrated mean produces vectors that all cluster, and you will not notice until the corpus is large enough to be expensive to fix.

**Then per location, in order:**

1. Author zones and adjacency first. Everything downstream depends on geographic coherence, and it's the part the model is worst at.
2. Author one block per dimension the location can plausibly support — this maximises signature coverage per unit of work.
3. Assemble those into groups, checking span as you go.
4. Backfill to 3–4 members per group.
5. Run `audit`; fix; run `coverage`; repeat until the servable rate clears your bar.

Each planning run also emits worst-case provider requests, input/output tokens, verification requests,
queue operations, storage writes, and bytes. The worker reserves those units before dispatch, has a finite
per-run job count/concurrency/deadline, and stops when any global or caller budget is exhausted. Demand data
is aggregated and retention-bounded; never feed raw searches or account IDs into the corpus planner.

Step 2 before step 4 is deliberate. Nine spanning blocks unlock far more signatures than four blocks in one perfect group.

### Coverage targets

| Tier | Locations | Target servable rate | Group depth |
|---|---|---|---|
| Head | Top 20 | ≥ 90% of 36 signatures | 4 members |
| Body | Next 100 | ≥ 60% | 3 members |
| Tail | Everything else | Cold start on demand | — |

Below ~40% servable, the location is doing more harm than good — users get poorly matched itineraries rather than no itineraries, which is worse for retention. Consider gating the destination until it clears the bar.

### Recalibration

The global mean vector shifts as the corpus grows. Recompute on a schedule (weekly is ample), and **treat a rising mean as a bug, not as growth** — it means authors are inflating scores and your discriminating power is decaying. `audit` reports per-dimension mean and standard deviation per location; alert on mean > 6.0 or stdev < 1.5.

### Tooling

`corpus_tools.py` implements the authoring-side loop:

```bash
python corpus_tools.py audit                         # CI gate; exit 1 on error
python corpus_tools.py coverage                      # servable signatures per location
python corpus_tools.py plan --demand demand.json     # bounded job manifest; no API calls
python corpus_tools.py promote blk_xyz               # read-only promotion preflight
```

`plan` prioritises on `demand_weight × signatures_unlocked`, so a cold high-demand location outranks a small gap in an already-good one. This checked-in tool remains offline and must never read provider credentials. `NullAuthor` emits bounded job manifests. A real author adapter belongs in the server/worker, where feature flags, authentication, `reserveApiUsageOrThrow`, token budgets, cost recording, timeouts, and audited persistence are unavoidable chokepoints.

---

## 12. PracticalNote — the cheapest tier in the system

The example itinerary's most-quoted section is its practical notes: luggage forwarding, transport passes, entry requirements, weather bands, when foliage forecasts publish. None of it is day-specific and none of it is user-specific.

These are **scoped to country/region × season, not to trip**, which makes them the highest-leverage thing in the corpus. One authored note about Japanese luggage forwarding serves every Japan itinerary you will ever generate, at any duration, for any interest signature.

```jsonc
{
  "note_id": "note_jp_takkyubin",
  "scope": { "country": "JP" },        // country | region | location | zone
  "category": "logistics",             // logistics | passes | entry | money |
                                       // weather | connectivity | etiquette | seasonal_timing
  "title": "Luggage forwarding",
  "body": "Pre-written. Send large bags ahead by takkyubin between hotels …",

  "applies_when": {
    "min_nights": 7,
    "multi_city": true,
    "has_segment_outside": ["JP"]      // triggers only when it's actually relevant
  },

  "volatility": "low",
  "last_verified": "2026-06-01",
  "confidence": "stable"               // stable | verify | seasonal — drives hedging, §14
}
```

`applies_when` is what keeps this from becoming boilerplate. A three-night Tokyo trip should not be told about inter-city luggage forwarding. Selection is a code-side predicate match, no tokens spent.

**Categories worth seeding per country before launch:** entry/visa, payment and cash norms, transit passes and stored-value cards, connectivity, tipping, seasonal timing (when do forecasts publish, when do bookings open), and a weather band table by month.

---

## 13. Derived artifacts

Six sections in the example are not *authored* content — they are reorganisations of data already in the
bound blocks and private logistics overlay. They cost no inference and no authoring, and each is high-value.

### 13.1 Booking plan

Aggregate every bound block's `availability` into one ordered list, sorted by urgency:

```
urgency = f(sells_out_risk, booking_window_opens, days_until_travel)
```

Split into **"book first"** (sells out, or window already open) and **"book ~1 month out."** The example puts this at the end as a standalone section, which is right — it's the thing a traveler actually acts on, and burying it inside day entries makes it unactionable.

This is pure aggregation over fields the schema already has. Build it.

### 13.2 Constraint receipt

The example ends with a hike summary table, explicitly framed as *"all within your 7 mi / 2,000 ft ceiling."* That is a **receipt showing the user's own stated constraint was honored**, and it does more for trust than any amount of prose.

Generalize: whenever the user states a hard constraint — daily walking limit, budget band, accessibility requirement, max drive time — render a compact table of the trip's actual values against it. Every number is already computed by the §8 validator; you're just showing your work.

### 13.3 Surfaced alternates

The example writes *"Myeongdong is the alternative if you prefer shopping convenience."*

That is a substitution group leaking into the output, and it should be deliberate rather than accidental. §3.2 currently picks one member and discards three. **The discarded members are content, not waste** — they are pre-authored, span-checked, slot-compatible, and already in context.

Render the runner-up as a named alternate with the axis of difference:

> **Jerónimos Monastery** — … *Prefer photography over history? Swap for MAAT, ten minutes along the river.*

Zero marginal cost, and it directly counters the homogenization risk in §9 by making the corpus's depth visible.

### 13.4 Revision diff

When a user modifies a trip, the example's opening *"What changed in this revision"* — with the reason and the cost delta — is exactly the shape of the Tier 1 delta output (§7). You already emit the patch; render it as prose alongside the updated itinerary rather than silently swapping content.

### 13.5 Days by base

Group the private `BaseStay` ranges into a compact date/night/location table and attach each day to one base.
This makes hotel changes, day trips, and accidental cross-country backtracking immediately visible. Derive it
from trip lodging/destination records; never ask the model to restate it.

### 13.6 Driving and deadlines at a glance

Render each `TravelLeg` with buffered duration, provenance/confidence, required departure or latest-arrival
time, reserved slack, and any optional checkpoints that would be cut if the route runs late. This is the
actionable road-trip summary: it exposes infeasible days before booking and explains conservative timing
without implying live traffic. It also supplies the validator-backed max-drive-time constraint receipt.

---

## 14. Copy patterns the corpus must support

Three writing behaviours in the example are worth encoding as schema obligations, because a model will not produce them reliably on its own.

### Honest negatives

> *"Takao peaks mid-to-late November. By Dec 7 the summit will be bare; only lower slopes may hold color. Come for the hike and the Fuji view."*

Language models are sycophantic and will not volunteer this. It has to be a **field** (`seasonal_caveats`, §3) that the renderer emits unconditionally when the month matches — never a thing the generator is asked to remember.

The pattern is: state the disappointment, then restate the remaining reason to go. Enforce both halves in authoring review.

### Volatility-driven hedging

The example hedges precisely where the underlying fact is unstable — *"typically has run,"* *"confirm this year's end date,"* *"check access"* — and states other facts flatly.

That maps directly onto the `volatility` and `confidence` fields. Make it mechanical: `confidence: verify` renders with a hedge and a check prompt; `stable` renders flat. This keeps hedging out of the model's judgment, where it will be applied either everywhere or nowhere.

### Named specifics over categories

*"Skip the Netflix-famous stalls; go two aisles over."* *"Shoot from the platform above the pagoda."* *"Start at Kita-Kamakura, not Kamakura."*

These are the lines that make an itinerary feel like it came from someone who went. They live in `insider_tip`, and they are the single field most worth spending human authoring time on. **An `insider_tip` that could have been written without visiting is worse than an empty one** — make that an explicit review criterion.

### Local-script naming

The example carries local-script names throughout, explicitly for signage, taxis, and maps. `name_local` and `name_script` (§3) are near-zero authoring cost and high practical value in any non-Latin-script destination. Render them in the day view, not just a glossary.

---

## 15. Included integration hooks and later expansion

- **Included in road-trip-lite:** existing lodging records define private base stays, and existing transfers
  define private leg times/modes. Zone-level recommendations already ship in `zones[].lodging` (§2), and
  `anchor_zone_id` lets local adjacency compute from the base.
- **Still later:** property search, live inventory, booking, multi-provider route optimization, and automatic
  rearrangement of cities. They require separate product approval, flags, limits, pricing, privacy review, and
  estimator coverage; nothing in road-trip-lite authorizes them.
- **Optional enhancement:** live route, weather, and anchor-schedule verification may refine the deterministic
  overlay only under the independent controls in §§17–18. The baseline remains functional with all three off.
- **schema.org export:** map `ItineraryInstance` → `TouristTrip`, days → `hasPart` sub-trips, bound blocks → `TouristAttraction` inside an ordered `ItemList`. Useful for crawler/AI-agent visibility; not suitable as the internal generation format.

---

## 16. Production storage and migration

### 16.1 Reuse and replace the existing cache deliberately

The repository already has `itineraryPlanCacheService.ts`, `ItineraryPlanCacheEntry`, and adapter methods.
Today Postgres stores those rows in the general `locations` table while Firebase uses an
`itinerary_plan_cache` collection. That divergence makes retention, byte accounting, cleanup, and adapter
parity harder. Implement this proposal as `binding-plan-v2` in those existing service/DB seams:

1. Add dedicated cache/release schemas and all required DB facade methods.
2. Dual-read v2, then legacy v1, but write only v2 during a time-bounded migration window.
3. Validate and promote a legacy read into v2 only if it passes current privacy, dependency, byte, and
   deterministic validation gates. Never blindly copy old payloads.
4. Record v1/v2 hit and rejection reasons separately without key or user cardinality.
5. After an observed rollback window, disable v1 reads and delete v1 rows in bounded cursor batches.

No request may write both the old and new formats indefinitely. Every new DB operation is implemented in
Postgres, Firebase, and the in-memory test adapter before the read flag can be enabled.

### 16.2 Durable binding-plan schema

Logical fields; Postgres uses a dedicated table and Firebase uses a collection with the same contract:

```text
itinerary_binding_plan_cache
  cache_key PK                    -- sha256 of canonical compatibility projection
  stage                          -- binding_plan (route/day legacy stages are migration-only)
  schema_version
  algorithm_version
  corpus_release_id
  template_revision
  validator_revision
  signature_hash                 -- hash only; no raw private request projection
  dependency_fingerprint
  payload_json                   -- strict assignment schema, no free text/private overlay
  payload_sha256
  payload_bytes
  fresh_until
  stale_until
  hard_expires_at
  created_at, updated_at
```

Required indexes are the primary key and a cleanup index on `(hard_expires_at, cache_key)`. Do not index
payload JSON or user-derived dimensions. Cleanup scans use a stable cursor and bounded batch size. A sampled
or asynchronously aggregated usage table may hold `hit_count`, `last_hit_at`, and repetition evidence; do
not update the main entry on every hit.

Initial hard caps, enforced before decode/write and duplicated in configuration with bounded validation:

| Object | Hard cap | On violation |
|---|---:|---|
| Cache key | 128 ASCII characters | Reject |
| Serialized binding payload | 64 KiB | Do not cache; continue bounded response |
| Decoded nesting | 12 levels | Treat as corrupt miss and quarantine |
| Destinations | 8 | Bypass shared binding cache |
| Trip days | 31 | Bypass shared binding cache |
| Candidate blocks sent to binder | 40 total, 2/group | Deterministically trim before prompt |
| Bindings | 8/day, 160/trip | Reject model output |
| Reason codes | 4/day | Reject extras |
| Private serialized logistics overlay | 128 KiB/trip | Derive in memory or omit optional detail; never spill into shared cache |
| Base stays / travel legs | 16 / 32 per trip | Return structured limit conflict; do not truncate required travel |
| Timed checkpoints | 12/day | Reject excess optional checkpoints before planning |
| Day variants | 4/day, 2 active-candidate evaluations/group | Deterministically trim optional variants |
| Shared corridor entry | 4 KiB | Do not cache; use labeled heuristic |
| L0 process cache | 256 entries and 32 MiB | LRU eviction |

Use safe JSON, not language-native object serialization. Verify `payload_bytes` and `payload_sha256` before
decode. Firestore document size remains comfortably below its platform ceiling; the application cap is the
portable contract. Do not introduce request-time (“JIT”) compression. Postgres may already compress large
values internally, and recompressing every hit can cost more CPU/latency than these small payloads save.
Start with `compression: "none"`. If adapter-specific measurements show a net saving, compress once on write
only, after the uncompressed payload passes the 64 KiB cap, and retain its uncompressed byte length/hash.
Require at least 20% measured size reduction, cap both compressed and expanded bytes, reject expansion ratios
above 10:1, and benchmark/decode-test each adapter before enabling the numeric compression setting.

### 16.3 Immutable corpus releases

Drafts and live content are distinct datasets. A release manifest contains `release_id`, parent release,
schema/tool versions, authoring job IDs, reviewer approval IDs, source/license summary, per-file/item hashes,
item/byte totals, creation timestamp, and rollback status. Activity blocks and profiles carry stable IDs plus
monotonic revisions; a release maps each ID to one revision.

Promotion creates a new immutable release in a transaction/batch, then atomically changes the active release
pointer. It never edits the active release in place. Rollback only changes that pointer and invalidates the
release-dependent L0 entries. Release creation reserves worst-case storage bytes first and reconciles actual
bytes exactly once using an idempotency key.

Do not read the active-release pointer from durable storage for every itinerary. Keep a separately bounded
60-second in-process pointer cache, coalesce refreshes, and meter the refresh read. Promotion/rollback sends a
best-effort invalidation event, but correctness relies on the short TTL and release ID in every binding key,
not event delivery. Emergency poisoning/source revocation disables reads or adds the release to a small
fail-closed denylist checked before L0; it does not wait 60 seconds. Corpus snapshots loaded for selection
have their own byte/count-bounded LRU and are evicted by release ID.

## 17. Standard limits, quotas, and cost accounting

### 17.1 One admission path for API and storage work

`reserveApiUsageOrThrow` and the Postgres/Firebase atomic counters now support positive integer `units`
(default 1), so request-, element-, token-, operation-, and byte-weighted work can share the standard durable
limiter. The remaining prerequisite is a releasable retained-capacity gauge for bytes/items that decrease on
expiry or deletion. Extend the standard control plane rather than adding cache- or road-trip-local counters:

```ts
reserveApiUsageOrThrow({
  provider,
  caller,
  units?: number,                 // defaults to 1
  requireConfiguredLimit?: true  // missing overall/caller cap throws before work
})
reserveCapacityOrThrow({ provider, caller, units, idempotencyKey })
commitCapacityReservation({ reservationId, actualUnits })
releaseCapacityReservation({ reservationId })
```

`units` must be a positive bounded integer. The Postgres, Firebase, and memory implementations atomically
check `current + units <= limit`. Capacity reservations are the gauge form of the same standard usage
architecture: they can decrease
on expiry/deletion and have expiring reservations so failed jobs do not leak quota. Before these primitives,
adapter parity, and concurrency tests ship, all cache-write, authoring, and prepopulation flags stay off.

Reservations occur before work. Request/operation reservations remain consumed on downstream failure to
prevent retry storms from bypassing limits. Byte reservations are committed to actual retained bytes or
released on a terminal failure. Every async job has an idempotency key, estimated units, deadline, attempt
cap, and one terminal accounting record.

All new itinerary cache, binder, verifier, authoring, queue, and cleanup call sites set
`requireConfiguredLimit: true`. Unlike the legacy permissive default, this mode requires finite positive
overall and caller limits and throws `ApiLimitConfigurationError` when either is missing/invalid. The
orchestrator then disables only the affected component and uses the bounded existing path; it must not make
the unreserved operation. Startup/readiness validation remains useful, but it is not the enforcement
boundary. Add a config-negative integration test for every caller so deleting a YAML entry cannot silently
turn a capped feature into an unlimited one.

Validate required provider/caller/pricing configuration from the in-memory parsed config before reading or
writing durable usage/cost counters. The metering control plane cannot recursively reserve a unit for its own
counter transaction; instead, bound it structurally with an allowlisted provider/caller registry, fixed
window/cardinality limits, TTL cleanup, bounded admin queries, and database-level capacity/retention policy.
Include its actual counter reads/writes, capacity reservations, feature-flag reads, and audit-log storage in
the active-backend cost estimate and observability budget. This makes control-plane overhead visible without
creating infinite recursive accounting.

### 17.2 Required provider/caller inventory

Add finite entries to `server/config/api-limits.yaml`. The values below are conservative initial staging
ceilings, not traffic forecasts; production changes require capacity/cost review. Missing provider, caller,
budget, or unit-price configuration fails closed at runtime and is also a failed readiness check.

| Provider | Caller/unit | Initial aggregate cap | Cap behavior |
|---|---|---:|---|
| Every enabled AI provider | `ITINERARY_BLOCK_BIND` request | 100/day/provider | Deterministic bind |
| Every enabled AI provider | `ITINERARY_CORPUS_AUTHOR` request | 20/day/provider | Leave authoring candidate queued/deferred |
| Every enabled AI provider | binder input/output tokens | 500k/50k per day/provider | Deterministic bind |
| Every enabled AI provider | author input/output tokens | 400k/120k per day/provider | Pause authoring |
| Existing verification provider(s) | `ITINERARY_CORPUS_VERIFY` | 100/day/provider | Draft remains non-live |
| `GOOGLE_ROUTES` | `ITINERARY_ROAD_TRIP_LEGS` matrix-element unit | 50/day; max 12 elements/trip | Use cached static corridor or labeled heuristic |
| `OPEN_METEO` | `ITINERARY_ROAD_TRIP_WEATHER` request | 100/day; max 7 forecast days/trip | Keep both pre-authored day variants; ask user to choose |
| Configured schedule provider(s) | `ITINERARY_ANCHOR_SCHEDULE_VERIFY` request | 100/day/provider; max 8/trip; anchors only | Mark schedule unknown and require user verification |
| `ITINERARY_CACHE_STORAGE` | `BINDING_READ` operation | 50,000/day | L0 or bounded existing path; no uncapped fill |
| `ITINERARY_CACHE_STORAGE` | `BINDING_WRITE` operation | 5,000/day | Return result without caching |
| `ITINERARY_CACHE_STORAGE` | `BINDING_DELETE` operation | 5,000/day | Continue next bounded cleanup window |
| `ITINERARY_CACHE_STORAGE` | `FILL_LEASE` operation | 10,000/day | Do not fill; deterministic response |
| `ITINERARY_CACHE_STORAGE` | `CORPUS_READ` operation | 50,000/day | Use bounded L0/current release snapshot |
| `ITINERARY_CACHE_STORAGE` | `CORPUS_WRITE` operation | 1,000/day | Promotion/prepopulation pauses |
| `ITINERARY_CACHE_STORAGE` | `ROAD_TRIP_PRIVATE_READ/WRITE` operation | 20,000/5,000 per day | Recompute provider-free overlay in memory or omit enhancement |
| `ITINERARY_CACHE_STORAGE` | `CORRIDOR_READ/WRITE` operation | 20,000/1,000 per day | Use reviewed corpus value or labeled heuristic |
| `ITINERARY_CACHE_STORAGE` | retained KiB gauge | 524,288 KiB platform-wide | Reject new writes/releases |
| `ITINERARY_CACHE_STORAGE` | road-trip-private retained KiB sub-gauge | 131,072 KiB within platform cap | Do not persist overlay; derive in request memory |
| `ITINERARY_CACHE_STORAGE` | corridor retained KiB sub-gauge | 65,536 KiB within platform cap | Reject provider-derived corridor write |
| `ITINERARY_CACHE_STORAGE` | binding-entry count gauge | 100,000 live/stale entries | Reject write-through; cleanup continues |
| `ITINERARY_CACHE_STORAGE` | corpus/draft/evidence item gauge | 250,000 items | Pause authoring/import/promotion |
| `ITINERARY_CACHE_STORAGE` | pending/quarantined job gauge | 10,000 items | Reject/defer new enqueue |
| `ITINERARY_CACHE_JOBS` | enqueue/attempt units | 1,000/2,000 per day | Deduplicate/defer; no retry fan-out |

Token limits must be enforced before each call from the provider registry using worst-case prompt and
completion ceilings, not only counted after the response. The existing AI provider/caller request
reservation and monthly budget checks remain in force as an additional ceiling. Before either AI flag can
be enabled, every selectable paid provider/model must have an explicit positive `monthlyBudgetUsd`, alert
threshold, token price, request callers, and token-unit callers. A null budget is not acceptable merely
because daily requests are capped. The binder has a hard
timeout, one attempt, no automatic model escalation, and `max_output_tokens <= 300`. Authoring uses bounded
per-block jobs; a cold location is not one unbounded prompt.

The road-trip-lite baseline issues **zero external requests**. Optional live calls are admitted only after the
provider and caller limits above, monthly provider budgets, and feature dependencies in §18 pass. Batch route
legs once per trip, reserve by matrix element rather than HTTP envelope, and reuse a compatible corridor-cache
hit before reserving. Request weather only when departure is within the configured forecast horizon and only
for weather-sensitive variant days. Verify schedules only for selected anchors, booked items, or high-volatility
time-critical stops—not every corpus block. A failed optional call never cascades to a second paid provider.
The caller caps are subordinate to each provider's existing aggregate cap; readiness fails if the aggregate
cannot accommodate them.

Every physical database interaction is accounted, including hit reads, misses, lease transactions,
repetition counters, writes, deletes, release metadata, cleanup scans, and review queue operations. Where a
transaction performs multiple billed reads/writes, reserve those actual worst-case units—not one unit for
the HTTP request. Temporary, draft, stale, quarantined, and superseded bytes all count toward platform
capacity until deleted.

Logical byte and item gauges cover payloads plus application metadata; fixed indexes, database page/replica
overhead, point-in-time recovery, and backups are capped at the infrastructure/database policy layer with
finite retention and included in the active-backend estimator via a measured overhead multiplier. Schema
migrations may add only the reviewed fixed indexes in §16.2—no user- or destination-created indexes. Logs,
traces, eval artifacts, and metric exemplars also have byte/event-rate limits and finite retention; they are
observability storage, not free exhaust.

### 17.3 Runtime cost tracking

- Token-priced AI calls continue through the provider registry and `recordApiCost` using actual input,
  cached-input (when the provider reports it), and output tokens. Add pricing for every enabled model; a
  missing model price is a deployment error for these callers.
- Flat-price verification calls reserve first and call `recordProviderRequestCost` immediately alongside
  the provider operation, including explicitly configured `$0` providers.
- Route, weather, and schedule enhancements reserve their worst-case request/element units before the call and
  invoke `recordProviderRequestCost` once with actual billable units. Cache hits and provider-free heuristics
  record usage/cost under storage or compute metrics, never as fake provider calls.
- Add caller-aware unit pricing for cache reads, writes, deletes, retained GiB-month, egress, queue
  operations, and worker compute. Record actual units against the same durable monthly cost-counter/reporting
  plane; do not build a cache-only dashboard ledger.
- Track avoided inference as telemetry and an estimator-derived counterfactual, not as an
  `itinerary_cache_roi` provider or negative cost entry. Avoided spend is not an invoice and must never be
  subtracted from actual provider cost counters. Report actual spend and modeled savings side by side.
- Prevent double counting: caller detail rolls up to the provider total once. Estimated reservation cost is
  replaced/reconciled by actual cost, not added to it.
- Record zero-cost operations as usage even when no cost-counter row is needed. “Free” still consumes quotas
  and may have provider fair-use terms.

Cost and limit failures use stable reason codes (`CACHE_STORAGE_LIMIT`, `BIND_PROVIDER_LIMIT`,
`AUTHORING_BUDGET`, `ROAD_ROUTE_LIMIT`, `ROAD_WEATHER_LIMIT`, `ANCHOR_SCHEDULE_LIMIT`, etc.) mapped to safe
UX. Never log prompts, raw cache projections, user constraints, exact trip routes/deadlines, or provider
payloads with those events.

### 17.4 Cost estimator coverage

Extend `server/config/cost-model.yaml` for Basic and Premium scenarios with explicit itinerary-cache
assumptions:

| Cost family | Required usage metrics |
|---|---|
| Binding AI | input, cached-input, and output tokens; deterministic/Tier 1/Tier 2 rates |
| Verification APIs | requests by provider |
| Road-trip routing | route batches and billable matrix elements; cache-hit and heuristic-fallback rates |
| Road-trip conditions | weather requests/days and anchor schedule-verification requests |
| Database | cache/corpus/lease/queue reads, writes, deletes, and transaction retries |
| Storage | live, draft, stale, superseded, and temporary GiB-month |
| Compute/queue | jobs, attempts, CPU/GiB-seconds, cleanup scans |
| Delivery | cache payload egress GiB, if billed separately |
| Observability | log/trace bytes ingested and retained, metric series/samples, eval artifact GiB-month |

Model low/base/high hit-rate scenarios and the uncached counterfactual. Inputs include active users,
generations/user, Tier 0 hit rate, deterministic Tier 1 success, LLM-bind rate, cold-location rate, average
payload bytes, write-through acceptance, corpus growth, TTL churn, verification calls/block, road trips/user,
legs/trip, route-corridor hit rate, near-departure weather eligibility, selected anchors/day, and retry rate.
Show gross inference savings, new cache/authoring cost, net savings, and cost per valid itinerary. Do not
claim savings from a cache hit unless the same baseline generation cost is removed.

Every new usage metric must map to exactly one `costSources` line item, even when its explicit price is zero.
Add a config test that fails for an unpriced metric, a double-mapped metric, a missing tier assumption, a
negative/non-finite value, or an aggregate usage estimate above the configured hard-cap capacity without a
visible warning. Admin price edits remain audited through the existing estimator configuration path.

Database prices and free allowances differ by deployment. The estimator selects exactly one active backend
scenario (`firebase`, managed Postgres, or local/in-memory test) and prices its reads/writes/deletes,
transactions, retained bytes, backups, and egress without also charging the other backend. Production
readiness fails if `DB_PROVIDER` has no matching storage cost scenario. Local/in-memory may be explicitly
priced at zero but still needs finite operation/byte caps in tests.

Separate per-user serving demand from shared platform work. Corpus prepopulation, release storage,
verification refresh, cleanup, backups, and observability baselines are modeled once per deployment (with
low/base/high growth), not multiplied by every user; request-path reads/binds are multiplied by eligible
generations. Add a reconciliation test comparing estimated monthly operation/token/byte totals with sampled
runtime counters and alert when error exceeds an agreed tolerance before using ROI to expand rollout.

### 17.5 Entitlements, abuse limits, and idempotency

Caching changes compute cost, not the product action. Preserve the current generation admission order from
`itineraryRoutes.ts` and `entitlementService.ts`:

1. authenticate and authorize current trip membership;
2. assert `ai_itinerary_generation`, then reserve the existing per-account/IP HTTP rate limit;
3. reserve `ai_itinerary_generations` with the existing idempotency key/monthly tier limit;
4. return an already-completed idempotent response before doing new cache/provider/storage work;
5. only then read/bind/fill the shared cache; and
6. finalize the same generation reservation on either a valid cache result or a newly generated result.

A Tier 0 hit still counts as one user-requested generation and cannot bypass Basic/Premium limits. A retry
with the same completed idempotency key counts once and performs no new cache read, bind, or authoring
enqueue. Admins may retain the existing tier-limit bypass, but never bypass global provider/token budgets,
storage capacity, operation caps, feature flags, or security/quality gates. Failed/quarantined cache reads
do not themselves create a second user generation charge.

Miss aggregation and authoring are platform maintenance, not user entitlements: deduplicate by shared-safe
key, remove account/trip identity, require a minimum aggregate demand threshold before authoring, and apply
short retention. A single user's rare/private constraint must not become a corpus job or leak through demand
telemetry.

## 18. Feature flags and configuration

Seed these in `server/config/feature-flags.yaml`, each as `{ enabled: false, description: "..." }` — the
existing flat per-flag shape already used by every entry in that file (e.g. `itinerary_reactions`, `flight_parser`).
There is no naming collision with any current flag; `itinerary_reactions` is the only other flag with an
`itinerary` prefix today, and it is unrelated (up/down-vote reactions on itinerary rows). All default `false`
for the new implementation:

| Flag | Gates | Dependency |
|---|---|---|
| `itinerary_block_cache` | Master switch; schema-v2 orchestration and UI status | Existing itinerary generation remains available |
| `itinerary_block_cache_reads` | L0/shared v2 reads and legacy migration reads | Master |
| `itinerary_block_cache_writes` | Write-through, repetition counters, cleanup metadata | Master + reads + weighted usage/capacity meters |
| `itinerary_block_cache_llm_binding` | Lightweight model bind after deterministic failure | Master + provider limits/pricing |
| `itinerary_block_cache_stale_revalidate` | Low-risk stale serve and refresh job | Master + reads + jobs |
| `itinerary_corpus_authoring` | Draft authoring and external verification workers | Master + complete provider/storage/job accounting |
| `itinerary_corpus_promotion` | Human-reviewed immutable release promotion | Master + authoring + audit trail |
| `itinerary_cache_prepopulation` | Demand-driven batch planning/fills | Master + writes + authoring + promotion |
| `itinerary_practical_notes` | PracticalNote selection/rendering | Master + reviewed note corpus |
| `itinerary_road_trip_lite` | Provider-free private base-stay/leg overlay and derived summaries | Master + reads + private storage/operation caps |
| `itinerary_day_variants` | Whole-day mutually exclusive variant selection | Master + road-trip-lite + reviewed variants |
| `itinerary_timed_route_days` | Deadline/slack/checkpoint scheduling and deterministic stop cuts | Master + road-trip-lite |
| `itinerary_live_route_conditions` | Optional Google Routes leg refinement | Road-trip-lite + configured route cap/pricing/cache |
| `itinerary_live_weather_variants` | Optional near-departure weather-informed variant choice | Day variants + configured weather cap/pricing |
| `itinerary_anchor_schedule_verification` | Optional selected-anchor hours refresh | Master + configured verification cap/pricing |

The server checks the relevant flag before reservation/work and workers check it again before every attempt.
The client flag only hides or explains UI; it is never the enforcement boundary. Disabling writes does not
delete data. Disabling reads bypasses both L0 and shared data. Disabling the master prevents enqueue and new
background work; in-flight jobs stop at the next safe checkpoint.

Resolve the fifteen booleans once per request/job through a typed `resolveItineraryCacheCapabilities()` helper
that enforces the dependency DAG in the table. Do not scatter ad hoc flag conjunctions across routes,
services, and workers. An invalid combination (for example prepopulation on while writes are off) resolves
the child capability to false, emits one rate-limited configuration alert, and performs no child work.
Contract tests cover every valid capability and representative invalid combinations without requiring a
fragile exhaustive UI matrix.

This repository's general feature-flag behavior is fail-open for missing rows. Therefore the rollout tool
must verify that every required row exists, has a non-empty `description`, and is explicitly disabled before
the master flag can be enabled. Do not silently change the global fail-open contract inside this feature.
Treat missing itinerary flag rows as a readiness failure and alert. To keep runtime fallback genuinely safe,
the cache orchestrator also has a computed `itineraryBlockCacheReady` prerequisite that is false unless all
required flag rows, schemas, finite limits, prices/budgets, adapter capabilities, and active corpus pointer
are present. This is a component readiness check, not a change to the shared feature-flag service. A
fail-open flag result cannot override a false readiness prerequisite.

Note that `owner` is not a field the current `feature-flags.yaml` schema or its loader supports — every
existing entry has only `enabled` and `description`. If per-flag ownership tracking is wanted (reasonable,
given this feature introduces fifteen flags with different blast radii), it is a small, separate, repo-wide
schema/loader change, not something this feature can assume already exists or add unilaterally as an
undocumented extra key. Land it first (or track ownership outside the YAML, e.g. in this document plus the
on-call runbook in §24) rather than having the readiness check depend on a field nothing else honors.

Numeric controls—TTLs, sizes, job limits, concurrency, timeouts, repetition threshold, stale windows, and
sampling rates—belong in the validated `caching.itineraryBlockCache` section of `api-limits.yaml` (or the
existing audited runtime numeric-settings mechanism where live editing is required). Clamp every value to a
code-defined safety maximum. Zero has one documented meaning per field; it must not accidentally mean
unlimited.

The three live-data flags are intentionally separate. Operators must be able to disable route refinement,
weather, or schedule verification without losing the provider-free logistics overlay or the other two. No
client-visible flag combination may bypass the server capability DAG, and no “live” label appears unless the
corresponding provider call completed within its freshness window.

## 19. Performance, reliability, and observability

Initial service objectives, measured separately by tier and cache outcome:

- Tier 0 p95 server overhead under 150 ms excluding client network time;
- deterministic Tier 1 p95 under 300 ms;
- provider-free road-trip overlay p95 under 50 ms for the configured maximum trip length;
- model-bound Tier 1 respects the existing generation deadline and adds no more than one model attempt;
- cache availability failures never prevent the bounded existing itinerary path;
- zero shared-hit privacy violations and zero hard-constraint validation escapes;
- stampede amplification at most one fill per key/lease window;
- net cache cost savings positive in the enablement cohort before prepopulation expands.

Metrics use fixed, low-cardinality labels only: tier, stage, outcome, freshness state, rejection reason,
schema version, provider, caller, and coarse location-demand band. Required counters/histograms include hit,
miss, stale hit, corrupt/quarantined entry, post-read rejection, deterministic success, bind call, bind token
counts, fill coalescing, lease wait, payload bytes, operation units, retained bytes, cleanup lag, authoring
queue age, promotion rate, rollback, constraint coverage, latency, net estimated savings, road-trip overlay
success/conflict, route matrix elements, corridor hit, heuristic fallback, weather request/day, schedule
verification, optional-stop cut reason, and variant-selection reason. Never label by
cache key, location ID, trip ID, user ID, prompt, or free-form error.

Alerts cover provider/storage limit thresholds, cost-budget thresholds, corrupt-entry rate, post-read
rejection spikes, hit-rate regression, fill amplification, queue age, hard-expiry cleanup lag, retained-byte
capacity, and negative net savings. Dashboard hit rate always pairs with valid-hit rate; a high raw hit rate
with frequent validator rejection is a defect.

Retries are limited to transient, idempotent operations with exponential backoff and jitter. Binding has no
automatic retry. Background provider calls have at most two attempts unless that provider's stricter policy
allows fewer. Dead-letter items contain safe identifiers and reason codes, not source text or secrets.

## 20. Security, privacy, licensing, and data lifecycle

- Authorize private itinerary assembly against current trip membership on every request. Cache presence or
  knowledge of a key conveys no access.
- Shared entries are classified `public_curated`; private overlays remain in request memory or are persisted
  only inside the existing authorized, tenant-scoped itinerary record with its encryption, retention, export,
  and account/trip deletion semantics. Any new private result cache requires a separate tenant-scoped encrypted
  design—not an extra field in the shared cache table.
- Hash canonical keys and use constant-shape lookup responses. Do not expose existence of non-public drafts,
  reviewer identities, or corpus internals to clients.
- Treat all model/partner output as untrusted. Validate strict JSON, escape renderer output, allowlist URI
  schemes/hosts where links are rendered, and never fetch author-supplied URLs from the serving request.
- Verification workers use provider adapters with fixed endpoints, timeouts, response-byte caps, and SSRF
  protections. Secrets come from existing environment helpers and never enter corpus JSON or prompts.
- Store source identifiers, applicable license/terms, attribution requirements, evidence hash, verified_at,
  and reviewer approval. Do not cache or republish a provider's protected descriptions, photos, pricing, or
  inventory beyond its terms. A source revocation can find and suppress all dependent blocks/releases.
- Safety/accessibility/permit facts require stronger evidence and shorter freshness than editorial copy.
  The app states that availability and conditions can change and links users to authoritative confirmation.
- Promotion, rollback, flag changes, numeric limit changes, and manual suppression write to `audit_log`.
  Reviewers cannot approve their own generated/imported draft when two-person review is required.
- Drafts, failed jobs, quarantined payloads, stale entries, superseded releases, evidence, and audit records
  each have documented retention. Cleanup is idempotent, cursor-bounded, metered, and verified by a daily
  retained-byte reconciliation. Legal hold overrides deletion only through the existing authorized process.

## 21. Maintainability and ownership

Define canonical Zod schemas and TypeScript types in one server module for LocationProfile, ActivityBlock,
SubstitutionGroup, DayTemplate, BindingPlan, PracticalNote, `OperatingScheduleEvidence`, `BaseStay`,
`TravelLeg`, `TimedRouteDay`, `DayVariant`, `TripLogisticsOverlay`, release manifest, and DB DTOs. Generate or check
the JSON Schema used by authoring CI from those definitions; do not maintain independent handwritten shapes.
Schema parsers return structured rejection reasons and never coerce arbitrary values into valid IDs/numbers.

Keep responsibilities separated:

- pure selector/vector/template/validator functions have no I/O;
- a pure logistics planner owns base ranges, leg estimates, slack/deadline arithmetic, checkpoint cuts, and
  variant exclusivity; it accepts provider results as typed inputs but never calls providers itself;
- cache service owns canonical keys, freshness, schema/checksum validation, and L0/single-flight behavior;
- DB adapters own persistence only;
- provider adapters own reservations, timeouts, and cost recording;
- authoring/release service owns drafts, evidence, approvals, and immutable promotion;
- renderer owns localized, escaped copy and reason-code presentation.

Primary implementation touchpoints:

| Area | Files/changes |
|---|---|
| Canonical types/schemas | `server/src/types.ts` plus a focused itinerary-cache schema module |
| Cache orchestration | evolve `server/src/services/itineraryPlanCacheService.ts`; do not add a sibling cache |
| Persistence | `server/src/db.ts`, `db.postgres.ts`, `db.firebase.ts`, memory adapter, and a Postgres migration |
| Limits/capacity | `server/src/apis/usageLimiter.ts`, atomic DB counter contract, and `server/config/api-limits.yaml` |
| Runtime costs | `server/src/apis/providerBudgeting.ts` and provider registry/callers |
| Estimates | `server/config/cost-model.yaml` and `server/src/services/costEstimatorService.ts` |
| Flags | `server/config/feature-flags.yaml`, server orchestration/workers, and existing client flag bootstrap |
| Road-trip-lite | focused pure logistics service plus existing lodging/transfer/trip DTOs; no new persistence silo |
| Observability | existing metrics/Prometheus/admin summaries with fixed-cardinality cache metrics |
| Tests | cache service/DB suites, durable limiter/cost wiring/config tests, corpus tool tests, and E2E fallback UX |

`corpus_tools.py` is a bounded offline QA/planning utility. It must use UTF-8, reject duplicate IDs and
oversized/malformed input, validate cross-references, produce deterministic output, and remain credential-
free. Its `promote` command is a preflight, not a write. Production mutations go through authenticated,
audited server services. Keep sample corpus failures intentional and documented if they are used as QA
fixtures; otherwise CI must require a clean sample corpus.

Assign owners for selection quality, corpus/editorial quality, provider cost, storage capacity, privacy,
and on-call response. Every schema version has a migration/rollback owner and a removal date for legacy
read paths.

## 22. User experience requirements

- Launch with no workflow regression: users still create an itinerary through the existing flow. Cache tier
  and internal provider names are not product concepts.
- Preserve pins, exclusions, accessibility, dietary, age, pace, budget, and mobility constraints above
  preference matching. Show the constraint receipt (§13.2) and identify any unfulfilled preference before
  save.
- A materially degraded fallback is labeled without alarm, names what could not be matched, and offers Edit
  preferences/Regenerate. It never claims personalization or current availability it did not establish.
- Stale-but-allowed editorial facts display the evidence date only where useful. Volatile booking, closure,
  permit, accessibility, weather, and safety items always show a verify action and authoritative source.
- Modification operates as a small previewable diff. Preserve user edits and votes; never replace a private
  itinerary in the background when a corpus release changes.
- Show the active base, buffered travel time, confidence/source class, hard deadlines, reserved slack, and
  optional stops at risk of being cut. Never silently delete a required stop or imply a heuristic is live traffic.
- Present whole-day variants as a clear choice with tradeoffs and selection reason. Weather-informed selection
  is only “current” inside its forecast freshness window; otherwise retain both choices and ask the user.
- Exact opening-hours conflicts block the affected anchor and identify the local date/time. Unknown hours show
  a verify action and source link instead of inventing availability.
- Empty/rest slots are intentional and explained. Do not fill them merely to make the itinerary look dense.
- Localization is part of the cache dependency. Unsupported language falls back consistently and is not
  written into a differently labeled language entry.
- Accessibility labels distinguish verified, self-reported, inferred, and unknown. Unknown is never treated
  as accessible.

## 23. Test and evaluation plan

### Unit and property tests

- canonicalization/hash stability, Unicode normalization, field ordering, schema/version invalidation;
- interest signature, flat profile, mean-centered cosine, deterministic tie-breaking, and input reordering;
- strict schema, unknown fields, invalid IDs, oversized/deep payloads, checksum mismatch, JSON bombs;
- hard filters for date/timezone/DST, closures, permits, accessibility, age, dietary, budget, weather, and
  safety freshness;
- reason-code rendering/localization/escaping and no free-form model prose;
- write-through economics, TTL jitter, freshness boundaries, negative-cache classification, and LRU byte cap.
- base-stay boundary construction, travel-time buffer clamping, backward deadline scheduling, stable optional-
  stop cuts, impossible-route reporting, and day-variant exclusivity;
- operating schedules across weekday/season/exception precedence, destination timezone, and DST;
- provider-free road-trip generation performs zero route/weather/schedule calls and is deterministic for equal inputs.

Use **property-based tests** (e.g. `fast-check`) for “a hard-incompatible block is never selected,”
“private fields never affect or enter the shared projection,” “validator acceptance is invariant under
candidate ordering,” “a required checkpoint is never auto-cut,” “a selected route always preserves declared
slack,” “exactly one exclusive day variant is active,” and “serialized payload remains within cap.” Fuzz
cache/model/provider JSON and corpus files.

### Golden Itinerary Eval Set

Maintain a versioned JSON **"Gold Set"** of 50 diverse trip requests (e.g., "3 days in Lisbon, mobility
limited, budget: tight"). Every change to the selector or validator must pass this suite, asserting zero
hard-constraint violations and consistent signature coverage.

Add a named **15-day Romania road-trip** golden scenario modeled on the reviewed reference itinerary. Its
machine-checkable assertions are:

- every date maps to the expected Bucharest, Brașov, Sighișoara, Cluj, Apuseni, Sibiu, or final Bucharest base;
- activities occur only after arrival and before departure, and driving occurs only inside the supplied car-
  rental window;
- Peleș Castle is not placed Monday and fits the verified, date-specific opening interval when selected;
- the final driving day reaches Bucharest by 18:00 with configured slack before a 19:00 car return;
- Poenari and other optional stops are cut before required deadlines in deterministic priority order;
- Transfăgărășan Thursday/Friday weather variants remain mutually exclusive and swappable as whole days;
- the days-by-base, driving/deadline summary, and hike constraint receipt match the structured source facts;
- disabling every live-data flag still yields a coherent, clearly labeled itinerary with no external calls.

### Integration and adapter-contract tests

- identical read/write/expiry/checksum/cleanup/release behavior for Postgres, Firebase, and memory;
- migration dual-read/write-v2-only behavior and bounded legacy cleanup;
- atomic weighted reservations and retained-capacity reserve/commit/release under concurrency and restart;
- single-flight across concurrent requests, expired leases, owner-token safety, timeout fallback;
- flags off at route, service, enqueue, and worker execution time;
- every external call reserves the correct provider/caller before invocation and records actual cost once;
- route matrices reserve/count elements (not merely HTTP calls), weather requests are horizon/day bounded,
  and schedule verification is restricted to selected anchors/time-critical items;
- every DB transaction reserves its worst-case operation/byte units and idempotent retries do not double bill;
- provider, storage, queue, token, and monthly-cost exhaustion each produce the documented bounded fallback;
- missing/zero provider or caller caps fail closed before work, and a cache hit follows the same generation
  entitlement/idempotency accounting as a miss;
- account/trip data never appears in shared cache documents, logs, metrics, or promotion artifacts.
- each road-trip/live-data flag fails independently to the provider-free overlay, and route/weather/schedule
  cap exhaustion never triggers a different paid provider.

Add static/wiring tests analogous to `apiRequestCostWiring.test.ts` so a new binder, author, verifier, or
storage operation cannot bypass reservation/cost functions. Config tests require all enabled AI providers to
declare both new callers and pricing, all required feature flags to be seeded, and all estimator metrics to
be priced exactly once.

### Quality, load, and security evaluation

Maintain a versioned offline eval corpus covering head/body/tail destinations, multi-city trips, flat and
conflicting preferences, mobility/accessibility, young children, dietary needs, tight budgets, pinned-item
conflicts, closures, permits, DST, long trips, cold locations, stale evidence, and malicious corpus/provider
text. Include multi-base road trips with rental windows, hard deadlines, seasonal roads, whole-day alternates,
and infeasible required routes. Compare against the existing pipeline on:

- hard-constraint violation rate (release blocker if non-zero in the gold set);
- valid itinerary rate, top-interest coverage, geographic coherence, pacing/density, pin recall;
- deterministic/Tier 0/Tier 1 proportions, tokens and provider calls per valid itinerary;
- p50/p95/p99 latency, payload/retained bytes, operation counts, and net cost;
- diversity distribution and repeated-winner rate within substitution groups;
- reviewer rejection, post-read rejection, stale suppression, and user edit/regenerate rates.

Run load tests for hot-key expiry, many unique keys, cold-location bursts, cleanup/release races, provider
timeouts, and storage throttling. Security tests cover authorization, cache-key guessing, poisoning, prompt
injection, stored XSS/unsafe links, SSRF in verification, oversized data, malformed Unicode, audit integrity,
and source revocation.

## 24. Rollout and definition of done

1. **Foundation, flags off:** canonical schemas, dedicated adapter-parity storage, weighted usage/capacity
   meters, fail-closed required-limit mode, entitlement/idempotency integration, cost pricing/estimator
   coverage, observability, and tests.
2. **Offline corpus:** clean immutable reference release, authoring QA, source/license review, no runtime reads.
3. **Shadow read:** compute keys/read/validate for an internal cohort, never alter responses; paid judging is
   separately flagged, capped, and costed.
4. **Deterministic internal serve:** master + reads for staff only; no LLM binding or writes.
5. **Provider-free road-trip-lite:** staff-only base stays, static/heuristic legs, timed-route arithmetic,
   day variants, and derived summaries; assert zero external route/weather/schedule calls.
6. **Tier 0 canary:** 1% then 5% of eligible traffic, rollback on privacy/constraint error, latency regression,
   corrupt/rejection rate, negative savings, or limit pressure.
7. **Bounded Tier 1:** enable lightweight binding after provider/token/cost metrics and deterministic fallback
   pass; no model escalation.
8. **Write-through:** enable only after reuse/economic thresholds are validated and retained-byte cleanup has
   operated successfully for at least one full TTL cycle.
9. **Authoring/promotion:** enable draft jobs, then reviewed immutable releases; keep prepopulation off.
10. **Optional live enhancements:** independently canary anchor schedules, then near-departure weather, then
    route refinement only after their caller/element/storage caps, prices, estimator mappings, and fallbacks
    pass. Do not bundle the three rollouts.
11. **Prepopulation:** expand one demand band at a time while net savings and quality stay above thresholds.

The feature is not production-complete until:

- [ ] every API, token, operation, job, retry, and retained byte has a finite enforced cap;
- [ ] missing/invalid limits, prices, budgets, flags, schemas, or adapter support disable the affected
      component before any billable work;
- [ ] every usage metric has runtime cost accounting and one estimator mapping;
- [ ] all major flags exist, default safely, work at route/service/worker boundaries, and have tested rollback;
- [ ] Postgres, Firebase, and memory pass the same cache/release/limiter contract suite;
- [ ] shared keys/values and telemetry pass privacy inspection with no private/free-form fields;
- [ ] corpus promotion is evidence-backed, audited, immutable, reversible, and has no bypass;
- [ ] constraint, security, load, chaos, migration, cost, and quality gates pass;
- [ ] the Romania road-trip golden scenario passes with all live-data flags off and again with each optional
      provider independently enabled, exhausted, timed out, and disabled;
- [ ] base/leg/deadline/variant data stays private, route/deadline math is deterministic, and required stops are
      never silently cut;
- [ ] route elements, weather requests/days, schedule verifications, private/shared storage operations, and
      retained bytes are capped, cost-recorded, and represented in low/base/high estimates;
- [ ] dashboards/alerts and an operator runbook cover kill switches, cap exhaustion, cleanup lag, poisoning,
      source revocation, and corpus rollback;
- [ ] measured canary net savings are positive without a statistically meaningful quality regression.
