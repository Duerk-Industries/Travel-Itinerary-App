# Automatic GetYourGuide Deep Links for Itinerary Activities — Implementation Plan

Back to: [Prompt Assets README](README.md) ·
[GetYourGuide Affiliate Partner Program Integration Suggestions](getyourguide-affiliate-integration-plan.md)
(the broader suggestions doc this plan narrows down to Phase A, made concrete)

This plan covers automatically attaching a GetYourGuide (GYG) affiliate deep link to relevant itinerary
activities, using the existing `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID` value in `server/.env`. It is written
to be directly implementable, but the live GYG affiliate documentation must be treated as the authority
for URL format, approved domains, attribution parameters, and disclosure requirements.

**Security note:** the partner ID itself is not treated as secret below (it's designed to appear in
public URLs), but this plan never prints its actual value — only the env var *name*. Whoever implements
this should read the real value from `server/.env` directly, not copy it between files/docs.

## 1. Decisions and senior-review corrections

| Decision | Choice |
|---|---|
| How the app gets the partner ID | **Server-owned redirect** using `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID`; do not require a mobile rebuild to rotate or disable attribution. A public build-time fallback is optional for offline exports only. |
| Where relevance and safety checks live | **Shared contract, server authoritative.** The server applies the feature flag, feasibility/preferences gate, quota, and link validation. A small client helper may mirror pure display checks, but must fail closed if server metadata is absent. |
| Where the link appears in the UI | **Inline on each qualifying activity row**, with neutral wording such as “Explore experiences.” Use “Skip-the-line” only when verified product metadata supports it. |

The link can still be generated retroactively for saved activities, but the server must own the canonical
redirect and feature flag. This keeps exports, native clients, and the web client consistent, permits an
instant kill switch, and avoids stale partner parameters embedded in saved itineraries.

### Canonical request flow

1. The server returns an optional affiliate-link descriptor containing a provider, link kind, opaque
   activity reference, and disclosure requirement—not a raw partner URL.
2. The app opens `GET /api/affiliate/getyourguide?token=...` (or an equivalent signed short token). The
   endpoint validates the signature, expiration, feature flag, and activity eligibility, then builds the
   current approved GYG URL and returns a `302`.
3. The redirect only permits the documented GYG host/path, strips unexpected parameters, emits a minimal
   consent-aware click event, and never logs account IDs, names, email addresses, or the partner ID.
4. If the endpoint is unavailable, the UI hides the CTA or uses an explicitly enabled, server-generated
   cached URL; it must not construct an untracked arbitrary URL in the client.

## 2. Grounded in what already exists

- `server/.env` already has `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID` set (confirmed present; value not
  reproduced here).
- `Activity` (`server/src/types.ts`) has `id`, `name`, `activityType: ActivityType`, `date`,
  `startLocation`. No persisted URL field is needed; the server may add an ephemeral link descriptor to
  the response when the activity passes the gates.
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
  generated activity text non-vague). §4 below defines a shared, pure subset for presentation, while the
  server remains authoritative and applies destination/time/feasibility checks.
- `app/config/premiumTrials.ts` demonstrates safe environment fallback patterns, but it should not be used
  to ship the partner ID in the normal online flow. The client consumes a server-issued descriptor instead.

## 3. Partner ID delivery

1. Keep `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID` in the server environment and read it through the app's
   validated configuration helper. Do not duplicate it in `app/.env`, `eas.json`, or the mobile bundle by
   default. A partner identifier may be technically public, but duplication creates stale-attribution and
   emergency-disable problems.
2. Add a server affiliate-link route/service that validates an activity token, applies the feature flag,
   and constructs the URL from the current partner documentation. Use an opaque, expiring click reference;
   never use a raw user ID or activity name as the tracking value.
3. `app/utils/getYourGuideLinks.ts` should be a typed descriptor/request builder, not the source of truth
   for partner parameters. It returns `null` when the server descriptor is missing or invalid. An
   explicitly documented client fallback may read `EXPO_PUBLIC_GETYOURGUIDE_PARTNER_ID` for offline
   exports, but it must be disabled in normal online mode and covered by a separate kill switch.
4. Add the server variable and endpoint to env-setup/runbook documentation, include rotation and rollback
   steps, and test missing/expired/rotated configuration. Never put a real partner value in source,
   fixtures, logs, screenshots, or CI output.

## 4. Relevance matching — deciding which activities get a link

The client may perform cheap display checks, but the server is authoritative. A link is emitted only when
the feature flag is on, the activity is eligible, and the server's deterministic travel-feasibility gate
passes. Phase A does not claim that a matching product or price exists; it only offers a destination-
scoped search.

**Gate 1 — bookable-shaped `activityType`.** Start with these types, subject to a bounded per-itinerary
cap:

```
Tour, Ticketed Attraction, Reservation, Day Trip, Class, Event, Concert/Show, Outdoor Activity, Spa/Wellness
```

Excluded by default: `Open Access` (usually free/no product to book — e.g. "walk through the park"),
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
useful GYG search (a search for "a local walk" returns noise, not a relevant result). Use the shared
pure ruleset (`isLikelySpecificActivityName`) for UI consistency, but apply the full server list before
issuing a descriptor:

- Reject if the name matches any of a short blocklist of vague phrases: `nearby`, `local (park|market|
  restaurant|event)`, `flexible`, `city center`, `old town` (used bare, with no place name attached).
- Reject if the name is fewer than 2 words after removing stopwords (too short to be a specific product).
- Otherwise accept.

This is intentionally conservative-but-simple, not exhaustive — false negatives (skipping a link on a
genuinely specific activity) are low-cost; false positives (linking a vague "local walk") are the ones
worth avoiding, and the two gates above already remove most of them.

**Gate 3 — travel relevance and feasibility.** Use the account preferences and trip preferences available
to the planner: interest weights, must-sees, budget/comfort, mobility/accessibility, language, party size,
date, time-of-day, duration, and avoid-list. Confirm that the activity's known coordinates (or the
destination center for Phase A) fit the previous/next itinerary legs and that duration plus a safety buffer
fits the day. Suppress links for activities already booked, duplicates, or days over the CTA cap. Never
encode sensitive preferences or exact personal data in the affiliate URL.

## 5. Building the URL

```ts
// app/utils/getYourGuideLinks.ts — descriptor only; server builds the URL
export type GetYourGuideLinkDescriptor = {
  provider: 'getyourguide';
  endpoint: string;       // server-owned affiliate endpoint
  token: string;          // opaque, signed, expiring, non-PII token
  kind: 'search' | 'product';
  disclosureRequired: true;
};

export const buildGetYourGuideDescriptor = (activity: Activity): GetYourGuideLinkDescriptor | null => {
  if (!isBookableActivityType(activity.activityType)) return null;
  if (!isLikelySpecificActivityName(activity.name)) return null;
  // The server must issue the token after destination/time/preferences/flag checks.
  return requestServerAffiliateDescriptor(activity.id) ?? null;
};
```

- **Query context** should be built server-side from the normalized activity name and disambiguated
  destination (country/city, and coordinates when available). Include date/time or party-size filters only
  when the partner format supports them; never put sensitive preferences in the URL.
- **Sub-ID / click reference** must be an opaque, expiring token. Do not use the activity ID directly if it
  can identify a traveler or expose internal data. If GYG supports sub-IDs, pass a privacy-reviewed token
  and document the mapping/retention policy.
- **Exact path and parameter names are unconfirmed** until the current GYG dashboard/docs are reviewed.
  Add a contract fixture and a small authorized smoke test; never ship the placeholder `?q=`, `partner_id=`,
  or `cmp=` shape as if it were production truth.

## 6. UI wiring

Inline on each qualifying row, in two places, using the server-issued descriptor:

1. **`app/tabs/activities.tsx`** — on each activity card/row, if the descriptor is present and the feature
   is enabled, render a small action link.
2. **CTA wording.** Use **"Explore experiences on GetYourGuide ↗"** for Phase A. Use **"View tickets"** or
   **"Skip-the-line"** only when a verified Phase-B product field supports that claim; `Ticketed Attraction`
   alone is not proof.
3. **`app/tabs/overview.tsx`** — same treatment on activity entries inside the day-by-day itinerary view.
4. **Required disclosure label**, adjacent to the CTA in both places and in PDF/email exports. Make the
   disclosure accessible to screen readers and localizable.
5. **Feature flag**: add `getyourguide_activity_suggestions` to `server/config/feature-flags.yaml`
   (`enabled: true` by default, but present so it can be killed instantly without a deploy). The app reads
   this the same way it reads other feature flags today — confirm the existing flag-fetch path
   (`FeaturesSection`'s `/api/admin/features`-style read, or whatever the *non-admin* runtime flag check
   is — verify against `entitlementService.ts`'s `assertCanUseFeature`/flag-read helpers) rather than
   introducing a second mechanism.

## 7. Testing plan

- **`app/tests/getYourGuideLinks.test.ts`** (pure function unit tests, no rendering, mirrors how
  `mapLinks.ts` itself would be tested if it had a dedicated test file):
  - Returns `null` when the server descriptor is missing, expired, malformed, or the feature is disabled.
  - Gate 1: returns `null` for each excluded `activityType`, returns a URL for each included one.
  - Gate 2: returns `null` for each blocklisted vague-phrase case and the too-short case; returns a URL
    for a normal specific name (e.g. "Louvre Museum Tour").
  - Handles special characters / non-ASCII activity names (e.g. "Museo Nacional de Antropología") in the
    descriptor request without leaking raw text or personal data into the token.
- **Server redirect tests**: validate signatures/expiry, host/path allowlisting, control-character and
  oversized inputs, flag-off behavior, missing configuration, token replay policy, consent-aware click
  events, and that the partner ID/raw account data never appears in logs.
- **Matching and planner integration tests**: cover budget/mobility/language/date/time/party-size gates,
  impossible transfer windows, must-see priority, duplicate/already-booked suppression, per-itinerary caps,
  and the invariant that affiliate ranking cannot reorder the core itinerary.
- **Component test** for the new inline affordance in `activities.tsx`/`overview.tsx` (mirrors
  `AdminTab.CostEstimate.test.tsx`'s pattern from the cost-estimator work: render with a fixture activity
  that should qualify, assert the link/button and disclosure text are present; render with a
  non-qualifying fixture, assert they're absent).
- **Manual verification in the running app** (per this repo's CLAUDE.md convention for UI changes): run
  `npm run web` in `app/`, open a trip with a mix of bookable and non-bookable activities, confirm the
  link appears only where expected, opens in a new tab/browser correctly, the disclosure text is visible,
  and the endpoint-disabled/offline state hides the CTA without breaking the itinerary.

## 8. Rollout

1. Confirm partner terms/link format and implement the server descriptor/redirect with tests before any
   UI work.
2. Wire `activities.tsx`, `overview.tsx`, PDF, and email renderers behind the feature flag, with disclosure
   and a bounded, travel-aware candidate list.
3. Ship to a small cohort first. Monitor broken redirects, suppression reasons, relevance samples,
   latency, and disclosure visibility before enabling broadly.
4. After sufficient click/quality data exists, tune the allowlist and specificity rules through config or a
   versioned ruleset—not by silently changing historical itineraries.

## 9. Explicitly out of scope for this plan

- Anything from the broader suggestions doc's **Phase B** (GetYourGuide Partner API, real price/rating
  data, cached product IDs) — this plan is deep-links only.
- A dedicated "Book Experiences" rollup section — declined in favor of inline placement (§1).
