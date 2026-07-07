import type { Request, Response, NextFunction } from 'express';

export type CanaryAwareUser = {
  id?: string;
  is_internal_canary?: boolean;
  isInternalCanary?: boolean;
};

export const isInternalCanaryUser = (user: unknown): boolean => {
  if (!user || typeof user !== 'object') return false;
  const candidate = user as CanaryAwareUser;
  return candidate.is_internal_canary === true || candidate.isInternalCanary === true;
};

export const canarySafeMode = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as Request & { user?: CanaryAwareUser }).user;
  res.locals.canarySafeMode = isInternalCanaryUser(user);
  next();
};

export const assertCanarySideEffectAllowed = (user: unknown, sideEffect: string): void => {
  if (!isInternalCanaryUser(user)) return;
  throw new Error(`Canary safe mode blocked side effect: ${sideEffect}`);
};
