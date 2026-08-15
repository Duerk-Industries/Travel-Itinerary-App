# WanderBunnies App Review Response Packet

**Application:** WanderBunnies - Shared Trip Planner  
**Draft date:** August 14, 2026  
**Status:** Draft - replace every `[OWNER INPUT REQUIRED]` field before submission

> Do not submit reviewer passwords, API keys, payment-card details, or private user data in a public document. Put reviewer credentials only in the secure App Review credential fields.

## 2. Devices and operating systems tested

Enter only physical devices on which the submitted build was actually tested. Use a device that supports and is running the current latest public operating-system release.

| Platform | Physical device model | Exact OS version | App version/build | Test date | Result |
|---|---|---|---|---|---|
| iOS | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[Pass / issues]` |
| iPadOS | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[Pass / N/A]` |
| Android | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[OWNER INPUT REQUIRED]` | `[Pass / N/A]` |

Retain internal evidence containing the device model, OS screenshot, build number, tester, test date, and pass/fail results for registration, login, account deletion, trip editing, paid-feature access, uploads, and permissions.

## 3. App functions, target audience, problem, and value

WanderBunnies is a collaborative travel-planning app for individuals, couples, families, and groups who want one shared place to organize a trip. It reduces fragmented planning across email, spreadsheets, group chats, booking confirmations, and notes.

### Primary functions

- Create and manage trips with destinations, dates, travelers, trip details, and shared access.
- Organize transfers, flights, lodging, car rentals, activities, day-by-day plans, and packing lists.
- Generate AI-assisted itinerary suggestions using destinations, dates, traveler preferences, and trip context. Users remain responsible for checking the results.
- Track shared expenses, payers, coverage, balances, settlement payments, and CSV cost reports where the user's tier permits those features.
- Import travel information from supported documents, forwarded email, or an optional Gmail connection where enabled.
- Collaborate through invitations, shared membership, following/read-only access, voting, chat, presence, and a private trip blog with text and media.
- Use maps, place search, weather, currency conversion, destination photography, and optional activity-provider links.

### Problem solved and value

The app gives a group a shared source of truth before and during travel. It reduces duplicated planning, missed logistics, unclear cost responsibility, and the time required to turn confirmations and preferences into a usable itinerary.

## 4. Setup and access instructions

### Reviewer access

- **Submitted version/build:** `[OWNER INPUT REQUIRED]`
- **Reviewer account:** `[ENTER IN SECURE APP REVIEW FIELD]`
- **Password:** `[ENTER IN SECURE APP REVIEW FIELD]`
- **Two-factor or verification handling:** `[OWNER INPUT REQUIRED - state "not required" or provide a durable review-safe method]`
- **Seeded trip:** `[OWNER INPUT REQUIRED - recommended: App Review Demo Trip]`
- **Account tier:** `[OWNER INPUT REQUIRED - recommended: active Premium access without a payment action]`

### Setup

1. Install the submitted build on a supported physical device and connect to the internet.
2. Launch WanderBunnies and choose **Login**.
3. Enter the reviewer credentials supplied in App Store Connect. The app supports email/password, Google sign-in, and Sign in with Apple when enabled.
4. Use an account that is already verified and does not require an employee-controlled one-time code.
5. Open the seeded demo trip from **Home**.

### Main-feature path

1. **Home / Create Trip:** Select destinations and dates, add travelers, and finish the guided setup.
2. **Overview:** Review the combined trip timeline and edit trip details.
3. **Transfers, Lodging, Activities, and Car Rentals:** Add, edit, vote on, and remove records.
4. **AI itinerary:** Submit an itinerary request and review the generated days and activities.
5. **Daily Expenses / Ledger / Cost Report:** Add an expense, choose its payer and covered travelers, review balances, record a settlement, and export CSV if entitled.
6. **Import:** Upload a supported travel file or use an enabled email/Gmail import, review proposed items, and confirm what is added to the trip.
7. **Trip Blog:** Add text and select a photo. On a fresh install, photo selection displays the iOS Photos permission request.
8. **Collaboration:** Invite a second user or use the supplied shared trip to demonstrate membership, following, voting, and shared updates.
9. **Account:** Review profile controls, Premium status, optional financial connections, data export, password/email management, and **Delete Account**.

No sample file is required for the core planner. If import is within the submitted review scope, attach a non-sensitive sample confirmation PDF or email fixture: `[OWNER INPUT REQUIRED / N/A]`.

### Paid features

The current source implements Free and Premium tiers. Premium includes higher trip and traveler limits, unlimited AI itinerary generations, email import, cost tracking, and additional media capability.

Stripe-hosted Checkout and the Stripe Customer Portal are implemented for web billing. Native code does not present a Stripe checkout button and currently directs users to the WanderBunnies website. Before iOS submission, confirm this behavior against the current App Store payment rules for digital functionality. Give App Review an already-entitled Premium account so paid features can be evaluated without payment information.

## 5. External services, tools, and platforms

Remove any service that is disabled in the exact submitted environment.

| Service | Purpose |
|---|---|
| Firebase / Google Cloud | Hosting, backend deployment, authentication support, database storage, media/object storage, App Check, and cloud security services. |
| Google Identity / OAuth | Google account authentication. |
| Apple | Sign in with Apple. |
| Gmail API | Optional read-only travel-message and attachment import within approved OAuth scopes. |
| Google Maps / Places | Place search, cached lookup, maps, static-map support, and navigation links. |
| OpenAI | Default configured provider for AI itinerary generation and selected parsing or summarization workflows. |
| Stripe | Web subscription checkout, billing status, taxes, invoices, fraud controls, webhooks, and Customer Portal. Stripe handles payment-card data. |
| Plaid | Optional connection to bank or card accounts for reviewing and selectively importing transactions as expenses. |
| Unsplash | Destination and itinerary photography. |
| Open-Meteo | Geocoding and weather forecasts. |
| Frankfurter | Reference currency exchange rates. |
| SerpAPI and Wikimedia | Attraction discovery and supporting source information. |
| GetYourGuide | Optional activity search, enrichment, and affiliate links. |
| Docling and local parsers | Structured extraction from supported travel documents and images. |
| SMTP / configured email provider | Verification, password, import, and service messages. |
| Sentry | Crash and error reporting when enabled. |
| Apple Maps, Google Maps, and Waze | User-initiated external navigation links, depending on installed apps. |

## 6. Regional differences

There is no intentional country-by-country feature gating in the current application code for the core trip planner. The same primary planning, collaboration, itinerary, and account functions are intended to work across supported regions, subject to connectivity, release configuration, and third-party availability.

Expected regional variation includes:

- Search results, maps, weather, attraction suggestions, destination images, and activity inventory vary by provider coverage.
- Currency conversion depends on supported currencies and available rates.
- Subscription taxes and eligible payment methods can vary by billing country.
- Google, Apple, Gmail, Plaid, Stripe, mapping apps, and partner links may be unavailable in some countries or for some accounts.
- The current interface is primarily English. Dates, currency formatting, and some provider content may follow device locale or provider output.
- Consumer, withdrawal, and privacy disclosures may vary where local law requires them.

**Proposed response:** WanderBunnies has no deliberately region-exclusive core feature set in the submitted build. If an optional provider is unavailable, the manual planning workflow remains available. Confirm this statement with production smoke testing in each launch region before using it verbatim.

## 7. Regulated industry and protected third-party material

### Regulated-industry status

WanderBunnies is a travel planning and collaboration tool. It is not represented as a travel agency, payment institution, bank, insurer, medical provider, legal adviser, immigration adviser, or emergency service. AI and provider output is informational and must be reviewed by the user.

No professional license or regulated-industry credential is expected to be required solely to operate the planner.

### Third-party and user material

- Destination photography, maps, place data, attraction discovery data, weather, currency rates, and partner activity content are accessed under the relevant provider or dataset terms and must retain required attribution.
- The bundled airport dataset identifies an Algolia-hosted airports dataset as its source. Retain its applicable license and attribution record.
- Users retain ownership of content they create or upload and grant the operating rights described in the WanderBunnies terms.
- GetYourGuide or other affiliate content should appear only while the applicable partner agreement is active and its branding, pricing, linking, and attribution rules are followed.

Retain the following records and provide them securely only if requested:

- Provider or partner agreements for production services that require approval.
- Dataset licenses and attribution records.
- Published Consumer Terms, Privacy Notice, Content Moderation Policy, support contact, and copyright-reporting process.
- Evidence that bundle identifiers, OAuth clients, domains, redirect URIs, and provider accounts are authorized for the operator.

Never provide secret API keys, webhook signing secrets, OAuth client secrets, private certificates, or user data.

**Proposed response:** Not applicable as a highly regulated service. WanderBunnies uses third-party data and services under provider terms and maintains the relevant accounts, agreements, licenses, and attribution records. Supporting evidence can be supplied securely upon request.

## Appendix A: Physical-device screen recording for item 1

### Recording preparation

1. Use a physical device that supports the current latest public OS release and install that release through **Settings > General > Software Update**.
2. Install the exact submitted TestFlight or release-candidate build.
3. Use a stable network, charge the device, lock the preferred orientation, and enable Focus or Do Not Disturb.
4. Prepare a disposable registration account and a separate seeded Premium reviewer account.
5. Remove real names, messages, payment information, booking references, and personal photos from demo data.
6. Reset the app's Photos permission so its system prompt appears during recording.
7. Add **Screen Recording** to Control Center if necessary. Touch and hold the recording control and enable the microphone if narration will be used.
8. Start recording, return to the Home Screen, and immediately launch WanderBunnies. If the opening is trimmed, the first visible action should be tapping the app icon.
9. Keep the functional demonstration continuous and avoid cuts that make the device or build unclear.

Apple's instructions: [Record the screen on your iPhone or iPad](https://support.apple.com/en-us/102653).

### Recording script

> Steps 11 and 12 describe the required final-state recording. Do not claim or record those controls until in-app reporting and server-enforced blocking are implemented in the submitted build.

1. **Launch**
   - On screen: Launch WanderBunnies from a closed state.
   - Narration: “This is WanderBunnies running on a physical device with the submitted build.”

2. **Registration**
   - On screen: Choose **Create Account**, enter disposable test details, accept required terms, and complete verification if required.
   - Narration: “A new user can create and verify an account using this flow.”

3. **Returning-user login**
   - On screen: Sign out and log in using the seeded Premium reviewer account.
   - Narration: “This is the normal login flow for a returning user.”

4. **Trip creation**
   - On screen: Start **Create Trip**, select destinations, dates, and travelers, and show the summary.
   - Narration: “The guided setup captures the trip's destinations, dates, and travelers.”

5. **Core planner**
   - On screen: Open the seeded trip. Show Overview, Transfers, Lodging, Activities, Car Rentals, and Packing List. Make one safe edit.
   - Narration: “The shared workspace keeps the group's logistics and plans together.”

6. **AI itinerary**
   - On screen: Submit a prepared request and show progress and a completed result.
   - Narration: “The app generates an editable itinerary suggestion from trip context and preferences.”

7. **Expenses**
   - On screen: Add a demo expense, choose its payer and covered travelers, and show balances, settlements, and CSV export.
   - Narration: “Premium cost tools allocate expenses and calculate group balances.”

8. **Paid features**
   - On screen: Show **Account > Premium**, the active tier, and a paid feature such as cost tracking or import. Do not enter payment data.
   - Narration: “This reviewer account is already entitled to Premium.”

9. **Import and connected data**
   - On screen: If enabled, show a non-sensitive document/Gmail import. If Plaid is enabled, show its sandbox consent entry point without using a real financial account.
   - Narration: “Connected-data features are optional and use provider consent before importing user-selected information.”

10. **User-generated content and Photos permission**
    - On screen: Add a Trip Blog text entry, tap **Add Photo**, show the iOS Photos permission prompt, select a demo image, and publish the post.
    - Narration: “Trip members can create shared content. Photo selection requests system permission on first use.”

11. **Report content**
    - On screen: Open a post or message menu, choose **Report**, select a reason, submit, and show the confirmation.
    - Narration: “Users can report objectionable content from the content itself.”

12. **Block user**
    - On screen: Open the test user's profile or action menu, choose **Block User**, confirm, and show the resulting hidden or disabled interaction.
    - Narration: “Blocking prevents further abusive interaction and hides the blocked user's content as applicable.”

13. **Delete account**
    - On screen: Sign into the disposable account, open account management, choose **Delete Account**, confirm, and show the signed-out state.
    - Narration: “Account deletion is available in the app and permanently removes the disposable account.”

14. **Finish**
    - On screen: Optionally show **Settings > General > About** for the device model and OS, then stop recording.
    - Narration: “This concludes the required account, core-feature, Premium, content-safety, and permission demonstrations.”

## Appendix B: Guideline 1.2 implementation requirements

Apple's current [App Review Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) states that an app with user-generated content must include:

1. A method for filtering objectionable material from being posted.
2. An in-app mechanism to report offensive content and timely responses to reports.
3. The ability to block abusive users from the service.
4. Published contact information.

### Current WanderBunnies status

| Requirement | Current status | Work needed |
|---|---|---|
| Published contact | Present | Keep `support@wander-bunnies.com` visible in the app and Support URL. |
| Reporting | Partial | The published policy accepts reports by email, but the submitted app needs a direct in-app report action. |
| Blocking | Missing | Add account-level block/unblock controls and enforce them on the server. |
| Pre-post filtering | Not demonstrated | Add enforceable text and media filtering before user content becomes visible. |
| Moderation operations | Partial | Add a durable report queue, review workflow, response target, enforcement actions, and audit history. |

### Minimum in-app user experience

Add a visible overflow/action menu to every user-generated content surface included in the submitted build, such as Trip Blog posts, photos/videos, chat messages, comments, and public/shared blog content.

The menu should provide:

- **Report content**
- **Report user** where account-level behavior is the concern
- **Block user**
- **Unblock user** from Account settings
- **Remove my content** when the current user owns the item

The report form should include:

- A clear reason list: harassment or bullying, hate or discrimination, sexual content, violence or threats, illegal activity, spam or scam, privacy violation, intellectual-property violation, and other.
- Optional details.
- A clear statement that the report was received.
- A stable report reference number.
- Emergency guidance when a report alleges immediate danger; the app should not imply that WanderBunnies is an emergency service.

Do not require users to copy an item ID, URL, or screenshot into an email. The app should attach the relevant technical context automatically.

### Blocking behavior

Blocking must be enforced by the server, not only hidden in the interface. At minimum:

- The blocked account cannot start new direct chats or send direct messages to the blocker.
- The accounts cannot invite, follow, mention, or otherwise initiate new direct interaction with one another.
- Content authored by the blocked account is hidden or collapsed for the blocker where feasible.
- The blocked user is not notified who blocked them.
- The block remains active after logout, reinstall, or use on another device.
- Account settings provide a list of blocked users and an explicit unblock action.
- APIs reject prohibited interactions even if a modified client calls them directly.

Shared trips need a defined rule because two blocked users may already be members of the same trip. A practical first release is:

- Disable direct chat and other direct interaction immediately.
- Hide or collapse the blocked person's optional social/blog content.
- Preserve essential shared logistics where hiding it would break the trip record.
- Give the blocker an easy way to leave the trip.
- Let the trip owner remove the abusive member.
- Let a moderator suspend or terminate the abusive account when a report is substantiated.

### Pre-post filtering

Apple asks for a method that filters objectionable material from being posted, so an email-only reporting process is insufficient by itself.

Implement filtering on the server for every write path:

- Normalize and inspect text for prohibited slurs, threats, explicit sexual content, harassment, spam, and malicious links.
- Validate MIME type, extension, file signature, file size, and media duration.
- Scan uploaded images and videos using an appropriate safety/moderation service before making them visible.
- Quarantine uncertain media for review instead of publishing it immediately.
- Reject clearly prohibited content with a user-readable message.
- Record the moderation result without logging private content unnecessarily.
- Apply the same controls to edited content, imported content, and alternate clients.

Filtering does not need to be perfect, but it must be real, consistently enforced, and paired with human report review.

### Backend and database work

Following this repository's adapter conventions, add equivalent Postgres and Firebase implementations for:

#### `content_reports`

- `id`
- `reporter_user_id`
- `reported_user_id`
- `content_type`
- `content_id`
- `trip_id` or conversation context
- `reason`
- `details`
- content/metadata snapshot or immutable evidence reference
- `status`: `received`, `in_review`, `actioned`, `dismissed`, or `appealed`
- assigned moderator
- created, reviewed, and resolved timestamps
- resolution and enforcement action

#### `user_blocks`

- `blocker_user_id`
- `blocked_user_id`
- created timestamp
- optional source report ID
- unique constraint on the blocker/blocked pair

#### Recommended API surface

- `POST /api/moderation/reports`
- `GET /api/account/blocked-users`
- `POST /api/account/blocked-users/:userId`
- `DELETE /api/account/blocked-users/:userId`
- Admin endpoints to list, assign, resolve, and audit reports

Every content, chat, follow, invitation, and social-interaction endpoint should check block relationships on the server.

### Moderation operations

Add an admin moderation queue that supports:

- Filters by status, reason, severity, date, reporter, and reported account.
- Safe content context and evidence review.
- Remove content, warn a user, remove a trip member, suspend an account, terminate an account, or dismiss a report.
- Duplicate-report grouping.
- Moderator notes and audit logging.
- Notifications to the reporter and affected user when appropriate.
- An appeal path consistent with the published moderation policy.

Apple says responses must be timely but does not state a universal hour count in Guideline 1.2. Establish a written internal target. A sensible launch target is to triage urgent safety reports immediately and review ordinary reports within 24 hours, with documented escalation and coverage.

### Acceptance tests before submission

- A user can report each enabled UGC type in three taps or fewer from its action menu.
- The report persists and appears in the admin queue with the correct content and user context.
- The user receives a confirmation and report reference.
- Blocking immediately stops direct interactions.
- Block enforcement survives logout, reinstall, and a second client.
- A blocked account receives an authorization error when calling protected APIs directly.
- Unblocking restores only the interactions intended by the product rules.
- Text and media filters run on create and edit operations.
- Moderators can remove content and suspend or terminate an account with an audit record.
- Published support contact and moderation policy are reachable from inside the app.
- The final physical-device recording demonstrates reporting and blocking using two test accounts.

### App Review notes after implementation

Use wording similar to:

> WanderBunnies includes private collaborative user-generated content. Each post, media item, and message has an in-app Report action. Users can block and unblock accounts from the content/profile menu and Account settings. Blocking is enforced by the server across direct messaging, invitations, following, and other direct interactions. New text and media are filtered before publication. Reports enter a monitored moderation queue, and the support contact and moderation policy are available in the app. The attached physical-device recording demonstrates these controls using test accounts.

Do not use that statement until every described control exists in the submitted build.

## Final owner checklist

- [ ] Replace all owner-input fields.
- [ ] Confirm tested device models, OS versions, and submitted build numbers.
- [ ] Provide a durable reviewer account with seeded Premium data.
- [ ] Verify the external-service list against production configuration.
- [ ] Implement and test pre-post filtering, in-app reporting, and account blocking.
- [ ] Staff and document the moderation response process.
- [ ] Confirm iOS payment and external-link compliance for digital Premium features.
- [ ] Retain provider agreements and dataset licenses.
- [ ] Record the final video on a physical device running the latest public OS.
