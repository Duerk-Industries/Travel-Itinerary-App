import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '../auth';

/**
 * Middleware that rejects requests from non-admin users.
 * Must be used after the `authenticate` middleware (which attaches req.user).
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as Request & { user?: TokenPayload }).user;
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};
