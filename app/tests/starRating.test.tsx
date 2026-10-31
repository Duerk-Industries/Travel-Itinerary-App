/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import StarRating, { starFill } from '../components/StarRating';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme } from '../theme/theme';

const mount = (ui: React.ReactElement) => render(<ThemeProvider theme={getAppTheme('light', 'light')}>{ui}</ThemeProvider>);
const fillWidth = (view: ReturnType<typeof mount>, testID: string) => Object.assign({}, ...view.getByTestId(testID).props.style).width;

describe('StarRating', () => {
  it('fills each star by how much of the rating reaches it', () => {
    expect([0, 1, 2, 3, 4].map((index) => starFill(4.3, index).toFixed(2))).toEqual(['1.00', '1.00', '1.00', '1.00', '0.30']);
    expect([0, 1, 2, 3, 4].map((index) => starFill(null, index))).toEqual([0, 0, 0, 0, 0]);
    expect([0, 4].map((index) => starFill(9, index))).toEqual([1, 1]);
    expect(starFill(-3, 0)).toBe(0);
  });

  it('shows a partly filled star for a fractional average', () => {
    const view = mount(<StarRating value={3.5} size={20} testID="avg" />);
    expect(fillWidth(view, 'avg-fill-1')).toBe(20);
    expect(fillWidth(view, 'avg-fill-3')).toBe(20);
    expect(fillWidth(view, 'avg-fill-4')).toBe(10);
    expect(view.queryByTestId('avg-fill-5')).toBeNull();
    expect(view.getByLabelText('Rating: 3.5 out of 5 stars')).toBeTruthy();
  });

  it('says so when nothing has been rated, and is not pressable without onChange', () => {
    const view = mount(<StarRating value={null} testID="none" label="Average rating" />);
    expect(view.getByLabelText('Average rating: not rated')).toBeTruthy();
    expect(view.queryByTestId('none-star-1')).toBeNull();
    expect(view.queryByTestId('none-fill-1')).toBeNull();
  });

  it('rates 1 to 5 when a star is pressed, and shows the current rating', () => {
    const onChange = jest.fn();
    const view = mount(<StarRating value={2} testID="mine" onChange={onChange} />);
    fireEvent.press(view.getByTestId('mine-star-4'));
    fireEvent.press(view.getByLabelText('Rate 1 star'));
    expect(onChange.mock.calls).toEqual([[4], [1]]);
    expect(view.getByTestId('mine-star-2').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.queryByTestId('mine-fill-3')).toBeNull();
  });

  it('ignores presses while disabled', () => {
    const onChange = jest.fn();
    const view = mount(<StarRating value={null} testID="off" onChange={onChange} disabled />);
    fireEvent.press(view.getByTestId('off-star-3'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
