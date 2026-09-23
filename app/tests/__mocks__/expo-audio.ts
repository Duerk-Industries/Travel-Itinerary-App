// Minimal stand-in for the native recording module (unavailable in the jsdom/node test
// environment) — real coverage of record/stop/transcribe flows lives in
// tests/blogMediaMetadataEditor.test.tsx, which overrides these jest.fn()s per test.
export const useAudioRecorder = jest.fn(() => ({
  prepareToRecordAsync: jest.fn(async () => {}),
  record: jest.fn(),
  stop: jest.fn(async () => {}),
  uri: 'file:///mock-recording.m4a',
}));

export const RecordingPresets = {
  HIGH_QUALITY: {},
  LOW_QUALITY: {},
};

export const requestRecordingPermissionsAsync = jest.fn(async () => ({ granted: true, status: 'granted' }));
export const getRecordingPermissionsAsync = jest.fn(async () => ({ granted: true, status: 'granted' }));
