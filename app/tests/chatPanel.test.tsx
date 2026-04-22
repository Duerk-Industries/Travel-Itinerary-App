/**
 * @jest-environment node
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ChatPanel from '../components/ChatPanel';
import { SERVER_EVENTS } from '../../packages/messaging/src/events';

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
    FlatList: React.forwardRef(({ data = [], renderItem, testID, ...props }: any, _ref: any) =>
      React.createElement(
        'FlatList',
        { testID, ...props },
        Array.isArray(data) ? data.map((item, index) => renderItem({ item, index })) : null
      )
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
      socket.trigger(SERVER_EVENTS.MESSAGE_HISTORY, []);
    });

    expect(tree.root.findByProps({ testID: 'chat-empty-state' })).toBeTruthy();
    expect(findText(tree.root, 'No messages yet').length).toBeGreaterThan(0);
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
