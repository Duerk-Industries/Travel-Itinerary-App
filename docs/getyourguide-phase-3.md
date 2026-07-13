# GetYourGuide Phase 3 implementation

The app now uses `app/utils/getYourGuideLinks.ts` as the client boundary. It
mirrors the Phase 1 display gates, requests a server descriptor asynchronously,
validates the opaque response and expiry, and never constructs a GetYourGuide
partner URL. A small in-memory cache and single-flight map prevent duplicate
descriptor requests while a screen is rendering.

`GetYourGuideCta` is mounted in the Activities tab and Overview activity rows.
It renders nothing until a valid descriptor arrives, and also renders nothing
for offline, feature-disabled, malformed, unauthorized, or unavailable states.
The ordinary activity row therefore has no placeholder, spinner, error banner,
or layout dependency on GetYourGuide. The CTA is keyboard/screen-reader
accessible, uses the existing web new-tab/native URL opener, and includes the
affiliate disclosure adjacent to the link.

The export helper `formatGetYourGuideExportDisclosure` provides the same
disclosure text for future PDF/email renderers. It returns an empty string for
missing or invalid descriptors, so exports cannot contain a provider
placeholder. No PDF/email renderer currently exists in the app; Phase 4/5
export work should call this helper only when it has a valid server descriptor.
