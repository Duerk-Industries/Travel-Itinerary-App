import { uploadOneBlogFile } from '../utils/blogUpload';

const jsonResponse = (body: unknown, status: number): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as Response);

describe('blog media upload finalization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports quota exhaustion when generated rendition overhead is rejected at completion', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ asset: { id: 'asset-1' }, uploadUrl: null }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: 'QUOTA_EXCEEDED', code: 'QUOTA_EXCEEDED' }, 413)) as jest.Mock;

    const result = await uploadOneBlogFile(
      { backendUrl: 'https://example.test', headers: { Authorization: 'Bearer token' }, tripId: 'trip-1' },
      '2026-09-01',
      { blob: new Blob(['photo']), mimeType: 'image/jpeg', size: 463990 }
    );

    expect(result).toEqual({ outcome: 'quota_exceeded' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
