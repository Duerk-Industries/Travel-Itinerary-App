import type { ScreenCache } from './screenCache';

// Session credentials are held only in memory, outside query keys and persisted data.
const sessions = new Map<ScreenCache, string>();
export const registerScreenSession = (cache: ScreenCache, token: string) => {
  sessions.set(cache, token);
  return () => { sessions.delete(cache); };
};
export const findScreenSession = (url: string, token: string): ScreenCache | undefined =>
  [...sessions].find(([cache, credential]) => cache.isActive && credential === token &&
    (url === cache.owner.environment.replace(/\/$/, '') || url.startsWith(`${cache.owner.environment.replace(/\/$/, '')}/`)))?.[0];

type ResumeListener = { environment: string; token: string; resume: () => void };
const resumes = new Set<ResumeListener>();
export const areScreenReadsPaused = (environment: string, token?: string | null): boolean =>
  [...sessions].some(([cache, credential]) => cache.isActive && cache.owner.environment === environment && credential === token && cache.readsPaused);
export const subscribeScreenReadResume = (environment: string, token: string, resume: () => void) => {
  const listener = { environment, token, resume }; resumes.add(listener);
  return () => { resumes.delete(listener); };
};
export const notifyScreenReadResume = (cache: ScreenCache) => {
  queueMicrotask(() => {
    if (!cache.isActive || cache.readsPaused) return;
    const token = sessions.get(cache);
    for (const listener of resumes) if (listener.environment === cache.owner.environment && listener.token === token) listener.resume();
  });
};
