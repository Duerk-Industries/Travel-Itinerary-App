/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import ReactionBar, { type ReactionSummary, type ReactionValue } from '../components/ReactionBar';

const emptySummary: ReactionSummary = { score: 0, upCount: 0, downCount: 0, userValue: null };

const noopAsync = async (): Promise<ReactionSummary> => emptySummary;

describe('ReactionBar', () => {
  it('renders thumbs and counts and the score', () => {
    const { getByTestId } = render(
      <ReactionBar
        detailId="d1"
        summary={{ score: 1, upCount: 2, downCount: 1, userValue: 1 }}
        canReact
        onCast={noopAsync}
        onClear={noopAsync}
      />
    );
    expect(getByTestId('reaction-bar-d1')).toBeTruthy();
    expect(getByTestId('reaction-up-d1')).toBeTruthy();
    expect(getByTestId('reaction-down-d1')).toBeTruthy();
    expect(getByTestId('reaction-score-d1').props.children).toBe('+1');
  });

  it('shows the upvote in the selected state when userValue is 1', () => {
    const { getByTestId } = render(
      <ReactionBar
        detailId="d1"
        summary={{ score: 1, upCount: 1, downCount: 0, userValue: 1 }}
        canReact
        onCast={noopAsync}
        onClear={noopAsync}
      />
    );
    expect(getByTestId('reaction-up-d1').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('reaction-down-d1').props.accessibilityState.selected).toBe(false);
  });

  it('disables interaction when canReact is false', () => {
    const onCast = jest.fn(noopAsync);
    const { getByTestId } = render(
      <ReactionBar
        detailId="d1"
        summary={emptySummary}
        canReact={false}
        onCast={onCast}
        onClear={noopAsync}
      />
    );
    fireEvent.press(getByTestId('reaction-up-d1'));
    expect(onCast).not.toHaveBeenCalled();
  });

  it('optimistically updates the count when the user casts an upvote', async () => {
    const onCast = jest.fn(
      async (_id: string, _value: ReactionValue): Promise<ReactionSummary> => ({
        score: 1,
        upCount: 1,
        downCount: 0,
        userValue: 1,
      })
    );
    const { getByTestId } = render(
      <ReactionBar
        detailId="d1"
        summary={emptySummary}
        canReact
        onCast={onCast}
        onClear={noopAsync}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId('reaction-up-d1'));
    });
    expect(onCast).toHaveBeenCalledWith('d1', 1);
    await waitFor(() => {
      expect(getByTestId('reaction-score-d1').props.children).toBe('+1');
    });
  });

  it('clears the vote when the user clicks their existing upvote again', async () => {
    const onClear = jest.fn(async (): Promise<ReactionSummary> => emptySummary);
    const onCast = jest.fn(noopAsync);
    const { getByTestId } = render(
      <ReactionBar
        detailId="d1"
        summary={{ score: 1, upCount: 1, downCount: 0, userValue: 1 }}
        canReact
        onCast={onCast}
        onClear={onClear}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId('reaction-up-d1'));
    });
    expect(onClear).toHaveBeenCalledWith('d1');
    expect(onCast).not.toHaveBeenCalled();
  });

  it('rolls back the optimistic update when the network call rejects', async () => {
    const onCast = jest.fn(async (): Promise<ReactionSummary> => {
      throw new Error('network down');
    });
    const onError = jest.fn();
    const { getByTestId } = render(
      <ReactionBar
        detailId="d1"
        summary={emptySummary}
        canReact
        onCast={onCast}
        onClear={noopAsync}
        onError={onError}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId('reaction-up-d1'));
    });
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('network down');
    });
    expect(getByTestId('reaction-score-d1').props.children).toBe('0');
  });
});
