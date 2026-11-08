# Shared screen data cache

[README](../README.md) · [Architecture](architecture.md) · [Test guide](../TEST_PLAN.md)

## Current scope

The app shell owns an authenticated TanStack Query client for each account, backend environment and session. Packing lists are the first migration: trip and personal lists persist locally; admin defaults use memory only. Other screens retain their existing fetch logic until migrated. This is cached viewing with online writes, separate from the existing offline trip download and pending-expense queues.

## Behavior

- A screen reads existing memory/disk data first and revalidates on opening. Simultaneous reads for the same key are deduplicated.
- Trip policy: 30-second stale time, one-minute refresh while an enabled query is active/visible, plus stale-data refresh on app resume, browser focus and reconnection. Editing/saving pauses automatic refreshes.
- Reference policy: one-hour stale time. Sensitive policy: zero stale time, memory only. A screen still has to opt into the shared hook and choose a policy; no global fetch interception is used.
- Background network/server failures preserve the saved view with an error and Retry control on packing lists. Unauthorized/forbidden/missing GET responses discard the affected cached view. Cached data never grants server access.
- Packing writes cancel preceding reads. Only server-confirmed responses/checkmarks enter the persistent cache. Failed checkmarks revert; repeated taps on an in-flight cell are ignored. Personal/default writes invalidate related packing queries.
- Cache keys include resource, variant and trip inside an account/environment client. No JWT or HTTP authorization header enters the persisted payload.

## Persistence and lifecycle

`app/cache/screenCache.ts` stores a versioned snapshot of explicitly opted-in successful queries. Memory retains up to 80 entries; active queries are retained even when that limit is exceeded. Disk retention is 24 hours, with at most 40 saved queries and a two-million-character serialized limit. Oversized or unserializable snapshots are skipped. Expired/corrupt/unsupported snapshots are disposable; the online request remains available. Storage is best effort and does not acknowledge an edit as saved.

Browser builds use private IndexedDB storage; service-worker response caches are not involved. Native builds use the existing SQLCipher + device-only SecureStore-key machinery, with a separate `wb.screen-cache.v1.*` namespace. Logout cancels/removes memory entries, waits for queued disk writes and erases that account/environment snapshot and native key. Pending financial writes and downloaded-trip snapshots remain separate.

The screen cache does not add an offline login/unlock path. Existing session and offline-access checks remain in charge of whether the app can be opened. A server restart, first install, eviction or cleared device storage still requires a full network load.

## Migrating another screen

1. Reuse canonical models from `server/src/types.ts`. Define and validate the actual response shape at the network/storage boundary.
2. Use `useScreenQuery` inside `ScreenCacheProvider`, with a stable key containing every request dimension (trip, filters, pagination, etc.). Use `screenQueryKey(resource, id)` for simple resources or a longer array for variants.
3. Pass an abort-aware fetcher. Throw `ScreenRequestError` with the response status so rejected access removes saved data. Keep credentials in the fetcher, outside the key and data.
4. Render `data` while `isFetching`; distinguish initial loading from updating. Preserve a clear transient error/retry state and remove local copies on authorization errors.
5. Keep form drafts outside cached server data. Set `paused` during editing; use `runWrite` for the complete save, including response parsing. `publish` the validated confirmed response, or supply dependent query-key prefixes to invalidate after the operation. If a mutation rejects access, call `forget` and clear the screen's draft/view state.
6. For a successful expense save, for example, invalidate that trip's expense, ledger and overview query prefixes once those screens are migrated. Do not persist optimistic or queued changes as confirmed server data.
7. Test remount/disk hydration, transient failure, access rejection, account/environment/trip switches, edit-vs-refresh races, mutation completion after navigation and logout during persistence.

Use `app/components/PackingListTable.tsx` as the first consumer. Query hooks remain co-located with their feature's request logic; the cache handles lifecycle, deduplication and persistence.

## Verification

```sh
npm --prefix app test -- --runInBand screenCache.test.ts useScreenQuery.test.tsx packingListTable.test.tsx nativeEncryptedStorage.test.ts
npm --prefix app run typecheck
```

Manual rollout: open a trip's packing list, navigate away/back on a slow connection, and verify the saved list appears while updating. Change a checkmark, reopen, and verify the confirmed value. In another authorized session change the list and confirm refresh sees it. Check phone editing/keyboard behavior, logout/account switching and native relaunch. An offline save should fail visibly and roll back, not claim to be queued.
