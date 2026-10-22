/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ImportSenderAddresses from '../components/ImportSenderAddresses';

const styles: Record<string, any> = { button: {}, buttonText: {}, helperText: {}, sectionTitle: {}, row: {} };
const res = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

const mount = (confirmStatus = 200) => {
  let list: any[] = [];
  const calls: string[] = [];
  (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    if (method === 'GET') return res({ addresses: list });
    if (method === 'POST' && url.endsWith('/confirm')) {
      calls.push(`confirm:${init?.body}`);
      if (confirmStatus !== 200) return res({ error: 'That code is not valid. Request a new one.' }, confirmStatus);
      list = [{ id: 'a1', email: 'me@example.com', status: 'VERIFIED', verifiedAt: 1 }];
      return res({ address: list[0] });
    }
    if (method === 'POST') { calls.push(`start:${init?.body}`); return res({ status: 'PENDING' }, 202); }
    if (method === 'DELETE') { calls.push('delete'); list = []; return res({ removed: true }); }
    return res({}, 404);
  });
  return { screen: render(<ImportSenderAddresses backendUrl="https://x.test" headers={{ Authorization: 'Bearer t' }} styles={styles} />), calls };
};

describe('ImportSenderAddresses', () => {
  it('sends a code, confirms it and lists the confirmed address, then removes it', async () => {
    const { screen, calls } = mount();
    expect((global as any).fetch).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('import-sender-toggle'));
    expect(screen.getByTestId('import-sender-send').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('import-sender-email'), 'me@example.com');
    fireEvent.press(screen.getByTestId('import-sender-send'));
    await screen.findByTestId('import-sender-code');
    expect(screen.getByText(/We sent a code to me@example.com/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('import-sender-code'), 'abcd2345');
    fireEvent.press(screen.getByTestId('import-sender-confirm'));
    await screen.findByText('me@example.com · Confirmed');
    expect(calls).toEqual(['start:{"email":"me@example.com"}', 'confirm:{"email":"me@example.com","code":"abcd2345"}']);
    fireEvent.press(screen.getByTestId('import-sender-remove-a1'));
    await waitFor(() => expect(screen.queryByText('me@example.com · Confirmed')).toBeNull());
  });

  it('shows the server message for a wrong code and keeps the code box open', async () => {
    const { screen } = mount(400);
    fireEvent.press(screen.getByTestId('import-sender-toggle'));
    fireEvent.changeText(screen.getByTestId('import-sender-email'), 'me@example.com');
    fireEvent.press(screen.getByTestId('import-sender-send'));
    fireEvent.changeText(await screen.findByTestId('import-sender-code'), 'zzzzzzzz');
    fireEvent.press(screen.getByTestId('import-sender-confirm'));
    await screen.findByText('That code is not valid. Request a new one.');
    expect(screen.getByTestId('import-sender-code')).toBeTruthy();
  });
});
