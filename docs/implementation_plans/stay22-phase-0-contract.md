# Stay22 Phase 0 Partner Contract Record

Verified: 2026-11-08 (public documentation only)
Status: **Link format verified; account, commercial and legal items open.** PR 4 (the adapter) can be built from this record. Rollout waits on the open items below.
Plans: [implementation plan, Phase 0](stay22-implementation-plan.md#phase-0-partner-prerequisites-owner-bryan-duerk) · [design](stay22-integration-plan.md)

This record is the gate for the Stay22 hotel-link integration. It records public documentation findings. The partner Hub, any Order Form and any written confirmation from Stay22 are authoritative for our account; add them here when received. Writing this record changed no configuration and made no request with our affiliate ID.

## Sources reviewed (2026-11-08)

- [Allez overview](https://dev.stay22.com/docs/allez), [parameters](https://dev.stay22.com/docs/allez/parameters), [quick start](https://dev.stay22.com/docs/allez/quick-start), [providers](https://dev.stay22.com/docs/allez/providers), [roam](https://dev.stay22.com/docs/allez/roam), [troubleshooting](https://dev.stay22.com/docs/allez/troubleshooting)
- [Mobile SDK](https://dev.stay22.com/docs/mobile-sdk), [link attribution](https://dev.stay22.com/docs/mobile-sdk/link-attribution), [SDK testing](https://dev.stay22.com/docs/mobile-sdk/testing)
- [Affiliate Partner Terms](https://www.stay22.com/terms), "Last updated: 2025-11-11". Sections 1–8 were read in full; sections 9–13 only through a summary of the page, so **re-read 9–13 in full before signing**.
- [FAQ](https://stay22.com/faq)
- Not read: the Mobile SDK quick start, notifications pages, the [Reporting API](https://dev.stay22.com/docs/reporting/transactions), and the [privacy policy](https://www.stay22.com/privacy) in detail (needed for PR 5).

## Verified link format

**Base URL:** `https://www.stay22.com/allez/{provider}`. All parameters are query strings.
- `roam` lets Stay22 choose the booking site per traveler, with geo-routing to regional sites.
- Fixed providers: `booking`, `expedia`, `hotelscom`, `vrbo`, `agoda`, `kayak`, `getyourguide`.

We use `roam`.

| Parameter | Format | Notes from the docs |
|---|---|---|
| `aid` | string | **Required.** "The only one that decides whether you get paid" |
| `lat`, `lng` | numbers | Use together; "coordinates take priority" over `address` |
| `address` | string | City and country work; more specific is better |
| `checkin`, `checkout` | `YYYY-MM-DD` | "Dates must be in the future"; otherwise they aren't pre-filled |
| `adults` | number | Optional |
| `campaign` | string | Tracking label, "strongly recommended" and repeatable. **Hyphens split values** (`foo-bar` reports as `foo` and `bar`), so use underscores |
| `children`, `childrenAges` | number; comma-separated ages | **We never send these** (design §6) |
| `link`, `hotelname`, `provider`, `roam`, `lang`, `currency` | — | Not used. `roam` doesn't work with `link`; `provider` is for testing only; language and currency are auto-detected |

Roam "requires a resolvable destination". The docs don't say what happens with no location, so the adapter never builds a link without one. Example from the docs:

`https://www.stay22.com/allez/roam?aid=<AID>&address=paris&checkin=2026-07-01&checkout=2026-07-05&adults=2&children=1`

### Adapter mapping (PR 4 builds exactly this)

| `StaySearchContext` | Stay22 parameter | Rule |
|---|---|---|
| `location.lat` / `location.lng` | `lat`, `lng` | Rounded to 4 decimals (about 11 m) |
| `location.city` or `location.text` | `address` | Only when there are no coordinates; URL-encoded |
| `checkIn` / `checkOut` | `checkin`, `checkout` | Both, or neither. **Omit both if check-in is not after today**; a stay already in progress gets an undated search |
| `adults` | `adults` | Only when present (1–30) |
| `rooms` | — | No documented parameter; not sent |
| `placement` | `campaign` | For example `campaign=lodging_needs_booking`. A second, fixed `campaign=wanderbunnies_app` separates app traffic from any other use of the same ID |
| (config) | `aid` | `STAY22_AFFILIATE_ID` |

No other parameter is ever added.

## Configuration values

```dotenv
STAYS_LINK_PROVIDERS=stay22
STAY22_AFFILIATE_ID=<from the Stay22 Hub>
STAY22_DEEP_LINK_BASE_URL=https://www.stay22.com/allez/roam
STAY22_ALLOWED_HOSTS=www.stay22.com
```

The host allowlist covers **our** redirect only. Stay22 then forwards the traveler to the chosen booking site (for example Booking.com, Expedia, or a regional site like `stayz.com.au`). The docs don't list intermediate hops, so verify the real chain once in the test environment (implementation plan, Rollout step 1).

## Native apps

- The terms define partner platforms to include "mobile and tablet applications" (§1.3), so app use is in scope.
- The Mobile SDK (Android, iOS, Flutter, Capacitor; **no React Native**) is optional. Stay22 says partners can "build the same link yourself and the booking is still attributed". The SDK is a push-notification product with its own consent and cookie behavior. **We don't use it.**
- Attribution: a cookie is set when the traveler lands on the booking site ("Cookie activates"). The docs don't address in-app browsers or WebViews. Our plan opens the **system browser** (`Linking.openURL`), which is the most cookie-friendly option. Ask Stay22 to confirm (open item 4).

## Terms findings that affect us

| Section | What it says | What it means for us |
|---|---|---|
| Preamble | Effective when the partner clicks "I Accept" **or first uses any Stay22 Product**, whichever is earlier. Stay22 may amend with 30 days' notice or by posting (§13, summary) | Creating the account or using our affiliate ID accepts these terms. Review them now, not at launch. Re-check this page before each rollout step |
| Preamble, §2.2 | Direct competitors are prohibited; no benchmarking, no building a competing product, no monitoring the Products' availability or performance | We aren't a competitor. **No synthetic monitoring of Stay22 links**; monitor only our own redirect. Comparing click-through against a future second provider could count as "benchmarking", so ask (open item 5) |
| §2.1 | The license is **non-exclusive** | Using or switching to another provider isn't prohibited by this text; confirm in writing (open item 5) |
| §3.2 | The partner must ensure its users bring no claims against Stay22, and is liable for its users' breaches | A business-to-business obligation; don't copy it into our consumer terms (design §7). Ask counsel how to manage it |
| §5.1–5.3 | Fees are set in the Order Form and calculated "solely based on records maintained by Stay22". A remittance report is available within 30 days of a withdrawal request. The partner pays all taxes | We can't audit commissions independently. Keep our own aggregate click counts for reconciliation |
| §7.2 | Stay22 gets a broad, irrevocable license to "Affiliate Partner Data", and may use anonymized aggregate data "for any purpose" | Another reason to send only the minimal search data (design §6). Never send identifiers |
| §8 | Each party complies with privacy law; personal information is processed under Stay22's privacy policy; the definitions reference Canadian privacy law | PR 5: name Stay22 as a recipient, describe the data, note a possible transfer to Canada; read the policy in full |
| §9(b) (summary) | AI output "may contain errors"; the partner must validate it and tell users to | Applies to Stay22's AI routing (roam). Our terms already say to verify property, price and dates before booking |
| §10–11 (summary) | The partner indemnifies Stay22. Stay22's liability is capped at the fees it paid us in the previous 6 months, and consequential damages are excluded | Counsel review (open item 6) |
| §12 (summary) | Unpaid fees are **forfeited** if Stay22 terminates for our breach. Either party may terminate for an uncured material breach (30 days' written notice) | Request payouts as soon as the minimum is reached, to limit exposure |
| §13 (summary) | Order of precedence appears to be Terms, then Order Form, then Documentation; Stay22 may assign freely | The preamble's wording ("together with any Order Forms") reads differently. Check the full §13 text |

## Commercial facts (FAQ)

- **Commission:** a "revenue share model" with "no upfront fees". **No rate is published**; gap-closing §11.3's "about 30%" figure came from third-party reviews.
- **Payouts:** monthly. A booking becomes eligible "once the guest has completed their stay". There's a minimum before you can request a payout, but its amount isn't published.
- **Attribution window and cookie duration:** not stated.
- **Booking sites:** Booking.com, Expedia and Hotels.com are named (roam also uses Vrbo, Agoda and Trip.com); the exact set varies by destination and market.
- **Disclosure:** Stay22's own products label links as sponsored. The terms set no disclosure wording; our "Partner link" disclosure (design §3) stands.

## Phase 0 decisions

1. The MVP uses Allez `roam` deep links built on our server, with no SDK, script or API key.
2. Parameters are limited to the adapter mapping above. Children, ages, names and IDs are never sent.
3. Placement goes in `campaign` (underscores only), plus a fixed `wanderbunnies_app` campaign.
4. Dates are sent only when check-in is in the future.
5. Native apps open links in the system browser.
6. Only our own redirect is monitored; there's no synthetic traffic to Stay22.
7. The affiliate ID stays in server configuration even though it isn't secret.

## Open items (owner: Bryan Duerk)

| # | Item | Blocks |
|---|---|---|
| 1 | Stay22 account created and affiliate ID recorded in `server/.env` and the deployment secrets | Rollout |
| 2 | The Order Form or Hub terms for our account: commission rate, payout minimum, attribution window, reversal or cancellation rules | Rollout |
| 3 | Written confirmation of use inside **signed-in, private** trip planning, and next to AI-generated itineraries | Rollout |
| 4 | Written confirmation that links opened from our iOS and Android apps in the system browser are attributed, and whether in-app browsers are supported | Native rollout |
| 5 | Written confirmation that using or switching to another accommodation provider is allowed, and that comparing results between providers isn't "benchmarking" under §2.2 | A second provider |
| 6 | Counsel review of §3.2 (user claims), §§10–11 (indemnity and liability), §12 (forfeiture), §7.2 (data license) and §13 (precedence), including whether to seek an amendment | Production rollout |
| 7 | Whether bookings through Stay22 cost travelers nothing extra (decides the "no additional cost" wording in our terms, PR 5) | PR 5 |
| 8 | The legal entity that signs, and who approves | Production rollout |
| 9 | Whether test clicks with our ID are filtered from reporting, and the typical reporting delay | Rollout step 2 |
| 10 | Read sections 9–13 of the terms and the privacy policy in full; update this record | PR 5 |

When items 1–3 and 6–8 are resolved, record the dates and outcomes here and mark the status **Approved for rollout**.
