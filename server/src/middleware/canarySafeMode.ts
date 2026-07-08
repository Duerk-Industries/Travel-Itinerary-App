import type { Request, Response, NextFunction } from 'express';
import { findUserByEmail, isInternalCanaryAccount } from '../db';
import { getEnvValue } from '../env';
import { logInfo } from '../logger';

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

// Defaults res.locals.canarySafeMode to false for any request that reaches
// this point before authentication has resolved a user. `authenticate()`
// (auth.ts) overwrites this with a fresh DB-backed value once req.user is
// set, since canary status is not embedded in the JWT payload.
export const canarySafeMode = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as Request & { user?: CanaryAwareUser }).user;
  res.locals.canarySafeMode = isInternalCanaryUser(user);
  next();
};

export const assertCanarySideEffectAllowed = (user: unknown, sideEffect: string): void => {
  if (!isInternalCanaryUser(user)) return;
  throw new Error(`Canary safe mode blocked side effect: ${sideEffect}`);
};

/**
 * Real enforcement point for outbound side effects (email, Stripe, push)
 * that are keyed by recipient email rather than an authenticated request's
 * req.user (e.g. transactional email senders). Returns true when the
 * recipient is the permanent internal canary account and the side effect
 * should be skipped/logged instead of actually dispatched.
 */
export const isCanaryRecipientEmail = async (email: string, sideEffect: string): Promise<boolean> => {
  // Most environments (local/dev/CI/most test files) have no canary account
  // configured at all; skip the DB round-trip entirely rather than making
  // every email-sending call site newly depend on a DB connection.
  const canaryAccountEmail = getEnvValue('CANARY_ACCOUNT_EMAIL');
  if (!canaryAccountEmail || canaryAccountEmail.trim().toLowerCase() !== email.trim().toLowerCase()) return false;
  const user = await findUserByEmail(email);
  if (!isInternalCanaryUser(user)) return false;
  logInfo(`[canarySafeMode] suppressed side effect "${sideEffect}" for internal canary account ${email}`);
  return true;
};

/**
 * Real enforcement point for outbound side effects keyed by userId (e.g.
 * Stripe billing operations, which already have the acting user's ID in
 * scope). Returns true when the side effect should be skipped/logged
 * instead of actually dispatched.
 */
export const isCanaryUserId = async (userId: string, sideEffect: string): Promise<boolean> => {
  // Same rationale as isCanaryRecipientEmail: skip the DB round-trip
  // entirely when no canary account is configured for this environment.
  if (!getEnvValue('CANARY_ACCOUNT_EMAIL')) return false;
  const canary = await isInternalCanaryAccount(userId);
  if (canary) {
    logInfo(`[canarySafeMode] suppressed side effect "${sideEffect}" for internal canary account ${userId}`);
  }
  return canary;
};
