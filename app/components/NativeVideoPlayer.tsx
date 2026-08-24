// @ts-nocheck
// Native (iOS/Android) inline video playback for trip-blog media, via expo-video. Split out of
// BlogMediaPreview into its own component because `useVideoPlayer` is a hook and BlogMediaPreview
// conditionally decides between this and <Image>/web <video> — hooks can't be called from inside
// that kind of branch, so the branch instead picks which *component* to mount.
import React from 'react';
import { VideoView, useVideoPlayer } from 'expo-video';

// `height`/`muted`/`showControls` let a compact caller (the DayMediaGallery mosaic) request a
// fixed-size, silent, control-free tile — tapping the tile opens the full lightbox for real
// playback, so this rendering never needs its own controls in that context. Omitting them keeps
// every existing full-size caller unchanged.
const NativeVideoPlayer = ({ uri, backgroundColor, height = 220, muted = false, showControls = true }) => {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = muted;
  });

  return (
    <VideoView
      testID="blog-media-video-native"
      player={player}
      style={{ width: '100%', height, borderRadius: 8, backgroundColor }}
      nativeControls={showControls}
      contentFit={showControls ? 'contain' : 'cover'}
    />
  );
};

export default NativeVideoPlayer;
