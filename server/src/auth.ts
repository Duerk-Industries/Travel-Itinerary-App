import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { findOrCreateUser, findOrCreateGoogleUser, getUserRole, ensureCurrentUserTier } from './db';
import { isPasswordSetupRequired } from './db';
import { User, UserRole } from './types';
import { getEnvValue } from './env';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import crypto from 'crypto';

const secret = getEnvValue('AUTH_SECRET', { defaultValue: 'development-secret' })!;

export const initPassport = () => {
    const googleClientId = getEnvValue('GOOGLE_CLIENT_ID');
    const googleClientSecret = getEnvValue('GOOGLE_CLIENT_SECRET');
    const googleCallbackUrl = getEnvValue('GOOGLE_CALLBACK_URL');
    if (googleClientId && googleClientSecret) {
        passport.use(new GoogleStrategy({
            clientID: googleClientId,
            clientSecret: googleClientSecret,
            callbackURL: googleCallbackUrl || '/api/auth/google/callback',
            scope: ['profile', 'email'],
        },
        async (_accessToken, _refreshToken, profile, done) => {
            const user = await findOrCreateGoogleUser(profile);
            return done(null, user);
        }));
    }

    passport.serializeUser((user, done) => {
        done(null, user);
    });

    passport.deserializeUser((user: User, done) => {
        done(null, user);
    });
};

export interface TokenPayload {
  userId: string;
  email: string;
  provider: User['provider'];
  role: UserRole;
}

export const createToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
};

export const createWebUserToken = (payload: { userId: string; username: string }): string => {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
};

type OAuthStatePayload = {
  redirectUri?: string;
  nonce: string;
};

const OAUTH_STATE_ISSUER = 'travel-itinerary-app';
const OAUTH_STATE_TTL = '10m';

export const createOAuthState = (payload: { redirectUri?: string }): string => {
  const nonce = crypto.randomBytes(16).toString('hex');
  const state: OAuthStatePayload = {
    redirectUri: payload.redirectUri,
    nonce,
  };
  return jwt.sign(state, secret, { expiresIn: OAUTH_STATE_TTL, issuer: OAUTH_STATE_ISSUER });
};

export const decodeOAuthState = (state: string): { redirectUri?: string } | null => {
  try {
    const decoded = jwt.verify(state, secret, { issuer: OAUTH_STATE_ISSUER }) as OAuthStatePayload;
    return { redirectUri: decoded.redirectUri };
  } catch {
    return null;
  }
};

const isPasswordSetupAllowlistedRequest = (req: Request): boolean => {
  if (req.method.toUpperCase() === 'OPTIONS') return true;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  const method = req.method.toUpperCase();
  if (method === 'PATCH' && path === '/api/account/password') return true;
  if (method === 'GET' && path === '/api/groups/invites') return true;
  if (method === 'POST' && /^\/api\/groups\/invites\/[^/]+\/(accept|reject)$/.test(path)) return true;
  return false;
};

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const [, token] = authHeader.split(' ');
  try {
    const decoded = jwt.verify(token, secret) as TokenPayload;
    const mustSetupPassword = await isPasswordSetupRequired(decoded.userId);
    if (mustSetupPassword && !isPasswordSetupAllowlistedRequest(req)) {
      res.status(403).json({ error: 'Password setup required before accessing this endpoint.' });
      return;
    }
    (req as Request & { user?: TokenPayload }).user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const handleLogin = async (
  email: string,
  provider: User['provider']
): Promise<{ token: string; user: User }> => {
  const user = await findOrCreateUser(email, provider);
  await ensureCurrentUserTier(user.id, 'free');
  const role = await getUserRole(user.id);
  const token = createToken({ userId: user.id, email: user.email, provider: user.provider, role });
  return { token, user };
};
