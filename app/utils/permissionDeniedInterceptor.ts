import { notifyPermissionDenied } from './permissionDenied';

// Auth endpoints have their own dedicated 403 handling (email confirmation,
// password setup) — surfacing the generic permission modal for those would
// duplicate/clobber that UX, so they're excluded here.
//
// Map preview endpoints (/api/maps/*) are explicitly designed to fail silently — a disabled
// feature flag, missing API key, or rate limit should make the map preview quietly not render,
// not interrupt the user with a blocking dialog (see TripDayMap.tsx's own "progressive
// enhancement, not core functionality" comment). Their own component-level onError/catch handling
// already covers this; without this exclusion, TripDayMap's web-path authenticated fetch() (added
// to work around react-native-web dropping <Image source.headers>) gets caught by this global
// interceptor before that component-level handling ever runs.
const isExcludedUrl = (url: string): boolean =>
  url.includes('/api/auth') || url.includes('/api/web-auth') || url.includes('/api/maps');

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
