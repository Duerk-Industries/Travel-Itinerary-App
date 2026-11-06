# Stay22 integration plan (provider-isolated hotel links)

Date: November 5, 2026 (revised November 6, 2026)
Status: Proposed. This document does not turn on an integration or publish legal changes.
Parent plan: [implementation-plan-gap-closing.md §11.3 H1](implementation-plan-gap-closing.md#h1-affiliate-links-p1--stay22-integration-plan). That section summarizes this plan and links here.

## 0. Decision and relationship to existing work

**Provider decision (Bryan Duerk, 2026-11-06):** use Stay22 for now. The provider and the booking method may change later. The design therefore isolates them: Stay22 is one adapter behind a provider-neutral "stays" feature (§2). Changing providers, or moving from link-out to in-app booking (gap-closing H2), must not change placements, client code, routes, flags or data.

This is the detailed plan for **H1: affiliate links** in the gap-closing plan's §11.3. Where the two disagreed, this plan decides:

| Topic | Earlier §11.3 sketch | This plan | Reason |
|---|---|---|---|
| Routes | `POST /api/stays/search-link`, `GET /api/stays/go/:token` | `POST /api/affiliate/stays/descriptor`, `GET /api/affiliate/stays/go/:token` | Provider-neutral path, under the existing `/api/affiliate` mount |
| Flags | `stays_affiliate_links` | `stays_partner_links` (feature) + `stays_provider_stay22` (provider) | Turn the feature off, or one provider off, independently |
| Occupancy | Adults from all trip travelers | The lodging's own `traveler_ids` / `rooms` only; otherwise nothing | A group trip doesn't mean everyone shares one booking |
| Partner sub-id | Opaque HMAC for each click | Fixed placement code (for example `lodging_needed`) | Partner reports can't be joined back to a traveler |

These items stay as written in §11.3: the `lodgingGaps.ts` helper and its tests, the **Who's paying?** step after an imported booking, and the H2 gate.

## 1. Recommended scope

Launch optional, clearly labeled accommodation search links in private trip planning, with Stay22 as the first provider. The traveler must click to start every handoff. Lodging tracking, itinerary generation, existing booking URLs, imports and expense calculations keep working with the feature off or with no provider configured.

**Reuse the GetYourGuide pattern; don't build a second one.** The repo already has an affiliate pipeline:

- `server/src/config/getYourGuide.ts`: env config through `getEnvValue()`, host and path allowlists
- `server/src/services/getYourGuideAffiliateService.ts`: signed, short-lived descriptor tokens
- `server/src/routes/getYourGuideRoutes.ts`, mounted at `/api/affiliate`: a descriptor endpoint, a first-party 302 redirect, rate limits through `httpRateLimitService`, and a generic `404 AFFILIATE_LINK_UNAVAILABLE`
- `app/utils/getYourGuideLinks.ts` and `app/components/GetYourGuideCta.tsx`: fetch the descriptor ahead of time, render nothing while it's unavailable, then open it with `window.open(..., 'noopener,noreferrer')` or `Linking.openURL`

First, move the parts that don't depend on any provider into shared `affiliateLinks` modules:
- token signing and verification
- allowlist checks
- the redirect handler
- the CTA shell with its disclosure slot

That refactor is a separate PR and must keep the GetYourGuide tests green without changes.

Stay22 markets several products (Allez deep links, Map, Lift, Nova, Spark, Loop). The MVP needs only an **Allez-style deep link**: a provider URL with our affiliate ID and search parameters, and no API key, script or server-to-server call. Confirm the exact URL format in partner documentation before coding; this plan doesn't specify it. Source: [Stay22 product overview](https://www.stay22.com/). Not re-verified for this revision.

## 2. Provider and method isolation

### 2.1 Layers

| Layer | Knows about Stay22? | Contents |
|---|---|---|
| **Placements and UI** | No | Lodging tab empty state, `Needed` lodging dialog, later the Overview gaps row. Generic `FindStayCta` with generic disclosure |
| **Stays feature service** | No | Access check, flags, `StaySearchContext` built from authorized trip data, provider selection, descriptor token, redirect |
| **Provider adapter** | **Only here** | `server/src/services/stays/providers/stay22.ts` and its config. Turns a `StaySearchContext` into a URL; declares allowed hosts |

### 2.2 Contracts (in `server/src/types.ts`)

```ts
type StayPlacement = 'lodging_empty' | 'lodging_needed' | 'lodging_proposed' | 'overview_gap';
type StayMethod = 'link_out';           // later: 'in_app' (gap-closing H2)

interface StaySearchContext {           // built on the server, after authorization
  placement: StayPlacement;
  location: { lat: number; lng: number } | { city: string } | { text: string };
  checkIn?: string;                     // YYYY-MM-DD, local
  checkOut?: string;
  adults?: number;                      // only from the lodging's own travelers
  rooms?: number;
}

interface StayLinkProvider {            // server only
  id: string;                           // 'stay22'
  displayName: string;                  // shown in legal text and admin, never needed by the client
  method: StayMethod;
  isConfigured(): boolean;
  allowedHosts(): string[];
  buildSearchUrl(ctx: StaySearchContext): URL | null;   // null = can't serve this context
}
```

The client sees only `{ stays: { available: boolean; method: StayMethod } }` from `planning-capabilities`, and `{ token, expiresAt, method, disclosureRequired: true }` from the descriptor endpoint.

### 2.3 Provider selection

- `STAYS_LINK_PROVIDERS` is an ordered list, read through `getEnvValue()` (for example `stay22`, or later `booking,stay22`).
- The first provider that is registered, configured, has its own flag on, and returns a URL for the context wins.
- If none qualifies, the CTA is hidden; there is no broken link.
- The registry is `server/src/services/stays/providers/index.ts`. Adding a provider means adding one file and one config entry there.

### 2.4 Rules that keep the provider isolated

1. **Provider-specific code lives only in the adapter.** The string `stay22` appears only in the adapter, its config, the registry, the flag seed, tests, and the legal pages. It never appears in client code, routes, placement codes or database fields. A test greps `app/` and fails if it finds the string.
2. **No stored provider state.** The MVP stores no provider IDs, URLs or clicks. The token carries the provider `id` and expires in minutes. After a switch, old tokens 404 and the client fetches a new descriptor.
3. **Metrics** may carry a low-cardinality `provider` label, needed for revenue reconciliation, next to `placement`. They never carry user, trip or URL data.
4. **One shared contract test suite** runs against every registered provider, plus a fake provider used in route tests. It checks: a URL only on allowed hosts, HTTPS, none of the §6 forbidden fields, `null` for unsupported contexts, and deterministic output.
5. **A change of method reuses the same pipeline.** H2 (in-app booking through liteAPI) would add `method: 'in_app'` providers that the same placements and `StaySearchContext` drive. The CTA branches on `method` (opening a booking sheet instead of a link). Placements, access rules and context building don't change.

### 2.5 Switching providers (checklist)

1. Get the new partner agreement and its URL documentation.
2. Add `providers/<id>.ts`, its config and its seeded `stays_provider_<id>` flag (fail-closed), plus a contract test entry.
3. Update the legal pages to name the new provider (§7) and publish them **before** switching.
4. Change the order in `STAYS_LINK_PROVIDERS`. You can run both providers for a cohort first by putting the new one first and enabling its flag for that cohort.
5. Turn off `stays_provider_stay22` and remove its config. Keep the Stay22 legal mention while commissions or reversals are outstanding.
6. Reconcile final payouts from the old partner's reports.

No client release or migration is needed.

## 3. Where to use it

| Priority | Placement | Experience | Conditions |
|---|---|---|---|
| MVP | Lodging tab empty state (`LodgingTab.tsx`, the "No lodging yet." branch) | "Find places to stay" for the trip destination and dates | Keep "Add lodging" and import as the main actions. Hidden for month-only trips with no dates, unless the provider returns a URL without dates |
| MVP | `Needed` lodging detail, **both** dialog variants (`feature_standardized_item_dialogs` on and off, `LodgingTab.tsx` ~481/~508) | "Search stays near here" using the lodging's `lat`/`lng` or `geoCity`, else the trip destination | A search around a place, never an offer for that exact property |
| MVP (optional) | `Proposed` lodging detail | Same, as a secondary action | — |
| Next | Overview: nights without a stay | "No place to stay for May 3–6 · Find a stay" | Needs `app/utils/lodgingGaps.ts`. Uses non-Cancelled lodgings and local calendar dates; travelers confirm gaps on multi-city trips and overnight transfers |
| Later | Itinerary overnight locations | Search for each overnight location | No such surface exists today; generation must never depend on a stays provider |
| Later | Embedded map (for example Stay22 Map) | Map around a destination | Its own flag, consent design and privacy review (§6). It's provider-specific, so it gets its own adapter capability and isn't assumed |
| Later | Public blog / destination pages | Generic "Find stays in <destination>" | Never expose a private group's dates, address or future whereabouts |
| Defer | Transportation, automatic link optimization | — | Separate scope and approval |

Don't show the CTA for Booked, Completed or Cancelled items, for trips in the past, or for followers (§5.3). Booked lodging keeps its original provider URL. No popups, automatic redirects, or promotion in receipts, expense reports, emails, the printable itinerary or exports.

**Disclosure** goes right next to the action and is provider-neutral: "Partner link: we may earn a commission if you book." The same wording as GetYourGuide keeps the app consistent. Don't claim "same price" or "no additional cost" unless every active provider confirms it (§7).

## 4. Partner and commercial prerequisites (Stay22)

Before production, get written confirmation of:
- use in web and native apps, inside private signed-in planning
- whether a placement may sit next to AI-generated content
- the allowed parameters and destinations, and branding rules
- which products we may use

Get the current technical docs, and record them in `docs/implementation_plans/stay22-phase-0-contract.md`, modeled on `getyourguide-phase-0-contract.md`.

Legal review of the [Stay22 Affiliate Partner Terms](https://www.stay22.com/terms). These section references come from the version dated November 11, 2025; they weren't re-verified, so recheck at signing:

- obligations around user claims (§3)
- indemnity and liability imbalance (§§10–11)
- forfeiture of unpaid fees (§12)
- data rights (§§7–8)
- competitive-use restrictions (§2)
- terms that take precedence over Order Forms (§13)

**Check that the terms allow switching or running another provider.** Competitive-use restrictions (§2) and termination terms must not stop a later switch or a dual-provider cohort.

Also confirm commission rates, attribution windows, reversals, payout thresholds and timing, reporting, and termination, including whether unpaid fees survive termination (§12). Record which legal entity signs and who owns approval.

## 5. Technical design

### 5.1 Flags

Seed both off in `server/config/feature-flags.yaml`, and add both to `FAIL_CLOSED_FLAGS` (`entitlementService.ts`) and `COHORT_FEATURES` (`featureCohorts.ts`):

| Flag | Controls |
|---|---|
| `stays_partner_links` | The whole feature, for any provider |
| `stays_provider_stay22` | Whether Stay22 may serve links |

Effective availability is `stays_partner_links && (some provider in STAYS_LINK_PROVIDERS is configured with its flag on) && access === 'member'`. Add later flags (map, public placements) only in the PR that implements them. Admins don't bypass flags.

### 5.2 Server

1. **`server/src/services/stays/staySearchContext.ts`** (provider-neutral). Input: `{ tripId, lodgingId?, placement }`. Load the trip and lodging **after** `ensureUserInTrip`, then derive:
   - location: lodging `lat`/`lng`, else `geoCity`, else `trip.destination`
   - dates: the lodging's check-in and check-out, else the trip `startDate`/`endDate`
   - occupancy: `traveler_ids.length` and `rooms` from the lodging only

   The client never supplies these values.
2. **`server/src/services/stays/stayLinkService.ts`** (provider-neutral):
   - select the provider (§2.3) and call `buildSearchUrl`
   - check the URL against that provider's `allowedHosts()` and HTTPS
   - wrap `{ providerId, url, exp }` in a token using the shared affiliate token code
3. **`server/src/services/stays/providers/stay22.ts`** plus `server/src/config/stays.ts`:
   - `STAY22_AFFILIATE_ID`: public, but kept on the server so shutdown and allowlisting stay ours
   - `STAY22_DEEP_LINK_BASE_URL`: validated HTTPS, no credentials or fragment
   - `STAY22_ALLOWED_HOSTS`

   No API key, and nothing in Expo or public config.
4. **Routes** on the `/api/affiliate` router:
   - `POST /api/affiliate/stays/descriptor` (authenticated). Strict Zod body `{ tripId: uuid, lodgingId?: string ≤64, placement }`. Steps in order: rate limit (`reserveRequestRateLimits`, per user per day), then `ensureUserInTrip`, then flags, then build the context, then the link. Returns `{ token, expiresAt, method: 'link_out', disclosureRequired: true }`.
   - `GET /api/affiliate/stays/go/:token`. No session, because it's a browser navigation. Steps: verify the signature and expiry, check the feature flag **and** the token's provider flag again, re-check the host allowlist, rate limit per IP, then `302` with `Referrer-Policy: no-referrer`.
   - Unavailable (flag off, no provider, lookup failure, bad token): `404 { error: 'AFFILIATE_LINK_UNAVAILABLE' }`, as GetYourGuide does. Don't use 402, which means a tier limit here.
5. **The token goes in the path and is opaque.** The `app.ts` access logger writes `req.originalUrl`. Encrypt the token payload (AES-256-GCM, the `pushTokenCrypto.ts` pattern) or redact `/api/affiliate/*/go/*` in the logger. Apply the same fix to GetYourGuide's `?token=` route.
6. **Capability.** `GET /api/trips/:id/planning-capabilities` returns `stays: { available, method }`. Don't use `/api/auth/features`: it has no user, so it can't apply cohorts or trip roles.
7. **Metrics.** When the request carries analytics consent, call `incrementMetric('stays_partner_click', { placement, provider })`.

### 5.3 Client

- `app/utils/stayLinks.ts` (`requestStayDescriptor`, `openStayDescriptor`) and `app/components/FindStayCta.tsx`, built on the shared affiliate helpers. No provider name anywhere.
- Fetch the descriptor when the CTA renders, and render nothing until a valid one arrives. The click then calls `window.open` synchronously inside the user gesture, so popup blockers don't stop it. If `window.open` returns `null`, navigate the same tab. Refetch after `expiresAt`.
- On native, open with `Linking.openURL` (the system browser). Test on real iOS and Android devices.
- Branch on `method`. Only `link_out` exists now; an unknown method renders nothing, so an older client stays safe after H2.
- Wire into `LodgingTab.tsx` (empty state and both dialog variants), with the capability passed from `App.tsx`.

### 5.4 Access and data

- **Members only.** Followers never see the CTA and get a 404; the handoff discloses private dates and location to a third party.
- **No schema change and no stored clicks.** That avoids Postgres/Firebase parity work; production runs only on Firestore. The rate limiter is the only persistent state touched, and it already works on both adapters.
- **Opening a link never creates or changes a lodging, status or cost.** The confirmed booking comes back through manual entry, upload or forwarding, and then the gap-closing §11.3 **Who's paying?** step picks it up.
- **Graceful failure.** Missing dates, an ambiguous destination, an expired descriptor or no available provider hide the CTA or show an editable retry, never a broken link.

## 6. Privacy and data boundaries

These rules apply to **every** provider adapter, and the shared contract tests enforce them.

The outbound URL may contain only:
- the provider's affiliate ID
- a placement code
- a location: coordinates, city or destination text
- check-in and check-out dates
- occupancy from the lodging itself

It must never contain:
- names, emails or birthdays
- children's ages or identities
- internal trip, group, lodging or user IDs
- JWTs
- confirmation numbers
- notes, expenses or itinerary text

If a provider requires children's ages, don't support that flow without a separate review.

**Redirect hygiene:**
- Use `noopener,noreferrer` on web, and set `Referrer-Policy: no-referrer` on our 302.
- Test the real redirect chain of each provider.
- Scrub search fields and full outbound URLs from logs, analytics and Sentry.

The MVP loads no provider script, iframe, pixel, preconnect or prefetch. Opening the link exposes network and device information to the provider and the booking site; disclose this accurately. Stay22 describes its collection in its [privacy policy](https://www.stay22.com/privacy).

Any embedded map or tracking product needs its own consent design and review before it's built:
- `app/utils/privacyConsent.ts` analytics consent doesn't cover affiliate tracking.
- Unknown or declined consent blocks loading.
- On iOS, an external browser handoff needs no ATT prompt, but an embedded tracker might.

Recommendation: hide the CTA for accounts under 18 when a declared date of birth is available.

## 7. Terms, privacy and cookie updates

The legal pages already cover affiliate links for GetYourGuide. Extend them, and **name each active stays provider in one list** so a switch edits a single line in each document. Publish before turning on traffic, and before any provider switch.

### Consumer terms (`app/public/terms.html`)

In §7 "External services and affiliate links", add Stay22 and the booking sites it links to. Add these lodging points:
- Bookings, payment, cancellation and refunds are governed by the booking provider.
- Saving a lodging or following a link doesn't confirm a reservation.
- Verify the property, dates, occupancy, total price, taxes, fees and cancellation terms before booking.
- Offers can change.
- Nothing limits rights that can't lawfully be excluded.

**Fix a conflict.** §7 currently says commissions come "at no additional cost to you." Keep that only if every active provider confirms it; otherwise use "We may receive a commission if you make a qualifying booking."

Also:
- Keep cancelling a WanderBunnies subscription separate from cancelling a hotel booking.
- Don't bring partner indemnity or user-claim terms into consumer terms.

### Privacy notice and cookies

- In `docs/legal/privacy-policy.md`, extend the existing "Affiliate and external-link data" row and the recipients list to the stays provider and the booking sites. Add lodging location, dates and occupancy to the data list, and update the version and change metadata.
- Regenerate with `node scripts/build-legal-pages.mjs` and verify with `--check`. Don't hand-edit the generated outputs.
- The link-only MVP likely needs no change to `cookies.html` or `privacy-choices.html`, because nothing is set on our origin. Confirm that, and revisit it for any embed.
- Record verified partner facts in `docs/legal-document-inputs.md`.

## 8. Implementation sequence

1. **Discovery and approval** (owner: Bryan, with legal):
   - Stay22 account and affiliate ID
   - the §4 confirmations, including the right to switch
   - `stay22-phase-0-contract.md`

   *Exit:* a verified parameter list and accepted terms.
2. **Shared affiliate refactor.** Extract the token, allowlist, redirect and CTA-shell code from GetYourGuide, and make the token opaque in the path. *Exit:* GetYourGuide tests unchanged and green on pg-mem and the Firestore emulator.
3. **Provider-neutral stays foundation:**
   - contracts, context builder, link service, registry
   - a fake test provider and the shared contract test suite
   - routes, flags, the capability field

   *Exit:* no URL is produced with flags off or missing, no provider, or a failing lookup.
4. **Stay22 adapter.** Config, URL builder, allowlist, contract-suite pass. *Exit:* the adapter passes with real documented parameters.
5. **Client and legal.** `FindStayCta`, Lodging tab wiring for both dialog variants, terms and privacy updates. *Exit:* web plus real iOS and Android checks pass, and the legal pages are published.
6. **Limited rollout.** Turn the flags on for an admin cohort, then everyone. Watch for redirect 404s and 429s, and check partner reporting by hand. *Exit:* two weeks stable, with clicks visible in Stay22 reports.
7. **Expansion.** `lodgingGaps.ts` and the Overview row. The 8-week H2 go/no-go uses these numbers.

## 9. Verification and acceptance criteria

- **Contract suite**, run for every provider and the fake:
  - HTTPS only, on allowed hosts only
  - none of the §6 forbidden fields, checked against a fixture trip that has names, notes and IDs
  - `null` for unsupported contexts
  - deterministic output
- **Server**, on pg-mem **and** `JEST_DB_PROVIDER=firebase`:
  - feature flag off, provider flag off, missing rows, lookup throws, provider not configured, empty provider list
  - provider fallback order
  - no admin bypass
  - non-member and follower get 404
  - tampered or expired token, and a token for a provider that has since been disabled
  - invalid or missing dates, month-only trip
  - rate limit
  - flag turned off between descriptor and redirect gives 404
- **Isolation:** a test fails if `app/` contains `stay22`.
- **Client:**
  - CTA hidden until capabilities resolve, and when unavailable
  - disclosure shown next to the CTA
  - both dialog variants
  - never shown for Booked, Completed or Cancelled lodging, or for followers
  - an unknown `method` renders nothing
  - a click changes no lodging, status or cost
  - popup-blocked fallback
- **Manual:**
  - zero provider requests before the click
  - no referrer leakage
  - our access logs contain no readable destination or dates
  - real devices open the system browser
- **Shutdown and switch:**
  - turning off either flag makes the redirect 404 within 60 s
  - the CTA hides on the next capabilities fetch
  - changing `STAYS_LINK_PROVIDERS` takes effect without a client release
- **Final checks:** `tsc` in both packages, legal-page tests, `node scripts/build-legal-pages.mjs --check`.

## 10. Measurement, operations and open decisions

**Measurement:**
- clicks by placement and provider, through the consent-aware metric
- commissions, reversals and payouts from partner reports only
- review revenue alongside broken handoffs, complaints, and whether travelers go on to add a lodging
- monitoring our own redirect is fine; synthetic monitoring of the partner needs their permission

**Rollback:** turn off `stays_partner_links`, which hides the feature for every provider, or turn off `stays_provider_<id>`, which falls back to the next provider or hides the CTA. Keep the legal pages. No background vendor work exists to cancel.

**Open decisions:**

1. Stay22 account, affiliate ID, and confirmation of the deep-link parameters (blocks step 4).
2. The contracting entity, and whether to seek a contract amendment (including the switching rights in §4).
3. Occupancy: send the lodging's own traveler count and rooms (recommended), or leave it to the provider page?
4. Minor accounts: hide the CTA for travelers under 18 (recommended)?
5. Tier availability: all tiers (recommended; this is free-tier revenue per gap-closing §11.2.4).
6. Whether the "no additional cost" wording in the terms survives (§7).
7. `Proposed` lodging placement in the MVP, or later?

No credentials, new vendor services or production activation are part of this plan document.
