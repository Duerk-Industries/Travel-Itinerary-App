/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

describe('TripBlogTab with no active trip', () => {
  it('shows only the select-a-trip prompt and makes no network requests', async () => {
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    const view = render(
      <TripBlogTab backendUrl="https://wanderbunnies.test" headers={{}} activeTripId={null} styles={{ sectionTitle: {} }} theme={{ colors: {} }} />
    );
    expect(await view.findByText('Select a trip to write its blog.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
