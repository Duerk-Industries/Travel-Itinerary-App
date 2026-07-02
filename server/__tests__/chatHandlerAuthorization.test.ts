/// <reference types="jest" />
/// <reference types="node" />
/**
 * Authorization regression tests for the Socket.IO chat handler.
 *
 * Before the fix, any authenticated socket could call JOIN_TRIP / SEND_MESSAGE
 * / MARK_READ for any tripId and the server would happily join the room and
 * relay messages, leaking chat history and accepting writes across trips.
 *
 * These tests drive `registerChatHandlers` against in-process socket / server
 * mocks and assert that:
 *   1. JOIN_TRIP refuses when ensureUserInTrip returns null (not a member).
 *   2. JOIN_TRIP succeeds when ensureUserInTrip returns a membership.
 *   3. SEND_MESSAGE refuses when not a member of the destination trip,
 *      even if socket.data.tripId is already set (defense-in-depth against
 *      a future JOIN_TRIP regression).
 *   4. MARK_READ silently refuses for non-members (no errors leaked back).
 */

import { CLIENT_EVENTS, SERVER_EVENTS } from '../src/socket/messaging';

jest.mock('../src/db', () => ({
  ensureUserInTrip: jest.fn(),
  addTripMessage: jest.fn(),
  listTripMessagesPage: jest.fn(async () => ({ messages: [], hasMore: false })),
  markMessagesRead: jest.fn(async () => undefined),
  countUnreadMessages: jest.fn(async () => 0),
}));
jest.mock('../src/socket/userHelper', () => ({
  getUserDisplayName: jest.fn(async (_id: string, email: string) => email),
}));
jest.mock('../src/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

import { registerChatHandlers } from '../src/socket/chatHandler';
import * as db from '../src/db';

type Handler = (...args: unknown[]) => unknown;

const createSocketMock = (userId: string) => {
  const handlers = new Map<string, Handler>();
  const emit = jest.fn();
  const join = jest.fn();
  const leave = jest.fn();
  const socket = {
    data: { user: { id: userId, email: `${userId}@example.com` }, tripId: undefined as string | undefined },
    on: jest.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    join,
    leave,
    emit,
  };
  return { socket, handlers, emit, join, leave };
};

const createIoMock = () => {
  const roomEmit = jest.fn();
  const io = { to: jest.fn(() => ({ emit: roomEmit })) };
  return { io, roomEmit };
};

describe('chatHandler authorization', () => {
  const ensureUserInTripMock = db.ensureUserInTrip as jest.Mock;
  const addTripMessageMock = db.addTripMessage as jest.Mock;
  const markMessagesReadMock = db.markMessagesRead as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('JOIN_TRIP rejects sockets whose user is not a member of the trip', async () => {
    ensureUserInTripMock.mockResolvedValueOnce(null);

    const { socket, handlers, emit, join } = createSocketMock('attacker');
    const { io } = createIoMock();
    registerChatHandlers(io as never, socket as never);

    const handler = handlers.get(CLIENT_EVENTS.JOIN_TRIP)!;
    await handler('trip-the-attacker-does-not-belong-to');

    expect(ensureUserInTripMock).toHaveBeenCalledWith(
      'trip-the-attacker-does-not-belong-to',
      'attacker',
    );
    expect(join).not.toHaveBeenCalled();
    expect(socket.data.tripId).toBeUndefined();
    expect(emit).toHaveBeenCalledWith(
      SERVER_EVENTS.ERROR,
      expect.stringMatching(/Not authorized/i),
    );
  });

  it('JOIN_TRIP joins the room and records tripId on the socket for a valid member', async () => {
    ensureUserInTripMock.mockResolvedValueOnce({ groupId: 'g-1' });

    const { socket, handlers, join } = createSocketMock('member-1');
    const { io } = createIoMock();
    registerChatHandlers(io as never, socket as never);

    const handler = handlers.get(CLIENT_EVENTS.JOIN_TRIP)!;
    await handler('trip-1');

    expect(join).toHaveBeenCalledWith('trip:trip-1');
    expect(socket.data.tripId).toBe('trip-1');
  });

  it('SEND_MESSAGE refuses to write when the user is not a member of the target trip', async () => {
    // Simulate a stale socket.data.tripId (e.g., trip removed user mid-session).
    const { socket, handlers, emit } = createSocketMock('member-1');
    socket.data.tripId = 'trip-stale';
    const { io } = createIoMock();
    registerChatHandlers(io as never, socket as never);

    ensureUserInTripMock.mockResolvedValueOnce(null);
    const handler = handlers.get(CLIENT_EVENTS.SEND_MESSAGE)!;
    await handler({ tripId: 'trip-stale', body: 'malicious' });

    expect(addTripMessageMock).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      SERVER_EVENTS.ERROR,
      expect.stringMatching(/Not authorized/i),
    );
  });

  it('MARK_READ silently no-ops when the user is not a member', async () => {
    const { socket, handlers } = createSocketMock('member-1');
    socket.data.tripId = 'trip-stale';
    const { io } = createIoMock();
    registerChatHandlers(io as never, socket as never);

    ensureUserInTripMock.mockResolvedValueOnce(null);
    const handler = handlers.get(CLIENT_EVENTS.MARK_READ)!;
    await handler({ tripId: 'trip-stale', messageId: 'msg-1' });

    expect(markMessagesReadMock).not.toHaveBeenCalled();
  });
});
