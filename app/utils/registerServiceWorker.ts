export type OfflineShellStatus = 'registered' | 'disabled' | 'unsupported' | 'skipped-dev' | 'failed';

type Env = {
  nodeEnv?: string;
  disabled?: boolean;
  /** Injected for tests; defaults to the browser globals. */
  win?: Pick<Window, 'addEventListener' | 'location'> & { document?: Pick<Document, 'readyState'>; caches?: CacheStorage };
  nav?: { serviceWorker?: Pick<ServiceWorkerContainer, 'register' | 'getRegistrations'> };
};

const CACHE_PREFIX = 'wb-';

const isSecureEnough = (win: NonNullable<Env['win']>): boolean => {
  const { protocol, hostname } = win.location;
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
};

/** Removes the worker and its caches. Also the rollback path: build with EXPO_PUBLIC_DISABLE_OFFLINE_SHELL=1. */
export const removeOfflineShell = async (env: Env = {}): Promise<void> => {
  const nav = env.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const win = env.win ?? (typeof window !== 'undefined' ? window : undefined);
  try {
    const registrations = (await nav?.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = (await win?.caches?.keys?.()) ?? [];
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => win?.caches?.delete(name)));
  } catch {
    // Best effort: a browser that refuses cleanup keeps working with whatever it has.
  }
};

/**
 * Registers the offline-shell worker (public/sw.js) once the page has loaded, so it never competes with
 * the first render. Web, production builds, secure origins only.
 */
export const registerOfflineShell = async (env: Env = {}): Promise<OfflineShellStatus> => {
  const win = env.win ?? (typeof window !== 'undefined' ? window : undefined);
  const nav = env.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  if (!win || !nav?.serviceWorker) return 'unsupported';

  const disabled = env.disabled ?? process.env.EXPO_PUBLIC_DISABLE_OFFLINE_SHELL === '1';
  if (disabled) {
    await removeOfflineShell({ win, nav });
    return 'disabled';
  }
  // Dev builds change constantly and a cached shell would hide those changes.
  if ((env.nodeEnv ?? process.env.NODE_ENV) !== 'production') return 'skipped-dev';
  if (!isSecureEnough(win)) return 'unsupported';

  const register = async (): Promise<OfflineShellStatus> => {
    try {
      await nav.serviceWorker!.register('/sw.js', { scope: '/' });
      return 'registered';
    } catch {
      return 'failed';
    }
  };
  if (win.document?.readyState === 'complete') return register();
  return new Promise<OfflineShellStatus>((resolve) => {
    win.addEventListener('load', () => void register().then(resolve), { once: true });
  });
};
