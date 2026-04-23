/**
 * @jest-environment node
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ChatPanel from '../components/ChatPanel';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
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
});
