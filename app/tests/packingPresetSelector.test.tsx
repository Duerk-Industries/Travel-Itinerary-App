/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PackingPresetSelector from '../components/PackingPresetSelector';

const theme = {
  colors: { text: '#000', textMuted: '#555', border: '#ddd', surface: '#fff' },
};

const baseProps = {
  backendUrl: 'http://localhost',
  headers: { Authorization: 'Bearer test-token' },
  jsonHeaders: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  theme,
};

describe('PackingPresetSelector', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders nothing when packing_lists_v2 is disabled (404)', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ status: 404, ok: false } as any);
    const { queryByTestId } = render(<PackingPresetSelector {...baseProps} />);
    await waitFor(() => expect(queryByTestId('account-packing-presets-loading')).toBeNull());
    expect(queryByTestId('account-packing-presets')).toBeNull();
  });

  test('shows General as always-on plus presets that can be added to the custom list', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        preferences: { presetKeys: ['general', 'beach'] },
        presets: [
          { key: 'general', label: 'General', isActive: true },
          { key: 'beach', label: 'Beach & Tropical', description: 'Swim and sand gear', isActive: true },
          { key: 'hiking', label: 'Hiking & Trekking', isActive: true },
        ],
      }),
    } as any);

    const { getByTestId, queryByTestId } = render(<PackingPresetSelector {...baseProps} />);
    await waitFor(() => expect(queryByTestId('account-packing-presets')).toBeTruthy());

    const generalToggle = getByTestId('account-packing-preset-toggle-general');
    expect(generalToggle.props.disabled).toBe(true);
    expect(generalToggle.props.value).toBe(true);

    expect(getByTestId('account-packing-preset-toggle-beach').props.children).toBeTruthy();
    expect(getByTestId('account-packing-preset-toggle-hiking').props.children).toBeTruthy();
  });

  test('adding a preset posts a materialization request immediately', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          preferences: { presetKeys: ['general'] },
          presets: [
            { key: 'general', label: 'General', isActive: true },
            { key: 'hiking', label: 'Hiking & Trekking', isActive: true },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ preferences: { presetKeys: ['general'] }, items: [{ category: 'Hiking', label: 'Trail shoes' }] }),
      } as any);

    const { getByTestId } = render(<PackingPresetSelector {...baseProps} />);
    await waitFor(() => expect(getByTestId('account-packing-preset-toggle-hiking')).toBeTruthy());

    fireEvent.press(getByTestId('account-packing-preset-toggle-hiking'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, postCall] = fetchMock.mock.calls as any[];
    expect(postCall[0]).toBe('http://localhost/api/account/packing-list-presets/hiking');
    expect(postCall[1]?.method).toBe('POST');
  });
});
