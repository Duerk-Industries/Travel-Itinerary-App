/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { subscribePermissionDenied } from '../utils/permissionDenied';
import { installPermissionDeniedInterceptor } from '../utils/permissionDeniedInterceptor';
import { subscribeAgeVerificationRequired } from '../utils/ageVerificationRequired';

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    status,
    clone() { return this; },
    json: async () => body,
  } as unknown as Response);

describe('installPermissionDeniedInterceptor', () => {
  let messages: string[];
  let unsubscribe: () => void;

  beforeAll(() => {
    // The interceptor installs itself exactly once (module-level `installed` flag, no reset
    // hook) and captures whatever `fetch` is current at install time as the real network call —
    // so the mock must be in place first, and installation must happen only once for this file.
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      if (url.includes('/api/auth')) return jsonResponse(403, { error: 'auth endpoint denied' });
      if (url.includes('/api/web-auth')) return jsonResponse(403, { error: 'web-auth endpoint denied' });
      if (url.includes('/api/maps')) return jsonResponse(403, { error: 'Trip day map is currently disabled' });
      if (url.includes('/api/other')) return jsonResponse(403, { error: 'generic denial' });
      if (url.includes('/api/trips')) return jsonResponse(403, { error: 'Date of birth required before accessing this endpoint.', code: 'AGE_VERIFICATION_REQUIRED' });
      return jsonResponse(200, {});
    }) as any;
    installPermissionDeniedInterceptor();
  });

  beforeEach(() => {
    messages = [];
    unsubscribe = subscribePermissionDenied((message) => messages.push(message));
  });

  afterEach(() => {
    unsubscribe();
  });

  it('shows the permission-denied modal for a 403 from a non-excluded endpoint', async () => {
    await fetch('/api/other/thing');
    expect(messages).toEqual(['generic denial']);
  });

  it('asks for a date of birth instead of showing "Permission Denied" for an age-gate 403', async () => {
    let prompts = 0;
    const stop = subscribeAgeVerificationRequired(() => { prompts += 1; });
    await fetch('/api/trips');
    stop();
    expect(prompts).toBe(1);
    expect(messages).toEqual([]);
  });

  it('does not surface a 403 from /api/auth', async () => {
    await fetch('/api/auth/login');
    expect(messages).toEqual([]);
  });

  it('does not surface a 403 from /api/web-auth', async () => {
    await fetch('/api/web-auth/session');
    expect(messages).toEqual([]);
  });

  it('does not surface a 403 from /api/maps (progressive-enhancement map previews fail silently)', async () => {
    await fetch('/api/maps/trip-day?points=%5B%5D');
    expect(messages).toEqual([]);
  });

  it('still returns the response itself even when the 403 is excluded from the modal', async () => {
    const response = await fetch('/api/maps/trip-day?points=%5B%5D');
    expect(response.status).toBe(403);
  });
});
