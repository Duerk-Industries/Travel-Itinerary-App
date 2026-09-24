/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import BlogCommentComposer from '../components/BlogCommentComposer';

describe('BlogCommentComposer', () => {
  it('disables submit until there is non-whitespace text, then calls onSubmit and clears', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(<BlogCommentComposer onSubmit={onSubmit} testID="composer" />);
    const submit = getByTestId('composer-submit');
    expect(submit.props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByTestId('composer-input'), '   ');
    expect(getByTestId('composer-submit').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByTestId('composer-input'), 'Great trip!');
    expect(getByTestId('composer-submit').props.accessibilityState.disabled).toBe(false);

    await act(async () => { fireEvent.press(getByTestId('composer-submit')); });
    expect(onSubmit).toHaveBeenCalledWith('Great trip!');
    expect(getByTestId('composer-input').props.value).toBe('');
  });

  it('renders the persistent audience disclosure label when given one, and none when not', () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <BlogCommentComposer onSubmit={jest.fn()} audienceLabel="Visible publicly" testID="composer" />
    );
    expect(getByTestId('composer-audience-label').props.children).toBe('Visible publicly');

    rerender(<BlogCommentComposer onSubmit={jest.fn()} testID="composer" />);
    expect(queryByTestId('composer-audience-label')).toBeNull();
  });

  it('shows a Cancel action only when onCancel is provided, and calls it', () => {
    const onCancel = jest.fn();
    const { getByTestId, queryByTestId, rerender } = render(
      <BlogCommentComposer onSubmit={jest.fn()} onCancel={onCancel} testID="composer" />
    );
    fireEvent.press(getByTestId('composer-cancel'));
    expect(onCancel).toHaveBeenCalled();

    rerender(<BlogCommentComposer onSubmit={jest.fn()} testID="composer" />);
    expect(queryByTestId('composer-cancel')).toBeNull();
  });
});
