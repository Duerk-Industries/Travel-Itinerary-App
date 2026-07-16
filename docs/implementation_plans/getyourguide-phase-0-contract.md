# GetYourGuide Phase 0 Partner Contract Record

Verified: 2026-07-13

This record is the implementation gate for the optional GetYourGuide integration. It records public
documentation findings; the partner portal/account terms remain authoritative for this specific account.
No Partner API call is enabled by Phase 0.

## Verified public requirements

Sources reviewed:

- [Deep links 101 — GetYourGuide Partner Resource Center](https://partner.getyourguide.support/hc/en-us/articles/13981115676061-Deep-links-101), updated 2024-07-03.
- [Unique-link troubleshooting — GetYourGuide Partner Resource Center](https://partner.getyourguide.support/hc/en-us/articles/13830964721693-Trouble-with-unique-link-not-found-error), updated 2025-06-05.
- [GetYourGuide Partner API getting started](https://github.com/getyourguide/partner-api-spec/wiki/Getting-started), last modified 2026-03-26.
- [GetYourGuide Partner Terms and Conditions](https://www.getyourguide.com/c/partner-terms-and-conditions/), reviewed 2026-07-13.

Findings:

- GYG provides a partner link builder. Its documented flow accepts a GYG URL or search term, requires a
  placement parameter, and supports optional campaign parameters. Manual examples use a `partner_id`
  tracking parameter. The implementation must use the account's generated link or verified parameter
  format rather than guessing one.
- Deep-link attribution uses a GYG partner cookie. The public deep-link guide says the cookie remains active
  for 31 days and that language/domain and currency are selected from the user's location.
- The public Partner API specification describes HTTPS JSON requests using an `X-ACCESS-TOKEN` and
  `Accept: application/json`. GET requests require `currency` and `cnt_language` query parameters.
- The public API getting-started guide states a default limit of 130 calls/minute; after the limit,
  subsequent calls are blocked for five minutes. It also warns against scraping the API to cache its output
  and says traffic is monitored against bookings. This is not an account-specific quota and must not be
  treated as permission to exceed a lower portal quota.
- The public terms say API credentials may be granted at GYG's discretion and must be kept secure. They
  require correct, regularly updated content, disclosure of the relationship, and prohibit unauthorized
  copying, scraping, republishing, or caching of GYG platform content. They also prohibit implying that
  this app is an official or endorsed GYG site.

## Phase 0 decisions

- Phase A will use a server-owned redirect and verified deep-link builder output. It will not call the
  Partner API or cache GYG content.
- The partner ID remains server configuration: `GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID`. It is never logged,
  placed in source fixtures, or bundled into the normal mobile build.
- The feature seed `getyourguide_activity_suggestions` is disabled by default and the runtime helper fails
  closed when the partner ID is absent or the database flag is not explicitly enabled.
- Phase 0 caching settings are limited to internal descriptor/rate-control guardrails. API response caching
  is disabled until GYG gives written permission and the account-specific terms are recorded here.
- If Phase B is approved, configure the account-specific API quota in `server/config/api-limits.yaml` with
  at least 20% headroom. The public 130 calls/minute figure is a ceiling/reference, not a production
  default. Add `GETYOURGUIDE` to the general limiter and cost estimator only when the API is actually used.

## Open blockers before Phase B

- Account-specific API approval, endpoint/version, quota, burst behavior, and billing terms.
- Exact placement/campaign parameter names and whether generated search links are commission-eligible.
- Written permission, if any, for storing product metadata, prices, images, availability, or translations;
  otherwise do not cache or persist GYG content.
- Final legal disclosure text and analytics consent/retention policy.
- Authorized test credentials and a non-production smoke-test procedure.

