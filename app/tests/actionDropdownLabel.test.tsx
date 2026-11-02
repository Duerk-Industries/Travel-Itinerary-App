import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ActionDropdown from '../components/ActionDropdown';

const styles = { button: {}, smallButton: {}, buttonText: {}, userNameButtonText: {} };

describe('ActionDropdown as the top-bar name menu', () => {
  it('shows the given label on the trigger and runs the chosen action', () => {
    const onProfile = jest.fn();
    const onLogout = jest.fn();
    const view = render(
      <ActionDropdown testID="topbar-user-menu" label="Alex Traveler" accessibilityLabel="Account menu" styles={styles}
        actions={[{ id: 'topbar-profile', label: 'Profile', onSelect: onProfile }, { id: 'topbar-logout', label: 'Log out', onSelect: onLogout }]} />
    );
    expect(view.getByText(/Alex Traveler/)).toBeTruthy();
    expect(view.queryByText('Log out')).toBeNull();
    fireEvent.press(view.getByTestId('topbar-user-menu'));
    expect(view.getByText('Profile')).toBeTruthy();
    fireEvent.press(view.getByTestId('topbar-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(onProfile).not.toHaveBeenCalled();
  });
});
