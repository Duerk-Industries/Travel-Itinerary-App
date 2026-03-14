# Real-Time Sync Recommendation

## Status: Socket.IO implemented for chat and presence

**Update (2026-03):** Socket.IO has been implemented for the chat and presence features. See [docs/websockets-and-chat.md](./websockets-and-chat.md) for the complete implementation details.

Trip data changes (flights, lodgings, activities) still follow the request-response HTTP model described below. This document is retained as a reference for extending real-time sync to those areas.

---

## Original: HTTP-only state (pre-Socket.IO)

The app uses a pure request-response HTTP model for trip data updates. All data updates are user-initiated: a user's changes are only visible to other group members after those members manually reload the page or re-navigate to the affected tab.

This means:
- User A adds a flight → User B must reload the Transfers tab to see it.
- User A accepts an expense split → User B must reload the Ledger tab.
- The pending-invite modal only fires on page load (at login time), not when a new invite arrives while the app is open.

## Impact on E2E tests

The multi-user E2E tests in `multi-user-group.test.ts` previously used `GET /api/groups/invites` polling to detect invites. They have been updated to rely on the Socket.IO invite-modal push; the test simply waits for `getByTestId('invite-modal')` to appear.

## Recommended next upgrade: Server-Sent Events (SSE) for trip data

SSE is the lightest-weight option and works over standard HTTP/1.1 (no upgrade handshake required). It provides server-to-client push for one-directional event streams, which is all that is needed here.

## Recommended upgrade: Server-Sent Events (SSE)

SSE is the lightest-weight option and works over standard HTTP/1.1 (no upgrade handshake required). It provides server-to-client push for one-directional event streams, which is all that is needed here.

### Server-side change

Add a new route `GET /api/trips/:tripId/events` that:
1. Sets headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
2. Registers the response object in an in-process registry keyed by `tripId`.
3. On any mutation to a trip (transfer added, lodging edited, expense deleted, etc.), emits an event to all registered responses for that `tripId`.
4. Removes the response on client disconnect.

Example server event payload:
```
event: trip-updated
data: {"type":"transfer","action":"created","tripId":"abc123"}
```

### Client-side change

In `app/App.tsx`, after a trip is selected, open an `EventSource` connection:
```typescript
const source = new EventSource(`${backendUrl}/api/trips/${activeTripId}/events`, {
  headers: { Authorization: `Bearer ${userToken}` }, // via a polyfill if needed
});
source.addEventListener('trip-updated', () => refreshAllData());
```

On trip deselect / logout / component unmount: `source.close()`.

### E2E test improvement

Once SSE is in place, the multi-user tests can replace the polling loop with a direct assertion:

```typescript
// After User A creates a transfer, User B's page receives the event automatically
// and refreshes. No polling needed.
await expect(userBPage.getByText('OriginalAir')).toBeVisible({ timeout: 3000 });
```

## Alternative: WebSocket

If bi-directional messaging is needed in the future (e.g. collaborative cursor or presence indicators), Socket.IO or the native `ws` library would be more appropriate. For the current use case (trip data updates), SSE is simpler and avoids a new dependency.

## Alternative: Polling

As a minimal step, a `setInterval`-based poll of the current trip's data every 30 seconds would improve the collaborative experience without requiring a persistent connection. This is easy to implement but less responsive than SSE.

## Decision criteria

| Approach | Latency | Server complexity | Client complexity | Connection overhead |
|---|---|---|---|---|
| Manual reload (current) | User-driven | None | None | None |
| Polling (30 s) | Up to 30 s | Minimal | ~10 LOC | Standard HTTP per poll |
| SSE | < 1 s | Low (one registry map) | ~20 LOC | 1 persistent connection per trip |
| WebSocket | < 100 ms | Medium | ~40 LOC | 1 persistent connection |

**Recommendation:** Implement SSE first. It directly addresses the collaborative viewing problem with minimal server infrastructure change and no new npm dependencies.
