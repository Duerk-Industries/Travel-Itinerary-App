/** @jest-environment node */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Text: 'Text',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  TouchableHighlight: 'TouchableHighlight',
  Pressable: 'Pressable',
  View: 'View',
  Image: 'Image',
  ImageBackground: 'ImageBackground',
  FlatList: 'FlatList',
  SectionList: 'SectionList',
  Switch: 'Switch',
  Modal: 'Modal',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  SafeAreaView: 'SafeAreaView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value },
  Linking: { openURL: jest.fn(async () => undefined) },
}));

import { GetYourGuideCta } from '../components/GetYourGuideCta';
import { Linking } from 'react-native';

const descriptor = {
  provider: 'getyourguide',
  kind: 'activity',
  token: 'g1.aaaaaaaa.aaaaaaaa.aaaaaaaa',
  disclosureRequired: true,
  expiresAt: '2099-01-01T00:00:00.000Z',
  rulesVersion: 'getyourguide-eligibility-v1',
};

const activity = {
  id: 'activity-1',
  name: 'Louvre Museum Guided Tour',
  activityType: 'Tour',
  date: '2026-09-02',
  startTime: '10:00',
  duration: '2 hours',
};

describe('GetYourGuide CTA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => descriptor } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders only after a valid descriptor arrives and includes accessible disclosure', async () => {
    const { queryByTestId, findByTestId, findByText } = render(
      <GetYourGuideCta backendUrl="https://wanderbunnies.test" activity={activity} destination="Paris, France" />
    );
    expect(queryByTestId('getyourguide-cta-activity-1')).toBeNull();
    expect(await findByTestId('getyourguide-cta-activity-1')).toBeTruthy();
    expect(await findByText('Explore experiences on GetYourGuide ↗')).toBeTruthy();
    expect(await findByText(/Affiliate link/)).toBeTruthy();
  });

  it('renders no placeholder for non-qualifying or unavailable activities', async () => {
    const { queryByTestId } = render(
      <GetYourGuideCta
        backendUrl="https://wanderbunnies.test"
        activity={{ ...activity, activityType: 'Shopping' }}
        destination="Paris, France"
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryByTestId('getyourguide-cta-activity-1')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('opens the server endpoint through the native opener', async () => {
    const { findByTestId } = render(
      <GetYourGuideCta backendUrl="https://wanderbunnies.test" activity={activity} destination="Paris, France" />
    );
    fireEvent.press(await findByTestId('getyourguide-cta-activity-1-link'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('/api/affiliate/getyourguide?token=')));
  });
});
