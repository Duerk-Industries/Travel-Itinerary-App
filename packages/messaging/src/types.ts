/**
 * Shared types for the WanderBunnies messaging/presence system.
 * Used by both the server (socket handlers) and the client (React Native / web).
 */

/** The application identifier. Allows the messaging module to be reused across apps. */
export const APP_ID = 'WanderBunnies';

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  /** Which application this message belongs to */
  appId: string;
  /** The trip this message is scoped to */
  tripId: string;
  /** Sender's user ID */
  senderId: string;
  /** Sender's display name (denormalized for rendering) */
  senderName: string;
  /** Sender's initials (e.g. "JD") — used in avatar circles */
  senderInitials: string;
  /** Message body; supports @mentions and emoji */
  body: string;
  /** ISO-8601 timestamp */
  createdAt: string;
}

export interface MessageRead {
  messageId: string;
  userId: string;
  readAt: string;
}

/** Sent from server → client when a new message arrives for the active trip */
export interface IncomingMessage extends ChatMessage {
  /** IDs of users who have already read this message (snapshot at send time) */
  readBy: string[];
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export interface PresenceUser {
  userId: string;
  displayName: string;
  initials: string;
  /** Color hex string assigned deterministically from userId */
  color: string;
  /** ISO-8601 last-seen timestamp */
  lastSeen: string;
}

/** Sent from server → client with the current presence list for the trip */
export type PresenceList = PresenceUser[];
