/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import StarRating, { ItemRating } from '../components/StarRating';

describe('StarRating', () => {
  it('reports the star that was tapped and marks the current one selected', () => {
    const onRate = jest.fn();
    const { getByTestId } = render(<StarRating value={3} onRate={onRate} name="Museum" testID="rate" />);
    expect(getByTestId('rate-star-3').props.accessibilityState).toMatchObject({ selected: true });
    expect(getByTestId('rate-star-1').props.accessibilityLabel).toBe('Rate Museum 1 star');
    expect(getByTestId('rate-star-4').props.accessibilityLabel).toBe('Rate Museum 4 stars');
    fireEvent.press(getByTestId('rate-star-4'));
    expect(onRate).toHaveBeenCalledWith(4);
  });
});

describe('ItemRating', () => {
  const completed = { status: 'Completed', averageRating: 4.5, ratingCount: 2, userStars: 5, name: 'Museum', testID: 'rate' };

  it('shows a dash until the item is Completed', () => {
    const { getByText, queryByTestId } = render(<ItemRating {...completed} status="Booked" onRate={jest.fn()} />);
    expect(getByText('-')).toBeTruthy();
    expect(queryByTestId('rate-star-1')).toBeNull();
  });

  it('lets a traveler change their rating and shows the group average', () => {
    const onRate = jest.fn();
    const { getByTestId, getByText } = render(<ItemRating {...completed} onRate={onRate} />);
    expect(getByText('4.5 (2)')).toBeTruthy();
    fireEvent.press(getByTestId('rate-star-2'));
    expect(onRate).toHaveBeenCalledWith(2);
  });

  it('shows only the average to someone who cannot rate', () => {
    const { getByText, queryByTestId } = render(<ItemRating {...completed} readOnly onRate={jest.fn()} />);
    expect(getByText('4.5 (2)')).toBeTruthy();
    expect(queryByTestId('rate-star-1')).toBeNull();
  });
});
