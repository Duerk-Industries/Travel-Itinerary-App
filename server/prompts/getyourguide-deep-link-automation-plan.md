# Automatic GetYourGuide Deep Links for Itinerary Activities — Implementation Plan

Back to: [Prompt Assets README](README.md) ·
[GetYourGuide Affiliate Partner Program Integration Suggestions](getyourguide-affiliate-integration-plan.md)
(the broader suggestions doc this plan narrows down to Phase A, made concrete)

This plan covers automatically attaching a GetYourGuide (GYG) affiliate deep link to relevant itinerary
activities, using the existing `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID` value in `server/.env`. It reflects
three architecture decisions confirmed with the product owner (see §1) and is written to be directly
implementable.

**Security note:** the partner ID itself is not treated as secret below (it's designed to appear in
public URLs), but this plan never prints its actual value — only the env var *name*. Whoever implements
this should read the real value from `server/.env` directly, not copy it between files/docs.

## 1. Decisions already made

| Decision | Choice |
|---|---|
| How the app gets the (non-secret) partner ID | **Baked into the build** via `EXPO_PUBLIC_GETYOURGUIDE_PARTNER_ID`. Unified with `GETYOURGUIDE_PARTNER_ID` in `server/.env`. |
| Where the "is this activity specific/bookable enough to link" check lives | **Shared Utility.** Implementation in `app/utils/getYourGuideLinks.ts` mirrored by a server-side helper to support **PDF/Email exports**. |
| Where the link appears in the UI | **Inline on each qualifying activity row** with **Dynamic CTAs** (e.g., "Skip-the-Line" for landmarks). |

Because the matching logic runs **entirely client-side at render time**, this works retroactively on
every activity already in the database the moment it ships — no backend changes, no data migration, no
regeneration of existing itineraries required.

## 2. Grounded in what already exists

- `server/.env` already has `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID` set (confirmed present; value not
  reproduced here).
- `Activity` (`server/src/types.ts`) has `id`, `name`, `activityType: ActivityType`, `date`,
  `startLocation`. No URL field — none needed, since the link is computed on the fly, not stored.
- `ActivityType` is a closed union: `Class | Concert/Show | Day Trip | Event | Food & Drink | Fun & Games
  | Hike | Nightlife | Open Access | Outdoor Activity | Reservation | Shopping | Sights & Landmarks |
  Spa/Wellness | Ticketed Attraction | Tour` (`types.ts`).
- `app/utils/mapLinks.ts` is the exact structural template to copy: a pure `buildXUrl(query, ...): string
  | null` function, `encodeURIComponent`, a typed options list for any future multi-provider picker. This
  plan's `getYourGuideLinks.ts` mirrors it line-for-line in spirit.
- `app/tabs/overview.tsx` already has a working, cross-platform external-link opener
  (`openDetailLink`, using `window.open` on web / `Linking.openURL` on native) wired to a `linkUrl`-style
  field on detail-item rows — reused as-is, not rebuilt.
- `server/src/services/itineraryPromptPlanService.ts`'s `GENERIC_ACTIVITY_PATTERNS` /
  `EXTRA_GENERIC_ACTIVITY_PATTERNS` are the server's real, fuller specificity guardrail (used to keep
  generated activity text non-vague). §4 below defines a small client-side subset in the same spirit,
  per the accepted decision above.
- `app/config/premiumTrials.ts` is the exact pattern for reading an `EXPO_PUBLIC_*` var with an
  `expo-constants` `extra` fallback (for environments where `process.env` isn't populated) — §3 reuses
  this shape for the partner ID.

## 3. Partner ID delivery

1. **`app/.env`** (local dev) and **`app/eas.json`** (build profiles, alongside the existing
   `EXPO_PUBLIC_BACKEND_URL`/`EXPO_PUBLIC_SENTRY_DSN` entries): add
   `EXPO_PUBLIC_GETYOURGUIDE_PARTNER_ID=<same value as server/.env's GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID>`.
2. **`app/utils/getYourGuideLinks.ts`**: a `getGetYourGuidePartnerId(): string | undefined` reader,
   mirroring `premiumTrials.ts`'s `readFlag()` — check `process.env.EXPO_PUBLIC_GETYOURGUIDE_PARTNER_ID`
   first, fall back to `expo-constants`'s `expoConfig?.extra?.getYourGuidePartnerId`. If neither is set,
   every link-building call returns `null` (no link shown) rather than emitting an untracked/unpaid link —
   correctness here matters, since a link without the partner ID earns nothing.
3. **Keep-in-sync reminder**: since this value now lives in two files (`server/.env` and `app/.env`/
   `eas.json`), add a one-line comment in both places pointing at the other, and a short note in this
   repo's env-setup docs. If the partner ID is ever rotated, both must be updated together — this was an
   accepted tradeoff of the "bake into the build" choice (see §1) over a backend config endpoint.

## 4. Relevance matching — deciding which activities get a link

Two independent gates, both must pass. Neither requires a network call — this is pure, synchronous,
client-side logic.

**Gate 1 — bookable-shaped `activityType`.** Only these types are eligible:

```
Tour, Ticketed Attraction, Reservation, Day Trip, Class, Event, Concert/Show, Outdoor Activity, Spa/Wellness
```

Excluded on purpose: `Open Access` (usually free/no product to book — e.g. "walk through the park"),
`Food & Drink` (GYG's core inventory is tours/attractions/tickets, not restaurant reservations — a
mismatch would look irrelevant), `Shopping`, `Nightlife`, `Fun & Games`, `Hike`, `Sights & Landmarks`
(often a free viewpoint/landmark, not a bookable product — though see the open note below). This list is
a starting point, easy to tune after launch once click-through data exists — it does not require a code
migration, just editing one array.

*Open question worth flagging, not blocking:* `Sights & Landmarks` and `Food & Drink` sit in a gray zone
— some (a food tour, a landmark's skip-the-line ticket) are genuinely bookable on GYG, others aren't. If
early click-through data shows users engaging with links on these types too, revisit the allowlist rather
than guessing now.

**Gate 2 — specific enough to search well.** Reject activity names that are too generic to produce a
useful GYG search (a search for "a local walk" returns noise, not a relevant result). Client-side
ruleset (`isLikelySpecificActivityName` in `getYourGuideLinks.ts`), deliberately smaller than the
server's full list per the accepted decision in §1:

- Reject if the name matches any of a short blocklist of vague phrases: `nearby`, `local (park|market|
  restaurant|event)`, `flexible`, `city center`, `old town` (used bare, with no place name attached).
- Reject if the name is fewer than 2 words after removing stopwords (too short to be a specific product).
- Otherwise accept.

This is intentionally conservative-but-simple, not exhaustive — false negatives (skipping a link on a
genuinely specific activity) are low-cost; false positives (linking a vague "local walk") are the ones
worth avoiding, and the two gates above already remove most of them.

## 5. Building the URL

```ts
// app/utils/getYourGuideLinks.ts
export const buildGetYourGuideUrl = (params: {
  activityName: string;
  destination: string; // trip's base/destination locality, for query specificity
  activityId: string;  // used as a click-reference / sub-id, see below
}): string | null => {
  const partnerId = getGetYourGuidePartnerId();
  if (!partnerId) return null;
  if (!isBookableActivityType(...)) return null; // caller passes activityType separately, see full impl
  if (!isLikelySpecificActivityName(params.activityName)) return null;

  const query = `${params.activityName}, ${params.destination}`.trim();
  const encoded = encodeURIComponent(query);
  // NOTE: exact query-param names (partner_id vs pid, cmp/sub-id param name, base search path) must be
  // confirmed against GetYourGuide's current partner dashboard/documentation before shipping — GYG's
  // affiliate link format is not something to guess into production. Placeholder shape below.
  return `https://www.getyourguide.com/s/?q=${encoded}&partner_id=${encodeURIComponent(partnerId)}&cmp=${encodeURIComponent(params.activityId)}`;
};
```

- **Query** = activity name + trip destination, giving GYG's own search the best chance of surfacing a
  relevant, real product — this app never claims a specific GYG product/price exists; it only links to a
  *search* for one, so nothing here risks the non-fabrication guardrail the itinerary pipeline already
  enforces.
- **Sub-id / click reference** = the activity's own `id` (already exists on every `Activity` record, no
  new field needed). If GYG's program supports an echoed sub-id/click-ref parameter (confirm exact param
  name against their docs), this lets you later correlate GYG's booking reports back to which specific
  generated activity converted — valuable product signal, not just revenue tracking, and ties directly
  back into this app's existing relevance-tuning work (itinerary-improvement-plan.md).
- **Exact param names are a placeholder above and must be verified** against GetYourGuide's live partner
  documentation/dashboard before shipping. Do not treat `?q=`/`partner_id=`/`cmp=` as confirmed — this is
  the one piece of this plan that depends on external, changeable documentation rather than this
  codebase.

## 6. UI wiring

Per the accepted decision (§1), inline on each qualifying row, in two places:

1. **`app/tabs/activities.tsx`** — on each activity card/row, if `buildGetYourGuideUrl(...)` returns
   non-null, render a small action link.
2. **Dynamic CTA Logic.** If `activityType` is `Ticketed Attraction`, use **"Get Skip-the-Line Tickets ↗"**.
   Otherwise use **"Find on GetYourGuide ↗"**.
3. **`app/tabs/overview.tsx`** — same treatment on activity entries inside the day-by-day itinerary view.
4. **Required disclosure label**, next to the link in both places...
4. **Feature flag**: add `getyourguide_activity_suggestions` to `server/config/feature-flags.yaml`
   (`enabled: true` by default, but present so it can be killed instantly without a deploy). The app reads
   this the same way it reads other feature flags today — confirm the existing flag-fetch path
   (`FeaturesSection`'s `/api/admin/features`-style read, or whatever the *non-admin* runtime flag check
   is — verify against `entitlementService.ts`'s `assertCanUseFeature`/flag-read helpers) rather than
   introducing a second mechanism.

## 7. Testing plan

- **`app/tests/getYourGuideLinks.test.ts`** (pure function unit tests, no rendering, mirrors how
  `mapLinks.ts` itself would be tested if it had a dedicated test file):
  - Returns `null` when the partner ID env var is unset.
  - Gate 1: returns `null` for each excluded `activityType`, returns a URL for each included one.
  - Gate 2: returns `null` for each blocklisted vague-phrase case and the too-short case; returns a URL
    for a normal specific name (e.g. "Louvre Museum Skip-the-Line Tour").
  - URL contains the encoded partner ID and the activity's `id` as the sub-id param (once the real param
    names are confirmed per §5's open item).
  - Handles special characters / non-ASCII activity names (e.g. "Museo Nacional de Antropología")
    correctly via `encodeURIComponent`.
- **Component test** for the new inline affordance in `activities.tsx`/`overview.tsx` (mirrors
  `AdminTab.CostEstimate.test.tsx`'s pattern from the cost-estimator work: render with a fixture activity
  that should qualify, assert the link/button and disclosure text are present; render with a
  non-qualifying fixture, assert they're absent).
- **Manual verification in the running app** (per this repo's CLAUDE.md convention for UI changes): run
  `npm run web` in `app/`, open a trip with a mix of bookable and non-bookable activities, confirm the
  link appears only where expected, opens in a new tab/browser correctly, and the disclosure text is
  visible.

## 8. Rollout

1. Add `EXPO_PUBLIC_GETYOURGUIDE_PARTNER_ID` (§3), build `getYourGuideLinks.ts` + its unit tests (§4–5,
   with the query-param names confirmed against GYG's real docs first — this is the one true blocker).
2. Wire into `activities.tsx` and `overview.tsx` (§6) behind the feature flag, with the disclosure label.
3. Ship to a small cohort first (the feature flag makes this easy to stage), watch for any obviously
   irrelevant links surfacing in practice (the two-gate filter in §4 is a first pass, not guaranteed
   perfect) before enabling broadly.
4. After real click-through/booking data exists, revisit the `activityType` allowlist and the
   specificity ruleset — this was explicitly designed to be cheap to tune (two small arrays/regex lists),
   not something to over-engineer before real usage data exists.

## 9. Explicitly out of scope for this plan

- Anything from the broader suggestions doc's **Phase B** (GetYourGuide Partner API, real price/rating
  data, cached product IDs) — this plan is deep-links only.
- Backend changes of any kind — this is a frontend-only feature by design (§1).
- A dedicated "Book Experiences" rollup section — declined in favor of inline placement (§1).
