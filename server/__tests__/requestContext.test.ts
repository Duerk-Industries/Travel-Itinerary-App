import {
  generateRequestId,
  getRequestContext,
  runWithRequestContext,
  setRequestContextUserId,
} from '../src/requestContext';

describe('requestContext', () => {
  it('returns undefined when called outside runWithRequestContext', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('exposes context inside a run', () => {
    runWithRequestContext({ requestId: 'abc', method: 'POST', path: '/x' }, () => {
      const ctx = getRequestContext();
      expect(ctx).toEqual({ requestId: 'abc', method: 'POST', path: '/x' });
    });
  });

  it('propagates context through async callbacks', async () => {
    await runWithRequestContext({ requestId: 'xyz' }, async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(getRequestContext()?.requestId).toBe('xyz');
    });
  });

  it('mutates userId on the active context', () => {
    runWithRequestContext({ requestId: 'r' }, () => {
      setRequestContextUserId('user-42');
      expect(getRequestContext()?.userId).toBe('user-42');
    });
  });

  it('setRequestContextUserId is a no-op when no context is active', () => {
    expect(() => setRequestContextUserId('x')).not.toThrow();
    expect(getRequestContext()).toBeUndefined();
  });

  it('generateRequestId produces distinct 16-char hex ids', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});
