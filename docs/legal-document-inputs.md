# WanderBunnies Legal Document Input Worksheet

Use this worksheet to supply the facts needed to replace every bracketed placeholder currently present in `app/public/privacy.html`, `app/public/terms.html`, and `app/public/withdrawal.html`.

Enter a final, verified answer under each **Your input** prompt. Do not publish the legal pages while any required item remains unresolved. Counsel should review the completed answers before they are inserted into the public documents.

> **Status note (2026-07-17):** All bracketed placeholders described above have already been resolved in the current HTML — `privacy.html`, `terms.html`, `withdrawal.html`, `cookies.html`, and `content-moderation.html` contain zero remaining `[...]` markers (verified by direct search). The section above describing "facts needed to replace placeholders" is now historical context for how the values below were chosen. A gap-analysis pass against the live application (see new items below) found several open items that were never resolved despite the placeholder text being filled in — several answers below were entered as defaults (e.g., "NOT APPLICABLE") without the documented legal determination the worksheet itself calls for. Treat those as still open, not resolved, until counsel actually reaches and records a conclusion.

## Business identity and contact details

### `[LEGAL ENTITY NAME]`

**Your input:** Bryan Duerk

**What it represents:** The full registered legal name of the person, company, or other entity that operates WanderBunnies and enters into contracts with users. Do not enter only the product name unless that is also the registered legal name.

**Used in:** Privacy Notice, Consumer Terms, and Withdrawal Form. The same value should be used consistently everywhere.

### `[FULL ADDRESS]`

**Your input:** 4 Dickinson Circle Shrewsbury, MA 01545
**What it represents:** The operator's complete registered or principal business address, including street, city, state/province or region, postal code, and country. Confirm whether a separate service-of-process or consumer-complaints address is legally required.

**Used in:** Privacy Notice and Consumer Terms.

### `[ADDRESS]`

**Your input:** 4 Dickinson Circle Shrewsbury, MA 01545

**What it represents:** The postal address to which a consumer may send a withdrawal notice. This will normally be the same as `[FULL ADDRESS]`, but it should be confirmed rather than assumed.

**Used in:** Withdrawal Form.

### `[SUPPORT CONTACT]`

**Your input:** bryan.duerk@gmail.com

**What it represents:** An additional customer-support contact method, such as a support URL, telephone number, or mailing address. If `support@wander-bunnies.com` is the only support contact, confirm that this placeholder should be removed rather than leaving an empty alternative.

**Used in:** Consumer Terms.

### `[PRIVACY EMAIL]`

**Your input:** bryan.duerk@gmail.com

**What it represents:** The monitored email address for privacy questions and data-subject requests. It may be `support@wander-bunnies.com` if that mailbox is trained and monitored for privacy requests; otherwise provide a dedicated address.

**Used in:** Privacy Notice.

### `[ACCESSIBILITY CONTACT]`

**Your input:** bryan.duerk@gmail.com

**What it represents:** The monitored email address, telephone number, or accessible web form for reporting accessibility barriers and requesting assistance. If the general support email is used, confirm that it is equipped to route accessibility requests.

**Used in:** Consumer Terms.

### `[ACCESSIBILITY RESPONSE TARGET]`

**Your input:** "acknowledge within two business days and provide a substantive response within ten business days."

**What it represents:** The service-level target for acknowledging and responding to accessibility reports, for example, "acknowledge within two business days and provide a substantive response within ten business days." Use only a target the business can operationally meet.

**Used in:** Consumer Terms.

## Privacy governance

### `[EU REPRESENTATIVE NAME AND CONTACT / NOT APPLICABLE — CONFIRM]`

**Your input:** NOT APPLICABLE

**What it represents:** If the operator is outside the EEA but GDPR Article 27 requires an EU representative, provide the representative's legal name, address, email, and applicable member state. Otherwise, obtain and record counsel's conclusion that the requirement does not apply and replace the placeholder with an accurate statement or remove the line.

**Used in:** Privacy Notice.

### `[DPO NAME AND CONTACT / NOT APPLICABLE — CONFIRM]`

**Your input:** NOT APPLICABLE

**What it represents:** The Data Protection Officer's name or function and direct contact details if a DPO has been appointed or is legally required. If no DPO is required or appointed, confirm that fact and remove or revise the line.

**Used in:** Privacy Notice.

### `[SUBPROCESSOR LIST URL]`

**Your input:** ________________________________________________

**What it represents:** A stable public URL listing processors/subprocessors that handle personal data, their service purpose, processing location, and relevant international-transfer mechanism. The page and its contents must actually exist before this URL is published.

**Used in:** Privacy Notice.

### `[MINIMUM AGE — CONFIRM]`

**Your input:** 16

**What it represents:** The minimum age required to create and use an account. The answer must be consistent with the intended countries, contract-capacity rules, GDPR child-consent requirements, app-store ratings, age-screening design, and how parents provide children's travel information.

**Used in:** Privacy Notice and Consumer Terms. Use one consistent value and supporting rule.

## Subscription and cancellation

### `[EXACT CANCELLATION PATH]`

**Your input:** Account Settings > Subscription > Manage Billing > Cancel Subscription

**What it represents:** Step-by-step instructions describing where a customer cancels a subscription, such as "Account Settings > Subscription > Manage Billing > Cancel Subscription." Include separate Apple App Store or Google Play instructions if subscriptions can be purchased there.

**Used in:** Consumer Terms.

## Liability and disputes

### `[INSERT VALID LIABILITY CAP OR STATE “NO CAP FOR CONSUMERS WHERE PROHIBITED”]`

**Your input:** NO CAP FOR CONSUMERS WHERE PROHIBITED

**What it represents:** The proposed maximum aggregate liability and its calculation, with all mandatory exceptions. This must be drafted or approved by counsel for each relevant jurisdiction and must preserve non-excludable consumer rights, including liability that cannot lawfully be capped.

**Used in:** Consumer Terms.

### `[STATE/COUNTRY]`

**Your input:** Massachusetts, USA

**What it represents:** The governing-law jurisdiction chosen for the contract. Counsel must confirm that the clause preserves mandatory consumer protections and court rights in each consumer's country of residence.

**Used in:** Consumer Terms.

### `[ARBITRATION BODY, e.g., AAA or JAMS]`

**Your input:** AAA

**What it represents:** The arbitration administrator for the US-only arbitration provision. The completed terms should also identify the applicable rules, commencement method, fees, hearing location or remote process, opt-out procedure, small-claims exception, and consumer-law carve-outs.

**Used in:** Consumer Terms.

### `[INSERT]`

**Your input:** Bryan Duerk, 4 Dickinson Cir. Shrewsbury, MA 01545

**What it represents:** The operator's complete legal name and service address for notices and complaints. This should normally repeat `[LEGAL ENTITY NAME]` and `[FULL ADDRESS]`; replace the generic marker with those verified values.

**Used in:** Consumer Terms, complaints/contact section.

## Withdrawal-form template markers

### `[*]`

**Operator action:** Preserve only where required by the official statutory model form, or replace the generic model with a service-specific withdrawal form reviewed by counsel.

**What it represents:** An instruction to the consumer to select or delete alternatives such as "I/We," "my/our," goods/service, and ordered/received dates. It is not business information to be filled in once by the operator. If the form becomes an online form, replace these markers with clear fields and choices.

**Used in:** Withdrawal Form.

## Open items found in gap-analysis review (2026-07-17)

These were found by reading the live documents against actual application behavior (routes, env config, and UI), not by re-reading the placeholder-fill history above. None of these have bracketed placeholders in the HTML — they're substantive gaps the placeholder-fill pass didn't catch.

### AI subprocessor disclosure — RESOLVED 2026-07-18

**Your input:** Anthropic added to the named list in §4 alongside OpenAI and Google Gemini. **Z.ai deliberately omitted** — confirmed only used in testing, not routed for real user data, so no production disclosure or transfer-risk assessment needed for it at this time. If Z.ai is ever enabled for production traffic, this must be revisited (China transfer-risk concerns from the original entry would then apply).

**What it represents:** `privacy.html` §4 named only "OpenAI, Google Gemini, or other providers"; `server/.env` has four live, keyed AI providers. Anthropic is genuinely production-facing and is now named; Z.ai is not.

**Used in:** Privacy Notice §4 (AI-assisted features).

### Non-AI subprocessor disclosure gaps — RESOLVED 2026-07-18

**Your input:** Unsplash and SerpAPI added to the service-provider list in §6.

**What it represents:** `privacy.html` §6's service-provider list omitted two real, wired-up integrations: **Unsplash** (destination photography, `UNSPLASH_ACCESS_KEY`) and **SerpAPI** (discovery/search, used in `attractionsCatalogService.ts` and `costEstimatorService.ts`).

**Used in:** Privacy Notice §6.

### Subprocessor list URL — PARTIALLY RESOLVED 2026-07-18

**Your input:** `https://cloud.google.com/terms/subprocessors` — added to §7, explicitly scoped to Google Cloud's own subprocessors.

**What it represents:** This link only covers Google Cloud's subprocessors, not WanderBunnies' full set of service providers (Stripe, Mailgun, OpenAI, Anthropic, Sentry, GetYourGuide, Unsplash, SerpAPI are all outside Google Cloud's list). §7 still directs users to contact us by email for the complete picture. If a single comprehensive subprocessor page is wanted later, this item should be reopened.

**Used in:** Privacy Notice §7.

### EU representative (GDPR Art. 27) — needs an actual determination, not a default

**Your input:** ________________________________________________

**What it represents:** The original worksheet entry above records "NOT APPLICABLE" without the documented legal analysis the worksheet itself calls for. Given the app actively serves EU/EEA users (dedicated withdrawal-rights document, EU consumer carve-outs, GDPR rights sections all present) rather than processing EU data only "occasionally," Art. 27 may actually require a representative. Get and record a real determination before treating this as closed.

**Used in:** Privacy Notice §1.

### Cookie consent mechanism vs. actual app behavior

**Your input:** ________________________________________________

**What it represents:** `cookies.html` §3 promises consent will be requested "before enabling" optional diagnostics. No consent banner or gating mechanism exists anywhere in `app/`, and Sentry is confirmed already live in production without one. Either build a real consent gate for EU-located sessions before non-essential providers activate, or narrow the document's language to match actual (consent-free) behavior if counsel concludes Sentry qualifies for a strictly-necessary exemption.

**Used in:** Cookie Notice §3.

### Minors' data entered by adults (travelers, not account holders) — RESOLVED 2026-07-18

**Your input:** §11 now leads with "There are no minors as account holders," then adds a second paragraph clarifying that an adult account holder may enter travel information for a minor dependent/family member as a traveler, with the submitting adult responsible for authority and accuracy.

**What it represents:** `privacy.html` §11 previously only addressed minors as account holders ("not directed to children under 16"). The app clearly supports adults adding child family members as travelers with real travel/ID details (§2 already contemplates passport/ID uploads "unless the feature specifically requires it").

**Used in:** Privacy Notice §11.

### AI capture/evaluation data — separate retention category

**Your input:** ________________________________________________

**What it represents:** `ENABLE_RAW_AI_CAPTURE` / `AI_CAPTURE_BUCKET` persist raw AI request/response pairs (including full document content sent to providers) for debugging/QA — a distinct purpose and legal basis from user-facing itinerary/ingestion data. The retention table in §8 doesn't give this its own row; it's currently only implicitly covered by "Security, diagnostic, and audit logs." Add an explicit row and confirm the legal basis (likely legitimate interest — product improvement/QA).

**Used in:** Privacy Notice §8.

### Business structure (not a document-text fix)

**Note, not a worksheet item:** The controller is "Bryan Duerk, an individual" — a sole proprietorship, not an LLC or corporation. This is real personal-liability exposure for the operator, independent of anything fixable in the legal documents themselves. Flagging since it surfaced during this review; worth a conversation with counsel or an accountant about entity structure, separate from the documents.

### Arbitration clause vs. EU consumers — flagged for priority counsel review

**Note, not a worksheet item:** `terms.html` §17 already includes reasonable consumer carve-outs, but mandatory pre-dispute consumer arbitration is treated with hostility under EU unfair-contract-terms law (Directive 93/13/EEC), and several member states void it outright against consumers. This is the single highest-value clause to get in front of counsel rather than rely on the existing hedging language.

### DSA applicability — currently self-hedged, needs an actual answer

**Note, not a worksheet item:** `content-moderation.html` correctly hedges "applies only to the extent... fall within their legal scope," but whether trip-sharing counts as "dissemination to the public" under DSA Art. 3(k) (vs. private group communication outside DSA's hosting-service provisions) is answerable and shouldn't stay permanently open.

## Completion check

- [ ] Legal entity name is verified against formation or registration records.
- [ ] Business, service, privacy, support, and accessibility contacts are monitored.
- [ ] EU representative and DPO applicability have been documented.
- [ ] Minimum-age decision matches product controls and target countries.
- [ ] Subprocessor page and international-transfer information are live and accurate.
- [ ] Cancellation instructions have been tested on every sales channel.
- [ ] Liability, governing-law, and arbitration clauses have been approved by qualified counsel.
- [ ] Withdrawal form and online withdrawal process have been tested.
- [ ] Every occurrence of every placeholder has been replaced consistently in the public HTML files.

