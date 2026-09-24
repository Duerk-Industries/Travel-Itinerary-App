/// <reference types="jest" />

import { resolveMediaAspectRatio, isVideoMimeType, guessMimeTypeFromName, SUPPORTED_MIME_TYPES } from '../tabs/tripBlog';
import { isAudioMimeType, SUPPORTED_AUDIO_MIME_TYPES } from '../utils/blogUpload';

describe('trip blog media sizing', () => {
  it('preserves valid intrinsic width-to-height ratios', () => {
    expect(resolveMediaAspectRatio(4032, 3024)).toBeCloseTo(4 / 3);
    expect(resolveMediaAspectRatio(1080, 1920)).toBeCloseTo(9 / 16);
  });

  it('ignores missing or invalid intrinsic dimensions', () => {
    expect(resolveMediaAspectRatio(0, 1080)).toBeNull();
    expect(resolveMediaAspectRatio(1920, undefined)).toBeNull();
    expect(resolveMediaAspectRatio('not-a-width', 1080)).toBeNull();
  });
});

describe('trip blog mixed photo/video upload classification', () => {
  it('classifies video mime types so a mixed batch sends the correct mediaKind per file', () => {
    expect(isVideoMimeType('video/mp4')).toBe(true);
    expect(isVideoMimeType('video/quicktime')).toBe(true);
    expect(isVideoMimeType('video/webm')).toBe(true);
    expect(isVideoMimeType('image/jpeg')).toBe(false);
    expect(isVideoMimeType('image/png')).toBe(false);
  });

  it('filters unsupported mime types out before an upload is even attempted', () => {
    expect(SUPPORTED_MIME_TYPES).toEqual(
      expect.arrayContaining(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm'])
    );
    expect(SUPPORTED_MIME_TYPES).not.toContain('image/heic');
    expect(SUPPORTED_MIME_TYPES).not.toContain('video/x-msvideo');
  });

  it('falls back to a filename-extension guess (including video) when no mimeType is reported', () => {
    expect(guessMimeTypeFromName('vacation.MOV')).toBe('video/quicktime');
    expect(guessMimeTypeFromName('clip.mp4')).toBe('video/mp4');
    expect(guessMimeTypeFromName('screen.webm')).toBe('video/webm');
    expect(guessMimeTypeFromName('sunset.jpg')).toBe('image/jpeg');
    expect(guessMimeTypeFromName('unknown.heic')).toBeNull();
  });

  it('keeps voice-note formats in their separately flagged picker path', () => {
    expect(isAudioMimeType('audio/m4a')).toBe(true);
    expect(SUPPORTED_AUDIO_MIME_TYPES).toEqual(expect.arrayContaining(['audio/mpeg', 'audio/m4a', 'audio/wav']));
    expect(SUPPORTED_MIME_TYPES).not.toContain('audio/m4a');
    expect(guessMimeTypeFromName('memo.m4a')).toBe('audio/m4a');
  });
});
