# Shared screen data cache

[README](../README.md) · [Architecture](architecture.md) · [Test guide](../TEST_PLAN.md)

## Current scope

The authenticated TanStack Query client now backs both declarative queries (`useScreenQuery`) and existing fetch-based screens (`screenFetch`). The latter is an explicit import in app screens/helpers; it does **not** replace the platform fetch implementation. The permission-denied interceptor stays on the raw transport to avoid recursive wrapping.

| Surface | Cache behavior |
|---|---|
| Trip/home directories, transfers, lodging, activities, car rentals | Account/environment/trip-scoped saved viewing, immediate cached pass, fresh normalized response |
| Expenses, ledger and cost report | Persisted server expense/payment and booking lists; derived totals rebuild from those lists; fresh account entitlements gate financial reads |
| Overview itinerary/day details, trip blog, followed-trip reading | Persisted GET data, query/page parameters in keys, guarded callbacks and background revalidation |
| Personal/trip packing lists | Declarative query, confirmed mutation updates and local persistence |
| Family/fellow travelers and selected traits | Saved account-scoped lists; authentication and demographics remain fresh |
| Maps, discovery, templates and optional reference content | Saved eligible JSON responses; catalogs use a one-hour freshness window; capability checks stay fresh |
| Import review/jobs/assignment queues | Memory-only saved viewing; access configuration stays fresh and writes recheck the server |
| Admin reports, account entitlements/permissions, billing, notifications, bank imports | Fresh requests with deduplication where eligible; no persisted sensitive snapshots and no stale fallback |
| Chat, public unauthenticated pages, files/streams, exports, signed URLs, authentication and internal callbacks | Existing live/socket/browser/file behavior; bypass private response caching |

This is cached viewing with online writes, separate from explicit offline trip downloads and pending-expense queues. The cache does not add an offline editing queue or an offline login path.

## Behavior

- `screenFetch` uses keys containing the full API path and query string inside the authenticated account/environment client. It deduplicates concurrent reads and gives each caller its own response body. Cached callbacks receive copies, never mutable cache-owned objects.
- `onCached` applies a saved server value immediately; normal callers still await/apply the fresh response. A registered current view can receive later foreground/reconnection/retry updates without remounting its form. `isCurrent` guards navigation, filters, trip/account changes and unmount. Editing drafts remain separate from server-data setters. Open dialogs and dirty account/trait forms pause background publication/refresh; reads resume after the last editor closes or saves.
- The provider refreshes stale current views on resume, browser focus, reconnection and a one-minute foreground interval. Declarative packing queries also retain their 30-second freshness policy. Ordinary HTTP trip/account/blog reads revalidate on each explicit read; reference reads can reuse a fresh one-hour entry.
- Temporary network/5xx failures preserve confirmed content. The shared saved-information notice explains a failed refresh and offers Retry. Access denials (401/402/403/404) remove the affected saved response and clear its view, including during background refreshes. Unknown URLs and `cache: 'no-store'` GETs bypass the cache. Explicit offline downloads use fresh-only requests, including their shared normalization helpers, so a failed download cannot renew offline access using a stale screen response.
- Successful writes mark related query categories dirty and exclude their old bodies from both preview and persistence until a new read succeeds. Booking/expense/payment changes invalidate trip/financial data; blog writes invalidate blog data; account, billing, imports and admin changes invalidate their dependent categories. Read-only POST operations such as image batches and parse/preview requests do not cancel trip reads.
- A write cancels affected older reads. One caller aborting its own request does not cancel a deduplicated request still needed by another view. Packing lists publish confirmed results directly and invalidate other dependent packing views, avoiding an unnecessary GET of the just-saved list.
- No JWT, authorization header or request callback enters persistent query keys/data. Account access, feature flags and tier checks remain server-authoritative.

## Persistence and lifecycle

`app/cache/screenCache.ts` stores a versioned snapshot of last confirmed query data (also preserving it after transient refresh failures). Memory retains up to 80 entries; active queries are retained even when that limit is exceeded. Disk retention is 24 hours, with at most 40 saved queries and a two-million-character serialized limit. Oversized/unserializable entries are skipped individually so one large blog cannot prevent smaller lists from being saved. Expired/corrupt/unsupported snapshots are disposable; the online request remains available. Storage is best effort and does not acknowledge an edit as saved.

Browser builds use private IndexedDB storage; service-worker response caches are not involved. Native builds use the existing SQLCipher + device-only SecureStore-key machinery, with a separate `wb.screen-cache.v1.*` namespace. Logout cancels/removes memory entries, waits for queued disk writes and erases that account/environment snapshot and native key. Pending financial writes and downloaded-trip snapshots remain separate.

The screen cache does not add an offline login/unlock path. Existing session and offline-access checks remain in charge of whether the app can be opened. A server restart, first install, eviction or cleared device storage still requires a full network load.

## Maintaining screen integrations

New screens should prefer `useScreenQuery` with a required explicit policy and a validator using canonical models from `server/src/types.ts`.

Existing fetch-based features use `screenFetch` (or `requestJson`, which delegates to it). The fetch helpers stay co-located with their feature. Supply these options on a cacheable read:

- `onCached(data)`: validate/normalize and apply **server view data**, never a form draft.
- `isCurrent()`: false after the account/trip/filter changes or the component unmounts.
- `onUnavailable()`: clear an object-shaped view after rejected access. Array views also have an empty-array fallback, but an explicit handler is preferred.

`httpCachePolicy.ts` defines endpoint eligibility, shape discriminators, categories and write dependencies. Add policy cases before broad routes when an endpoint returns permissions, capabilities, private provider data, files or secrets. Never cache auth callbacks, one-time links or write responses as GET results. New mutations should identify dependent categories; read-only POST provider operations should explicitly bypass mutation invalidation.

For declarative consumers, keep drafts outside cache data, pause during edits, use `runWrite`, and `publish` validated confirmed responses. For imperative consumers, existing success handlers apply the response; follow-up reads ignore dirty pre-save snapshots. Test navigation and pending-write races, not just a single successful fetch.

## Verification

```sh
npm --prefix app test -- --runInBand screenFetch.test.ts screenCache.test.ts useScreenQuery.test.tsx packingListTable.test.tsx nativeEncryptedStorage.test.ts
npm --prefix app run typecheck
```

Manual rollout: open each trip-item and financial view, switch trips/accounts, revisit on a slow connection, and confirm saved rows appear before the fresh response. Check itinerary/blog pagination and editing, member-access rejection, stale-information Retry and mutation-dependent totals. Open a trip's packing list, navigate away/back on a slow connection, and verify the saved list appears while updating. Change a checkmark, reopen, and verify the confirmed value. In another authorized session change the list and confirm refresh sees it. Check phone editing/keyboard behavior, logout/account switching and native relaunch. An offline save should fail visibly and roll back, not claim to be queued.
