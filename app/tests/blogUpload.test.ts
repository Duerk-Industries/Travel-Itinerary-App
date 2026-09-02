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

  it('forwards capture metadata to upload-init and omits it when absent', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ asset: { id: 'a1' }, uploadUrl: null }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'a1' }, 200));
    global.fetch = fetchMock as jest.Mock;

    await uploadOneBlogFile(
      { backendUrl: 'https://example.test', headers: {}, tripId: 'trip-1' },
      '2026-09-01',
      { blob: new Blob(['x']), mimeType: 'image/jpeg', size: 10, capturedAt: '2026-09-01T14:30:00', capturedLat: 48.85, capturedLng: 2.35 }
    );

    const initBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(initBody.capturedAt).toBe('2026-09-01T14:30:00');
    expect(initBody.capturedLat).toBe(48.85);
    expect(initBody.capturedLng).toBe(2.35);

    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ asset: { id: 'a2' }, uploadUrl: null }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'a2' }, 200));
    await uploadOneBlogFile(
      { backendUrl: 'https://example.test', headers: {}, tripId: 'trip-1' },
      '2026-09-01',
      { blob: new Blob(['x']), mimeType: 'image/jpeg', size: 10 }
    );
    const initBody2 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(initBody2.capturedAt).toBeNull();
    expect(initBody2.capturedLat).toBeNull();
  });

  it('does not throw a cyclic-JSON error when handed a non-string dayDate', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ asset: { id: 'a1' }, uploadUrl: null }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'a1' }, 200));
    global.fetch = fetchMock as jest.Mock;

    // A DOM-event-like object with a self-reference — exactly what a bare onPress handler leaks.
    const cyclic: any = { type: 'press' };
    cyclic.self = cyclic;

    const result = await uploadOneBlogFile(
      { backendUrl: 'https://example.test', headers: {}, tripId: 'trip-1' },
      cyclic,
      { blob: new Blob(['x']), mimeType: 'image/jpeg', size: 10 }
    );

    expect(result.outcome).toBe('ok');
    const initBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(typeof initBody.dayDate).toBe('string'); // coerced, not cyclic
  });
});
