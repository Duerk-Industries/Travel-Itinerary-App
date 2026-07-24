import { outputProfile, validateVideoEnvelope } from '../src/services/blogVideoProcessingService';

describe('trip blog video safety envelope', () => {
  it('accepts a compliant source and publishes a bounded output profile', () => {
    expect(() => validateVideoEnvelope({ durationSeconds: 60, width: 3840, height: 2160, frameRate: 60 })).not.toThrow();
    expect(outputProfile).toMatchObject({ codec: 'h264', audioCodec: 'aac', maxWidth: 1920, maxFrameRate: 30 });
  });
  it.each([
    [{ durationSeconds: 301, width: 1920, height: 1080, frameRate: 30 }],
    [{ durationSeconds: 10, width: 4096, height: 2160, frameRate: 30 }],
    [{ durationSeconds: 10, width: 1920, height: 1080, frameRate: 61 }],
  ])('rejects unsafe probe %j', (probe) => expect(() => validateVideoEnvelope(probe as any)).toThrow());
});
