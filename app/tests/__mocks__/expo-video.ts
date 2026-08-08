import React from 'react';

export const useVideoPlayer = jest.fn((source: unknown, setup?: (player: any) => void) => {
  const player = { loop: false, play: jest.fn(), pause: jest.fn() };
  if (setup) setup(player);
  return player;
});

// A minimal stand-in that renders as a plain View-like element so RTL queries against it don't
// need real native video decoding (unavailable in the jsdom/node test environment).
export const VideoView = (props: Record<string, unknown>) => React.createElement('video-view', props);

export const isPictureInPictureSupported = jest.fn(() => false);
