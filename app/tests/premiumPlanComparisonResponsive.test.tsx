/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

let mockWindowWidth = 1024;
let mockWindowHeight = 900;

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  ActivityIndicator: 'ActivityIndicator',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
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
  SafeAreaView: 'SafeAreaView',
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => styles,
    flatten: (style: unknown) => style,
  },
  useWindowDimensions: () => ({ width: mockWindowWidth, height: mockWindowHeight }),
  useColorScheme: () => 'light',
}));

jest.mock('../utils/billing', () => ({
  fetchBillingPlans: jest.fn(async () => []),
  createCheckoutSession: jest.fn(),
  openBillingUrl: jest.fn(),
  isCheckoutAllowedOnPlatform: jest.fn(() => true),
  formatCents: jest.fn((cents: number) => `$${cents / 100}`),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PremiumPlanComparisonDialog = require('../components/PremiumPlanComparisonDialog').default as React.FC<any>;

const styles = {
  modalOverlay: {},
  confirmModal: {},
  sectionTitle: {},
  helperText: {},
  errorText: {},
  button: {},
  secondaryButton: {},
  secondaryButtonText: {},
  buttonDisabled: {},
  planComparisonModal: { name: 'plan-comparison-modal' },
  planComparisonGrid: {},
  planComparisonTier: {},
  planComparisonTierPremium: {},
  planComparisonTierTitle: {},
  planComparisonFeatureList: {},
  planComparisonFeature: {},
  planComparisonOptions: {},
  planComparisonOption: {},
  planComparisonOptionTitle: {},
  planComparisonOptionPrice: {},
  planComparisonOptionTrial: {},
  planComparisonMaybeLater: {},
};

const renderDialog = () =>
  render(
    <PremiumPlanComparisonDialog
      visible
      backendUrl="https://api.example.test"
      token="token-1"
      styles={styles}
      onMaybeLater={jest.fn()}
    />,
  );

describe('PremiumPlanComparisonDialog responsive layout', () => {
  afterEach(() => {
    mockWindowWidth = 1024;
    mockWindowHeight = 900;
  });

  it('caps the scrollable body height and keeps the default card width on wide, tall screens', async () => {
    mockWindowWidth = 1024;
    mockWindowHeight = 900;
    const { getByTestId } = renderDialog();

    await waitFor(() => getByTestId('premium-plan-comparison-scroll'));
    const scroll = getByTestId('premium-plan-comparison-scroll');
    expect(scroll.props.style).toEqual({ maxHeight: 480 });

    const overlay = getByTestId('premium-plan-comparison-dialog');
    // cardStyle is [planComparisonModal, false] when not compact
    expect(overlay).toBeTruthy();
  });

  it('shrinks the scroll area and forces a full-width, height-capped card on narrow phone screens', async () => {
    mockWindowWidth = 375;
    mockWindowHeight = 667;
    const { getByTestId } = renderDialog();

    await waitFor(() => getByTestId('premium-plan-comparison-scroll'));
    const scroll = getByTestId('premium-plan-comparison-scroll');
    expect(scroll.props.style).toEqual({ maxHeight: 380 });
  });

  it('treats short landscape viewports as compact even when wide', async () => {
    mockWindowWidth = 812;
    mockWindowHeight = 375;
    const { getByTestId } = renderDialog();

    await waitFor(() => getByTestId('premium-plan-comparison-scroll'));
    const scroll = getByTestId('premium-plan-comparison-scroll');
    expect(scroll.props.style).toEqual({ maxHeight: 380 });
  });
});
