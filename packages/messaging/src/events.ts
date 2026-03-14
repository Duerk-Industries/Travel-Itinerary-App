/**
 * Socket.IO event name constants shared between server and client.
 *
 * Import from this file to avoid string-literal typos across both packages.
 */

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export const CLIENT_EVENTS = {
  /** Client joins a trip room after authenticating */
  JOIN_TRIP: 'chat:join_trip',
  /** Client leaves a trip room (or disconnects) */
  LEAVE_TRIP: 'chat:leave_trip',
  /** Client sends a message to the trip thread */
  SEND_MESSAGE: 'chat:send_message',
  /** Client marks all messages up to `messageId` as read */
  MARK_READ: 'chat:mark_read',
  /** Client explicitly updates their presence heartbeat */
  HEARTBEAT: 'presence:heartbeat',
} as const;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export const SERVER_EVENTS = {
  /** Server emits a new message to all members of the trip room */
  NEW_MESSAGE: 'chat:new_message',
  /** Server broadcasts updated unread counts for a user */
  UNREAD_COUNT: 'chat:unread_count',
  /** Server emits read-receipt update to the trip room */
  READ_RECEIPT: 'chat:read_receipt',
  /** Server emits the full presence list for the trip room */
  PRESENCE_UPDATE: 'presence:update',
  /** Sent to a single socket after JOIN_TRIP with message history */
  MESSAGE_HISTORY: 'chat:message_history',
  /** Generic error back to the emitting client */
  ERROR: 'chat:error',
} as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
export type ServerEvent = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
