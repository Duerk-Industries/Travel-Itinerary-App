/// <reference types="jest" />
/// <reference types="node" />
import jwt from 'jsonwebtoken';
import { createToken, createWebUserToken, verifyToken } from '../src/auth';
import { getAuthAudience, getAuthIssuer, getAuthSecret } from '../src/authConfig';

describe('auth token verification', () => {
  afterEach(() => {
    delete process.env.AUTH_ISSUER;
    delete process.env.AUTH_AUDIENCE;
  });

  it('rejects a token signed with the wrong issuer', () => {
    const token = jwt.sign(
      { userId: 'user-1', email: 'issuer@example.com', provider: 'email', role: 'user' },
      getAuthSecret(),
      { expiresIn: '1h', issuer: 'wrong-issuer', audience: getAuthAudience() }
    );

    expect(() => verifyToken(token)).toThrow(/issuer/i);
  });

  it('rejects a token signed with the wrong audience', () => {
    const token = jwt.sign(
      { userId: 'user-1', email: 'aud@example.com', provider: 'email', role: 'user' },
      getAuthSecret(),
      { expiresIn: '1h', issuer: getAuthIssuer(), audience: 'wrong-audience' }
    );

    expect(() => verifyToken(token)).toThrow(/audience/i);
  });

  it('issues app and web tokens that remain valid for the 30-day offline access period', () => {
    const mobileToken = createToken({
      userId: 'user-1',
      email: 'traveler@example.com',
      provider: 'email',
      role: 'user',
    });
    const webToken = createWebUserToken({ userId: 'user-1', username: 'traveler' });
    const lifetimeInSeconds = (token: string): number => {
      const decoded = jwt.decode(token);
      if (!decoded || typeof decoded === 'string' || !decoded.iat || !decoded.exp) {
        throw new Error('Expected a token with issued-at and expiration claims');
      }
      return decoded.exp - decoded.iat;
    };

    expect(lifetimeInSeconds(mobileToken)).toBe(30 * 24 * 60 * 60);
    expect(lifetimeInSeconds(webToken)).toBe(30 * 24 * 60 * 60);
  });
});
