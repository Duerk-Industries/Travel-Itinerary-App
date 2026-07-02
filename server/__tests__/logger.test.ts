/// <reference types="jest" />
/// <reference types="node" />
describe('logger', () => {
  const originalLogFormat = process.env.LOG_FORMAT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKService = process.env.K_SERVICE;

  const restoreEnv = () => {
    if (originalLogFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalLogFormat;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalKService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalKService;
  };

  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    restoreEnv();
  });

  it('emits text-format logs by default in development', () => {
    delete process.env.LOG_FORMAT;
    delete process.env.NODE_ENV;
    delete process.env.K_SERVICE;
    const { logInfo } = require('../src/logger');
    logInfo('hello world');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain('[info]');
    expect(line).toContain('hello world');
  });

  it('emits JSON-format logs when LOG_FORMAT=json', () => {
    process.env.LOG_FORMAT = 'json';
    const { logInfo } = require('../src/logger');
    logInfo('hello world');
    const line = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: 'info', message: 'hello world' });
    expect(typeof parsed.time).toBe('string');
  });

  it('includes request context fields when running inside runWithRequestContext', () => {
    process.env.LOG_FORMAT = 'json';
    const { logInfo } = require('../src/logger');
    const { runWithRequestContext } = require('../src/requestContext');
    runWithRequestContext(
      { requestId: 'abc123', method: 'GET', path: '/api/x', userId: 'user-1' },
      () => logInfo('inside')
    );
    const line = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      requestId: 'abc123',
      method: 'GET',
      path: '/api/x',
      userId: 'user-1',
    });
  });

  it('redacts sensitive keys in JSON error payloads', () => {
    process.env.LOG_FORMAT = 'json';
    const { logError } = require('../src/logger');
    logError('failed', {
      payload: {
        password: 'hunter2',
        authToken: 'abc',
        safe: 'ok',
        nested: { api_key: 'xyz' },
      },
    });
    const line = errorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    const error = parsed.error as Record<string, unknown>;
    const payload = error.payload as Record<string, unknown>;
    expect(payload.password).toBe('[REDACTED]');
    expect(payload.authToken).toBe('[REDACTED]');
    expect(payload.safe).toBe('ok');
    expect((payload.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
  });

  it('redacts the expanded set of sensitive key patterns', () => {
    process.env.LOG_FORMAT = 'json';
    const { logError } = require('../src/logger');
    logError('failed', {
      payload: {
        newPassword: 'super-secret',
        currentPwd: 'old-secret',
        idToken: 'eyJ...',
        bearerToken: 'Bearer xyz',
        jwt: 'a.b.c',
        sessionId: 'sess-1',
        credential: { user: 'u', password: 'p' },
        privateKey: '-----BEGIN----',
        userId: 'user-123',
        email: 'alice@example.com',
      },
    });
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    const payload = (parsed.error as any).payload as Record<string, unknown>;
    expect(payload.newPassword).toBe('[REDACTED]');
    expect(payload.currentPwd).toBe('[REDACTED]');
    expect(payload.idToken).toBe('[REDACTED]');
    expect(payload.bearerToken).toBe('[REDACTED]');
    expect(payload.jwt).toBe('[REDACTED]');
    expect(payload.sessionId).toBe('[REDACTED]');
    expect(payload.credential).toBe('[REDACTED]');
    expect(payload.privateKey).toBe('[REDACTED]');
    // Non-sensitive keys remain visible.
    expect(payload.userId).toBe('user-123');
    expect(payload.email).toBe('alice@example.com');
  });

  it('formats Error objects with name/message/stack in JSON mode', () => {
    process.env.LOG_FORMAT = 'json';
    const { logError } = require('../src/logger');
    const err = new Error('boom');
    logError('context', err);
    const line = errorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.error).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof parsed.error.stack).toBe('string');
  });

  it('includes request ID suffix in text mode when inside a context', () => {
    delete process.env.LOG_FORMAT;
    delete process.env.NODE_ENV;
    delete process.env.K_SERVICE;
    const { logInfo } = require('../src/logger');
    const { runWithRequestContext } = require('../src/requestContext');
    runWithRequestContext({ requestId: 'req-99' }, () => logInfo('msg'));
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain('[req=req-99]');
    expect(line).toContain('msg');
  });
});
