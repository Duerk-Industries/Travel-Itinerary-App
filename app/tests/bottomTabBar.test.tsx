import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import BottomTabBar, { type AddOption } from '../components/BottomTabBar';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('light', 'light');
const addOptions: AddOption[] = [
  { key: 'expense', label: 'Expense', icon: 'expense' },
  { key: 'flight', label: 'Flight', icon: 'flight' },
];

const renderBar = (props: Partial<React.ComponentProps<typeof BottomTabBar>> = {}) => {
  const onNavigate = jest.fn();
  const onChooseAdd = jest.fn();
  const view = render(
    <BottomTabBar
      theme={theme}
      activePage="home"
      leftTabs={[{ page: 'home', label: 'Home', icon: 'home' }, { page: 'overview', label: 'Itinerary', icon: 'itinerary' }]}
      rightTabs={[{ page: 'blog', label: 'Blog', icon: 'blog' }, { page: 'account', label: 'Profile', icon: 'profile' }]}
      addOptions={addOptions}
      addTitle="Add to Lisbon Long Weekend"
      onNavigate={onNavigate}
      onChooseAdd={onChooseAdd}
      {...props}
    />
  );
  return { ...view, onNavigate, onChooseAdd };
};

describe('BottomTabBar', () => {
  it('navigates to the page of the tab that is pressed', () => {
    const { getByTestId, onNavigate } = renderBar();
    fireEvent.press(getByTestId('bottom-tab-overview'));
    expect(onNavigate).toHaveBeenCalledWith('overview');
  });

  it('marks the current tab selected, and counts every account page as Profile', () => {
    const { getByTestId } = renderBar({ activePage: 'account-preferences' });
    expect(getByTestId('bottom-tab-account').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('bottom-tab-home').props.accessibilityState).toEqual({ selected: false });
  });

  it('opens the Add menu and reports the chosen option, closing the menu', () => {
    const { getByTestId, queryByTestId, onNavigate, onChooseAdd } = renderBar();
    expect(queryByTestId('add-sheet')).toBeNull();
    fireEvent.press(getByTestId('bottom-tab-add'));
    const sheet = getByTestId('add-sheet');
    expect(within(sheet).getByText('Add to Lisbon Long Weekend')).toBeTruthy();
    fireEvent.press(within(sheet).getByTestId('add-option-expense'));
    expect(onChooseAdd).toHaveBeenCalledWith('expense');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(queryByTestId('add-sheet')).toBeNull();
  });

  it('closes the Add menu from Cancel without navigating', () => {
    const { getByTestId, queryByTestId, onNavigate, onChooseAdd } = renderBar();
    fireEvent.press(getByTestId('bottom-tab-add'));
    fireEvent.press(getByTestId('add-sheet-cancel'));
    expect(onChooseAdd).not.toHaveBeenCalled();
    expect(queryByTestId('add-sheet')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
