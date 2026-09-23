/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import PackingListMatrix from '../components/PackingListMatrix';

const colors = {
  border: '#ccd4df',
  text: '#111827',
  textMuted: '#64748b',
  backgroundAlt: '#f1f5f9',
  success: '#16a34a',
  surface: '#ffffff',
};

const props = {
  items: [{ id: 'sunscreen', label: 'Sunscreen', category: 'Essentials' }],
  travelers: [{ id: 'alex', name: 'Alex' }],
  colors,
};

const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return (style ?? {}) as Record<string, unknown>;
};

describe('PackingListMatrix column alignment', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    (Platform as any).OS = originalPlatform;
  });

  it.each(['web', 'ios'])('uses the same traveler-column width in the %s table header and body', (platform) => {
    (Platform as any).OS = platform;
    const screen = render(<PackingListMatrix {...props} />);

    const header = platform === 'web'
      ? screen.getByTestId('packing-matrix-web-header-alex')
      : screen.getByText('Alex').parent!;
    const body = screen.getByTestId('packing-check-sunscreen-alex');

    expect(flattenStyle(header.props.style)).toMatchObject({ width: 110 });
    expect(flattenStyle(body.props.style)).toMatchObject({ width: 110 });
  });
});
