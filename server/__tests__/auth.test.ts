import jwt from 'jsonwebtoken';

describe('auth token verification', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.AUTH_ISSUER;
    delete process.env.AUTH_AUDIENCE;
  });

  it('rejects a token signed with the wrong issuer', async () => {
    const { getAuthAudience, getAuthSecret } = await import('../src/authConfig');
    const { verifyToken } = await import('../src/auth');
    const token = jwt.sign(
      { userId: 'user-1', email: 'issuer@example.com', provider: 'email', role: 'user' },
      getAuthSecret(),
      { expiresIn: '1h', issuer: 'wrong-issuer', audience: getAuthAudience() }
    );

    expect(() => verifyToken(token)).toThrow(/issuer/i);
  });

  it('rejects a token signed with the wrong audience', async () => {
    const { getAuthIssuer, getAuthSecret } = await import('../src/authConfig');
    const { verifyToken } = await import('../src/auth');
    const token = jwt.sign(
      { userId: 'user-1', email: 'aud@example.com', provider: 'email', role: 'user' },
      getAuthSecret(),
      { expiresIn: '1h', issuer: getAuthIssuer(), audience: 'wrong-audience' }
    );

    expect(() => verifyToken(token)).toThrow(/audience/i);
  });
});
