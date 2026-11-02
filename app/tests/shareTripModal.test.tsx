/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ShareTripModal from '../components/ShareTripModal';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      scheme: 'travelitineraryplanner',
    },
  },
}));

const styles = {
  modalOverlay: {},
  modalCard: {},
  detailModal: {},
  row: {},
  sectionTitle: {},
  linkText: {},
  buttonText: {},
  errorText: {},
  helperText: {},
  modalLabel: {},
  input: {},
  button: {},
  smallButton: {},
  buttonDisabled: {},
  divider: {},
  bodyText: {},
  dangerButton: {},
  dangerButtonText: {},
};

describe('ShareTripModal', () => {
  it('loads share settings without navigating to trip settings', async () => {
    const originalFetch = global.fetch;
    if (!global.fetch) {
      (global as any).fetch = jest.fn();
    }
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ followCode: 'ABC123', invites: [] }),
    } as any);

    const { getByDisplayValue, getByText } = render(
      <ShareTripModal
        visible
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer test' }}
        trip={{ id: 't1', name: 'Share Trip' }}
        styles={styles}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => expect(getByText('Share link (Follower access)')).toBeTruthy());
    await waitFor(() => expect(getByDisplayValue('travelitineraryplanner://app?followCode=ABC123')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/api/trips/t1/share/meta', {
      headers: { Authorization: 'Bearer test' },
    });

    fetchMock.mockRestore();
    if (!originalFetch) {
      delete (global as any).fetch;
    }
  });

  describe('invite role', () => {
    const invitePosts = (fetchMock: jest.Mock) => fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith('/share/invites') && init?.method === 'POST')
      .map(([, init]) => JSON.parse(init.body).invites[0].role);

    const mountWithInviteApi = () => {
      const fetchMock = jest.fn(async (url: string, init?: any): Promise<any> => {
        if (String(url).endsWith('/share/invites') && init?.method === 'POST') return { ok: true, json: async () => ({ invites: [{ id: 'i1' }] }), text: async () => '{}' };
        if (String(url).endsWith('/share/meta')) return { ok: true, text: async () => JSON.stringify({ followCode: 'ABC123', invites: [] }) };
        return { ok: true, text: async () => JSON.stringify({ followers: [] }) };
      });
      (global as any).fetch = fetchMock;
      const view = render(
        <ShareTripModal visible backendUrl="http://localhost" headers={{ Authorization: 'Bearer test' }} trip={{ id: 't1', name: 'Share Trip' }} styles={styles} onClose={jest.fn()} />
      );
      return { fetchMock, view };
    };
    const send = async (view: ReturnType<typeof render>, email: string) => {
      fireEvent.changeText(view.getByTestId('share-trip-invite-emails'), email);
      fireEvent.press(view.getByTestId('share-trip-send'));
      await waitFor(() => expect(view.getByText('Processed 1 invite(s).')).toBeTruthy());
    };
    const originalFetch = global.fetch;
    afterEach(() => { if (originalFetch) (global as any).fetch = originalFetch; else delete (global as any).fetch; });

    it('invites as a Member by default, and keeps the role after sending', async () => {
      const { fetchMock, view } = mountWithInviteApi();
      await send(view, 'one@example.com');
      await send(view, 'two@example.com');
      expect(invitePosts(fetchMock)).toEqual(['member', 'member']);
    });

    it('keeps a role picked for the first invite for the next one', async () => {
      const { fetchMock, view } = mountWithInviteApi();
      fireEvent.press(view.getByText('Follower'));
      await send(view, 'one@example.com');
      await send(view, 'two@example.com');
      expect(invitePosts(fetchMock)).toEqual(['follower', 'follower']);
    });
  });

});
