/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import GmailForwardingConfirmation from '../components/GmailForwardingConfirmation';
jest.mock('../utils/clipboard', () => ({ copyToClipboard: jest.fn(async () => 'copied') }));
import { copyToClipboard } from '../utils/clipboard';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });
it('shows a verified code, copies it only on request and never follows a message link', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ confirmations: [{ id: 'one', code: '123456789', requestedBy: 'owner@gmail.com', expiresAt: Date.now() + 60_000, url: 'https://evil.test/approve' }] }) })) as unknown as typeof fetch;
  const screen = render(<GmailForwardingConfirmation address="private@example.com" backendUrl="https://api.test" headers={{ Authorization: 'Bearer owner' }} />);
  await waitFor(() => expect(screen.getByText('123456789')).toBeTruthy());
  expect(screen.queryByText(/evil.test/)).toBeNull(); expect(copyToClipboard).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Copy Gmail code'));
  await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('123456789'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('fences account/alias changes and discards expired or invalid codes', async () => {
  let finish!: (response: Response) => void;
  global.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; })) as unknown as typeof fetch;
  const screen = render(<GmailForwardingConfirmation address="old@example.com" backendUrl="https://api.test" headers={{ Authorization: 'Bearer old' }} />);
  const old = finish;
  screen.rerender(<GmailForwardingConfirmation address="new@example.com" backendUrl="https://api.test" headers={{ Authorization: 'Bearer new' }} />);
  await act(async () => { old({ ok: true, json: async () => ({ confirmations: [{ id: 'old', code: '123456789', expiresAt: Date.now() + 60_000 }] }) } as Response); });
  expect(screen.queryByText('123456789')).toBeNull();
  await act(async () => { finish({ ok: true, json: async () => ({ confirmations: [{ id: 'bad', code: '<script>', expiresAt: Date.now() + 60_000 }, { id: 'expired', code: '987654321', expiresAt: Date.now() - 1 }] }) } as Response); });
  expect(screen.queryByText('987654321')).toBeNull(); expect(screen.queryByText('<script>')).toBeNull();
});
