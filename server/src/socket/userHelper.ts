/**
 * Resolve the display name of a user from the DB.
 * Falls back to email if no first/last name is set.
 */
import { getUserById } from '../db';
import { logError } from '../logger';

/** displayName cache: userId → name. Short TTL for live apps. */
const cache = new Map<string, { name: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export const getUserDisplayName = async (
  userId: string,
  fallbackEmail: string,
): Promise<string> => {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  try {
    const user = await getUserById(userId);
    if (user) {
      const firstName = (user as any).firstName ?? (user as any).first_name ?? '';
      const lastName = (user as any).lastName ?? (user as any).last_name ?? '';
      const full = `${firstName} ${lastName}`.trim();
      const name = full || user.email || fallbackEmail;
      cache.set(userId, { name, expiresAt: Date.now() + CACHE_TTL_MS });
      return name;
    }
  } catch (err) {
    logError('[userHelper] getUserById error', err);
  }

  return fallbackEmail;
};
