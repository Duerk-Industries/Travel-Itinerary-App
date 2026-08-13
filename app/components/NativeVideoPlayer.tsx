// @ts-nocheck
// Native (iOS/Android) inline video playback for trip-blog media, via expo-video. Split out of
// BlogMediaPreview into its own component because `useVideoPlayer` is a hook and BlogMediaPreview
// conditionally decides between this and <Image>/web <video> — hooks can't be called from inside
// that kind of branch, so the branch instead picks which *component* to mount.
import React from 'react';
import { VideoView, useVideoPlayer } from 'expo-video';

const NativeVideoPlayer = ({ uri, backgroundColor }) => {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  return (
    <VideoView
      testID="blog-media-video-native"
      player={player}
      style={{ width: '100%', height: 220, borderRadius: 8, backgroundColor }}
      nativeControls
      contentFit="contain"
    />
  );
};

export default NativeVideoPlayer;
