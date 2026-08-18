# Itinerary Narrative Depth & Validation — Implementation Plan

**Status:** Implemented for the recommended P0/P1/P2/P4 sequence. P3/P5/P6/P7 remain deferred as described below.
**Last updated:** 2026-08-17
**Authors:** assistant, in collaboration with @tristanduerk
**Related:** [implementation-plan-wanderlog-competitive-analysis.md](implementation-plan-wanderlog-competitive-analysis.md) (map/discovery/route-optimization gaps — orthogonal to this doc, which is about the *depth and trustworthiness of generated content*, not features)

## Implementation update — 2026-08-17

- The full generated markdown is persisted on the itinerary and exposed in the Overview as collapsible **Trip Notes**.
- Verified catalog/Wikipedia attractions can use longer descriptions; free-form activities remain capped at the shorter limit.
- The Overview derives a deterministic **What to book now** list from unbooked trip records.
- Plausibility-gated destination narratives are cached and prepended to the guide.
- The prompt-plan response now also carries `annotated-itinerary-v1`: route rationale, evidence/confidence, booking and verification actions, pace/contingency notes, and validation results. Verified ActivityBlock closures and operating windows are enforced in code; provisional and `llm_draft` facts remain explicitly unverified.
- Exact entry rules, transit quirks, trail metrics, and translations are still never invented. Those fields are omitted or turned into verification actions unless trusted source data is present.

## Implementation update — 2026-08-17 (audit fixes)

Following an architecture audit of the annotated-itinerary pipeline against this plan, four gaps were closed:

- **Day-trip/base-city conflict is now deterministic.** `enforceDayTripBaseCityConsistency` (itineraryPromptPlanService.ts) replaces what used to be a p3_validate.md prompt instruction asking the LLM to police its own day-trip placement — the exact failure mode this plan's hybrid-generation section exists to prevent. It only removes an item when the attractions catalog proves it's physically in the base city on a day the itinerary already committed to a named day trip elsewhere.
- **Lodging-zone guidance now reaches the rendered itinerary.** `AnnotatedItinerary.route.bases[].lodgingZone` surfaces LocationZoneSchema's district suitability, station access, transit note, cost band, and named alternative — previously modeled in the corpus but dead-ending there. Picked via the base's own scheduled activities (by ActivityBlock zone) and the corpus's adjacency graph, never fabricated when no lodging-suitable zone is on record.
- **The quality gate has a live caller.** `runItineraryQualityGateAgainstPinnedBaseline` (itineraryQualityGateService.ts) compares every generation's evaluation metrics against an admin-pinned baseline (`PATCH /api/admin/itinerary-cache/quality-baseline`, mirroring the existing `ACTIVE_CORPUS_RELEASE_ID` pattern) and records the result in generation metrics. Fail-open and non-blocking by design — an operational signal, not a hard gate on the request path — using looser continuous-monitoring thresholds than the strict A/B-comparison defaults.
- **One confidence vocabulary.** `ItineraryConfidenceSchema` (`verified | historical_pattern | estimated | needs_confirmation | user_supplied`) replaces three enums that had drifted independently (`verified/provisional/unknown`, `verified/estimated/unknown`, `verified/estimated/low`) across evidence, contingencies, actions, fragile connections, and road-trip travel legs.
- `itineraryEvaluationService.ts`'s `unsupportedFactRate`/`scheduleWindowViolations` were also found permanently null despite the annotation stage already computing the data (a prior-session bug, fixed the same day this plan's P0–P4 items shipped) — now wired through.

---

## 1. Prompt for this analysis

Given a hand-written, heavily annotated 28-night Japan/Korea itinerary
(`japan-korea-itinerary-annotated.md`) as a quality bar, determine what it
would take for WanderBunnies' AI generation to produce, validate, and surface
that kind of content — historical/cultural context per stop, specific
logistics ("non-reserved cars 1–3 on every Nozomi"), a booking-priority list,
practical notes (luggage forwarding, entry requirements, weather) — instead
of the current output.

## 2. The single biggest finding: the rich content already exists and is thrown away

The generation pipeline (`itineraryPromptPlanService.ts`) runs a real
**render stage** (`p4_render_md.md`) that produces full markdown — headers,
a day-by-day narrative, a "why this fits your group" line per activity — and
returns it from the API as `result.plan`
([itineraryRoutes.ts:452](../../server/src/routes/itineraryRoutes.ts#L452)).

Nothing in the app displays it. `parsePlanToDetails()`
([itineraryParser.ts](../../app/utils/itineraryParser.ts)) — the only
client-side consumer of `plan` — is a defensive fallback parser that reduces
the markdown back down to bare `{day, activity, cost}` triples, discarding
every word of prose. The structured `details`/`generatedItems` path (built by
`buildDetails()`/`mapItems()`) is what actually reaches the UI, and it only
ever carries a name, a time, and a 1–2 sentence factual description plus a
generic "This stop suits your group because it supports your X interests"
line (`ItineraryGeneratedActivity.notes` /
`ItineraryGeneratedDetail.noteBody`).

**This means closing a meaningful part of the gap doesn't require generating
more content — it requires deciding where the content the model *already
writes* should actually be shown**, and then deepening it from there. That
reframes this from "build a new AI feature" to "stop discarding an existing
one, then invest incrementally."

## 3. Gap inventory — the example vs. current output

| What the example has | Current WanderBunnies equivalent | Gap |
|---|---|---|
| A 1–3 paragraph region/city intro (history, why it's sequenced here) | Nothing — no region-level narrative field exists anywhere in the schema | **Full gap** |
| Per-stop "what it is and why it earned its slot" (history, what makes *this* stop specifically worth it, an insider framing tip) | A 1–2 sentence factual blurb (cached Wikipedia summary or catalog snippet) + a generic interest-fit sentence | **Depth gap** — the field exists, it's just thin, and (before this session's fixes) was sometimes wrong or a listicle title |
| Specific transport instructions per leg (line names, which car is non-reserved, walk-up vs. must-book, minute-level connection times) | `day.ln[]`, capped at 2 generic entries per day ("reserve about X minutes before activities") | **Depth + capacity gap** |
| Explicit walk-up vs. reservation-required calls, plus ⚠️-style risk warnings ("only four services run daily") | Only `requiresPreOrderTickets` (boolean → folded into activity notes as one generic sentence) | **Partial** — the underlying signal exists for tickets; nothing analogous exists for transport legs |
| A "what you actually have to book, by urgency" table | Nothing consolidated — pre-order flags are scattered per-activity, never aggregated | **Full gap**, but cheaply derivable (see §4, P2) |
| A hike/activity-intensity summary table (distance, elevation gain) | `estimateAttractionDurationMinutes` exists (duration only); no elevation/intensity data anywhere | **Full gap** — needs new data |
| Practical notes: luggage forwarding, entry requirements (Visa/K-ETA), pass value assessment, regional weather ranges | Per-day weather already exists (`overview_weather`, real Open-Meteo data) and *is* shown; the rest (entry requirements, passes, luggage) is absent | **Partial** — weather is solved; the rest is a genuine gap |
| Native-script place names alongside romanization | Not present | **Full gap**, and higher-risk to auto-generate (see §5, P3) |
| Route-at-a-glance summary table | Not present in-app (though the wizard/overview implicitly encodes this via the day tabs + lodging list) | **Cosmetic gap**, mostly a rendering question, not a generation question |

## 4. Proposed improvements, prioritized

Each item below is scoped to be independently shippable — nothing here
requires the others.

### P0 — Surface the render-stage output instead of discarding it

Add a "Trip Notes" (or "Guide") view that renders `result.plan` as
formatted text — a new tab/section on the itinerary screen, not a
replacement for the structured Activities/Locations views this session
already cleaned up. Store the markdown on the itinerary record (it's already
computed and returned; just isn't persisted or displayed) and render it with
whatever lightweight markdown renderer the app already uses elsewhere (check
`app/components/` for one before adding a dependency — the blog narrative
feature almost certainly needs one already).

**Cost:** ~zero new LLM spend (the stage already runs on every generation).
**Risk:** low — `p4_render_md.md`'s own system prompt already forbids
inventing facts and instructs it to render only what's in the input JSON
(`activityContext`), so it inherits whatever validation already runs upstream
of it. It's a *rendering* change, not a new generation surface.
**Effort:** small (a new read-only view + one migration to persist the field).

### P1 — Deepen the per-stop `description`/`whyThisFits` content

Two independent moves, both bounded by this session's validation work:

1. **Ask for more, but only from verified sources.** `attachAttractionMetadata()`
   already fetches a real Wikipedia summary per attraction, gated by
   `wikipediaGeocodingService.ts`'s topical-plausibility check (added this
   session). Raise `MAX_DESCRIPTION_SENTENCES` (currently 2, in
   `attractionDurationEstimationService.ts`) for verified/catalog-backed
   attractions specifically — a real Wikipedia extract for a real, catalog-matched
   place is exactly the kind of content the example's per-stop paragraphs are
   made of, and it's already fact-checked by definition (it's Wikipedia's own
   text, not LLM prose). Uncatalogued ("wild") activities should *not* get a
   longer description — see §5.
2. **A short "why here, why now" line, generated once per unique
   (destination, attraction) pair, not per trip.** This is different from the
   existing `whyFitsByName` reasoning (which is about the *traveler's*
   interests) — it's closer to the example's insider framing ("the shot is
   taken from the platform above the pagoda, not from its base"). This is
   genuinely new LLM-generated content and carries real hallucination risk
   for anything specific/tactical (angles, timing, which side of a bridge) —
   scope it to *general* context (what the place is, why it's historically
   significant) rather than tactical tips, and cache aggressively by
   attraction name so the cost is amortized across every trip that visits the
   same place, the same way `AttractionDurationMetadata` already is.

**Cost:** low-to-moderate (longer completions per attraction, mitigated by
caching).
**Risk:** moderate for the generated-tip variant; low for the
longer-Wikipedia-extract variant. See §5 for the validation requirement.

### P2 — A deterministic "what to book now" list

Fully derivable from data the pipeline already computes — no new LLM call.
`requiresPreOrderTickets` (per activity), lodging with limited
availability/high season pricing (a proxy: comfort tier + destination +
date-range overlap with known high-demand windows, e.g. Kyoto in late
November per the example — this is exactly the kind of thing
`destinationClimatologyBlock`/`LOGISTICS FACTS` already models for weather
and could model for demand), and international flight/rail legs (already
flagged as `transfer.n` notes in some cases). Aggregate into a "Book soon"
section, bucketed by urgency the same way the example's table is (Now / Soon
/ Later), computed server-side as a deterministic post-processing step over
`generatedItems`, not generated by the LLM at all.

**Cost:** none (pure computation over existing fields).
**Risk:** none — it's not a new fact source, just a new view over verified
existing fields.
**Effort:** small-to-moderate (the demand-window heuristic needs some
real-world calibration, but the pre-order/booking-reference-based version is
close to free).

### P3 — Practical/entry-requirement notes

Weather is already solved (`overview_weather`). The rest — visa/entry
requirements (Visit Japan Web, K-ETA-style items), luggage-forwarding advice,
rail-pass value assessment — is destination-and-nationality-specific
information the LLM does not reliably know current rules for (visa/entry
requirements *change*, and getting one wrong is a much worse failure mode
than a wrong museum description). **Do not generate this from the LLM's
background knowledge.** If pursued, this needs either a maintained reference
dataset (by destination + traveler nationality) or an explicit
"unverified — confirm before travel" disclaimer treatment, matching how the
app already declines to invent exact prices/hours elsewhere in the prompts.
Recommend scoping this to a small, curated set of common
nationality/destination pairs if it's pursued at all, or skipping it — it's
the highest-liability, lowest-leverage item in this list.

**Cost:** ongoing maintenance cost for a curated dataset, or real risk if
LLM-generated.
**Risk:** high if not curated/sourced from something authoritative.
**Recommendation:** low priority; possibly out of scope entirely.

### P4 — Region/day narrative intros

A 2–3 sentence intro per unique destination the trip visits ("why this order,
what defines this place"), generated once per destination and cached the
same way attraction descriptions are (keyed by destination name, not by
trip) — most trips to Kyoto should get the same intro, not a fresh
generation every time. Lower risk than P1's per-attraction tips because it's
scoped to well-known, broadly-documented facts about major destinations
(history, character), which is exactly where Wikipedia-style summaries are
most reliable.

**Cost:** low (one call per unique destination, heavily cached across all
users).
**Risk:** low-moderate — same validation requirement as P1.

### P5 — Transport-leg specificity (walk-up vs. reserve, line names, connection risk)

This is the example's single richest layer and the hardest to do safely.
"Non-reserved cars 1–3 on every Nozomi," "IC cards stop working north of
Mino-Ota," "only four Hida services run daily" — this is exactly the kind of
narrow, easily-stale, easily-wrong operational detail that already caused
three separate hallucination bugs this session (a wrong Wikipedia match, a
listicle title standing in for an activity, a geographically implausible
activity type). Getting a specific rail detail wrong is worse than a vague
one, because the traveler will act on it directly. **Do not generate this
from LLM background knowledge without a real transit-data source behind it**
(a GTFS-style feed, or a maintained per-region transit-quirks reference).
Absent that, the safer version is qualitative-only ("reservations recommended
in peak season" without inventing car numbers or service counts) — which is
close to what `day.ln[]` already does.

**Recommendation:** do not pursue the fully-specific version without a real
data source. The qualitative version is already substantially covered.

### P6 — Hike/activity-intensity table

Needs elevation-gain data that doesn't currently exist anywhere in the
pipeline. `estimateAttractionDurationMinutes` only estimates duration.
Feasible if a hiking-specific data source is added (many attraction catalogs
— AllTrails-style, OpenStreetMap trail relations — carry distance/elevation),
but this is new data-integration work, not a prompt/validation change.

**Recommendation:** defer; revisit only if hiking/outdoor-heavy trips become
a priority segment.

### P7 — Native script alongside romanization

Cosmetic and mostly low-risk (Wikipedia article titles in the destination's
language are already fetchable metadata), but genuinely low-value relative
to effort — the example does it for a bilingual power-user audience;
WanderBunnies' broader audience gets little from it. Low priority.

## 5. Validation strategy — the load-bearing constraint on all of the above

This session fixed three real hallucination bugs in the existing (much
thinner) content:

1. A live Wikipedia search for a generic AI-generated activity name
   confidently returned a topically unrelated article (`wikipediaGeocodingService.ts`'s
   `isPlausibleMatch` gate).
2. The model produced listicle article titles ("5 Things to Do in La
   Fortuna") as if they were bookable activities (`sanitizeActivityText`'s
   expanded `GENERIC_ACTIVITY_PATTERNS`).
3. The model scheduled a geographically implausible activity type at a
   real place ("Surf Lesson" in a mountain town) — caught only when neither
   the curated catalog nor a corroborating description backed it up
   (`enforceGeographicActivityPlausibility`).

**Every item in §4 that involves new LLM-generated prose (P1's tip variant,
P4, and especially P5) reintroduces this exact risk class, proportional to
how specific and tactical the content is.** The general principle this
session established, and that any of this work must keep:

> Trust the LLM for *synthesis* of already-verified facts (rendering a real
> Wikipedia extract, explaining why a real catalog entry fits stated
> preferences). Do not trust it for *facts themselves* (a specific transit
> detail, a specific composition tip, a specific geographic feature) unless
> there's a verifiable source behind the claim, and gate the output against
> that source the same way `isPlausibleMatch`/`enforceGeographicActivityPlausibility`
> already do — reject and fall back rather than surface an unverified
> specific claim.

Concretely: P0 and P2 need no new validation (they don't add new facts). P1's
longer-Wikipedia-extract variant needs none beyond what already exists. P1's
tip variant and P4 need a plausibility/corroboration check before being
cached, mirroring `isPlausibleMatch`. P3 and P5, as scoped above, should not
ship as free-form LLM generation without a real backing data source — that's
not a validation gap that can be prompt-engineered away.

## 6. Recommended sequencing

1. **P0** (surface existing markdown) — ships value immediately with
   near-zero new risk or cost; also the cheapest way to learn whether users
   actually want this before investing further.
2. **P2** (deterministic booking-priority list) — no LLM risk, real value,
   independent of P0.
3. **P1** (deepen per-stop description, Wikipedia-extract variant only) —
   direct extension of this session's plausibility-gate work.
4. **P4** (region intros) — same validation pattern as P1, once P1 ships.
5. **P1's tip variant** — only after P1/P4 validate the caching + plausibility
   approach in production.
6. **P3, P5, P6, P7** — hold. Each needs either a new data source or a
   deliberate liability/scope decision this document isn't making
   unilaterally.
