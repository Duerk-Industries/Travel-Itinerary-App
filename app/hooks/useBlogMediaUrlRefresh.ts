import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

// Blog media read URLs last one hour. Refresh the document before they expire,
// including when a phone resumes after its timers were suspended.
const REFRESH_AFTER_MS = 45 * 60_000;

type BlogWithMedia = {
  days?: Array<{ items?: Array<{ primaryUrl?: string | null; thumbnailUrl?: string | null; assets?: Array<{ primaryUrl?: string | null; thumbnailUrl?: string | null }> }> }>;
} | null;

const hasMediaUrls = (blog: BlogWithMedia): boolean => Boolean(blog?.days?.some((day) => day.items?.some((item) =>
  item.primaryUrl || item.thumbnailUrl || item.assets?.some((asset) => asset.primaryUrl || asset.thumbnailUrl)
)));

export const useBlogMediaUrlRefresh = (blog: BlogWithMedia, refresh: () => Promise<unknown> | void): void => {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const receivedAt = useRef(Date.now());
  const inFlight = useRef(false);

  useEffect(() => { receivedAt.current = Date.now(); }, [blog]);

  useEffect(() => {
    if (!hasMediaUrls(blog)) return;
    const check = () => {
      if (inFlight.current || Date.now() - receivedAt.current < REFRESH_AFTER_MS) return;
      inFlight.current = true;
      Promise.resolve(refreshRef.current()).catch(() => undefined).finally(() => { inFlight.current = false; });
    };
    const timer = setInterval(check, 60_000);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisible = () => { if (!document.hidden) check(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', check);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', check);
      };
    }
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [blog]);
};
