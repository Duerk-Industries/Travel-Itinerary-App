/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import AssistantChatPanel from '../components/AssistantChatPanel';

// The panel's root style is [container, [panelDesktop, position]] on web --
// see the `panelStyle` computation in AssistantChatPanel.tsx. Rather than
// couple every test to that exact shape, search it for the object carrying
// the live draggable position (has numeric top/left) instead of indexing in.
const findPositionStyle = (style: any): { top: number; left: number } | undefined => {
  if (Array.isArray(style)) {
    for (const entry of style) {
      const found = findPositionStyle(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (style && typeof style.top === 'number' && typeof style.left === 'number') {
    return style;
  }
  return undefined;
};

const mockUseAssistantChat = jest.fn();
jest.mock('../hooks/useAssistantChat', () => ({
  useAssistantChat: () => mockUseAssistantChat(),
}));

const baseHookReturn = {
  engineState: 'idle' as const,
  loadProgress: null,
  errorMessage: null,
  messages: [] as any[],
  capability: { supported: true },
  loadModel: jest.fn(),
  sendMessage: jest.fn(),
  clearConversation: jest.fn(),
};

describe('AssistantChatPanel', () => {
  beforeEach(() => {
    mockUseAssistantChat.mockReset();
    window.localStorage.clear();
  });

  it('shows an unsupported-device message and no load button when WebGPU is unavailable', () => {
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      capability: { supported: false, reason: 'no-webgpu' },
    });
    const { getByTestId, queryByTestId, getByText } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(getByTestId('assistant-unsupported-state')).toBeTruthy();
    expect(getByText(/WebGPU support/)).toBeTruthy();
    expect(queryByTestId('assistant-load-button')).toBeNull();
  });

  it('shows the idle intro with a load button, which calls loadModel with the default model', () => {
    const loadModel = jest.fn();
    mockUseAssistantChat.mockReturnValue({ ...baseHookReturn, loadModel });
    const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(getByTestId('assistant-idle-state')).toBeTruthy();
    fireEvent.press(getByTestId('assistant-load-button'));
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledWith('Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
  });

  it('shows load progress while loading', () => {
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      engineState: 'loading',
      loadProgress: { progress: 0.42, text: 'Fetching model shard 3/7' },
    });
    const { getByTestId, getByText } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(getByTestId('assistant-loading-state')).toBeTruthy();
    expect(getByText('Fetching model shard 3/7')).toBeTruthy();
  });

  it('renders conversation messages once ready', () => {
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      engineState: 'ready',
      messages: [
        { id: 'u-1', role: 'user', content: 'How do I add a flight?' },
        { id: 'a-1', role: 'assistant', content: 'Open the Transfers tab and tap Add.' },
      ],
    });
    const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);
    // The mocked FlatList (app/tests/__mocks__/react-native.ts) is an inert
    // host tag -- it doesn't invoke renderItem -- so assert on the data prop
    // Metro/RN would actually render from, rather than rendered text nodes.
    const list = getByTestId('assistant-message-list');
    expect(list.props.data).toEqual([
      { id: 'u-1', role: 'user', content: 'How do I add a flight?' },
      { id: 'a-1', role: 'assistant', content: 'Open the Transfers tab and tap Add.' },
    ]);
  });

  it('sends the typed message and clears the input', () => {
    const sendMessage = jest.fn();
    mockUseAssistantChat.mockReturnValue({ ...baseHookReturn, engineState: 'ready', sendMessage });
    const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);

    const input = getByTestId('assistant-input');
    fireEvent.changeText(input, 'How do I split an expense?');
    fireEvent.press(getByTestId('assistant-send'));

    expect(sendMessage).toHaveBeenCalledWith('How do I split an expense?');
    expect(input.props.value).toBe('');
  });

  it('disables the input and send button while generating', () => {
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      engineState: 'generating',
      messages: [{ id: 'u-1', role: 'user', content: 'hi' }],
    });
    const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(getByTestId('assistant-input').props.editable).toBe(false);
    expect(getByTestId('assistant-send').props.disabled).toBe(true);
  });

  it('shows a retry-load state (not the chat UI) when loading fails before any conversation started', () => {
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      engineState: 'error',
      errorMessage: 'WebGPU device lost',
      messages: [],
    });
    const { getByTestId, getByText } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(getByTestId('assistant-idle-state')).toBeTruthy();
    expect(getByText('WebGPU device lost')).toBeTruthy();
    expect(getByText('Try again')).toBeTruthy();
  });

  it('shows the chat UI with an inline error banner when generation fails mid-conversation', () => {
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      engineState: 'error',
      errorMessage: 'Something went wrong generating a response.',
      messages: [
        { id: 'u-1', role: 'user', content: 'hi' },
        { id: 'a-1', role: 'assistant', content: '' },
      ],
    });
    const { getByTestId, getByText } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(getByTestId('assistant-message-list')).toBeTruthy();
    expect(getByText('Something went wrong generating a response.')).toBeTruthy();
  });

  it('calls onClose when the close button is pressed (web layout)', () => {
    // The header shows a "close" (✕) button on web and a "back" button on
    // native -- force web here, same technique as TripDayMap.test.tsx.
    const { Platform } = require('react-native');
    const originalOS = Platform.OS;
    Platform.OS = 'web';
    try {
      const onClose = jest.fn();
      mockUseAssistantChat.mockReturnValue(baseHookReturn);
      const { getByTestId } = render(<AssistantChatPanel onClose={onClose} />);
      fireEvent.press(getByTestId('assistant-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('calls onClose when the back button is pressed (native layout)', () => {
    const onClose = jest.fn();
    mockUseAssistantChat.mockReturnValue(baseHookReturn);
    const { getByTestId } = render(<AssistantChatPanel onClose={onClose} />);
    fireEvent.press(getByTestId('assistant-back'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves the panel by the drag distance when dragged via the header (web layout)', () => {
    // Real fix for "it blocks the screen and you can't move it" feedback
    // from manual testing -- the panel is now draggable via its header.
    const { Platform } = require('react-native');
    const originalOS = Platform.OS;
    Platform.OS = 'web';
    try {
      mockUseAssistantChat.mockReturnValue(baseHookReturn);
      const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);

      const dragHandle = getByTestId('assistant-drag-handle');
      const panel = getByTestId('assistant-chat-panel');
      const before = findPositionStyle(panel.props.style);
      expect(before).toBeDefined();

      act(() => {
        dragHandle.props.onResponderGrant({ nativeEvent: { pageX: 100, pageY: 100 } });
      });
      act(() => {
        dragHandle.props.onResponderMove({ nativeEvent: { pageX: 160, pageY: 135 } });
      });
      act(() => {
        dragHandle.props.onResponderRelease({ nativeEvent: {} });
      });

      const after = findPositionStyle(panel.props.style);
      expect(after!.left).toBe(before!.left + 60);
      expect(after!.top).toBe(before!.top + 35);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('clamps a drag so the panel cannot be moved off-screen', () => {
    const { Platform } = require('react-native');
    const originalOS = Platform.OS;
    Platform.OS = 'web';
    try {
      mockUseAssistantChat.mockReturnValue(baseHookReturn);
      const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);

      const dragHandle = getByTestId('assistant-drag-handle');
      const panel = getByTestId('assistant-chat-panel');

      act(() => {
        dragHandle.props.onResponderGrant({ nativeEvent: { pageX: 0, pageY: 0 } });
      });
      act(() => {
        // Wildly past any real viewport -- should clamp, not overshoot.
        dragHandle.props.onResponderMove({ nativeEvent: { pageX: -100000, pageY: -100000 } });
      });
      act(() => {
        dragHandle.props.onResponderRelease({ nativeEvent: {} });
      });

      const after = findPositionStyle(panel.props.style);
      expect(after!.left).toBeGreaterThanOrEqual(0);
      expect(after!.top).toBeGreaterThanOrEqual(0);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('preserves the dragged position when the panel is hidden and shown again', () => {
    const { Platform } = require('react-native');
    const originalOS = Platform.OS;
    Platform.OS = 'web';
    try {
      mockUseAssistantChat.mockReturnValue(baseHookReturn);
      const { getByTestId, rerender } = render(<AssistantChatPanel onClose={jest.fn()} visible />);

      const dragHandle = getByTestId('assistant-drag-handle');
      act(() => {
        dragHandle.props.onResponderGrant({ nativeEvent: { pageX: 0, pageY: 0 } });
      });
      act(() => {
        dragHandle.props.onResponderMove({ nativeEvent: { pageX: 40, pageY: 40 } });
      });
      act(() => {
        dragHandle.props.onResponderRelease({ nativeEvent: {} });
      });
      const dragged = findPositionStyle(getByTestId('assistant-chat-panel').props.style);

      rerender(<AssistantChatPanel onClose={jest.fn()} visible={false} />);
      rerender(<AssistantChatPanel onClose={jest.fn()} visible />);

      const afterReopen = findPositionStyle(getByTestId('assistant-chat-panel').props.style);
      expect(afterReopen).toEqual(dragged);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('does not show a "clear conversation" button when there is no conversation yet', () => {
    mockUseAssistantChat.mockReturnValue({ ...baseHookReturn, messages: [] });
    const { queryByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);
    expect(queryByTestId('assistant-clear')).toBeNull();
  });

  it('shows a "clear conversation" button once there is history, and calls clearConversation when pressed', () => {
    const clearConversation = jest.fn();
    mockUseAssistantChat.mockReturnValue({
      ...baseHookReturn,
      engineState: 'ready',
      messages: [{ id: 'u-1', role: 'user', content: 'hi' }],
      clearConversation,
    });
    const { getByTestId } = render(<AssistantChatPanel onClose={jest.fn()} />);
    fireEvent.press(getByTestId('assistant-clear'));
    expect(clearConversation).toHaveBeenCalledTimes(1);
  });
});
