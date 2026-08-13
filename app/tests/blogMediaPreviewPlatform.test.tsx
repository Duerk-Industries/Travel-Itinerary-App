/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { BlogMediaPreview } from '../components/BlogMediaPreview';

const videoItem = { kindKey: 'media.video', primaryUrl: 'https://example.com/clip.mp4' };
const photoItem = { kindKey: 'media.photo', primaryUrl: 'https://example.com/photo.jpg' };

describe('BlogMediaPreview platform branching', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it('renders the web <video> element when Platform.OS is web', () => {
    Platform.OS = 'web';
    const { getByTestId, queryByTestId } = render(<BlogMediaPreview item={videoItem} backgroundColor="#fff" />);
    expect(getByTestId('blog-media-video-web')).toBeTruthy();
    expect(queryByTestId('blog-media-video-native')).toBeNull();
  });

  it('renders the native expo-video player when Platform.OS is not web', () => {
    Platform.OS = 'ios';
    const { getByTestId, queryByTestId } = render(<BlogMediaPreview item={videoItem} backgroundColor="#fff" />);
    expect(getByTestId('blog-media-video-native')).toBeTruthy();
    expect(queryByTestId('blog-media-video-web')).toBeNull();
  });

  it('renders a photo as <Image> on both web and native', () => {
    Platform.OS = 'web';
    expect(render(<BlogMediaPreview item={photoItem} backgroundColor="#fff" />).getByTestId('blog-media-photo')).toBeTruthy();
    Platform.OS = 'android';
    expect(render(<BlogMediaPreview item={photoItem} backgroundColor="#fff" />).getByTestId('blog-media-photo')).toBeTruthy();
  });
});
