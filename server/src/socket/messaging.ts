/**
 * Server-local copy of the messaging contract used at runtime by Cloud Run.
 *
 * The app still consumes the shared workspace package directly, but the server
 * source deploy only uploads the `server/` directory, so it cannot rely on
 * workspace packages being present during build or runtime.
 */

export const APP_ID = 'WanderBunnies';

export interface ChatMessage {
  id: string;
  appId: string;
  tripId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  body: string;
  createdAt: string;
}

export interface MessageRead {
  messageId: string;
  userId: string;
  readAt: string;
}

export interface IncomingMessage extends ChatMessage {
  readBy: string[];
}

export interface PresenceUser {
  userId: string;
  displayName: string;
  initials: string;
  color: string;
  lastSeen: string;
}

export type PresenceList = PresenceUser[];

export const CLIENT_EVENTS = {
  JOIN_TRIP: 'chat:join_trip',
  LEAVE_TRIP: 'chat:leave_trip',
  SEND_MESSAGE: 'chat:send_message',
  MARK_READ: 'chat:mark_read',
  LOAD_OLDER: 'chat:load_older',
  HEARTBEAT: 'presence:heartbeat',
} as const;

export const SERVER_EVENTS = {
  NEW_MESSAGE: 'chat:new_message',
  UNREAD_COUNT: 'chat:unread_count',
  READ_RECEIPT: 'chat:read_receipt',
  PRESENCE_UPDATE: 'presence:update',
  MESSAGE_HISTORY: 'chat:message_history',
  MESSAGE_HISTORY_PAGE: 'chat:message_history_page',
  ERROR: 'chat:error',
} as const;

const PALETTE = [
  '#E53935',
  '#8E24AA',
  '#1E88E5',
  '#00ACC1',
  '#43A047',
  '#FB8C00',
  '#6D4C41',
  '#039BE5',
  '#F4511E',
  '#7CB342',
  '#00897B',
  '#3949AB',
];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function initialsForName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
