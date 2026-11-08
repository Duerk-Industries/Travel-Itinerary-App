# Stay22 implementation plan

Date: 2026-11-08
Status: Ready to start. Phase 0 record: [stay22-phase-0-contract.md](stay22-phase-0-contract.md) (link format verified 2026-11-08; commercial and legal items open). PRs 1–4 can be built now; the rollout waits on the open items.
Design: [Stay22 integration plan](stay22-integration-plan.md) (what and why). This document covers **how**: the PRs, files, tests and rollout, in order.
Parent: [gap-closing §11.3 H1](implementation-plan-gap-closing.md#h1-affiliate-links-p1--stay22-integration-plan)

## Summary

Travelers get a **Find places to stay** partner link on the Lodging tab. It opens a hotel search pre-filled with the destination and dates. Stay22 is the first provider, behind a provider-neutral "stays" layer, so a later provider or in-app booking needs no client or route changes.

| Step | What | Needs Stay22? | Size |
|---|---|---|---|
| Phase 0 | Account, affiliate ID, documented URL parameters, terms review | Yes | Non-code |
| PR 1 | Extract the shared affiliate core from GetYourGuide (no behavior change) | No | ~2 days |
| PR 2 | Provider-neutral stays layer, flags, routes and capability, with a fake provider | No | ~3 days |
| PR 3 | Client: `FindStayCta` and Lodging tab wiring (renders nothing while the flags are off) | No | ~3 days |
| PR 4 | Stay22 adapter and provider contract tests | Link format only (verified) | ~1 day |
| PR 5 | Terms and privacy updates | Facts from Phase 0 | ~1 day plus review |
| Rollout | Test environment, admin cohort, everyone | Yes | ~2 weeks of observation |
| Next | Overview "nights without a stay" row (`lodgingGaps.ts`) | No | ~2 days |

PRs 1–3 can merge while the partner paperwork is pending; every surface stays dark because the flags are seeded off and fail closed.

## Corrections to the design plan found while planning

These came from reading the code. The design plan has been updated to match.

1. **Lodging statuses.** There's no `Needed` status in code. The statuses are `Proposed`, `Needs Booking`, `Booked`, `Cancelled` and `Completed` (`server/src/utils/itineraryStatus.ts`); legacy `Needed` normalizes to `Proposed`. The main placement is **`Needs Booking`**, with **`Proposed`** secondary. Placement codes become `lodging_empty`, `lodging_needs_booking`, `lodging_proposed` and `overview_gap`.
2. **Tokens are already opaque.** The GetYourGuide token is AES-256-GCM encrypted (`encryptPayload` in `getYourGuideAffiliateService.ts`), so access logs only ever show ciphertext. No log redaction is needed. Keep the token in the path (`/go/:token`) for cleanliness.
3. **The existing click metric never fires.** The GetYourGuide redirect counts a click only when the request carries `X-Analytics-Consent: granted`. A browser navigation can't send that header, and no client code sends it anywhere. For stays, the client sends its consent state in the descriptor request, the token carries it, and the redirect counts the click only when it's true. Fix GetYourGuide the same way in a follow-up (PR 1 makes that a one-liner).
4. **Key separation.** The GetYourGuide token key is `sha256(AUTH_SECRET)`. The shared token module derives a separate key per purpose with HKDF (`info: 'wb-affiliate-stays-v1'`), so stays tokens and GetYourGuide tokens can't be swapped.

## Phase 0: partner prerequisites (owner: Bryan Duerk)

Nothing here is code. **Recorded in [stay22-phase-0-contract.md](stay22-phase-0-contract.md).** The public link format is verified there, so PR 4 isn't blocked; the rollout is, until that record's open items are resolved.

- [ ] Stay22 partner account; record the affiliate ID (`aid`). *(Open item 1)*
- [x] Documented deep-link format: base URL, parameters, campaign rule and allowed host. *(Verified 2026-11-08 from public docs; there's no rooms parameter. Confirm the redirect chain in the test environment.)*
- [ ] Written confirmation of use in web **and** native apps *(the terms include mobile apps; in-app attribution and private-page use are open items 3–4)*, inside signed-in private planning, and of the right to switch or add a provider ([design §4](stay22-integration-plan.md#4-partner-and-commercial-prerequisites-stay22)).
- [ ] Terms review: the user-claims, indemnity, fee-forfeiture, data-rights, competitive-use and precedence sections *(summarized in the record; counsel review is open item 6)*. Commission rate, attribution window and payout terms recorded *(not published; open item 2)*.
- [ ] Whether "no additional cost to you" is true for Stay22 bookings (decides the terms wording in PR 5).
- [x] Write `docs/implementation_plans/stay22-phase-0-contract.md` *(done 2026-11-08; update it as the open items close)*.

**Exit:** the contract record exists, with a parameter list that PR 4's fixtures can use verbatim.

## PR 1: shared affiliate core (refactor only)

**Goal:** move the provider-neutral parts of GetYourGuide into shared modules, with **no change in GetYourGuide behavior**.

**New files:**

| File | Contents |
|---|---|
| `server/src/services/affiliate/affiliateToken.ts` | `sealAffiliateToken(payload, { prefix, key, ttlSeconds })` and `openAffiliateToken(token, { prefix, key })`: AES-256-GCM, the `<prefix>.<iv>.<tag>.<ciphertext>` format, length bound (4,096) and expiry check. `deriveAffiliateKey(purpose)` uses `crypto.hkdfSync('sha256', getAuthSecret(), '', purpose, 32)` |
| `server/src/services/affiliate/affiliateUrl.ts` | `validateOutboundUrl(url, { hosts, pathPrefixes? })`: HTTPS only; no credentials, fragment or control characters; exact host match; optional path-prefix match; ≤ 2,048 characters |
| `server/src/services/affiliate/affiliateRedirect.ts` | Express helpers: `sendAffiliateUnavailable(res)` (`404 { error: 'AFFILIATE_LINK_UNAVAILABLE' }`), `sendRateLimited(err, res)` (429 + `Retry-After`), `redirectToPartner(res, url)` (sets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, then 302) |
| `app/utils/affiliateLinks.ts` | `openFirstPartyRedirect(url)`: `window.open(url, '_blank', 'noopener,noreferrer')` on web, navigating the same tab when that returns `null`; `Linking.openURL` on native; returns success |
| `app/components/PartnerLinkCta.tsx` | Presentational shell: label, the provider-neutral disclosure "Partner link: we may earn a commission if you book.", `testID`, a disabled state while loading, 44 px touch target. No fetching |

**Changed files:**
- `getYourGuideAffiliateService.ts` uses `affiliateToken` and `affiliateUrl`. It keeps its existing `g1` prefix and `sha256(AUTH_SECRET)` key, so tokens already issued stay valid across the deploy.
- `getYourGuideRoutes.ts` uses the redirect helpers.
- `getYourGuideLinks.ts` uses `openFirstPartyRedirect`.
- `GetYourGuideCta.tsx` and `GetYourGuideTourLink.tsx` render through `PartnerLinkCta`. Visible text and test IDs stay the same.

**Tests:**
- New `server/__tests__/affiliate/affiliateToken.test.ts`: round trip; tampered IV, tag or ciphertext; wrong prefix; wrong key; expired; oversized.
- New `affiliateUrl.test.ts`: `http:`, credentials, a lookalike host (`stay22.com.evil.test`), a path outside the prefix, an over-length URL.
- Existing suites unchanged and green: `getYourGuideAffiliateService`, `getYourGuideConfig`, `getYourGuideApi`, the GetYourGuide routes and `app/tests/getYourGuideCta.test.tsx`.

**Exit:** `npm run typecheck`, the GetYourGuide suites on pg-mem, and `npm --prefix app test -- getYourGuide` all pass with no edits to existing assertions.

**Rollback:** revert the PR. Nothing is stored.

## PR 2: provider-neutral stays layer (dark, with a fake provider)

**Goal:** the whole server path works end to end against a fake provider, with both flags seeded off.

### Types: `server/src/types.ts`

Add `StayPlacement`, `StayMethod`, `StaySearchContext` and `StayLinkProvider` exactly as in [design §2.2](stay22-integration-plan.md#22-contracts-in-serversrctypests), with the placement codes from correction 1. Add `StayDescriptorResponse = { token: string; expiresAt: string; method: StayMethod; disclosureRequired: true }`.

### Server modules: `server/src/services/stays/`

| File | Responsibility |
|---|---|
| `staySearchContext.ts` | `buildStaySearchContext({ userId, tripId, lodgingId?, placement })`. It **re-checks `ensureUserInTrip` itself** (defense in depth), then loads the trip and, if given, the lodging with `getTripById` and `listLodgings`. It rejects a lodging from another trip, and a lodging whose status is `Booked`, `Completed` or `Cancelled`. Derivation rules are below. Returns `null` when there's no usable location |
| `providers/index.ts` | Registry: `Record<string, StayLinkProvider>`. In PR 2 it registers only `fake` when `NODE_ENV === 'test'` |
| `providers/fake.ts` | Test-only provider: builds `https://stays.example.test/search?...` from the context and allows only that host |
| `stayLinkService.ts` | `selectProvider(ctx)`: walks `STAYS_LINK_PROVIDERS` and returns the first provider that is registered, `isConfigured()`, has `stays_provider_<id>` on (`isFeatureEnabled`), and returns a URL for the context. Then `createStayDescriptor(...)` validates the URL with `validateOutboundUrl` against that provider's `allowedHosts()` and seals `{ v: 1, p: providerId, u: url, pl: placement, c: consent, exp }` with `deriveAffiliateKey('wb-affiliate-stays-v1')`, prefix `s1`. `resolveStayRedirect(token)` opens the token, re-checks both flags, re-validates the URL against the provider's current allowlist, and returns the URL or `null` |

**Context derivation rules:**
- **Location:** the lodging's `lat`/`lng` if both are finite; else its `geoCity`; else `trip.destination`. Trim text to 120 characters and strip control characters.
- **Dates:** the lodging's `check_in_date`/`check_out_date` when both are valid `YYYY-MM-DD` with check-out after check-in. Else the trip's `startDate`/`endDate` under the same rule. Else none. Month-only trips get no dates.
- **Occupancy:** `adults = traveler_ids.length` only when it's between 1 and 30; `rooms` only when it's between 1 and 10. Never derived from the trip's group.
- **Past trips:** if check-out (or the trip end) is before today, return `null`.

### Config: `server/src/config/stays.ts`

`getStaysProviderOrder()` reads `STAYS_LINK_PROVIDERS` through `getEnvValue()`: a comma-separated list, lowercased, unknown IDs ignored. The default is empty, so nothing is available until configured. Token TTL comes from `getApiCacheSetting('stays', 'descriptorTtlMinutes')`, defaulting to 10 and clamped to 1–60. Add a `stays` block under `caching:` in `server/config/api-limits.yaml`, next to `getYourGuide`, with `descriptorTtlMinutes: 10`, `descriptorPerDayPerAccount: 300` and `redirectPerMinutePerIp: 60`.

### Routes: new `server/src/routes/staysRoutes.ts`

Mount with `app.use('/api/affiliate/stays', staysRoutes)` in `server/src/app.ts`, **before** the existing `app.use('/api/affiliate', getYourGuideRoutes)`.

- **`POST /descriptor`** (`authenticate`). Strict Zod body: `{ tripId: uuid, lodgingId?: string ≤64, placement: enum, analyticsConsent?: boolean }`. Steps in order:
  1. Check the body size (≤ 4 KiB).
  2. Rate limit with `reserveRequestRateLimits({ name: 'stays_descriptor', identities: ['user:'+id], ... })`.
  3. `ensureUserInTrip` (members only; followers get the 404).
  4. `isFeatureEnabled('stays_partner_links', userId)`.
  5. Build the context, then the descriptor.

  Any denial or failure returns `sendAffiliateUnavailable`. Response header: `Cache-Control: private, no-store`.
- **`GET /go/:token`** (no session). Steps:
  1. Rate limit per IP (`stays_redirect_ip`).
  2. `resolveStayRedirect`.
  3. If the token's consent field is true, `incrementMetric('stays_partner_click', { placement, provider })`.
  4. `redirectToPartner`.

  Failure returns `sendAffiliateUnavailable`. Never log the token or the URL.

### Flags and capability

- In `server/config/feature-flags.yaml`, add `stays_partner_links` and `stays_provider_stay22`, both `enabled: false`, with descriptions.
- Add both to `FAIL_CLOSED_FLAGS` (`entitlementService.ts`) and `COHORT_FEATURES` (`featureCohorts.ts`).
- Run `npm run docs:flags`.
- `GET /api/trips/:id/planning-capabilities` (`tripRoutes.ts`) gains `stays: { available, method }`, where `available` = `access.access === 'member'` && `stays_partner_links` && `await hasAvailableStayProvider(userId)`. The last is the provider walk from `stayLinkService` with no context. `method` is `'link_out'`.

### Tests

**`server/__tests__/stays/staySearchContext.test.ts`:**
- lodging coordinates, then `geoCity`, then destination fallback
- invalid or reversed dates fall back to trip dates
- a month-only trip gets no dates
- adults only from the lodging's travelers, bounded
- a past trip returns `null`
- another trip's lodging is rejected
- Booked, Completed and Cancelled lodgings return `null`

**`server/__tests__/stays/staysRoutes.test.ts`** (Supertest):
- no auth gives 401
- a non-member and a follower get 404
- feature flag off, provider flag off, missing rows (delete the rows and clear the cache) and an empty provider list all give 404
- the flag-lookup failure path gives 404
- admin gets no bypass
- tampered, expired and wrong-prefix tokens give 404
- a GetYourGuide token at the stays route gives 404
- turning the flag off between descriptor and redirect gives 404 on redirect
- a disabled provider gives 404 on redirect
- rate limits give 429 with `Retry-After`
- the redirect has `Referrer-Policy: no-referrer` and the `Location` host is on the allowlist
- the metric is counted only when consent was true

**Privacy fixture.** A trip whose name, notes, member names, emails, IDs and confirmation number are distinctive strings. Assert that none of them appears in the `Location` URL. Assert the URL has no `tripId`, `userId` or `lodgingId` parameter.

**Elsewhere:**
- `gapClosingFlags.test.ts`: add both keys to the missing-row loop.
- `planning-capabilities` test: `stays.available` matches the route gate for a member, a follower and a non-member.

**Run on both adapters:**

```sh
npm --prefix server run test:single -- --runInBand __tests__/stays __tests__/gapClosingFlags.test.ts
npm --prefix server run test:firestore -- __tests__/stays/staysRoutes.test.ts __tests__/gapClosingFlags.test.ts
```

The rate limiter writes to the database, so the Firestore run is required.

**Docs in this PR:**
- Add the stays row to [architecture](../architecture.md) subsystems.
- Replace the "Planned, not built" note in [feature activation](../operations/feature-activation.md) with a real row (prerequisites: `STAYS_LINK_PROVIDERS`, provider config, legal published).

**Exit:** all of the above pass, and with the flags off no request produces a provider URL.

**Rollback:** revert. Nothing is stored; the flags stay off.

## PR 3: client (dark until the flags are on)

**New files:**

| File | Contents |
|---|---|
| `app/utils/stayLinks.ts` | `requestStayDescriptor({ backendUrl, headers, tripId, lodgingId?, placement, analyticsConsent, signal })` POSTs to `/api/affiliate/stays/descriptor`. It returns `null` on any non-200 or a malformed body, validated with `^s1\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){3}$`, `method === 'link_out'` and a future `expiresAt`. `openStayDescriptor(backendUrl, descriptor)` calls `openFirstPartyRedirect` with `/api/affiliate/stays/go/<token>`. No provider names |
| `app/hooks/useStaysCapability.ts` | Fetches `GET /api/trips/:id/planning-capabilities` the way `NearbyPlacesPanel` does, aborting on trip change. Defaults to `{ available: false }`; refetches when the app returns to the foreground (`AppState`) |
| `app/components/FindStayCta.tsx` | Props: `backendUrl`, `headers`, `tripId`, `lodgingId?`, `placement`, `available`, `readOnly`, `label?`, `testID`. Renders nothing when `!available`, `readOnly`, or while there's no valid descriptor. Prefetches the descriptor on mount and when it expires. The press handler opens **synchronously** from the prefetched descriptor, so popup blockers don't stop it. Analytics consent is read from the client's existing privacy status (`productAnalyticsAllowed`) |

**Wiring in `app/tabs/LodgingTab.tsx`:**
- Call `useStaysCapability(trip?.id)` once.
- **Empty state:** in the phone cards ("No lodging yet.") and, when there are no lodgings, above the desktop table (which currently renders an empty table with no message), add `FindStayCta placement="lodging_empty"` with the label "Find places to stay", below the existing Add lodging and import actions.
- **Standardized dialog** (`TripItemDetailsDialog`): when the status is `Needs Booking` or `Proposed`, add a row `{ label: 'Find a stay', value: null, content: <FindStayCta … /> }` with placement `lodging_needs_booking` or `lodging_proposed`, and the label "Search stays near here".
- **Legacy dialog** (`LodgingDetailsDialog`): add an optional `footer?: React.ReactNode` prop rendered above its action buttons, and pass the same CTA.
- Hide in every case when `readOnly` is true (followers).

**Tests** (`app/tests/`):
- `findStayCta.test.tsx`:
  - nothing while unavailable or loading
  - nothing for read-only users
  - the disclosure renders next to the button
  - pressing opens the `/go/` URL synchronously
  - when `window.open` returns `null`, the same tab navigates
  - an expired descriptor is refetched
  - an unknown `method` renders nothing
  - consent is passed through
- `lodgingTabStays.test.tsx`:
  - empty state in both layouts
  - CTA on `Needs Booking` and `Proposed` but not on `Booked`, `Completed` or `Cancelled`
  - both dialog variants (`featureStandardizedItemDialogs` true and false)
  - pressing the CTA changes no lodging, status or cost (no save request is made)
- `staysProviderIsolation.test.ts`: reads every `.ts`/`.tsx` file under `app/` (excluding tests and `node_modules`) and fails if any contains `stay22`, case-insensitive.

**Manual:** with flags on against the fake provider in local dev, check that Chromium opens a new tab and that a phone-width layout keeps the button reachable.

**Exit:** the app suites pass, `npm run typecheck` passes, and with the flags off the Lodging tab looks exactly as before.

## PR 4: Stay22 adapter (needs Phase 0)

**New and changed files:**
- **`server/src/services/stays/providers/stay22.ts`:**
  - `id: 'stay22'`, `displayName: 'Stay22'`, `method: 'link_out'`
  - `isConfigured()` requires `STAY22_AFFILIATE_ID` and a valid `STAY22_DEEP_LINK_BASE_URL`
  - `allowedHosts()` comes from `STAY22_ALLOWED_HOSTS`, defaulting to the documented host(s)
  - `buildSearchUrl(ctx)` maps the context to **only** the parameters in the record's [adapter mapping](stay22-phase-0-contract.md#adapter-mapping-pr-4-builds-exactly-this): `aid`, `lat`/`lng` or `address`, `checkin`/`checkout` (only when check-in is after today), `adults`, and `campaign` (the placement plus a fixed `wanderbunnies_app`)
  - the placement code goes in the campaign/sub-id parameter
  - returns `null` if the context has no location the provider accepts
- **`server/src/config/stays.ts`:** add the three `STAY22_*` settings through `getEnvValue()`; list them in `server/.env.example` with placeholder values.
- **`providers/index.ts`:** register `stay22`.

**Tests: `server/__tests__/stays/providerContract.test.ts`.** This shared suite runs for **every registered provider** plus `fake`, using a fixed set of contexts (coordinates, city, text, no dates, with and without occupancy, the privacy fixture). For each it asserts:
- HTTPS
- the host is in `allowedHosts()`
- no forbidden fields
- no internal IDs
- deterministic output
- `null` for unsupported contexts
- length ≤ 2,048

**Stay22-specific snapshot:** one context produces exactly the documented URL from the Phase 0 record.

**Deployment config:**
- Set `STAY22_AFFILIATE_ID`, `STAY22_DEEP_LINK_BASE_URL` and `STAY22_ALLOWED_HOSTS` in the deployment secrets. The affiliate ID isn't secret, but keep it in server config.
- Set `STAYS_LINK_PROVIDERS=stay22`.

**Exit:** the contract suite passes; one manually opened link in the test environment lands on a Stay22 search with the right destination and dates, and the redirect chain stays on the recorded hosts.

## PR 5: terms and privacy (publish before turning on traffic)

- **`app/public/terms.html` §7:**
  - add Stay22 and the booking sites to the provider list
  - add the lodging points from [design §7](stay22-integration-plan.md#7-terms-privacy-and-cookie-updates)
  - fix the "no additional cost" sentence per the Phase 0 answer
  - update the effective date
- **`docs/legal/privacy-policy.md`:**
  - extend the "Affiliate and external-link data" row (lodging location, dates, occupancy) and the recipients list
  - bump the version, effective date and change note
  - run `npm run build:legal` and commit the generated `app/public/privacy.html` and `server/src/legal/privacyPolicyHtml.ts`
- **`docs/legal-document-inputs.md`:** record the verified Stay22 facts.
- **Store privacy declarations:** check whether App Store and Play declarations need a change. A link-out with no embedded SDK usually doesn't; record the decision.

**Tests:** `npm run check:legal` and the legal-page tests.

## Rollout

Follow the [feature activation procedure](../operations/feature-activation.md#how-to-turn-on-any-feature) and the [rollout checklist](../operations/rollout-testing.md).

1. **Test environment.** Turn both flags on. Run through each placement as a member, a follower and a non-member, on web, an iPhone and an Android phone. Check:
   - network inspection shows no request to Stay22 before the click
   - the redirect sends no referrer
   - turning `stays_partner_links` off makes `/go/` return 404 within 60 seconds and hides the CTA on the next capabilities fetch
2. **Production, admin cohort.** Set a cohort on both flags: Bryan, Tristan, one ordinary account. Retire after 30 days. Turn both on. Open real links, and confirm clicks show up in the Stay22 dashboard (allow for its reporting delay).
3. **Everyone.** Remove the cohorts after a week without problems. Watch redirect 404 and 429 counts, `stays_partner_click` by placement, error logs and support reports.
4. **Exit after two weeks:** stable redirects, clicks visible in partner reporting, no complaints about broken or misleading links. Record the result in the release evidence.

**Rollback:** turn off `stays_partner_links` (everything) or `stays_provider_stay22` (that provider only). Wait 60 seconds. Nothing needs cleanup.

## Next: Overview "nights without a stay"

A separate PR after the rollout exits:
- `app/utils/lodgingGaps.ts`: a pure function that takes trip dates and non-Cancelled lodgings and returns uncovered night ranges. Unit-test it for overlaps, same-day turnovers, lodging outside the trip, month-only trips (no gaps) and DST boundaries.
- A row in the Overview day list ("No place to stay for May 3–6 · Find a stay"), using `placement="overview_gap"` and a server-side gap-range context. Add `checkIn`/`checkOut` overrides to the descriptor body, validated as a sub-range of the trip.
- The 8-week H2 go/no-go in gap-closing §11.6 uses the rollout's click and commission numbers.

## Definition of done

- [ ] All five PRs merged; each PR's tests pass on pg-mem, and the server stays tests also pass on the Firestore emulator.
- [ ] `npm run typecheck`, `npm test`, `npm run check:docs:flags` and `npm run check:legal` pass.
- [ ] The provider isolation test passes: no `stay22` string in the client.
- [ ] Phase 0 contract record written; legal pages published before the flags were turned on.
- [ ] Feature activation guide, architecture and flag inventory updated.
- [ ] Rollout exit criteria met and recorded.
- [ ] Follow-up issue filed for the GetYourGuide click-metric fix (correction 3).

## Risks and open questions

| Risk | Mitigation |
|---|---|
| Stay22's parameters differ from what's assumed (for example, no coordinates) | The adapter returns `null` for unsupported contexts and falls back to city or destination text; the contract record decides |
| Partner reporting can't separate placements | The placement code is best-effort attribution; our own consent-gated metric counts clicks per placement |
| Popup blockers on web | The prefetched descriptor plus synchronous `window.open`, with a same-tab fallback |
| A stale client after a provider switch | Tokens are short-lived and provider-scoped; old tokens return 404 and the CTA refetches |
| Minors | Open decision (design §10 #4). If the answer is to hide the CTA under 18, add a date-of-birth check in PR 2's capability field |

Open decisions carried from the design plan: occupancy (recommended: the lodging's own travelers), minors, tier availability (recommended: all tiers), and whether `Proposed` ships in the MVP (this plan includes it as a secondary placement).
