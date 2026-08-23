/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import BlogReactionBar from '../components/BlogReactionBar';

const zeroSummary = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };

describe('BlogReactionBar', () => {
  it('shows only non-zero emoji chips, plus the "+" control, when nothing is expanded', () => {
    const { queryByTestId } = render(
      <BlogReactionBar
        targetKind="item" targetId="item-1"
        summary={{ reactionCounts: { heart: 3 }, reactionTotal: 3, commentCount: 0, userReaction: null }}
        canEngage onToggle={jest.fn()} testID="bar"
      />
    );
    expect(queryByTestId('bar-chip-heart')).toBeTruthy();
    expect(queryByTestId('bar-chip-laugh')).toBeNull(); // zero count, not shown as a chip
    expect(queryByTestId('bar-add')).toBeTruthy();
    expect(queryByTestId('bar-picker')).toBeNull(); // collapsed by default
  });

  it('tapping "+" reveals the full emoji picker; tapping an emoji calls onToggle and collapses it again', async () => {
    const onToggle = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = render(
      <BlogReactionBar targetKind="item" targetId="item-1" summary={zeroSummary} canEngage onToggle={onToggle} testID="bar" />
    );
    fireEvent.press(getByTestId('bar-add'));
    expect(getByTestId('bar-picker')).toBeTruthy();

    await act(async () => { fireEvent.press(getByTestId('bar-pick-fire')); });
    expect(onToggle).toHaveBeenCalledWith('item', 'item-1', 'fire');
    expect(queryByTestId('bar-picker')).toBeNull();
  });

  it('tapping an already-present chip calls onToggle with that same emoji (client decides clear vs set)', async () => {
    const onToggle = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <BlogReactionBar
        targetKind="item" targetId="item-1"
        summary={{ reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' }}
        canEngage onToggle={onToggle} testID="bar"
      />
    );
    await act(async () => { fireEvent.press(getByTestId('bar-chip-heart')); });
    expect(onToggle).toHaveBeenCalledWith('item', 'item-1', 'heart');
  });

  it('does not render the "+" control at all when canEngage is false — not merely disabled', () => {
    const { queryByTestId } = render(
      <BlogReactionBar
        targetKind="item" targetId="item-1"
        summary={{ reactionCounts: { heart: 2 }, reactionTotal: 2, commentCount: 0, userReaction: null }}
        canEngage={false} onToggle={jest.fn()} testID="bar"
      />
    );
    expect(queryByTestId('bar-add')).toBeNull();
  });

  it('calls onError when onToggle rejects, and does not throw', async () => {
    const onToggle = jest.fn().mockRejectedValue(new Error('Not authorized'));
    const onError = jest.fn();
    const { getByTestId } = render(
      <BlogReactionBar
        targetKind="item" targetId="item-1"
        summary={{ reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' }}
        canEngage onToggle={onToggle} onError={onError} testID="bar"
      />
    );
    await act(async () => { fireEvent.press(getByTestId('bar-chip-heart')); });
    expect(onError).toHaveBeenCalledWith('Not authorized');
  });
});
