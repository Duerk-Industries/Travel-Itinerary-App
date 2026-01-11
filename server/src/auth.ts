import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { findOrCreateUser } from './db';
import { User } from './types';

const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET || 'development-secret';
export const authCookieName = 'auth_token';

interface TokenPayload {
  userId: string;
  email: string;
  provider: User['provider'];
}

export const createToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
};

export const createWebUserToken = (payload: { userId: string; username: string }): string => {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
};

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';');
      for (const cookie of cookies) {
        const [name, ...rest] = cookie.trim().split('=');
        if (name === authCookieName) {
          token = decodeURIComponent(rest.join('='));
          break;
        }
      }
    }
  }
  if (!token) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  try {
    const decoded = jwt.verify(token, secret) as TokenPayload;
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
  const token = createToken({ userId: user.id, email: user.email, provider: user.provider });
  return { token, user };
};
