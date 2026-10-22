/// <reference types="jest" />
import { actualAudioType, readLocalBlob } from '../utils/localBlob';

describe('actualAudioType', () => {
  it('uses the format the browser really recorded, without codec details', () => {
    expect(actualAudioType('audio/mp4;codecs=mp4a.40.2', 'audio/m4a')).toEqual({ mimeType: 'audio/mp4', extension: 'm4a' });
    expect(actualAudioType('audio/webm;codecs=opus', 'audio/m4a')).toEqual({ mimeType: 'audio/webm', extension: 'webm' });
  });

  it('falls back when the type is missing or unknown', () => {
    expect(actualAudioType('', 'audio/m4a')).toEqual({ mimeType: 'audio/m4a', extension: 'm4a' });
    expect(actualAudioType('application/octet-stream', 'audio/m4a')).toEqual({ mimeType: 'audio/m4a', extension: 'm4a' });
  });
});

describe('readLocalBlob', () => {
  const originalFetch = (global as any).fetch;
  const originalXhr = (global as any).XMLHttpRequest;
  afterEach(() => { (global as any).fetch = originalFetch; (global as any).XMLHttpRequest = originalXhr; });

  it('falls back to fetch when XMLHttpRequest fails, and retries a transient failure', async () => {
    (global as any).XMLHttpRequest = undefined;
    const blob = new Blob(['audio']);
    let calls = 0;
    (global as any).fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Load failed');
      return { blob: async () => blob };
    });
    await expect(readLocalBlob('blob:https://wander-bunnies.com/abc')).resolves.toBe(blob);
    expect(calls).toBe(2);
  });

  it('reports the underlying error when every attempt fails', async () => {
    (global as any).XMLHttpRequest = undefined;
    (global as any).fetch = jest.fn(async () => { throw new TypeError('Load failed'); });
    await expect(readLocalBlob('blob:x')).rejects.toThrow('Load failed');
  });
});
