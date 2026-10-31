/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ItemRatingCell from '../components/ItemRatingCell';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme } from '../theme/theme';

const mount = (ui: React.ReactElement) => render(<ThemeProvider theme={getAppTheme('light', 'light')}>{ui}</ThemeProvider>);
const cell = (props: Partial<React.ComponentProps<typeof ItemRatingCell>>) =>
  mount(<ItemRatingCell id="x" testIDPrefix="lodging" averageRating={3.5} userRating={null} canRate={false} {...props} />);

describe('ItemRatingCell', () => {
  it('shows the average, and stars to rate with on a completed item the viewer has not rated', () => {
    const onRate = jest.fn();
    const view = cell({ canRate: true, onRate });
    expect(view.getByTestId('lodging-average-rating-x')).toBeTruthy();
    fireEvent.press(view.getByTestId('lodging-your-rating-x-star-4'));
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('shows the viewer\'s own stars in place of the average once they have rated, still changeable', () => {
    const onRate = jest.fn();
    const view = cell({ userRating: 2, canRate: true, onRate });
    expect(view.queryByTestId('lodging-average-rating-x')).toBeNull();
    expect(view.getByTestId('lodging-your-rating-x-fill-2')).toBeTruthy();
    expect(view.queryByTestId('lodging-your-rating-x-fill-3')).toBeNull();
    fireEvent.press(view.getByTestId('lodging-your-rating-x-star-5'));
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('is display-only when the viewer cannot rate', () => {
    const view = cell({ userRating: 4 });
    expect(view.getByTestId('lodging-your-rating-x-fill-4')).toBeTruthy();
    expect(view.queryByTestId('lodging-your-rating-x-star-1')).toBeNull();
    expect(cell({}).queryByTestId('lodging-your-rating-x-star-1')).toBeNull();
  });
});
