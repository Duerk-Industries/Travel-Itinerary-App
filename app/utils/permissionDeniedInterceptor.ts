import { notifyPermissionDenied } from './permissionDenied';

// Auth endpoints have their own dedicated 403 handling (email confirmation,
// password setup) — surfacing the generic permission modal for those would
// duplicate/clobber that UX, so they're excluded here.
const isExcludedUrl = (url: string): boolean => url.includes('/api/auth') || url.includes('/api/web-auth');

let installed = false;

export const installPermissionDeniedInterceptor = (): void => {
  if (installed || typeof fetch === 'undefined') return;
  installed = true;
  const originalFetch = fetch;
  (globalThis as any).fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (response.status === 403) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? '';
      if (!isExcludedUrl(url)) {
        try {
          const data = await response.clone().json();
          const message = data && typeof data.error === 'string' ? data.error : undefined;
          notifyPermissionDenied(message);
        } catch {
          notifyPermissionDenied();
        }
      }
    }
    return response;
  };
};
