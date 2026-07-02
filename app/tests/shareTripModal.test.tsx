/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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
});
