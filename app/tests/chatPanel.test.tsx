/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ChatPanel from '../components/ChatPanel';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockViewportWidth = 1200;
let mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('react-native', () => {
  const React = require('react');
  const make = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    View: make('View'),
    Text: make('Text'),
    TextInput: make('TextInput'),
    TouchableOpacity: make('TouchableOpacity'),
    KeyboardAvoidingView: make('KeyboardAvoidingView'),
    ActivityIndicator: make('ActivityIndicator'),
    FlatList: React.forwardRef(
      (
        { data = [], renderItem, testID, ListHeaderComponent, keyExtractor, ...props }: any,
        _ref: any,
      ) => {
        const header = ListHeaderComponent
          ? React.isValidElement(ListHeaderComponent)
            ? React.cloneElement(ListHeaderComponent, { key: '__header' })
            : React.createElement(ListHeaderComponent, { key: '__header' })
          : null;
        const items = Array.isArray(data)
          ? data.map((item, index) => {
              const key = keyExtractor ? keyExtractor(item, index) : String(index);
              const el = renderItem({ item, index });
              return React.isValidElement(el) ? React.cloneElement(el, { key }) : el;
            })
          : null;
        return React.createElement('FlatList', { testID, ...props }, header, items);
      },
    ),
    StyleSheet: { create: (styles: any) => styles },
    Platform: { OS: 'web' },
    Dimensions: { get: () => ({ width: 1200, height: 800 }) },
    useWindowDimensions: () => ({ width: mockViewportWidth, height: 800, scale: 1, fontScale: 1 }),
  };
});

type HandlerMap = Record<string, Array<(...args: any[]) => void>>;

const createSocketMock = () => {
  const handlers: HandlerMap = {};
  const socket: any = {
    connected: true,
    emit: jest.fn(),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
      return socket;
    }),
    off: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = (handlers[event] ?? []).filter((candidate) => candidate !== handler);
      return socket;
    }),
    once: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
      return socket;
    }),
    trigger: (event: string, ...args: any[]) => {
      for (const handler of handlers[event] ?? []) {
        handler(...args);
      }
    },
  };
  return socket;
};

const baseProps = {
  tripId: 'trip-1',
  currentUserId: 'user-1',
  currentUserName: 'Bryan',
  onClose: jest.fn(),
  unreadCount: 0,
  onUnreadChange: jest.fn(),
};

const findText = (root: any, text: string) =>
  root.findAll((node: any) => node.type === 'Text' && node.props.children === text);

describe('ChatPanel', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockViewportWidth = 1200;
    mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    require('react-native').Platform.OS = 'web';
    const originalWarn = console.warn.bind(console);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (message !== '[chat] connect_error') {
        originalWarn(message, ...args);
      }
    });
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test.each([
    ['ios', 59, 34],
    ['android', 24, 24],
  ])('keeps the %s Back button below system bars and closes chat', (platform, top, bottom) => {
    require('react-native').Platform.OS = platform;
    mockViewportWidth = 390;
    mockInsets = { top, right: 0, bottom, left: 0 };
    const onClose = jest.fn();
    let tree: any;
    act(() => { tree = renderer.create(<ChatPanel socket={createSocketMock()} {...baseProps} onClose={onClose} />); });
    const panel = tree.root.findByProps({ testID: 'chat-panel' });
    expect(panel.props.style[1][1]).toMatchObject({ top, bottom });
    const back = tree.root.findByProps({ testID: 'chat-back' });
    expect(back.props.style).toMatchObject({ minHeight: 44, minWidth: 44 });
    act(() => { back.props.onPress(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('uses a safe-area-aware full-screen panel with Back on phone-sized web', () => {
    mockViewportWidth = 390;
    let tree: any;
    act(() => { tree = renderer.create(<ChatPanel socket={createSocketMock()} {...baseProps} />); });
    const panel = tree.root.findByProps({ testID: 'chat-panel' });
    expect(panel.props.style[1][1]).toMatchObject({
      top: 'env(safe-area-inset-top, 0px)',
      bottom: 'env(safe-area-inset-bottom, 0px)',
    });
    expect(tree.root.findByProps({ testID: 'chat-back' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'chat-close' })).toHaveLength(0);
  });

  test('shows empty state when message history is empty', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: [],
        hasMore: false,
        initial: true,
      });
    });

    expect(tree.root.findByProps({ testID: 'chat-empty-state' })).toBeTruthy();
    expect(findText(tree.root, 'No messages yet').length).toBeGreaterThan(0);
  });

  test('renders Load older button only when hasMore is true', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    const initialMessages = [
      { id: 'm1', tripId: baseProps.tripId, senderId: 'user-2', senderName: 'Alice', senderInitials: 'AA', body: 'hi', createdAt: '2026-04-23T12:00:00Z', appId: 'WanderBunnies' },
    ];

    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: initialMessages,
        hasMore: true,
        initial: true,
      });
    });

    expect(tree.root.findByProps({ testID: 'chat-load-older' })).toBeTruthy();

    // Clicking load-older emits LOAD_OLDER with the oldest id
    const btn = tree.root.findByProps({ testID: 'chat-load-older' });
    act(() => {
      btn.props.onPress();
    });
    expect(socket.emit).toHaveBeenCalledWith(CLIENT_EVENTS.LOAD_OLDER, {
      tripId: baseProps.tripId,
      beforeId: 'm1',
    });

    // Older page arrives and prepends; if hasMore:false, button disappears
    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: [
          { id: 'm0', tripId: baseProps.tripId, senderId: 'user-2', senderName: 'Alice', senderInitials: 'AA', body: 'older', createdAt: '2026-04-23T11:59:00Z', appId: 'WanderBunnies' },
        ],
        hasMore: false,
        initial: false,
        beforeId: 'm1',
      });
    });

    expect(tree.root.findAllByProps({ testID: 'chat-load-older' })).toHaveLength(0);
  });

  test('MARK_READ is watermark-gated and not resent for the same message id', () => {
    const socket = createSocketMock();

    act(() => {
      renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    // Initial history: tail message triggers one MARK_READ
    const tail = { id: 'm1', tripId: baseProps.tripId, senderId: 'user-2', senderName: 'Alice', senderInitials: 'AA', body: 'hi', createdAt: '2026-04-23T12:00:00Z', appId: 'WanderBunnies' };
    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: [tail],
        hasMore: false,
        initial: true,
      });
    });

    const markReadCalls = () =>
      (socket.emit as jest.Mock).mock.calls.filter((c: any[]) => c[0] === CLIENT_EVENTS.MARK_READ);

    expect(markReadCalls()).toEqual([[CLIENT_EVENTS.MARK_READ, { tripId: baseProps.tripId, messageId: 'm1' }]]);

    // Same tail arriving again (e.g., echoed NEW_MESSAGE) must NOT re-emit
    act(() => {
      socket.trigger(SERVER_EVENTS.NEW_MESSAGE, tail);
    });
    expect(markReadCalls()).toHaveLength(1);

    // A truly new message advances the watermark and emits once
    const next = { ...tail, id: 'm2', body: 'hello', createdAt: '2026-04-23T12:00:30Z' };
    act(() => {
      socket.trigger(SERVER_EVENTS.NEW_MESSAGE, next);
    });
    expect(markReadCalls()).toHaveLength(2);
    expect(markReadCalls()[1][1]).toEqual({ tripId: baseProps.tripId, messageId: 'm2' });
  });

  test('shows error state on chat server error', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    act(() => {
      socket.trigger(SERVER_EVENTS.ERROR, 'Unable to load chat history right now.');
    });

    expect(tree.root.findByProps({ testID: 'chat-error-state' })).toBeTruthy();
    expect(findText(tree.root, 'Unable to load chat history right now.').length).toBeGreaterThan(0);
  });

  test('shows error state on socket connect error', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    act(() => {
      socket.trigger('connect_error', new Error('boom'));
    });

    expect(tree.root.findByProps({ testID: 'chat-error-state' })).toBeTruthy();
    expect(findText(tree.root, 'Unable to connect to chat right now.').length).toBeGreaterThan(0);
  });

  test('renders unread separator anchored to oldest-unread message when unreadCount > 0 at mount', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(
        <ChatPanel socket={socket} {...baseProps} unreadCount={3} />,
      );
    });

    // 5 messages total; unreadCount=3 at mount → last 3 are unread, separator
    // sits above message at index 5-3=2 (id m3).
    const mk = (id: string, body: string) => ({
      id,
      tripId: baseProps.tripId,
      senderId: 'user-2',
      senderName: 'Alice',
      senderInitials: 'AA',
      body,
      createdAt: `2026-04-23T12:00:${id.slice(1).padStart(2, '0')}Z`,
      appId: 'WanderBunnies',
    });
    const history = [mk('m1', 'one'), mk('m2', 'two'), mk('m3', 'three'), mk('m4', 'four'), mk('m5', 'five')];

    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: history,
        hasMore: false,
        initial: true,
      });
    });

    // The separator should be rendered exactly once (anchored to the oldest
    // unread message m3) and sit inside the same wrapper as m3's row. Count
    // the number of distinct message ids that precede/follow the separator in
    // the FlatList's rendered children to verify placement without needing
    // to reason about composite-vs-host fiber duplication.
    const separator = tree.root.findByProps({ testID: 'chat-unread-separator' });
    expect(separator).toBeTruthy();

    const m3Row = tree.root.findByProps({ testID: 'chat-message-m3' });
    // The separator and m3Row are siblings inside the wrapper View emitted by
    // renderMessage. Walking up to the shared wrapper and listing its message
    // descendants should give exactly ['m3'].
    const wrapper = m3Row.parent;
    const messagesInsideWrapper = wrapper.findAllByType('View' as any)
      .map((v: any) => v.props.testID as string | undefined)
      .filter((id?: string) => id?.startsWith('chat-message-'));
    expect(messagesInsideWrapper).toEqual(['chat-message-m3']);
  });

  test('does not render unread separator when unreadCount is 0 at mount', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} unreadCount={0} />);
    });

    const msg = {
      id: 'm1',
      tripId: baseProps.tripId,
      senderId: 'user-2',
      senderName: 'Alice',
      senderInitials: 'AA',
      body: 'hi',
      createdAt: '2026-04-23T12:00:00Z',
      appId: 'WanderBunnies',
    };

    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: [msg],
        hasMore: false,
        initial: true,
      });
    });

    expect(tree.root.findAllByProps({ testID: 'chat-unread-separator' })).toHaveLength(0);
  });

  test('unread separator stays pinned when a new message arrives (does not drift)', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} unreadCount={2} />);
    });

    const mk = (id: string) => ({
      id,
      tripId: baseProps.tripId,
      senderId: 'user-2',
      senderName: 'Alice',
      senderInitials: 'AA',
      body: `body ${id}`,
      createdAt: `2026-04-23T12:00:${id.slice(1).padStart(2, '0')}Z`,
      appId: 'WanderBunnies',
    });

    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: [mk('m1'), mk('m2'), mk('m3')],
        hasMore: false,
        initial: true,
      });
    });

    // Separator anchored above m2 (index 3-2=1).
    const m2Row = tree.root.findByProps({ testID: 'chat-message-m2' });
    const sep = tree.root.findByProps({ testID: 'chat-unread-separator' });
    expect(sep.parent).toBe(m2Row.parent);

    // A brand-new message arrives live.
    act(() => {
      socket.trigger(SERVER_EVENTS.NEW_MESSAGE, mk('m4'));
    });

    // Separator must still be anchored to m2, not to a newer message. Walk
    // up to m2's wrapper and list the message ids it contains — it should be
    // exactly ['m2'], which would not be true if the separator had drifted.
    const m2RowAfter = tree.root.findByProps({ testID: 'chat-message-m2' });
    const wrapper = m2RowAfter.parent;
    const messagesInsideWrapper = wrapper.findAllByType('View' as any)
      .map((v: any) => v.props.testID as string | undefined)
      .filter((id?: string) => id?.startsWith('chat-message-'));
    expect(messagesInsideWrapper).toEqual(['chat-message-m2']);

    // And m4's wrapper should NOT contain the separator.
    const m4Row = tree.root.findByProps({ testID: 'chat-message-m4' });
    const m4Wrapper = m4Row.parent;
    const sepsInM4Wrapper = m4Wrapper
      .findAllByProps({ testID: 'chat-unread-separator' })
      .filter((el: any) => el.type === 'View');
    expect(sepsInM4Wrapper).toHaveLength(0);
  });

  test('falls back to error state if history never arrives', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(tree.root.findByProps({ testID: 'chat-error-state' })).toBeTruthy();
    expect(findText(tree.root, 'Unable to load chat history right now.').length).toBeGreaterThan(0);
  });

  test('keeps rendered history after the fallback timeout elapses', () => {
    const socket = createSocketMock();
    let tree: any;

    act(() => {
      tree = renderer.create(<ChatPanel socket={socket} {...baseProps} />);
    });

    act(() => {
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, {
        tripId: baseProps.tripId,
        messages: [
          {
            id: 'm1',
            tripId: baseProps.tripId,
            senderId: 'user-2',
            senderName: 'Alice',
            senderInitials: 'AA',
            body: 'hello from chat',
            createdAt: '2026-04-23T12:00:00Z',
            appId: 'WanderBunnies',
          },
        ],
        hasMore: false,
        initial: true,
      });
    });

    act(() => {
      jest.advanceTimersByTime(6000);
    });

    expect(tree.root.findByProps({ testID: 'chat-message-m1' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'chat-error-state' })).toHaveLength(0);
  });
});
