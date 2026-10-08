# Analytics Upgrade: Manual Follow-ups

Status as of October 8, 2026. These are the tasks from the [analytics upgrade](analytics-upgrade.md) that code can't do: signatures, legal review, vendor and console settings, store submissions, deployment, and device checks. The engineering record is in the [implementation plan](implementation-plans/analytics-upgrade.md), and the Phase 0 evidence is in the [Phase 0 record](analytics-phase-0.md). The [sign-off packet](legal/analytics-signoff-packet.md) gathers every signature, decision and verification below into fill-in tables, with ready-to-send drafts of the user notification and the App Review note.

Optional product analytics and detailed diagnostics stay **off** (`analytics_collection_enabled` and `diagnostics_user_linked_enabled` flags) until every item in sections 1–4 is done.

## 0. Urgent (not analytics-specific)

- [x] **Remove the unauthenticated login routes.** `POST /api/auth/email` and `POST /api/auth/oauth` issued a valid 30-day token for *any* email address, including admin tokens for the bootstrap admin emails. **Removed in code on October 8, 2026**, together with `handleLogin` in `server/src/auth.ts`. `server/__tests__/admin-bootstrap.test.ts` now asserts that all four paths (`/api/auth/*` and the `/api/web-auth/*` aliases) return 404 and issue no token, and the release gate checks the routes stay gone. **Production stays exposed until the §4 deploy:** the deployed build (`7355b79`) still has both routes, so deploy soon, independently of the analytics work. *Owner: Engineering.*

## 1. Legal and sign-off

- [ ] **Sign the DPIA** (packet A4) and its legitimate-interests appendix: [docs/legal/analytics-dpia.md](legal/analytics-dpia.md). *Owner: Tristan (controller).*
- [ ] **Counsel review** of every item marked **[Counsel]** in the DPIA, and of the [EU/UK representative assessment](legal/eu-uk-representative-assessment.md). That draft concludes the "occasional processing" exemption probably does **not** apply while EU/UK users are targeted. Either appoint EU and UK representatives, or stop targeting those markets, and record the decision. Until then, keep any analytics canary to non-EU/UK users. *Owner: Tristan + counsel.*
- [ ] **Confirm the operator address** (packet A2). Every legal page lists 4 Dickinson Circle, Shrewsbury, MA as Tristan Duerk's business address. *Owner: Tristan.*
- [ ] **Confirm in writing that Tristan is the operator** (packet A1, statement ready to sign). The Terms, withdrawal form and content-moderation pages now name Tristan instead of Bryan, which changes the party users contract with. *Owner: Tristan.*
- [ ] **Sign off the event and metric dictionary v1** (packet B1) in the [Phase 0 record](analytics-phase-0.md#initial-event-and-metric-dictionary). *Owner: Product.*

## 2. Vendors and data transfers

- [ ] **Collect processor agreements (DPAs) and transfer mechanisms** (EU–US Data Privacy Framework or SCCs; packet C11 has the per-vendor table) for Google Cloud/Firebase, Sentry, each AI provider (OpenAI, Anthropic, Gemini and any others enabled), Stripe, Plaid, Mailgun/SMTP, Expo, Unsplash, SerpAPI and GetYourGuide. Record them in the processing register. *Owner: Operations.*
- [ ] **Set Sentry project data retention to 30 days**, and confirm the project's data region. The privacy notice now says diagnostics "expire within 30 days". *Owner: Operations.*
- [ ] **Confirm each AI provider's API data-retention terms**, and enable zero-retention options where eligible. *Owner: Operations.*
- [ ] **Check the `support@wander-bunnies.com` mailbox** with a send/receive test. It is now the only privacy contact. *Owner: Operations.*

## 3. Cost and billing

- [ ] **Create the $100/month analytics canary budget** in Cloud Console. The Cloud Billing API is disabled, so the CLI can't do it.
  - Use Billing → Budgets & alerts, scoped to project `travel-itinerary-app-483623`.
  - Filter to Firestore, Cloud Run, Cloud Storage and Logging.
  - Set the amount to the pre-canary baseline plus $100, with alerts at 80% and 100%.
  - Record the budget name in the Phase 0 record. Set the Sentry quota alert separately.

  *Owner: Operations.*
- [ ] **Enter provider invoices monthly** with `PUT /api/admin/costs/invoices/:provider/:month`, and review the reconciliation in `GET /api/admin/costs/ledger`. *Owner: Finance.*
- [ ] **Price unknown providers and models.** The ledger report lists unknown-priced attempts; add their prices to `server/config/api-limits.yaml`. *Owner: Engineering.*

## 4. Publishing and stores

- [ ] **Deploy the current branch.** Production runs `7355b79`, which predates the age gate, privacy controls, the cost ledger and the new legal pages. Afterwards:
  - confirm the new flags seed as **disabled**;
  - confirm `/privacy`, `/privacy.html`, `/privacy-choices`, `/delete-account`, `/cookies` and `/terms` all resolve on the live domain.

  *Owner: Engineering.*
- [ ] **Publish privacy notice version 3.0 and notify existing users,** in-app or by email. This covers the changed operator and the new optional collection. The email (D1) and in-app wording (D2) are drafted in the packet. Sending the email is manual; showing the in-app banner needs a small engineering change (§7). *Owner: Tristan.*
- [ ] **Update App Store Connect's App Privacy answers and Google Play's Data safety form** from [docs/app-store-review-packet.md](app-store-review-packet.md) §8, alongside the first build that contains these changes. Enter `https://wander-bunnies.com/delete-account.html` as the Play Console account-deletion URL. *Owner: Mobile lead.*
- [ ] **Verify the built apps:**
  - Xcode **Privacy Report** for the archived EAS iOS build, compared with `ios.privacyManifests`;
  - merged `AndroidManifest.xml` contains no `AD_ID`;
  - proxy capture on web, iOS and Android shows **no optional traffic before consent or after withdrawal**, including Sentry's native layer at startup.

  *Owner: Mobile lead.*

- [ ] **Optional: set up the analytics CSV export bucket.** Create a private bucket in `us-east5` with a lifecycle rule (for example 25 months, matching the aggregate retention). Grant the Cloud Run service account write access, and set `ANALYTICS_EXPORT_BUCKET`. The daily export of suppressed aggregate CSVs stays off until this is done. *Owner: Operations.*

## 5. Age gate

- [ ] **Turn on `age_gate_enforcement`** only once the oldest supported app build includes the date-of-birth prompt. *Owner: Engineering.*
- [ ] **Explain the date-of-birth prompt in App Review notes.** Apple has previously rejected forced steps after Sign in with Apple. Draft text is in packet D3. *Owner: Mobile lead.*
- [ ] **Optional: enable the Apple Declared Age Range shortcut.**
  1. Turn on the *Declared Age Range* capability on the App ID in the Apple Developer portal. Capability sync is off for this app, so this is manual.
  2. Build with `APPLE_DECLARED_AGE_RANGE_ENABLED=1` on an Xcode 26+ EAS image.
  3. Test on a physical iPhone signed in to an Apple Account.

  *Owner: Mobile lead.*

## 6. Verification still owed

- [ ] **Run the new ledger, lease, erasure and retention code against the Firestore emulator** and a disposable test project. So far it has only been tested on the in-memory Postgres adapter. *Owner: Engineering.*
- [ ] **Load test at 10× the measured peak:** 40,610 requests/hour plus modeled analytics batches, on Firebase. *Owner: Engineering.*
- [ ] **Inspect a few existing AI capture objects** before relying on the 30-day lifecycle claim; the test bucket is still unmanaged. *Owner: Engineering.*

## 7. Later engineering work (tracked here so it isn't lost)

The full records are in the plan's Phase 2–7 sections.
- Tier and role eligibility in report denominators, an expected-trip denominator for during-trip engagement, and daily rollups once reports show `truncated`.
- ~~More instrumentation: `task_*` for imports, invites and item editing, plus `task_cancelled` for trip creation.~~ Done October 8, 2026 (plan, Phase 7 addendum). Still open: item forms fire `task_started` on submit, so abandoning an item form isn't measured. Measuring it would mean adding open/close hooks to each item dialog.
- Per-segment trip time zones, and real lodging coordinates once Places details are integrated.
- Cost Whisper transcription per minute, and optionally import GCP billing exports instead of entering invoices by hand.
- Replay deletion tombstones after a backup restore.
- ~~An admin UI for privacy rights requests (API only today).~~ Done October 8, 2026: Admin → Privacy Requests.
- Admin-initiated erasure: a button in Admin → Privacy Requests that starts an erasure job for a verified request. Today an engineer has to start one when the user can't use the in-app deletion.
- In-app banner for privacy notice changes (packet D2), shown once per notice version.
- Activation, collaboration, retention, AI value and monetization views, after the first five are trusted.
