# EU and UK Representative Assessment (GDPR Art. 27 / UK GDPR Art. 27)

Status: **DRAFT for counsel review.** Records the operator's current decision and the analysis behind it.
Prepared: October 8, 2026. Controller: Tristan Duerk (WanderBunnies). Contact: support@wander-bunnies.com.

## Current decision

**The EU/EEA and UK are targeted markets, and no Art. 27 representative is appointed yet** (operator decision, October 8, 2026). This document records why that position needs counsel review and what would change it. Public notices must not claim that a representative exists.

## Facts

- The controller is established outside the EU and UK (US). There is no EU or UK establishment.
- Services are offered to people in the EU/EEA and UK: the privacy notice has GDPR sections and EU transfer language, and the site publishes an EU consumer withdrawal form and a Digital Services Act content-moderation page. Under GDPR Art. 3(2)(a) and the EDPB's targeting criteria, these indicate **intent to offer services** in those markets.
- Processing is continuous (accounts, trips, collaboration), not one-off. It includes travel dates, group relationships and, optionally, imported email or financial data. Optional analytics would add behavioral observation (Art. 3(2)(b)).

## The exemption (Art. 27(2)(a))

No representative is required if processing is **occasional**, does not include large-scale special-category or criminal-offence data, and is unlikely to result in a risk to individuals' rights.

| Condition | Assessment |
|---|---|
| Occasional | **Likely not met.** The service processes EU/UK users' data continuously as its core function. |
| No large-scale special-category data | Likely met: none is intentionally processed. |
| Unlikely to result in risk | Uncertain: travel dates and group data carry some risk (see the [DPIA](analytics-dpia.md), R1). |

**Draft conclusion:** because the exemption requires *all* conditions and "occasional" is likely not met, the exemption probably does **not** apply while EU/UK users are targeted. **[Counsel to confirm.]** User count is not a statutory threshold.

## Options

1. **Appoint representatives** (commercial EU and UK representative services typically cost a few hundred to low thousands of dollars a year per region). Then publish their details in the privacy notice.
2. **Stop targeting** the EU/EEA and UK: remove EU-specific offering signals, don't market there, and document the decision. Existing EU/UK users still need a plan.
3. **Keep the current position** pending counsel review. This accepts the regulatory risk of operating without a required representative. That risk exists for the whole service, not only analytics.

## Recommendation and gate

Get counsel's view before **enabling optional analytics for EU/UK users** and before any EU/UK marketing. Until that review closes, the analytics canary can be limited to non-EU/UK users, or held entirely.

## DPO

A DPO is required only where core activities involve regular and systematic monitoring of individuals on a large scale, or large-scale special-category processing (Art. 37). Opt-in, first-party, small-scale analytics does not appear to meet that threshold. **Draft conclusion: DPO not required. [Counsel to confirm.]**

## Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Controller | Tristan Duerk | | |
| Counsel | | | |
