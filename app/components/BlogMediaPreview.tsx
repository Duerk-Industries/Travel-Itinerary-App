// @ts-nocheck
// Shared by app/tabs/tripBlog.tsx and the day-gallery/lightbox components — pulled out of
// tripBlog.tsx (which re-exports both names for backward compatibility) so the gallery/lightbox
// components can import it without a circular tabs<->components import.
import React, { useEffect, useState } from 'react';
import { Image, Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import NativeVideoPlayer from './NativeVideoPlayer';

export const resolveMediaAspectRatio = (width, height) => {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  if (!Number.isFinite(numericWidth) || !Number.isFinite(numericHeight) || numericWidth <= 0 || numericHeight <= 0) {
    return null;
  }
  return numericWidth / numericHeight;
};

// `tileHeight`, when passed, opts into a fixed-height "cover" crop instead of the default
// intrinsic-aspect-ratio/letterboxed rendering — used by the DayMediaGallery mosaic, where every
// tile in a row must line up regardless of each photo's own aspect ratio. Omitting it keeps every
// existing caller (the lightbox, standalone item media) rendering exactly as before.
export const BlogMediaPreview = ({ item, backgroundColor, tileHeight = null }) => {
  const [aspectRatio, setAspectRatio] = useState(null);
  const mediaUrl = item.primaryUrl || item.thumbnailUrl;
  const isTile = tileHeight != null;

  useEffect(() => {
    setAspectRatio(null);
  }, [mediaUrl]);

  if (item.kindKey === 'media.video') {
    if (Platform.OS === 'web') {
      return React.createElement('video', {
        testID: 'blog-media-video-web',
        src: mediaUrl,
        controls: !isTile,
        muted: isTile,
        playsInline: true,
        preload: 'metadata',
        style: {
          display: 'block',
          width: '100%',
          height: isTile ? tileHeight : 'auto',
          maxWidth: '100%',
          borderRadius: 8,
          backgroundColor,
          objectFit: isTile ? 'cover' : undefined,
        },
      });
    }
    // Native (iOS/Android): previously fell through to <Image> below, which tried to decode a
    // video URL as an image and silently showed nothing — expo-video plays it properly instead.
    if (!mediaUrl) return null;
    return <NativeVideoPlayer uri={mediaUrl} backgroundColor={backgroundColor} height={tileHeight ?? undefined} muted={isTile} showControls={!isTile} />;
  }

  if (item.kindKey === 'media.audio') {
    if (Platform.OS === 'web') {
      return React.createElement('audio', {
        testID: 'blog-media-audio-web',
        src: mediaUrl,
        controls: true,
        preload: 'metadata',
        style: { width: '100%' },
      });
    }
    return (
      <View style={{ padding: 12, borderRadius: 8, backgroundColor }}>
        <TouchableOpacity accessibilityRole="button" disabled={!mediaUrl} onPress={() => mediaUrl && Linking.openURL(mediaUrl)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontWeight: '700' }}>▶ Play voice note</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Image
      testID="blog-media-photo"
      source={{ uri: mediaUrl }}
      style={isTile ? {
        width: '100%',
        height: tileHeight,
        borderRadius: 8,
        backgroundColor,
      } : {
        width: '100%',
        ...(aspectRatio ? { aspectRatio } : { height: 200 }),
        borderRadius: 8,
        backgroundColor,
      }}
      resizeMode={isTile ? 'cover' : 'contain'}
      onLoad={(event) => {
        const source = event?.nativeEvent?.source;
        const nextAspectRatio = resolveMediaAspectRatio(source?.width, source?.height);
        if (nextAspectRatio) setAspectRatio(nextAspectRatio);
      }}
    />
  );
};
