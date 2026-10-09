# Analytics Upgrade: Sign-off Packet

Status: **prepared October 8, 2026, nothing signed yet.** This packet gathers every decision and signature the [manual follow-ups](../analytics-manual-followups.md) need, so each one can be done in a single sitting. It also has ready-to-send drafts for the user notification and the App Review note.

Engineering can't sign, decide or send any of this. Each item says who owns it, what to read first, what to decide, and where to record the result. After you record an item, tick its checkbox in the follow-ups. The release gate (`npm run check:analytics-release -- --strict`) reads those checkboxes.

Optional analytics and detailed diagnostics stay off until sections A–C below are complete. Those are the follow-ups' §1–§4.

## A. Controller decisions (Tristan Duerk)

### A1. Operator confirmation

The Terms, privacy notice, withdrawal form and content-moderation page now name Tristan Duerk as the operator, replacing Bryan Duerk. This changes the party users contract with.

> I, Tristan Duerk, confirm that I operate WanderBunnies as an individual trading under that name. From version 3.0 of the Privacy Notice (effective October 8, 2026) I am the controller of the personal data described in it and the contracting party under the Consumer Terms.
>
> Signed: ______________________  Date: ____________

### A2. Operator address

Every legal page lists **4 Dickinson Circle, Shrewsbury, MA 01545, USA** as the business address.

☐ Correct as published  ☐ Change to: ________________________________ (Engineering then updates `docs/legal-document-inputs.md` and regenerates the pages)

### A3. EU and UK representatives (GDPR Art. 27 / UK GDPR Art. 27)

Read the [representative assessment](eu-uk-representative-assessment.md) first. Its draft conclusion is that the "occasional processing" exemption probably does **not** apply while the app targets EU and UK users. Choose one:

| Option | What it means in practice | Effect on analytics |
|---|---|---|
| ☐ **Appoint representatives** in the EU and UK | Contract a representative service and add its details to §1 of the privacy notice and the store listings. | The Europe exclusion in the rollout can be lifted once counsel agrees. |
| ☐ **Stop targeting the EU and UK** | Remove EU/UK storefronts or availability, and stop EU-language or EU-pricing marketing. Existing EU/UK users are still covered by GDPR. | Keep `excludeEurope` on. |
| ☐ **Counsel concludes the exemption applies** | Counsel records the reasoning in the assessment. | Per counsel. |

Decision: ____________________  Counsel: ____________________  Date: ____________

Until this is decided, keep every analytics rollout on **Exclude Europe** (the default).

### A4. DPIA and legitimate-interests assessment

Read the [DPIA](analytics-dpia.md), and send the items marked **[Counsel]** for review before signing. Record the decision in the DPIA's own §8 table and the Appendix A table; this packet doesn't duplicate them.

The DPIA's conditions say optional collection must not start until measures M1, M2, M3, M5, M7, M9 and M10 are implemented **and verified**. The verification evidence is section C below.

### A5. Publish privacy notice 3.0 and notify users

☐ Approve publication of [privacy notice 3.0](privacy-policy.md) and send the notification in **D1** (email) and **D2** (in-app) once the release is deployed.

Approved: ______________________  Date: ____________

## B. Product sign-off

### B1. Event and metric dictionary v1

Read the [dictionary in the Phase 0 record](../analytics-phase-0.md#initial-event-and-metric-dictionary) and the event registry (`packages/analytics/src/registry.ts`). The registry is the only list of events and properties that can be collected; anything not in it is rejected by the server.

Since the dictionary was drafted, task events also cover **imports** (CSV, document, file upload and Gmail), **invites** (trip sharing and group members), **item add/edit** on every item type, and **cancelling trip creation**. Properties are limited to the task and feature names and a coarse failure category; email addresses, file contents and error messages are never sent.

☐ Approve dictionary v1 as implemented  ☐ Approve with changes: ________________

Product owner: ______________________  Date: ____________

## C. Operations verification record

Record evidence (a screenshot location, ticket or email date) rather than just "done".

| # | Check | Owner | Result | Evidence | Date |
|---|---|---|---|---|---|
| C1 | `support@wander-bunnies.com` send/receive test: send from an outside address, reply, and confirm both arrive | Operations | | | |
| C2 | Sentry project data retention set to **30 days**; data region recorded | Operations | Region: | | |
| C3 | Sentry quota alert set | Operations | | | |
| C4 | $100/month canary budget created in Cloud Console (see the follow-ups §3 for scope) | Operations | Budget name: | | |
| C5 | Production deployed from this branch; new flags seeded **disabled**; legal URLs resolve | Engineering | Revision: | | |
| C6 | `npm run check:analytics-release -- --strict` passes | Engineering | | | |
| C7 | `npm run smoke:analytics -- --confirm` with a dedicated internal test account (the last step erases its analytics data) | Engineering | | | |
| C8 | Device proxy capture (web, iOS, Android): no optional traffic before consent or after withdrawal | Mobile lead | | | |
| C9 | Xcode Privacy Report matches `ios.privacyManifests`; merged Android manifest has no `AD_ID` | Mobile lead | | | |
| C10 | App Store Connect App Privacy and Google Play Data safety updated from the [review packet §8](../app-store-review-packet.md) | Mobile lead | | | |

### C11. Processor agreements and transfer mechanisms

One row per processor. "Transfer mechanism" is normally the EU–US Data Privacy Framework (check the vendor's listing at dataprivacyframework.gov) or the vendor's Standard Contractual Clauses in its DPA. Store copies of each signed or accepted DPA outside the repository, and note the location here.

| Processor | Used for | DPA accepted (date, how) | Transfer mechanism | API data retention / zero-retention | Where the copy is kept |
|---|---|---|---|---|---|
| Google Cloud / Firebase | Hosting, database, storage, logging | | | n/a | |
| Sentry | Error and diagnostics reporting | | | 30 days (C2) | |
| OpenAI | AI features | | | | |
| Anthropic | AI features | | | | |
| Google Gemini | AI features | | | | |
| Other enabled AI providers: ________ | AI features | | | | |
| Stripe | Payments | | | n/a | |
| Plaid | Bank transaction import (optional) | | | n/a | |
| Mailgun / SMTP provider | Email | | | n/a | |
| Expo | Push notifications, app updates | | | n/a | |
| Unsplash | Destination images | | | n/a | |
| SerpAPI | Search results | | | n/a | |
| GetYourGuide | Activity inventory | | | n/a | |

When this table is complete, copy the recipients and transfer columns into the [draft processing register](../analytics-phase-0.md#processing-register-draft-ropa).

## D. Ready-to-send drafts

These are drafts for Tristan, and for counsel if needed. Send them only after the release containing privacy notice 3.0 is live.

### D1. Email to existing users

**Subject:** We've updated the WanderBunnies Privacy Notice and Terms

> Hi {first name},
>
> We've updated our Privacy Notice (version 3.0) and Consumer Terms, effective {date of deployment}. Here's what changed:
>
> - **Who runs WanderBunnies.** WanderBunnies is operated by Tristan Duerk, who is now named as the operator and data controller. Privacy questions go to support@wander-bunnies.com.
> - **New optional analytics and diagnostics, off unless you turn them on.** You can choose to share product usage analytics, such as which features you use and whether tasks succeed, and detailed crash diagnostics. Both are off unless you opt in under Account → Privacy, and you can change your mind at any time. We never record your trip contents, messages, location, or anything from Gmail or connected bank accounts for analytics.
> - **Age requirement.** Accounts are for people aged 16 or older everywhere.
> - **More control.** You can export your data or delete your analytics data yourself from Account → Privacy. We honor Global Privacy Control signals.
> - **Clearer details** on how long we keep data, who our service providers are, and how data is transferred.
>
> Read the full notice at https://wander-bunnies.com/privacy and the Terms at https://wander-bunnies.com/terms. If you have questions, reply to this email or contact support@wander-bunnies.com.
>
> — Tristan, WanderBunnies

Notes for sending:
- This is a service message. Send it to every active account, including those that have opted out of marketing email.
- Don't add tracking pixels or link tracking.
- Check with counsel whether the operator change needs users to accept the Terms again, rather than just be notified.

### D2. In-app notice (one-time banner)

> **We've updated our Privacy Notice and Terms.** WanderBunnies is now operated by Tristan Duerk, and you can choose optional analytics and diagnostics (both off unless you turn them on) in Account → Privacy. [Read what changed]

The "Read what changed" link goes to `/privacy`. The banner must not ask for analytics consent itself. Consent stays in Account → Privacy, where both choices are shown separately and default to off.

### D3. App Review note: date-of-birth prompt (for when `age_gate_enforcement` is on)

> **Age confirmation after sign-in.** WanderBunnies requires users to be 16 or older (Privacy Notice §13). After a user signs in for the first time, including with Sign in with Apple, the app asks once for their date of birth. We don't ask for any other personal information at this step, and the date of birth is used only to confirm eligibility. On devices where Apple's Declared Age Range confirms the user is 16 or older, the prompt is skipped. The demo account provided for review has already completed this step. To see the prompt, create a new account with email and password.

Check this against the build before submitting. Include the last sentence only if the reviewer account really has completed the prompt, and keep the Declared Age Range sentence only if `APPLE_DECLARED_AGE_RANGE_ENABLED=1` was set for the build.

## E. Go/no-go for the first analytics canary

Turn on `analytics_collection_enabled` with rollout mode **internal** only when all of these are true:

- [ ] A1–A5 and B1 recorded above.
- [ ] C1–C11 recorded, with evidence.
- [ ] `npm run check:analytics-release -- --strict` exits 0.
- [ ] The rollout panel shows **Exclude Europe** on for both purposes, unless A3 says otherwise.

Approved for canary: ______________________ (controller)  Date: ____________

To move from internal to a percentage or to everyone, repeat the C7 smoke test and review a week of Admin → Analytics → Reliability first. The steps are in the [runbook](../analytics-runbook.md).
