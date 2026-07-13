# GetYourGuide Phase 2 implementation

Phase 2 adds deep-link descriptors without making Partner API calls. An authenticated
`POST /api/affiliate/getyourguide/descriptor` validates the Phase 1 candidate and
returns an opaque AES-256-GCM descriptor. The partner ID, allowlisted hosts/paths,
feature flag, and signing key remain server-side. The descriptor expires using the
`getYourGuide.redirectTokenTtlMinutes` setting (10 minutes by default).

The browser follows `GET /api/affiliate/getyourguide?token=...`. The server validates
the authenticated token, feature flag, expiry, and current allowlist, strips all
client query/hash values, adds only the configured `partner_id`, and returns a 302.
Malformed, disabled, unconfigured, or disallowed requests return the neutral
`AFFILIATE_LINK_UNAVAILABLE` response so clients can omit the CTA. Redirects are
throttled through the existing `HTTP_RATE_LIMIT` accounting (`redirectPerMinutePerIp`
and `redirectPerDayPerAccount`).

Click telemetry is intentionally minimal: `getyourguide_affiliate_click` is emitted
only when `X-Analytics-Consent: granted` is present, with a fixed `kind` label and
no activity text, token, partner ID, IP address, or personal data. It uses the
existing in-process metric retention/aggregation and does not create a Firestore
event. The client must continue to render the ordinary activity when this route is
unavailable; Phase 3 owns that UI behavior.

No GetYourGuide Partner API request or response caching is enabled in this phase.
