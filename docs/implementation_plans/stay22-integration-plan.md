# Stay22 integration plan

Date: November 5, 2026  
Status: Proposed; this document does not activate an integration or publish legal changes.

## 1. Recommended scope

Launch optional, clearly disclosed accommodation affiliate links in private trip planning. Start with explicit traveler clicks; consider an accommodation map later. Keep all Stay22 behavior behind a default-off master feature flag, with separate flags for later capabilities. Lodging tracking, itinerary generation, existing booking URLs, imports, and expense calculations must continue working without Stay22.

Stay22 currently advertises Allez links, Map, Lift link optimization, Nova, Spark, and Loop transportation monetization. Product names alone do not establish API access, supported parameters, native compatibility, or our commercial rights. Confirm those in partner documentation and a signed agreement before implementation. Source: [Stay22 product overview](https://www.stay22.com/).

## 2. Where to use it

| Priority | Placement | Suggested experience | Conditions |
|---|---|---|---|
| MVP | Lodging tab empty state | “Find places to stay” using the selected destination and confirmed dates | Explicit click; preserve “Add lodging” and import actions |
| MVP | Needed or Proposed lodging detail | “Search stays near this location” | Distinguish destination search from an exact-property offer; never invent a property match |
| Next | Overview accommodation gaps | “Find a stay for these nights” for uncovered destination/date intervals | Compute gaps from active stays and local calendar dates; exclude Cancelled stays; ask the traveler to confirm gaps in multi-city or overnight-transfer trips |
| Next | Itinerary base-stay section | Contextual lodging search for each overnight base | Use itinerary location/date data after generation; never make generation depend on Stay22 or imply that accommodation is reserved |
| Later | Optional lodging map | Traveler opens a map around the chosen destination or base stay | Web first; explicit activation and required consent; separate from the existing trip-day map |
| Later | Public destination guides or public trip blogs | A generic “Find stays in this destination” link or map | Respect publication permissions; never expose a private group's dates, lodging address, or future whereabouts |
| Defer | Transportation and automatic link optimization | Evaluate Loop and Lift only after lodging launch | Separate scope, disclosures, tests, and child flags; retain existing airline and booking links |

Prefer planning moments with clear lodging intent. Suppress prompts for Completed/Cancelled items and fully covered past trips. For Booked lodging, preserve the original confirmation/provider URL; do not replace it with an affiliate link. Do not convert user-entered URLs automatically in the MVP. No popups, automatic redirects, or promotion inside receipts or expense reports.

Suggested CTA disclosure, immediately beside the action: “Affiliate link: we may earn a commission if you book.” Do not promise identical prices or that commissions never affect ranking without verification. Explain any sponsored placement and keep relevance criteria independent of commission rates.

## 3. Partner and commercial prerequisites

Before enabling production, obtain written confirmation of web and native app authorization, private authenticated planning, AI itinerary placement, permitted destinations/parameters, approved branding, and product access. Obtain current technical docs rather than guessing URL formats or endpoints.

Legal review should address broad user-claim obligations (§3), indemnity and liability imbalance (§§10–11), unpaid-fee forfeiture (§12), data rights (§§7–8), competitive-use restrictions (§2), and terms taking precedence over Order Forms (§13). Seek a signed amendment that expressly overrides conflicting terms. Confirm commissions, attribution windows, reversals, payout thresholds/timing, reporting, termination, and ordinary service-monitoring permission. These are partner contract issues; updating our consumer terms does not resolve them. Source: [Stay22 Affiliate Partner Terms](https://www.stay22.com/terms), published version dated November 11, 2025.

Record the contracting operator/entity and approval owner. Do not assume the WanderBunnies brand is itself the contracting legal entity. Recheck terms and technical documentation at implementation and before launch.

## 4. Feature flags and shutdown behavior

Proposed flags, all seeded `enabled: false` in `server/config/feature-flags.yaml`:

| Flag | Controls |
|---|---|
| `stay22_integration` | Master switch for every Stay22 surface, outbound handoff, script, map, API call, and optional job |
| `stay22_lodging_links` | MVP accommodation search links; requires master |
| `stay22_lodging_map` | Optional map; requires master and applicable consent |
| `stay22_public_placements` | Public guide/blog placements; requires master and relevant link/map child |
| `stay22_link_optimization` | Future automatic monetization; requires master; no MVP implementation |
| `stay22_transportation` | Future transportation placements; requires master; no MVP implementation |

Add each implemented flag to `FAIL_CLOSED_FLAGS` in `server/src/services/entitlementService.ts`. Missing rows must disable Stay22; preserve existing fail-open behavior for unrelated flags. Database values remain authoritative; changing YAML must not overwrite an admin's runtime choice. No admin bypass.

Expose effective master-and-child availability through the existing `/api/auth/features` response, default client state to false, and pass props from `app/App.tsx`. Inspect response caching and cohort behavior before choosing rollout: user-specific eligibility must not enter a globally cached/public response. Reuse `featureCohorts.ts` only where the actual authenticated user is available. Public placements remain off in the MVP.

The server independently checks flags at every handoff/provider endpoint. UI hiding alone is insufficient. On flag/configuration lookup failure, issue no provider call and return a controlled unavailable response. Follow the existing `EntitlementError`/402 contract where applicable; document the unavailable response separately.

Turning the master off stops new handoffs within the current server flag cache window (up to 60 seconds), across all instances. Client refresh must hide controls and unmount embeds; check flags again when the app resumes. Document that an already opened third-party page cannot be recalled. Links in the app should request a fresh server-authorized handoff rather than store long-lived provider URLs that bypass shutdown. Do not emit affiliate links into emails, PDFs, or exports in the MVP.

Published terms, privacy notices, user rights, and required deletion/security handling stay accessible when the feature is off. The flag controls integration behavior, not access to legal information.

## 5. Technical design

1. Add a small Stay22 service and, only if needed by approved documentation, an external API adapter under `server/src/apis/`. Read configuration with `getEnvValue()`; never place a secret in Expo/public configuration. Define validated handoff DTOs in `server/src/types.ts`.
2. Propose `POST /api/stay22/handoff`, mounted in `server/src/app.ts`. Authenticate, authorize trip membership using established route helpers, check master/child eligibility, validate input, then construct an approved URL. Use Zod, bounded inputs, rate limits, and a strict HTTPS host allowlist. Never accept an arbitrary redirect destination or fetch user-supplied URLs.
3. Send a typed context (trip ID and optional lodging/base-stay reference) to our server. Derive provider search fields only after authorization. A read-only follower must not gain access to private trip details through this endpoint. Confirm the intended member permissions before launch.
4. Return a short-lived handoff result or one-time first-party token, depending on the supported navigation flow. On web, preserve the user gesture to avoid popup blocking; use a same-tab fallback. On native, open the approved external destination with `Linking`. Test iOS/Android rather than assuming iframe or WebView support.
5. Keep the fetch helper with `app/tabs/lodging.ts`; place a reusable disclosed CTA in `app/components/`. Wire `LodgingTab.tsx` and the actual active lodging dialog path, including the standardized-dialog flag variant. Add Overview/itinerary placements only in subsequent phases.
6. No database change is expected for MVP link generation. If durable handoff tokens, consent, or attribution records are required, specify retention, migrations, and facade/Postgres/Firebase implementations; verify memory-adapter coverage.

Opening a link must not create a lodging, set its status to Booked, alter a cost, or assert availability. A traveler can later add/import their confirmed booking through existing flows. Handle missing dates, ambiguous destination, expired sessions, and provider unavailability with a clear retry or editable search context.

## 6. Privacy and data boundaries

Allowlist only provider-required search data: destination or accommodation-area coordinates, check-in/check-out dates, and traveler-confirmed aggregate occupancy if supported. Do not infer all group members are booking together. Do not send names, emails, birthdays, child identities, internal trip/group/user IDs, JWTs, confirmation numbers, private notes, expenses, or itinerary text. If ages are mandatory, assess that separately before supporting the flow.

Use coarse placement codes for attribution, never identifiers encoding travelers or private trips. Suppress sensitive referrers with `Referrer-Policy`/`noreferrer` as appropriate and verify the actual redirect chain. Scrub search fields and full outbound URLs from logs, analytics, and error reporting.

The MVP loads no Stay22 script, iframe, pixel, preconnect, or prefetch before the traveler acts. Clicking an external link still exposes network/device information to its destination; explain this accurately. Stay22 describes visitor technical information and partner booking information in its [privacy policy](https://www.stay22.com/privacy).

Before embedded maps or optimization, inventory cookies/storage, recipients, processing roles, retention, transfers, and opt-out behavior. Extend the existing consent model only with a correctly scoped choice; product analytics consent in `app/utils/privacyConsent.ts` is not automatic permission for affiliate advertising/tracking. Respect applicable browser privacy signals and regional rules. Unknown/declined consent must prevent optional provider loading. Withdrawal unmounts embeds and stops future optional collection. Review minor-account eligibility separately from the app's minimum account age.

## 7. Terms, privacy, and cookie updates

Deliver legal changes before feature activation, with accurate effective dates and version/change records. Counsel should adapt the draft below to verified integration behavior and applicable consumer law.

### Consumer terms

Update `app/public/terms.html` at its existing third-party services/links provisions. Confirm all served copies and deployment routes. Suggested draft:

> **Accommodation searches and affiliate links.** WanderBunnies may offer optional links or search tools through Stay22 and participating travel providers. We may receive a commission when you make an eligible booking through these links. Affiliate links are identified where they appear. Any payment, reservation, cancellation, change, or refund is governed by the terms of the provider with whom you book. WanderBunnies provides trip-planning tools and does not confirm a reservation merely because you view an offer, follow a link, or save a lodging in your itinerary. Before booking, verify the property's identity, dates, occupancy, total price, taxes, fees, availability, and cancellation conditions with the booking provider. Third-party offers can change. Nothing in this section limits rights or remedies that cannot lawfully be excluded.

Check that merchant-of-record and support descriptions match the actual partner flow. Separate WanderBunnies subscription cancellation from hotel-booking cancellation. Do not import Stay22's business indemnity or a prohibition on user claims into consumer terms. Do not describe a blanket waiver of privacy rights or guarantee rates/refunds.

Determine whether material changes require notice or renewed acceptance under existing terms and applicable law. Use the existing account/version mechanism if available; record any needed implementation work rather than assuming signup consent covers new tracking.

### Privacy notice and cookies

- Edit the canonical `docs/legal/privacy-policy.md`, including its version/effective/change metadata. Describe the actual Stay22 flow, data categories, purposes, recipients, legal basis, international transfers, retention, and rights/contact process. Distinguish Stay22 from the ultimate booking provider and confirm their respective processing roles.
- Run `node scripts/build-legal-pages.mjs` to regenerate `app/public/privacy.html` and `server/src/legal/privacyPolicyHtml.ts`; verify with `--check`. Do not edit generated privacy outputs directly.
- Update `app/public/cookies.html` and `app/public/privacy-choices.html` only to reflect technologies actually used. Publish applicable partner/processor disclosures and update mobile store privacy declarations where required.
- Update `docs/legal-document-inputs.md` with verified partner facts and remaining decisions. Required legal disclosures remain published after rollback while retained data or historic bookings still make them relevant.

## 8. Implementation sequence

1. **Discovery and approval:** collect partner docs and contractual changes; document URL parameters, allowed platforms, data flows, responsibilities, and legal decisions. Owner: product/operator with legal review. Exit: scope and commercial/data conditions recorded.
2. **Dark foundation:** implement disabled seeds, fail-closed gates, feature response/props, validated handoff, configuration checks, and mocked provider tests. Owner: backend/frontend. Exit: no Stay22 traffic with flags off, missing, or unavailable.
3. **Legal and MVP:** prepare reviewed legal changes and disclosed Lodging CTAs; publish/version notices before activating traffic. Owner: product/legal/frontend. Exit: link-only web/native verification and acceptance criteria pass.
4. **Limited rollout:** use supported authenticated cohort controls or an isolated deployment first; enable master plus links only. Monitor first-party failures and partner reporting manually. Owner: operator. Exit: stable flow and no unexpected collection/navigation behavior.
5. **Expansion:** add gaps/base stays, then separately reviewed map/public placements. Automatic optimization and transportation require their own approved scope and consent design. Owner: product/engineering.

## 9. Verification and acceptance criteria

- Backend tests cover master off, child off, missing rows, lookup errors, misconfiguration, no admin bypass, unauthorized trip access, hostile URLs, and invalid dates. Assert zero provider calls in every denied case.
- Frontend tests cover hidden controls until flags resolve, local disclosure, both dialog variants, existing booking URLs, and no status/cost mutation. Existing lodging creation/import/editing remains usable with Stay22 disabled.
- Web network inspection confirms zero Stay22 requests before interaction, no sensitive referrer/analytics leakage, correct navigation, and graceful popup/provider failures. Native checks verify external opening and no embedded dependency.
- Future map tests cover no consent, withdrawal, privacy signals, stale clients, and master-off unmounting. Public-placement tests prove no private data disclosure.
- Test shutdown across cache expiry and app resume. Previously opened third-party pages are explicitly outside the shutdown guarantee.
- Run focused server/frontend suites, appropriate TypeScript checks, legal-page tests, and `node scripts/build-legal-pages.mjs --check` after implementation. This planning-only change does not require application tests.

## 10. Measurement, operations, and open decisions

Measure aggregate eligible views/clicks only through the existing consent-aware analytics path; do not add a separate tracking bypass. Use partner reports for commissions, reversals, and payouts without promising booking-level attribution unsupported by the contract. Review revenue alongside broken handoffs, complaints, and lodging-task completion. Avoid synthetic vendor monitoring unless expressly authorized by Stay22.

Rollback: disable `stay22_integration`, confirm backend denial and client refresh, remove/unmount provider resources, retain legal/history records, and investigate before re-enabling. Review partner terms periodically and reconcile unpaid commissions. Never retry background vendor work after shutdown.

Open decisions before coding: approved Stay22 product and docs; exact handoff/navigation design; legal contracting entity and contract changes; web/native scope; consent and minor-account policy; allowed occupancy fields; tier availability (recommend all tiers initially); cohort support; and whether any durable data is necessary. No credentials, new vendor services, or production activation are part of this plan document.
