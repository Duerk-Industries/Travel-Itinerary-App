import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AssistantChatButton from '../components/AssistantChatButton';

describe('AssistantChatButton', () => {
  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<AssistantChatButton onPress={onPress} />);
    fireEvent.press(getByTestId('assistant-chat-fab'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('has an accessible label describing what it opens', () => {
    const { getByLabelText } = render(<AssistantChatButton onPress={jest.fn()} />);
    expect(getByLabelText('Open the app guide assistant')).toBeTruthy();
  });
});
