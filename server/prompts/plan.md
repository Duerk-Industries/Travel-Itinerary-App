# LLM Itinerary Prompt Plan (Optimized + Ultra-cheap Mini Calls)

This plan merges and improves:
- The 2–4 step pack in **itinerary_prompt_pack** (structured plan → expand → validate → optional render). fileciteturn0file0
- The separate prompts (structural optimizer, narrative expansion, validator/formatter). fileciteturn0file2 fileciteturn0file1 fileciteturn0file5
- Trait definitions from the two JSONs. fileciteturn0file3 fileciteturn0file4


## Non-synthetic data policy (hard rule)

All prompts in this plan include an explicit restriction against synthetic/fictional “facts”.
The model must **not** fabricate:
- named businesses (restaurants/hotels/tour operators), exact addresses, prices, schedules, train numbers,
- precise distances/durations as facts,
- “current” opening hours, ticketing rules, or any claim that would require browsing.

When details are unknown or would require external verification, the output must use:
- **generic categories** (especially for meals), and/or
- **placeholders** (e.g., lodging as `"Lodging at '<base>'"`), and/or
- omit the detail.

## What changed (why it’s better for cost + reliability)

### 1) One canonical compact data model (short keys)
The prior files used multiple, longer schemas (`trip/bases/transfers/itinerary_days` vs `routing/days`).
This plan uses **one compact schema** end-to-end so mini models:
- emit fewer tokens,
- make fewer structural mistakes,
- require fewer retries.

### 2) Trait normalization is explicit and cheap
Your pack suggests compressing traits; the JSON trait files already encode key dimensions (pace/comfort/mobility/car/weights).
So Prompt 0 produces a single normalized block and assumptions list, which all later prompts consume.

### 3) Separation of responsibilities (prevents “rework”)
- Prompt 1 ONLY solves routing/bases/transfers (hard constraints).
- Prompt 2 ONLY fills daily content (soft preferences).
- Prompt 3 ONLY repairs.
This reduces “model arguing with itself” and cuts retries.

### 4) JSON schemas optimized for ultra-cheap mini models
- Short keys (`sd`, `ed`, `b`, `x`, `dy`, `w`)
- Short enums (`R/B/F`, `B/M/L`, `L/M/H`, `P/D/R`)
- Avoid verbose nested objects unless needed.

- No separate booking list  to save tokens; “needs action” is inferred from activity type codes (R/E, sometimes A/T).
- If reintroducing a booking list later, restrict it to R and E only.

## Execution plan (recommended)

### Call A — Prompt 0 (Normalize)
Input: `req.json`  
Output: `norm.json`

### Call B — Prompt 1 (Route skeleton)
Input: `req.json` + `norm.json`  
Output: `route.json`

### Call C — Prompt 2 (Expand days)
Input: `route.json` + `norm.json`  
Output: `itinerary.json`

### Call D — Prompt 3 (Validate/repair)
Input: `itinerary.json`  
Output: `itinerary_fixed.json`

### Optional Call E — Prompt 4 (Render markdown)
Input: `itinerary_fixed.json`  
Output: `itinerary.md`

## Compact schemas (mini-model oriented)

- `schemas/req_schema_min.json` — input request fields (supports either explicit dates or month+duration)
- `schemas/norm_schema_min.json` — normalized traits + resolved dates
- `schemas/step1_schema_min.json` — routing skeleton
- `schemas/step2_schema_min.json` — full itinerary (routing + days)

Implementation note: treat these as **“contract schemas”** (what the model must emit), not full JSON Schema Draft specs, to keep tokens low.

## Trait mapping (from your JSONs)

Trip traits (short form) come from: pace/comfort/mobility/car + activity weights. fileciteturn0file3  
User traits support overrides and interests that help infer weights cheaply. fileciteturn0file4

Short code mapping:
- pace: Relaxed=R, Balanced=B, Fast=F
- comfort: Budget=B, Midrange=M, Luxury=L
- mobility: Low=L, Medium=M, High=H
- car: PublicTransitOnly=P, DayTripsOnly=D, FullTripRental=R
- weights: `w` = `{o,c,f,n,r}` for Outdoors/Culture/Food/Nightlife/Relax (sum=100)
- activity type enum (k): A=Ticketed Attraction, R=Reservation/timed entry, T=Guided Tour, O=Open Access/free, E=Event/scheduled
  - A (Ticketed Attraction): ticket/entrance fee; may be bought at gate; not necessarily timed
  - R (Reservation): requires pre-booking and/or timed entry (may be free)
  - T (Tour): guided experience (walking tour, day trip)
  - O (Open Access): no booking/ticket (park, historic walk, beach, viewpoint)
  - E (Event): scheduled event (concert, theater, festival, sporting event)


## Files produced
- `plan.md` (this document)
- `prompts/p0_norm.md`, `prompts/p1_route.md`, `prompts/p2_days.md`, `prompts/p3_validate.md`,
  `prompts/p4_render_md.md` — the live prompt templates, loaded at runtime by
  `itineraryInstructionService.ts`. (The `.json` siblings these once had were an unused, stale duplicate
  of this same content and have been deleted.)
- `traits/trip_traits_min.json`
- `traits/user_traits_min.json`
- `schemas/*_schema_min.json`



## Update: Hub prioritization (Prompt 1)
- Prompt 1 explicitly compares same-hub vs linear/open-jaw routing using rough travel-time heuristics.
- If linear/open-jaw saves **>= 60 minutes** total, it is preferred. If savings are **< 60 minutes**, default to the same hub for logistical simplicity.


## Plan-only routing heuristics (do not include in prompt tokens)

These heuristics live **only in this plan.md** so your app (or a higher-level orchestrator) can choose a plausible transfer mode without inflating mini-model prompt tokens. They are **not facts** and must not be presented as verified travel times.

### Distance-band heuristic table

| Great-circle / driving proxy | Default mode preference (highest → lowest) | Notes |
|---:|---|---|
| 0–80 km | Private → Train → Bus → Other | Assume local/regional movement. |
| 80–250 km | Train → Bus → Private → Other | “Intercity” scale; keep it simple. |
| 250–800 km | Train (if ≤4h) → Flight → Bus → Private → Other | Use Europe bias below where applicable. |
| 800–1500 km | Flight → Train → Bus → Other → Private | Most cases are air unless rail is known fast. |
| 1500+ km | Flight → Other | Ferry only if island-chain logic applies. |

### Automatic mode-bias rules by continent

Apply **only as tie-breakers** when multiple modes look plausible from distance-band logic (and you are using rough time heuristics, not real schedules):

- **Europe:** prefer **Train** for estimated ground trips ≤4h; prefer **Flight** beyond that.
- **Asia:** mixed; prefer **Train** for ≤3h in known high-speed corridors, otherwise **Flight** for long legs; **Bus** for short regional legs where rail is unlikely.
- **North America:** prefer **Flight** for ≥500 km; **Private** for ≤300 km where rail is weak; **Train** only when specifically user-requested or clearly practical.
- **South America:** prefer **Flight** for long legs; **Bus** commonly for mid-range; **Other** only when infrastructure uncertainty is high.
- **Africa:** prefer **Flight** for long legs; **Private**/**Bus** for regional; use **Other** when constraints are unclear.
- **Oceania:** islands drive choices: **Flight** between distant regions; **Ferry** for nearby island hops; **Private** for short land legs.



## Update: Loose weight enforcement (Prompt 2)
Prompt 2 treats weights as **trip-level frequency**, not a daily checklist:
- Low weight (<=15%): schedule a full activity roughly once every 3–5 days.
- Medium (16–35%): every 1–3 days.
- High (>=36%): most days.


## Update: Base extension repair (Prompt 3)
Validator includes a targeted repair step for lodging gaps: extend the preceding base checkout date forward to cover missing nights, avoiding a full routing regeneration unless extension is impossible.


## Update: Token-optimized meals
All day outputs use meal codes only: `BQ` (quick breakfast), `LC` (casual lunch), `DL` (local dinner). This prevents long meal strings and keeps mini-model outputs cheap.


## Additional Determinism + Cost Controls (Plan-only)

These rules are **plan-only** guidance for your orchestrator/operator. Do **not** paste them into prompt tokens.

### Travel Friction Score (tie-break)
When Prompt 1 has multiple viable routings, choose the lowest friction:

- **FrictionScore = (TransferHours × 2) + (TransfersCount × 1.5) + (BaseChanges × 2)**

Lower is better. Use this score only for tie-breaks; do not require the model to compute it.

### Hard cap on base count (routing guardrail)
Enforce maximum bases by trip length (before considering exceptions):

- **≤7 days:** 2 bases max  
- **8–12:** 3 bases max  
- **13–18:** 4 bases max  
- **19+:** 5 bases max  

Apply **Trip Mode** adjustments:
- **E (Explorer):** +1 base allowance
- **S (Slow):** −1 base allowance (min 1)

### Activity density control (output length)
Target stable output sizes:
- Per day: **≤3** primary activities, **≤1** evening item, **≤2** logistics notes
- For trips **≥10 days**: insert a lighter/rest half-day about every **4–5 days**

### Weight normalization (pre-step)
Normalize weights to sum to **100** (scale/round; fix remainder on the largest weight). This prevents drift when inputs don’t sum to 100.

### Token cost guardrails (operational targets)
Recommended token targets (excluding your input JSON size):
- **Prompt 0:** <350 tokens
- **Prompt 1:** <450 tokens
- **Prompt 2:** <600 tokens per 7 days
- **Prompt 3:** <350 tokens

If outputs exceed targets, shorten daily notes first (ln), then reduce optional narrative (m/e), never remove required structure.

### Routing stability seed (req.rs)
If multiple options are similar, use **req.rs** as a deterministic tie-break:
- Sort candidate options lexicographically
- Pick index **(rs mod N)**

This makes repeated calls reproducible even with stochastic sampling.
## Day items format (token-optimized)
- Each day uses a single list `it[]` of items: `[t,k,text]`.
- `t` time tag: `M` (morning), `D` (day/afternoon), `E` (evening).
- `k` activity type: `A` Ticketed Attraction, `R` Reservation/timed entry, `T` Tour, `O` Open Access, `E` Event.
- Policy: text must remain generic; no named venues/operators; no prices/timetables.
- Density caps: `it` <= 5 total, evening (`t=E`) <= 2, `ln` <= 2.
