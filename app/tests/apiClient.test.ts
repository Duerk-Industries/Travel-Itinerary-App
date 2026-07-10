/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { ApiClientError, requestJson } from '../utils/apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('injects auth headers and JSON-serializes plain object bodies', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '',
    } as Response);

    await requestJson('https://wanderbunnies.test/api/trips', {
      body: { name: 'Paris' },
      method: 'POST',
      token: 'token-123',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wanderbunnies.test/api/trips',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Paris' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('throws a parsed ApiClientError for non-ok responses', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden', code: 'NOPE' }),
      text: async () => '',
    } as Response);

    await expect(requestJson('https://wanderbunnies.test/api/groups')).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: 'ApiClientError',
        message: 'Forbidden',
        status: 403,
        code: 'NOPE',
      })
    );
  });
});
