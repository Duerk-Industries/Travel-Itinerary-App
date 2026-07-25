export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
}

export const validateVideoEnvelope = (probe: VideoProbe): void => {
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0 || probe.durationSeconds > 300) throw new Error('Video duration exceeds the 5 minute limit');
  if (!Number.isInteger(probe.width) || !Number.isInteger(probe.height) || probe.width <= 0 || probe.height <= 0 || probe.width > 3840 || probe.height > 2160) throw new Error('Video resolution exceeds the 4K limit');
  if (!Number.isFinite(probe.frameRate) || probe.frameRate <= 0 || probe.frameRate > 60) throw new Error('Video frame rate exceeds the 60 fps limit');
};

export const outputProfile = Object.freeze({ codec: 'h264', audioCodec: 'aac', maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, container: 'mp4' });
