/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import BlogPublicDefaultToggle from '../components/BlogPublicDefaultToggle';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('dark' as any, 'dark');
const styles = { modalLabel: {}, row: {}, cellText: {}, helperText: {} };
const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response);

describe('BlogPublicDefaultToggle', () => {
  it('defaults to public, loads the saved value, and saves changes', async () => {
    const fetchMock = jest.fn((url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ publicByDefault: false }) : json({ publicByDefault: true }));
    (global as any).fetch = fetchMock;
    const view = render(<BlogPublicDefaultToggle backendUrl="http://api.test" headers={{ Authorization: 'Bearer t' }} styles={styles} theme={theme} />);
    const toggle = view.getByTestId('blog-public-default-switch');
    expect(toggle.props.value).toBe(true);
    await waitFor(() => expect(view.getByTestId('blog-public-default-switch').props.disabled).toBeFalsy());

    await act(async () => { fireEvent(view.getByTestId('blog-public-default-switch'), 'valueChange', false); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/account/blog-defaults',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ publicByDefault: false }) }),
    ));
    expect(view.getByTestId('blog-public-default-switch').props.value).toBe(false);
  });

  it('reverts the switch and shows an error when saving fails', async () => {
    (global as any).fetch = jest.fn((url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ error: 'Nope' }, false) : json({ publicByDefault: true }));
    const view = render(<BlogPublicDefaultToggle backendUrl="http://api.test" headers={{}} styles={styles} theme={theme} />);
    await waitFor(() => expect(view.getByTestId('blog-public-default-switch').props.disabled).toBeFalsy());
    await act(async () => { fireEvent(view.getByTestId('blog-public-default-switch'), 'valueChange', false); });
    expect(await view.findByText('Nope')).toBeTruthy();
    expect(view.getByTestId('blog-public-default-switch').props.value).toBe(true);
  });
});
