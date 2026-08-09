/// <reference types="jest" />

import { planShareUpload, normalizeShareIntentFiles } from '../utils/incomingShare';

describe('planShareUpload', () => {
  it('turns a single shared item + message into that item\'s caption', () => {
    expect(planShareUpload(1, 'Sunset at the beach')).toEqual({
      captionForSingleItem: 'Sunset at the beach',
      dayMessage: null,
    });
  });

  it('turns multiple shared items + message into a general day message', () => {
    expect(planShareUpload(3, 'Great day exploring the old town')).toEqual({
      captionForSingleItem: null,
      dayMessage: 'Great day exploring the old town',
    });
  });

  it('does neither when there is no message', () => {
    expect(planShareUpload(1, undefined)).toEqual({ captionForSingleItem: null, dayMessage: null });
    expect(planShareUpload(3, '')).toEqual({ captionForSingleItem: null, dayMessage: null });
    expect(planShareUpload(3, '   ')).toEqual({ captionForSingleItem: null, dayMessage: null });
  });

  it('does neither when there are no items, even with a message', () => {
    expect(planShareUpload(0, 'orphaned message')).toEqual({ captionForSingleItem: null, dayMessage: null });
  });

  it('trims whitespace from the message before applying it', () => {
    expect(planShareUpload(1, '  padded caption  ')).toEqual({
      captionForSingleItem: 'padded caption',
      dayMessage: null,
    });
  });
});

describe('normalizeShareIntentFiles', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => { (global as any).fetch = originalFetch; });

  it('normalizes share-intent files into the { blob, mimeType, size, name } shape uploads expect', async () => {
    const fakeBlob = { size: 12345 };
    (global as any).fetch = jest.fn(async () => ({ blob: async () => fakeBlob }));

    const result = await normalizeShareIntentFiles([
      { path: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 12345 },
    ]);

    expect(result).toEqual([{ blob: fakeBlob, mimeType: 'image/jpeg', size: 12345, name: 'photo.jpg' }]);
  });

  it('falls back to a filename-extension mime-type guess when the share payload omits mimeType', async () => {
    const fakeBlob = { size: 999 };
    (global as any).fetch = jest.fn(async () => ({ blob: async () => fakeBlob }));

    const result = await normalizeShareIntentFiles([
      { path: 'file:///tmp/clip.mp4', fileName: 'clip.mp4', size: null },
    ]);

    expect(result).toEqual([{ blob: fakeBlob, mimeType: 'video/mp4', size: 999, name: 'clip.mp4' }]);
  });

  it('drops a file that fails to read instead of failing the whole batch', async () => {
    (global as any).fetch = jest.fn(async (path: string) => {
      if (path.includes('bad')) throw new Error('ENOENT');
      return { blob: async () => ({ size: 1 }) };
    });

    const result = await normalizeShareIntentFiles([
      { path: 'file:///tmp/good.jpg', mimeType: 'image/jpeg', fileName: 'good.jpg', size: 1 },
      { path: 'file:///tmp/bad.jpg', mimeType: 'image/jpeg', fileName: 'bad.jpg', size: 1 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good.jpg');
  });
});
