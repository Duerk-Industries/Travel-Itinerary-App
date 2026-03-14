# WebSockets, Presence & Chat — WanderBunnies

## Overview

WanderBunnies uses **Socket.IO** for real-time communication between users who are viewing the same trip. Two features are built on this layer:

1. **Presence indicators** — colored avatar circles (with initials) that appear to the left of the user name in the top bar, showing other users currently active on the same trip.
2. **Trip chat** — a per-trip chat thread accessible via a FAB (floating action button) in the lower-right corner.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  packages/messaging/                        │
│  (shared types + event constants)           │
│   src/types.ts   src/events.ts              │
│   src/colors.ts  src/index.ts               │
└────────────────┬────────────────────────────┘
                 │  imported by
       ┌─────────┴──────────┐
       │ server/src/socket/ │   app/utils/socket.ts
       │  index.ts          │   app/components/
       │  authMiddleware.ts │     PresenceAvatars.tsx
       │  presenceManager.ts│     ChatButton.tsx
       │  chatHandler.ts    │     ChatPanel.tsx
       │  userHelper.ts     │   app/App.tsx
       └────────────────────┘
```

### `packages/messaging/` workspace

Shared TypeScript module (`@wanderbunnies/messaging`) containing:

| File | Purpose |
|------|---------|
| `src/types.ts` | `ChatMessage`, `MessageRead`, `PresenceUser`, `IncomingMessage` |
| `src/events.ts` | `CLIENT_EVENTS` and `SERVER_EVENTS` constants |
| `src/colors.ts` | `colorForUser()` and `initialsForName()` pure helpers |

### Server (`server/src/socket/`)

| File | Purpose |
|------|---------|
| `index.ts` | Creates Socket.IO `Server`, attaches CORS, registers auth middleware |
| `authMiddleware.ts` | Verifies JWT from `socket.handshake.auth.token`; attaches `socket.data.user` |
| `presenceManager.ts` | In-process presence store; 15-second grace period on disconnect |
| `chatHandler.ts` | Registers all Socket.IO event listeners per socket |
| `userHelper.ts` | Resolves user display names from DB (60-second cache) |

The Socket.IO server is attached to the same HTTP server as Express:
```typescript
// server/src/index.ts
const server = app.listen(portToUse, …);
createSocketServer(server);      // ← Socket.IO shares the HTTP port
```

---

## Socket.IO Event Reference

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:join_trip` | `tripId: string` | Join the trip room; receive history and presence list |
| `chat:leave_trip` | `tripId: string` | Leave the trip room |
| `chat:send_message` | `{ tripId, body }` | Send a message to the trip thread |
| `chat:mark_read` | `{ tripId, messageId }` | Mark all messages up to `messageId` as read |
| `presence:heartbeat` | — | Refresh lastSeen timestamp |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message_history` | `ChatMessage[]` | Sent to the joining socket; full message history |
| `chat:new_message` | `ChatMessage` | Broadcast to trip room when a message is sent |
| `chat:unread_count` | `{ tripId, count }` | Sent to reader after mark-read |
| `chat:read_receipt` | `{ messageId, userId }` | Broadcast when any member marks as read |
| `presence:update` | `PresenceUser[]` | Broadcast on join, leave, and grace-period expiry |
| `chat:error` | `string` | Sent to the emitting socket on failure |

---

## Presence

- **Scope**: Per-trip. Only users with the same `activeTripId` see each other.
- **Location**: Small colored circles rendered in `PresenceAvatars` component, placed immediately to the left of the user's own name in the top bar.
- **Grace period**: 15 seconds before a disconnected user is removed from the list.
- **Colors**: Deterministically assigned from `colorForUser(userId)` using a 12-color palette.
- **Scaling**: Current implementation is in-process (single server). For multi-instance deployments, replace with Redis adapter (`@socket.io/redis-adapter`).

---

## Chat

- **Thread model**: One thread per trip, scoped to `appId = "WanderBunnies"`.
- **Persistence**: Messages are stored in `trip_messages` table and loaded when the chat panel opens.
- **Read receipts**: Stored in `message_reads` table. Unread count badge appears on the FAB.
- **UI — Desktop**: Partial-screen overlay (360×480 px) anchored to the lower-right with a minimize button.
- **UI — Mobile**: Full-screen modal with a back button.
- **Emoji**: Supported natively by the text input.
- **@mentions**: Type `@` in the input to mention a trip member (UI indicator; server stores raw body).
- **Max message length**: 2 000 characters.

---

## Database Schema

```sql
-- Chat messages
CREATE TABLE trip_messages (
  id UUID PRIMARY KEY,
  app_id TEXT NOT NULL DEFAULT 'WanderBunnies',
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_initials TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Read receipts
CREATE TABLE message_reads (
  message_id UUID NOT NULL REFERENCES trip_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
```

Both tables are supported by the `postgres`, `firebase`, and `memory` (pg-mem) adapters.

---

## REST Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/trips/:id/messages` | Returns up to 200 messages (configurable via `?limit=N`). Requires auth. |

---

## Frontend Client

```typescript
// app/utils/socket.ts
import { connectSocket, disconnectSocket, getSocket,
         CLIENT_EVENTS, SERVER_EVENTS } from './utils/socket';

// After login
connectSocket(userToken);

// Join a trip room
getSocket().emit(CLIENT_EVENTS.JOIN_TRIP, tripId);

// Listen for messages
getSocket().on(SERVER_EVENTS.NEW_MESSAGE, (msg: ChatMessage) => { … });

// On logout
disconnectSocket();
```

---

## Testing

### Unit / Integration (Jest)

`server/__tests__/socket-chat.test.ts` covers:
- `colorForUser` / `initialsForName` pure functions
- `presenceManager` join/leave/heartbeat/grace-period
- DB functions: `listTripMessages`, `addTripMessage`, `markMessagesRead`, `countUnreadMessages`
- REST endpoint: `GET /api/trips/:id/messages`

Run with: `npm run test:server`

### E2E (Playwright)

`app/e2e/chat.test.ts` covers:
- Open chat via FAB
- Send a message and see it appear
- Message history persists after reload
- Minimize button (desktop)
- Presence circles for another user
- Unread badge increments when other user sends

Run with: `npx playwright test app/e2e/chat.test.ts`

---

## Known Limitations / Future Work

- Presence is in-process; does not survive server restart or scale across multiple instances (add Redis adapter for production multi-instance).
- @mention autocomplete UI is minimal (raw `@` character only — no dropdown).
- Image attachments are not supported.
- Push notifications for unread messages when the app is backgrounded are not implemented.
