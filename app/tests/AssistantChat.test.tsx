/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AssistantChat from '../components/AssistantChat';

// This test is about the open/close routing between the cheap button and
// the lazy-loaded panel -- not the panel's own internals (covered by
// AssistantChatPanel.test.tsx). Mocking the panel module means this test
// never touches useAssistantChat/@mlc-ai/web-llm at all.
//
// The mock tracks how many times it's been mounted, and honors `visible`
// the same way the real AssistantChatPanel does (stay mounted, render
// nothing when hidden) -- that contract is exactly what makes conversation
// state survive a close/reopen, so the mock needs to model it faithfully
// for these tests to mean anything.
let mountCount = 0;
jest.mock('../components/AssistantChatPanel', () => {
  const { Text, TouchableOpacity } = require('react-native');
  const MockPanel = ({ onClose, visible = true }: { onClose: () => void; visible?: boolean }) => {
    const React = require('react');
    React.useEffect(() => {
      mountCount += 1;
    }, []);
    if (!visible) return null;
    return (
      <TouchableOpacity testID="mock-panel-close" onPress={onClose}>
        <Text>mock assistant panel</Text>
      </TouchableOpacity>
    );
  };
  return { __esModule: true, default: MockPanel };
});

describe('AssistantChat', () => {
  beforeEach(() => {
    mountCount = 0;
  });

  it('renders the FAB when closed, not the panel', () => {
    const { getByTestId, queryByText } = render(<AssistantChat />);
    expect(getByTestId('assistant-chat-fab')).toBeTruthy();
    expect(queryByText('mock assistant panel')).toBeNull();
  });

  it('opens the (lazily-loaded) panel when the FAB is pressed, replacing the FAB', async () => {
    const { getByTestId, queryByTestId, findByText } = render(<AssistantChat />);
    fireEvent.press(getByTestId('assistant-chat-fab'));

    expect(await findByText('mock assistant panel')).toBeTruthy();
    expect(queryByTestId('assistant-chat-fab')).toBeNull();
  });

  it('returns to the FAB when the panel calls onClose', async () => {
    const { getByTestId, findByTestId, queryByText } = render(<AssistantChat />);
    fireEvent.press(getByTestId('assistant-chat-fab'));

    const closeButton = await findByTestId('mock-panel-close');
    fireEvent.press(closeButton);

    await waitFor(() => {
      expect(queryByText('mock assistant panel')).toBeNull();
    });
    expect(getByTestId('assistant-chat-fab')).toBeTruthy();
  });

  it('does not remount the panel on close/reopen -- conversation state must survive', async () => {
    const { getByTestId, findByText, findByTestId } = render(<AssistantChat />);

    fireEvent.press(getByTestId('assistant-chat-fab'));
    await findByText('mock assistant panel');
    expect(mountCount).toBe(1);

    fireEvent.press(await findByTestId('mock-panel-close'));
    await waitFor(() => expect(getByTestId('assistant-chat-fab')).toBeTruthy());

    fireEvent.press(getByTestId('assistant-chat-fab'));
    await findByText('mock assistant panel');

    // Still only ever mounted once -- the second "open" made the already-
    // mounted panel visible again rather than creating a fresh instance,
    // which is what keeps useAssistantChat()'s messages/engine state alive.
    expect(mountCount).toBe(1);
  });
});
