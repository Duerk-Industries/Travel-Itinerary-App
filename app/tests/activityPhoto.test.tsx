/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react-native';
import ActivityPhoto from '../components/ActivityPhoto';
import { normalizeActivityFromApi } from '../tabs/activities';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme } from '../theme/theme';

const mount = (ui: React.ReactElement) => render(<ThemeProvider theme={getAppTheme('light', 'light')}>{ui}</ThemeProvider>);

describe('ActivityPhoto', () => {
  it('shows the picture with its photographer credit', () => {
    const view = mount(<ActivityPhoto image={{ url: 'https://images.example/louvre.jpg', credit: 'Ada Lovelace, Unsplash' }} name="Louvre" testID="photo" />);
    expect(view.getByTestId('photo')).toBeTruthy();
    expect(view.getByLabelText('Louvre').props.source).toEqual({ uri: 'https://images.example/louvre.jpg' });
    expect(view.getByText('Photo: Ada Lovelace, Unsplash')).toBeTruthy();
  });

  it('renders nothing for an activity with no picture', () => {
    expect(mount(<ActivityPhoto image={null} name="Walk" testID="none" />).queryByTestId('none')).toBeNull();
    expect(mount(<ActivityPhoto image={undefined} name="Walk" testID="none" />).queryByTestId('none')).toBeNull();
  });

  it('keeps the picture the server sent on an activity', () => {
    const image = { url: 'https://images.example/a.jpg', credit: 'Someone, CC0', pageUrl: 'https://commons.example/a' };
    expect(normalizeActivityFromApi({ id: 'a', name: 'Walk', image }).image).toEqual(image);
  });
});
