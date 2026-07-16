# GetYourGuide Phase 6 operations and rollout

Phase 6 completes the operational guardrails for the optional integration. The
general API admin console now exposes the `GETYOURGUIDE` limiter/cost provider,
feature state, configuration presence, cache-permission state, provider usage,
health, latency, retry/429 counts, cache fresh/stale/negative/miss counts,
suppression reasons, and consented click counts. It never exposes tokens,
partner credentials, raw traveler text, or personal identifiers. Affiliate
revenue and commission remain explicitly owned by a separate revenue
dashboard.

The feature flag `getyourguide_activity_suggestions` is the kill switch. It is
seeded disabled and is checked by candidate descriptor issuance, the redirect,
and Partner API calls. Disabling it removes the optional CTA/redirect behavior
without modifying or invalidating saved itinerary data. The ordinary activity
rows and exports remain usable; no provider placeholder is rendered.

## Controlled rollout

1. Keep the flag disabled and validate the admin status card, limiter counters,
   cache policy, disclosure, and ordinary offline/missing-configuration UI.
2. Enable for internal canary accounts only after the partner contract, quota,
   endpoint, locale, and written caching permission are recorded. Keep
   per-generation/day lookup budgets conservative.
3. Expand to a small cohort after reviewing a human sample for destination,
   timing, mobility, budget, and must-see relevance. Monitor redirect failures,
   429s, p95 latency, cache behavior, suppression reasons, and disclosure
   visibility.
4. Broaden enablement only when quality and operational thresholds remain
   healthy. Disable the flag immediately on broken redirects, privacy/terms
   concerns, provider instability, or misleading matches.

The rollback procedure is to disable the feature flag, then set Partner API
lookup budgets to zero. Existing trips continue to render normally, while new
descriptor/API work fails closed.
